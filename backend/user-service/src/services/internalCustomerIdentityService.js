const { z } = require("zod");
const AppError = require("../../../shared/errors/AppError");
const { createAuditLogService } = require("./auditLogService");

const requestSchema = z.object({
    user_id: z.string().min(1).max(36)
}).strict();

function createInternalCustomerIdentityService({
    db,
    verifyUserAccessToken,
    auditLog = createAuditLogService()
} = {}) {
    if (typeof db !== "function"
        || typeof verifyUserAccessToken !== "function"
        || !auditLog
        || typeof auditLog.record !== "function") {
        throw new Error("Database, User JWT verifier, and audit logger are required");
    }

    async function recordAttempt({
        serviceId,
        userId = null,
        requestId = null,
        success,
        reason
    }) {
        await db.transaction(async (trx) => {
            await auditLog.record(trx, {
                actor_user_id: null,
                action: success
                    ? "INTERNAL.CUSTOMER_IDENTITY_RESOLVED"
                    : "INTERNAL.CUSTOMER_IDENTITY_DENIED",
                target_entity_type: "user",
                target_entity_id: userId,
                outcome: success ? "SUCCESS" : "FAILURE",
                request_id: requestId,
                metadata: {
                    calling_service: serviceId,
                    reason
                }
            });
        });
    }

    async function recordMalformedRequest(serviceAuth, requestId = null) {
        const serviceId = typeof serviceAuth?.serviceId === "string"
            ? serviceAuth.serviceId
            : "unknown";
        const authorized = serviceId === "payment-service";
        try {
            await recordAttempt({
                serviceId,
                requestId,
                success: false,
                reason: authorized ? "MALFORMED_REQUEST" : "CALLER_NOT_ALLOWED"
            });
        } catch {
            throw new AppError("Customer identity service unavailable", 503);
        }
        if (!authorized) {
            throw new AppError("Internal service is not authorized", 403);
        }
    }

    async function resolveRegisteredCustomerByUserId(
        serviceAuth,
        input,
        userAccessToken,
        requestId = null
    ) {
        const serviceId = typeof serviceAuth?.serviceId === "string"
            ? serviceAuth.serviceId
            : "unknown";
        if (serviceId !== "payment-service") {
            try {
                await recordAttempt({
                    serviceId,
                    requestId,
                    success: false,
                    reason: "CALLER_NOT_ALLOWED"
                });
            } catch {
                throw new AppError("Customer identity service unavailable", 503);
            }
            throw new AppError("Internal service is not authorized", 403);
        }

        let claims;
        try {
            if (typeof userAccessToken !== "string" || !userAccessToken) {
                throw new Error("User access token is required");
            }
            claims = verifyUserAccessToken(userAccessToken);
            if (!claims
                || claims.token_use !== "user_access"
                || typeof claims.sub !== "string"
                || !claims.sub.trim()) {
                throw new Error("Invalid User access token");
            }
        } catch {
            try {
                await recordAttempt({
                    serviceId,
                    requestId,
                    success: false,
                    reason: "INVALID_USER_TOKEN"
                });
            } catch {
                throw new AppError("Customer identity service unavailable", 503);
            }
            throw new AppError("Invalid or expired User access token", 401);
        }

        const parsed = requestSchema.safeParse(input);
        if (!parsed.success) {
            try {
                await recordAttempt({
                    serviceId,
                    userId: claims.sub,
                    requestId,
                    success: false,
                    reason: "INVALID_REQUEST"
                });
            } catch {
                throw new AppError("Customer identity service unavailable", 503);
            }
            throw new AppError("Invalid customer identity request", 400);
        }

        if (parsed.data.user_id !== claims.sub) {
            try {
                await recordAttempt({
                    serviceId,
                    userId: claims.sub,
                    requestId,
                    success: false,
                    reason: "USER_SUBJECT_MISMATCH"
                });
            } catch {
                throw new AppError("Customer identity service unavailable", 503);
            }
            throw new AppError("Invalid or expired User access token", 401);
        }

        let result;
        try {
            result = await db.transaction(async (trx) => {
                const user = await trx("users")
                    .select("user_id", "status")
                    .where({ user_id: claims.sub })
                    .first();
                let customer;
                let reason = "MAPPING_NOT_FOUND";
                let conflict = false;

                if (user?.status === "ACTIVE") {
                    const customers = await trx("customers")
                        .select("customer_id", "user_id", "customer_type")
                        .where({ user_id: claims.sub });
                    if (customers.length > 1) {
                        reason = "MAPPING_INTEGRITY_CONFLICT";
                        conflict = true;
                    } else if (customers.length === 1
                        && customers[0].user_id === claims.sub
                        && customers[0].customer_type === "REGISTERED") {
                        customer = customers[0];
                        reason = "RESOLVED";
                    }
                }

                await auditLog.record(trx, {
                    actor_user_id: null,
                    action: customer
                        ? "INTERNAL.CUSTOMER_IDENTITY_RESOLVED"
                        : "INTERNAL.CUSTOMER_IDENTITY_DENIED",
                    target_entity_type: "user",
                    target_entity_id: claims.sub,
                    outcome: customer ? "SUCCESS" : "FAILURE",
                    request_id: requestId,
                    metadata: {
                        calling_service: serviceId,
                        reason
                    }
                });

                if (conflict) {
                    return { conflict: true };
                }
                if (!customer) {
                    return { notFound: true };
                }
                return {
                    user_id: claims.sub,
                    customer_id: customer.customer_id,
                    customer_type: "REGISTERED"
                };
            });
        } catch {
            throw new AppError("Customer identity service unavailable", 503);
        }

        if (result?.conflict) {
            throw new AppError("Customer identity mapping conflict", 409);
        }
        if (result?.notFound) {
            throw new AppError("Customer identity not found", 404);
        }
        return result;
    }

    return {
        recordMalformedRequest,
        resolveRegisteredCustomerByUserId
    };
}

module.exports = {
    createInternalCustomerIdentityService
};
