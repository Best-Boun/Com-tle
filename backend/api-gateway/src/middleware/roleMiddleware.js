const { USER_ROLES } = require("../../../shared/constants");

const validRoles = new Set(Object.values(USER_ROLES));

function requireRoles(...allowedRoles) {
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

        const hasValidPolicy = allowedRoles.length > 0
            && allowedRoles.every((role) => validRoles.has(role));

        if (!hasValidRoles || !hasValidPolicy) {
            return res.status(403).json({
                success: false,
                message: "You do not have permission"
            });
        }

        if (!assignedRoles.some((role) => allowedRoles.includes(role))) {
            return res.status(403).json({
                success: false,
                message: "You do not have permission"
            });
        }

        next();
    };
}

module.exports = requireRoles;
