const { PERMISSIONS, USER_ROLES } = require("../../../shared/constants");
const AppError = require("../../../shared/errors/AppError");
const { ADMIN_PERMISSIONS } = require("../constants/adminPermissions");
const { CUSTOMER_MERGE_PERMISSIONS } = require("../constants/customerMergePermissions");

const knownPermissionCodes = new Set([
    ...Object.values(PERMISSIONS),
    ...Object.values(ADMIN_PERMISSIONS),
    ...Object.values(CUSTOMER_MERGE_PERMISSIONS)
]);
const knownRoleCodes = new Set(Object.values(USER_ROLES));

function createPermissionService({ db }) {
    if (!db) {
        throw new Error("Database is required");
    }

    async function loadRolePermissionRows(userId) {
        try {
            return await db("user_roles")
                .join("roles", "user_roles.role_id", "roles.role_id")
                .leftJoin(
                    "role_permissions",
                    "roles.role_id",
                    "role_permissions.role_id"
                )
                .leftJoin(
                    "permissions",
                    "role_permissions.permission_id",
                    "permissions.permission_id"
                )
                .select("roles.role_code", "permissions.permission_code")
                .where({ "user_roles.user_id": userId })
                .orderBy("roles.role_code")
                .orderBy("permissions.permission_code");
        } catch {
            throw new AppError("Authorization service unavailable", 503);
        }
    }

    function summarizeAccess(rows, onlyRoleCode) {
        const roles = new Set();
        const permissions = new Set();
        for (const row of rows) {
            if (knownRoleCodes.has(row.role_code)
                && (onlyRoleCode === undefined || row.role_code === onlyRoleCode)) {
                roles.add(row.role_code);
                if (knownPermissionCodes.has(row.permission_code)) {
                    permissions.add(row.permission_code);
                }
            }
        }
        return {
            roles: [...roles].sort(),
            permissions: [...permissions].sort()
        };
    }

    async function getUserAccess(userId) {
        return summarizeAccess(await loadRolePermissionRows(userId));
    }

    async function isActiveUser(userId) {
        if (typeof userId !== "string" || userId.trim().length === 0) {
            return false;
        }
        try {
            const user = await db("users")
                .select("status")
                .where({ user_id: userId })
                .first();
            return user?.status === "ACTIVE";
        } catch {
            throw new AppError("Authorization service unavailable", 503);
        }
    }

    async function userHasPermission(userId, permissionCode, { requiredRole } = {}) {
        if (!knownPermissionCodes.has(permissionCode)
            || (requiredRole !== undefined && !knownRoleCodes.has(requiredRole))
            || typeof userId !== "string"
            || userId.trim().length === 0) {
            return false;
        }
        if (!await isActiveUser(userId)) {
            return false;
        }
        // Without requiredRole, permissions are the union of all current roles.
        // With requiredRole (ADMIN_ONLY), only grants made directly to that role count.
        const access = summarizeAccess(
            await loadRolePermissionRows(userId),
            requiredRole
        );
        return access.permissions.includes(permissionCode)
            && (requiredRole === undefined || access.roles.includes(requiredRole));
    }

    return {
        getUserAccess,
        userHasPermission,
        isActiveUser,
        activeUserHasPermission: userHasPermission
    };
}

module.exports = {
    createPermissionService
};
