const AppError = require("../../../shared/errors/AppError");

function createRequireInternalServiceAuth(internalServiceAuthService) {
    if (!internalServiceAuthService
        || typeof internalServiceAuthService.verifyServiceToken !== "function") {
        throw new Error("Internal service authentication is required");
    }

    return function requireInternalServiceAuth(req, res, next) {
        const authorization = req.get("authorization");
        const match = typeof authorization === "string"
            ? authorization.match(/^Bearer\s+([^\s]+)$/i)
            : null;
        if (!match) {
            return next(new AppError("Internal service authentication required", 401));
        }

        internalServiceAuthService.verifyServiceToken(match[1])
            .then((serviceAuth) => {
                req.internalService = serviceAuth;
                next();
            })
            .catch(next);
    };
}

module.exports = {
    createRequireInternalServiceAuth
};
