const {
    PERMISSIONS,
    ROLE_PERMISSIONS,
    USER_ROLES
} = require("../../../shared/constants");

const validRoles = new Set(Object.values(USER_ROLES));
const validPermissions = new Set(Object.values(PERMISSIONS));

function requirePermissions(...requiredPermissions) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: "Authentication required"
            });
        }

        const assignedRoles = req.user.roles;
        const hasValidRoles = Array.isArray(assignedRoles)
            && assignedRoles.length > 0
            && assignedRoles.every(
                (role) => typeof role === "string" && validRoles.has(role)
            );
        const hasValidPolicy = requiredPermissions.length > 0
            && requiredPermissions.every(
                (permission) => typeof permission === "string"
                    && validPermissions.has(permission)
            );

        if (!hasValidRoles || !hasValidPolicy) {
            return res.status(403).json({
                success: false,
                message: "You do not have permission"
            });
        }

        const grantedPermissions = new Set(
            assignedRoles.flatMap((role) => ROLE_PERMISSIONS[role])
        );
        if (!requiredPermissions.every(
            (permission) => grantedPermissions.has(permission)
        )) {
            return res.status(403).json({
                success: false,
                message: "You do not have permission"
            });
        }

        return next();
    };
}

module.exports = requirePermissions;
