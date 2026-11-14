const { PERMISSIONS } = require("../../../shared/constants");
const AppError = require("../../../shared/errors/AppError");
const { ADMIN_PERMISSIONS } = require("../constants/adminPermissions");
const { CUSTOMER_MERGE_PERMISSIONS } = require("../constants/customerMergePermissions");

const knownPermissionCodes = new Set([
    ...Object.values(PERMISSIONS),
    ...Object.values(ADMIN_PERMISSIONS),
    ...Object.values(CUSTOMER_MERGE_PERMISSIONS)
]);

function createRequirePermission(permissionService) {
    if (!permissionService
        || typeof permissionService.userHasPermission !== "function") {
        throw new Error("Permission service is required");
    }

    return function requirePermission(permissionCode, options) {
        return async function checkPermission(req, res, next) {
            if (!req.auth || typeof req.auth.userId !== "string") {
                return next(new AppError("Authentication required", 401));
            }

            if (!knownPermissionCodes.has(permissionCode)) {
                return next(new AppError("You do not have permission", 403));
            }

            try {
                const permitted = await permissionService.userHasPermission(
                    req.auth.userId,
                    permissionCode,
                    options
                );
                if (!permitted) {
                    return next(new AppError("You do not have permission", 403));
                }
                return next();
            } catch (error) {
                return next(error);
            }
        };
    };
}

module.exports = {
    createRequirePermission
};
