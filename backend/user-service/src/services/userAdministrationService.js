const { USER_ROLES } = require("../../../shared/constants");
const AppError = require("../../../shared/errors/AppError");
const { createAuditLogService } = require("./auditLogService");
const { z } = require("zod");

const userStatuses = ["ACTIVE", "DISABLED", "LOCKED"];
const userIdSchema = z.string().trim().min(1).max(36);
const listOptionsSchema = z.object({
    page: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER / 100).optional(),
    page_size: z.coerce.number().int().min(1).max(100).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    search: z.string().trim().min(1).max(100).optional(),
    status: z.enum(userStatuses).optional(),
    role: z.enum(Object.values(USER_ROLES)).optional()
}).strict().refine((value) => value.page_size === undefined
    || value.limit === undefined
    || value.page_size === value.limit);
const targetStatusSchema = z.object({
    status: z.enum(["ACTIVE", "DISABLED"])
}).strict();
const targetRoleSchema = z.object({
    role_code: z.enum([USER_ROLES.CUSTOMER, USER_ROLES.TECHNICIAN])
}).strict();

function escapeLike(value) {
    return value.replace(/[\\%_]/g, "\\$&");
}

function applyFilters(query, db, options) {
    if (options.status) {
        query.where("u.status", options.status);
    }

    if (options.search) {
        const searchPattern = `%${escapeLike(options.search)}%`;
        query.where(function matchSearch() {
            this.where("u.email", "like", searchPattern)
                .orWhere("u.phone", "like", searchPattern)
                .orWhere("c.phone", "like", searchPattern)
                .orWhere("c.full_name", "like", searchPattern);
        });
    }

    if (options.role) {
        query.whereExists(function hasRole() {
            this.select(db.raw("1"))
                .from("user_roles as ur")
                .join("roles as r", "ur.role_id", "r.role_id")
                .whereRaw("ur.user_id = u.user_id")
                .andWhere("r.role_code", options.role);
        });
    }

    return query;
}

