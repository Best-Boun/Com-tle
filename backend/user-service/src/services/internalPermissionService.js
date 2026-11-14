const { z } = require("zod");
const { PERMISSIONS } = require("../../../shared/constants");
const AppError = require("../../../shared/errors/AppError");
// Only domain permissions other services need. User-administration and merge
// codes (user.*, customer.merge.*) are answered allowed:false without a lookup,
// so internal callers cannot probe which users are administrators.
const knownPermissionCodes = new Set(Object.values(PERMISSIONS));
const { USER_ROLES } = require("../../../shared/constants");
// Staff-only payment operations are admin operations: ADMIN_ONLY is decided
// here, never by the calling service.
const adminOnlyPermissionCodes = new Set([
    PERMISSIONS.PAYMENT_RECORD,
    PERMISSIONS.PAYMENT_REFUND,
    PERMISSIONS.PAYMENT_VIEW_ALL
]);
const requestSchema = z.object({
    user_id: z.string().trim().min(1).max(36),
    permission: z.string().trim().min(1).max(100),
    resource: z.object({
        work_order_id: z.string().trim().min(1).max(36).optional(),
        payment_id: z.string().trim().min(1).max(36).optional(),
        refund_id: z.string().trim().min(1).max(36).optional()
    }).strict().optional()
}).strict();

function createInternalPermissionService({ permissionService } = {}) {
    if (!permissionService
        || typeof permissionService.activeUserHasPermission !== "function") {
        throw new Error("Permission service is required");
    }

    async function checkPermission(serviceAuth, input) {
        if (!serviceAuth || typeof serviceAuth.serviceId !== "string") {
            throw new AppError("Internal service authentication required", 401);
        }
        const parsed = requestSchema.safeParse(input);
        if (!parsed.success) {
            return null;
        }

        const { user_id: userId, permission, resource } = parsed.data;
        if (permission === PERMISSIONS.PAYMENT_VIEW_OWN
            && !resource?.work_order_id
            && !resource?.payment_id) {
            return null;
        }
        let allowed = false;
        if (knownPermissionCodes.has(permission)) {
            allowed = adminOnlyPermissionCodes.has(permission)
                ? await permissionService.activeUserHasPermission(
                    userId,
                    permission,
                    { requiredRole: USER_ROLES.ADMIN }
                )
                : await permissionService.activeUserHasPermission(userId, permission);
        }
        return {
            user_id: userId,
            permission,
            allowed: allowed === true
        };
    }

    return { checkPermission };
}

module.exports = {
    createInternalPermissionService
};
