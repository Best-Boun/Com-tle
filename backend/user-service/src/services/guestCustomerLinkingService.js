const { z } = require("zod");
const AppError = require("../../../shared/errors/AppError");
const { createAuditLogService } = require("./auditLogService");
const { lockUsers, lockCustomers, withDeadlockRetry, isDeadlockError } = require("./customerLocking");

const customerIdSchema = z.string().trim().min(1).max(36);
const userIdSchema = z.string().trim().min(1).max(36);
const MAX_MAPPING_ATTEMPTS = 3;

class MappingChangedError extends Error {
    constructor() {
        super("Customer mapping changed during linking");
    }
}

function isDuplicateKeyError(error) {
    return error.code === "ER_DUP_ENTRY" || error.errno === 1062;
}

function createGuestCustomerLinkingService({ db, verifyIdentity } = {}) {
    if (!db || typeof verifyIdentity !== "function") {
        throw new Error("Database and trusted identity verifier are required");
    }
    const auditLog = createAuditLogService();

    async function linkGuestCustomer(customerId, identityEvidence, requestId = null) {
        const parsedCustomerId = customerIdSchema.safeParse(customerId);
        if (!parsedCustomerId.success || identityEvidence === undefined
            || identityEvidence === null) {
            throw new AppError("Invalid guest customer linking request", 400);
        }

        let verifiedUserId;
        try {
            verifiedUserId = await verifyIdentity(identityEvidence);
        } catch {
            throw new AppError("Identity verification unavailable", 503);
        }
        if (typeof verifiedUserId !== "string"
            || !userIdSchema.safeParse(verifiedUserId).success) {
            throw new AppError("Identity verification is required", 403);
        }
        verifiedUserId = verifiedUserId.trim();

        try {
            return await withDeadlockRetry(async () => {
                for (let attempt = 1; ; attempt += 1) {
                    try {
                        return await db.transaction(async (trx) => {
                            const users = await lockUsers(trx, [verifiedUserId]);
                            const discovered = await trx("customers")
                                .select("customer_id")
                                .where({ user_id: verifiedUserId })
                                .first();
                            const customers = await lockCustomers(trx, [
                                parsedCustomerId.data,
                                ...(discovered ? [discovered.customer_id] : [])
                            ]);
                            const current = await trx("customers")
                                .select("customer_id")
                                .where({ user_id: verifiedUserId })
                                .first();
                            if ((discovered?.customer_id ?? null) !== (current?.customer_id ?? null)) {
                                throw new MappingChangedError();
                            }
                            const customer = customers.get(parsedCustomerId.data);
                            if (!customer) {
                                throw new AppError("Customer not found", 404);
                            }
                            if (customer.customer_type !== "GUEST" || customer.user_id !== null) {
                                throw new AppError("Customer is already registered", 409);
                            }

                            const user = users.get(verifiedUserId);
                            if (!user) {
                                throw new AppError("User not found", 404);
                            }
                            if (user.status !== "ACTIVE") {
                                throw new AppError("User account is not eligible for linking", 409);
                            }
                            if (current) {
                                throw new AppError("User already has a customer profile", 409);
                            }

                            const updated = await trx("customers")
                                .where({
                                    customer_id: customer.customer_id,
                                    customer_type: "GUEST",
                                    user_id: null
                                })
                                .update({
                                    user_id: verifiedUserId,
                                    customer_type: "REGISTERED"
                                });
                            if (updated !== 1) {
                                throw new AppError("Customer is already registered", 409);
                            }

                            await auditLog.record(trx, {
                                actor_user_id: null,
                                action: "CUSTOMER.GUEST_LINKED",
                                target_entity_type: "customer",
                                target_entity_id: customer.customer_id,
                                outcome: "SUCCESS",
                                request_id: requestId,
                                metadata: { linked_user_id: verifiedUserId }
                            });

                            return {
                                customer_id: customer.customer_id,
                                user_id: verifiedUserId,
                                customer_type: "REGISTERED"
                            };
                        }, { isolationLevel: "read committed" });
                    } catch (error) {
                        if (!(error instanceof MappingChangedError) || attempt === MAX_MAPPING_ATTEMPTS) {
                            throw error;
                        }
                    }
                }
            });
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            if (isDuplicateKeyError(error)) {
                throw new AppError("User already has a customer profile", 409);
            }
            if (error instanceof MappingChangedError) {
                throw new AppError("Guest customer linking unavailable after mapping retries", 503);
            }
            if (isDeadlockError(error)) {
                throw new AppError("Guest customer linking unavailable after deadlock retries", 503);
            }
            throw new AppError("Guest customer linking unavailable", 503);
        }
    }

    return { linkGuestCustomer };
}

module.exports = {
    createGuestCustomerLinkingService
};