function createUserAdministrationService({ db }) {
    if (!db) {
        throw new Error("Database is required");
    }
    const auditLog = createAuditLogService();
    // Business rejections are audited; malformed input (400) and outages (503) are not.
    const auditedFailureStatuses = new Set([403, 404, 409]);

    async function recordFailure(action, actorId, targetUserId, metadata, error, requestId) {
        if (!(error instanceof AppError) || !auditedFailureStatuses.has(error.statusCode)) {
            return;
        }
        try {
            await db.transaction((trx) => auditLog.record(trx, {
                actor_user_id: actorId,
                action,
                target_entity_type: "user",
                target_entity_id: targetUserId,
                outcome: "FAILURE",
                request_id: requestId,
                metadata: { ...metadata, reason: error.message }
            }));
        } catch {
            throw new AppError("User administration service unavailable", 503);
        }
    }

    function userQuery() {
        return db("users as u")
            .leftJoin("customers as c", "c.user_id", "u.user_id");
    }

    async function loadRoles(userIds) {
        if (userIds.length === 0) {
            return new Map();
        }

        const assignments = await db("user_roles as ur")
            .join("roles as r", "ur.role_id", "r.role_id")
            .select("ur.user_id", "r.role_code")
            .whereIn("ur.user_id", userIds)
            .orderBy("r.role_code");
        const rolesByUser = new Map(userIds.map((userId) => [userId, []]));
        for (const assignment of assignments) {
            if (rolesByUser.has(assignment.user_id)
                && Object.values(USER_ROLES).includes(assignment.role_code)
                && !rolesByUser.get(assignment.user_id).includes(assignment.role_code)) {
                rolesByUser.get(assignment.user_id).push(assignment.role_code);
            }
        }
        return rolesByUser;
    }

    async function listUsers(input = {}) {
        const parsed = listOptionsSchema.safeParse(input);
        if (!parsed.success) {
            throw new AppError("Invalid user list filters", 400);
        }

        try {
            const options = {
                ...parsed.data,
                page: parsed.data.page || 1,
                page_size: parsed.data.limit || parsed.data.page_size || 25
            };
            const filteredQuery = applyFilters(userQuery(), db, options);
            const countRow = await filteredQuery.clone()
                .clearSelect()
                .clearOrder()
                .count({ total: "u.user_id" })
                .first();
            const rows = await filteredQuery
                .select(
                    "u.user_id",
                    "u.email",
                    "u.phone",
                    "u.status",
                    "c.full_name",
                    "c.customer_type"
                )
                .orderBy("u.email")
                .orderBy("u.user_id")
                .limit(options.page_size)
                .offset((options.page - 1) * options.page_size);
            const rolesByUser = await loadRoles(rows.map((row) => row.user_id));
            const total = Number(countRow.total);

            return {
                items: rows.map((row) => ({
                    user_id: row.user_id,
                    email: row.email,
                    phone: row.phone,
                    status: row.status,
                    full_name: row.full_name,
                    customer_type: row.customer_type,
                    roles: rolesByUser.get(row.user_id) || []
                })),
                pagination: {
                    page: options.page,
                    page_size: options.page_size,
                    total,
                    total_pages: Math.ceil(total / options.page_size)
                }
            };
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError("User administration service unavailable", 503);
        }
    }

    async function getUserDetails(userId) {
        const parsedUserId = userIdSchema.safeParse(userId);
        if (!parsedUserId.success) {
            throw new AppError("Invalid user ID", 400);
        }
        userId = parsedUserId.data;

        try {
            const user = await userQuery()
                .select(
                    "u.user_id",
                    "u.email",
                    "u.phone",
                    "u.status",
                    "c.customer_id",
                    "c.full_name",
                    "c.phone as customer_phone",
                    "c.email as customer_email",
                    "c.customer_type"
                )
                .where("u.user_id", userId)
                .first();
            if (!user) {
                throw new AppError("User not found", 404);
            }

            const rolesByUser = await loadRoles([user.user_id]);
            return {
                user_id: user.user_id,
                email: user.email,
                phone: user.phone,
                status: user.status,
                customer: user.customer_id
                    ? {
                        customer_id: user.customer_id,
                        full_name: user.full_name,
                        email: user.customer_email,
                        phone: user.customer_phone,
                        customer_type: user.customer_type
                    }
                    : null,
                roles: rolesByUser.get(user.user_id) || []
            };
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError("User administration service unavailable", 503);
        }
    }

    async function lockAdminRole(trx) {
        const adminRole = await trx("roles")
            .select("role_id")
            .where({ role_code: USER_ROLES.ADMIN })
            .forUpdate()
            .first();
        if (!adminRole) {
            throw new AppError("Administrator role is not configured", 503);
        }
        return adminRole.role_id;
    }

    async function countActiveAdmins(trx) {
        const row = await trx("user_roles as ur")
            .join("users as u", "ur.user_id", "u.user_id")
            .countDistinct({ total: "u.user_id" })
            .where({ "ur.role_id": await lockAdminRole(trx), "u.status": "ACTIVE" })
            .first();
        return Number(row.total);
    }

    async function getLockedUser(trx, userId) {
        return trx("users")
            .select("user_id", "status")
            .where({ user_id: userId })
            .forUpdate()
            .first();
    }

    async function updateUserStatus(userId, actorId, input, requestId = null) {
        const parsed = targetStatusSchema.safeParse(input);
        if (!parsed.success) {
            throw new AppError("Invalid account status update", 400);
        }
        const parsedUserId = userIdSchema.safeParse(userId);
        const parsedActorId = userIdSchema.safeParse(actorId);
        if (!parsedUserId.success || !parsedActorId.success) {
            throw new AppError("Invalid user identity", 400);
        }
        userId = parsedUserId.data;
        actorId = parsedActorId.data;

        try {
            return await db.transaction(async (trx) => {
                const adminRoleId = await lockAdminRole(trx);
                const user = await getLockedUser(trx, userId);
                if (!user) {
                    throw new AppError("User not found", 404);
                }
                if (userId === actorId) {
                    throw new AppError("Administrators cannot change their own status", 403);
                }

                const targetStatus = parsed.data.status;
                if (user.status === targetStatus) {
                    return { user_id: userId, status: user.status };
                }

                const allowedTransition = (user.status === "ACTIVE"
                    && targetStatus === "DISABLED")
                    || (["DISABLED", "LOCKED"].includes(user.status)
                        && targetStatus === "ACTIVE");
                if (!allowedTransition) {
                    throw new AppError("Invalid account status transition", 409);
                }

                if (user.status === "ACTIVE" && targetStatus === "DISABLED") {
                    const hasAdminRole = await trx("user_roles")
                        .where({ user_id: userId, role_id: adminRoleId })
                        .first();
                    if (hasAdminRole && await countActiveAdmins(trx) <= 1) {
                        throw new AppError(
                            "Cannot disable the last active administrator",
                            409
                        );
                    }
                }

                await trx("users")
                    .where({ user_id: userId })
                    .update({ status: targetStatus });
                await auditLog.record(trx, {
                    actor_user_id: actorId,
                    action: "ADMIN.USER_STATUS_CHANGED",
                    target_entity_type: "user",
                    target_entity_id: userId,
                    outcome: "SUCCESS",
                    request_id: requestId,
                    metadata: {
                        from_status: user.status,
                        to_status: targetStatus
                    }
                });
                return { user_id: userId, status: targetStatus };
            });
        } catch (error) {
            if (error instanceof AppError) {
                await recordFailure(
                    "ADMIN.USER_STATUS_CHANGED",
                    actorId,
                    userId,
                    { to_status: parsed.data.status },
                    error,
                    requestId
                );
                throw error;
            }
            throw new AppError("User administration service unavailable", 503);
        }
    }

    async function assignRole(userId, actorId, input, requestId = null) {
        const parsed = targetRoleSchema.safeParse(input);
        if (!parsed.success) {
            throw new AppError("Invalid role assignment", 400);
        }
        const parsedUserId = userIdSchema.safeParse(userId);
        const parsedActorId = userIdSchema.safeParse(actorId);
        if (!parsedUserId.success || !parsedActorId.success) {
            throw new AppError("Invalid user identity", 400);
        }
        userId = parsedUserId.data;
        actorId = parsedActorId.data;

        try {
            return await db.transaction(async (trx) => {
                await lockAdminRole(trx);
                const user = await getLockedUser(trx, userId);
                if (!user) {
                    throw new AppError("User not found", 404);
                }
                if (userId === actorId) {
                    throw new AppError("Administrators cannot modify their own roles", 403);
                }

                const role = await trx("roles")
                    .select("role_id", "role_code")
                    .where({ role_code: parsed.data.role_code })
                    .first();
                if (!role) {
                    throw new AppError("Role not found", 404);
                }
                const existing = await trx("user_roles")
                    .where({ user_id: userId, role_id: role.role_id })
                    .first();
                if (existing) {
                    throw new AppError("User already has this role", 409);
                }

                await trx("user_roles").insert({
                    user_id: userId,
                    role_id: role.role_id,
                    assigned_by: actorId
                });
                await auditLog.record(trx, {
                    actor_user_id: actorId,
                    action: "ADMIN.USER_ROLE_ASSIGNED",
                    target_entity_type: "user",
                    target_entity_id: userId,
                    outcome: "SUCCESS",
                    request_id: requestId,
                    metadata: { role_code: role.role_code }
                });
                return { user_id: userId, role_code: role.role_code };
            });
        } catch (error) {
            const failure = error instanceof AppError
                ? error
                : error.code === "ER_DUP_ENTRY" || error.errno === 1062
                    ? new AppError("User already has this role", 409)
                    : null;
            if (failure) {
                await recordFailure(
                    "ADMIN.USER_ROLE_ASSIGNED",
                    actorId,
                    userId,
                    { role_code: parsed.data.role_code },
                    failure,
                    requestId
                );
                throw failure;
            }
            throw new AppError("User administration service unavailable", 503);
        }
    }

    async function removeRole(userId, actorId, roleCode, requestId = null) {
        const parsed = targetRoleSchema.safeParse({ role_code: roleCode });
        if (!parsed.success) {
            throw new AppError("Invalid role assignment", 400);
        }
        const parsedUserId = userIdSchema.safeParse(userId);
        const parsedActorId = userIdSchema.safeParse(actorId);
        if (!parsedUserId.success || !parsedActorId.success) {
            throw new AppError("Invalid user identity", 400);
        }
        userId = parsedUserId.data;
        actorId = parsedActorId.data;

        try {
            return await db.transaction(async (trx) => {
                await lockAdminRole(trx);
                const user = await getLockedUser(trx, userId);
                if (!user) {
                    throw new AppError("User not found", 404);
                }
                if (userId === actorId) {
                    throw new AppError("Administrators cannot modify their own roles", 403);
                }

                const role = await trx("roles")
                    .select("role_id", "role_code")
                    .where({ role_code: parsed.data.role_code })
                    .first();
                if (!role) {
                    throw new AppError("Role not found", 404);
                }
                const assignments = await trx("user_roles")
                    .select("role_id")
                    .where({ user_id: userId })
                    .forUpdate();
                const targetAssignment = assignments.find(
                    (assignment) => assignment.role_id === role.role_id
                );
                if (!targetAssignment) {
                    throw new AppError("User does not have this role", 404);
                }
                if (assignments.length <= 1) {
                    throw new AppError("Cannot remove the user's final role", 409);
                }

                await trx("user_roles")
                    .where({ user_id: userId, role_id: role.role_id })
                    .delete();
                await auditLog.record(trx, {
                    actor_user_id: actorId,
                    action: "ADMIN.USER_ROLE_REMOVED",
                    target_entity_type: "user",
                    target_entity_id: userId,
                    outcome: "SUCCESS",
                    request_id: requestId,
                    metadata: { role_code: role.role_code }
                });
                return { user_id: userId, role_code: role.role_code };
            });
        } catch (error) {
            if (error instanceof AppError) {
                await recordFailure(
                    "ADMIN.USER_ROLE_REMOVED",
                    actorId,
                    userId,
                    { role_code: parsed.data.role_code },
                    error,
                    requestId
                );
                throw error;
            }
            throw new AppError("User administration service unavailable", 503);
        }
    }

    return {
        listUsers,
        getUserDetails,
        updateUserStatus,
        assignRole,
        removeRole
    };
}

module.exports = {
    createUserAdministrationService
};
