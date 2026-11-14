const AppError = require("../../../shared/errors/AppError");

function createRequireAuth(verifyAccessToken, permissionService) {
    if (typeof verifyAccessToken !== "function") {
        throw new Error("Access-token verification is required");
    }
    if (!permissionService || typeof permissionService.isActiveUser !== "function") {
        throw new Error("Active-user authorization is required");
    }

    return async function requireAuth(req, res, next) {
        const authorization = req.get("authorization");
        const match = typeof authorization === "string"
            ? authorization.match(/^Bearer\s+([^\s]+)$/i)
            : null;

        if (!match) {
            return next(new AppError("Authentication required", 401));
        }

        let claims;
        try {
            claims = verifyAccessToken(match[1]);
        } catch {
            return next(new AppError("Invalid or expired access token", 401));
        }

        try {
            if (!await permissionService.isActiveUser(claims.sub)) {
                return next(new AppError("Invalid or expired access token", 401));
            }
        } catch (error) {
            return next(error);
        }

        req.auth = {
            userId: claims.sub,
            roles: claims.roles
        };
        return next();
    };
}

module.exports = {
    createRequireAuth
};
