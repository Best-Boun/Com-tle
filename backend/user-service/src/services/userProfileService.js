const { z } = require("zod");
const { USER_ROLES } = require("../../../shared/constants");
const AppError = require("../../../shared/errors/AppError");
const { createAuditLogService } = require("./auditLogService");
const { withDeadlockRetry, isDeadlockError } = require("./customerLocking");

const validRoleCodes = new Set(Object.values(USER_ROLES));
const updateSchema = z.object({
    full_name: z.string().trim().min(1).max(150).optional(),
    phone: z.union([z.string().trim().min(1).max(30), z.null()]).optional()
}).strict().refine((value) => Object.keys(value).length > 0);

function createUserProfileService({ db }) {
    if (!db) {
        throw new Error("Database is required");
    }
    const auditLog = createAuditLogService();

    async function readProfile(query, userId) {
        const user = await query("users")
            .select("user_id", "email", "phone", "status")
            .where({ user_id: userId })
            .first();
        if (!user) {
            throw new AppError("User profile not found", 404);
        }

        const customer = await query("customers")
            .select("full_name", "customer_type")
            .where({ user_id: userId })
            .first();
        if (!customer) {
            throw new AppError("User profile not found", 404);
        }

        const assignedRows = await query("user_roles")
            .join("roles", "user_roles.role_id", "roles.role_id")
            .select("roles.role_code")
            .where({ "user_roles.user_id": userId })
            .orderBy("roles.role_code");

        return {
            user_id: user.user_id,
            email: user.email,
            phone: user.phone,
            status: user.status,
            full_name: customer.full_name,
            customer_type: customer.customer_type,
            roles: [...new Set(
                assignedRows
                    .map((row) => row.role_code)
                    .filter((roleCode) => validRoleCodes.has(roleCode))
            )]
        };
    }

    async function getProfile(userId) {
        try {
            return await readProfile(db, userId);
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError("User profile service unavailable", 503);
        }
    }

    async function updateProfile(userId, input, requestId = null) {
        const parsed = updateSchema.safeParse(input);
        if (!parsed.success) {
            throw new AppError("Invalid profile update", 400);
        }

        try {
            return await withDeadlockRetry(() => db.transaction(async (trx) => {
                const user = await trx("users")
                    .select("user_id")
                    .where({ user_id: userId })
                    .forUpdate()
                    .first();
                const customer = await trx("customers")
                    .select("customer_id", "customer_type")
                    .where({ user_id: userId })
                    .forUpdate()
                    .first();
                if (!user || !customer) {
                    throw new AppError("User profile not found", 404);
                }
                if (customer.customer_type === "MERGED") {
                    throw new AppError("Merged customer profile cannot be updated", 409);
                }

                const updates = parsed.data;
                if (Object.hasOwn(updates, "phone")) {
                    await trx("users")
                        .where({ user_id: userId })
                        .update({ phone: updates.phone });
                    await trx("customers")
                        .where({ user_id: userId })
                        .update({ phone: updates.phone });
                }

                if (Object.hasOwn(updates, "full_name")) {
                    await trx("customers")
                        .where({ user_id: userId })
                        .update({ full_name: updates.full_name });
                }

                await auditLog.record(trx, {
                    actor_user_id: userId,
                    action: "USER.PROFILE_UPDATED",
                    target_entity_type: "user",
                    target_entity_id: userId,
                    outcome: "SUCCESS",
                    request_id: requestId,
                    metadata: { changed_fields: Object.keys(updates) }
                });

                return await readProfile(trx, userId);
            }));
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            if (isDeadlockError(error)) {
                throw new AppError("User profile service unavailable after deadlock retries", 503);
            }
            throw new AppError("User profile service unavailable", 503);
        }
    }

    return { getProfile, updateProfile };
}

module.exports = {
    createUserProfileService
};
