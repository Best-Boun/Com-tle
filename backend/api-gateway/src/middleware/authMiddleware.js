const jwt = require("jsonwebtoken");
const { USER_ROLES } = require("../../../shared/constants");

const validRoles = new Set(Object.values(USER_ROLES));

function createAuthMiddleware({
    publicKey,
    issuer,
    audience,
    jwtImplementation = jwt
} = {}) {
    if (!publicKey || !issuer || !audience) {
        throw new Error("JWT public key, issuer, and audience are required");
    }

    return (req, res, next) => {
        const authorization = req.headers.authorization;
        const match = typeof authorization === "string"
            ? authorization.match(/^Bearer\s+(\S+)$/i)
            : null;

        if (!match) {
            return res.status(401).json({
                success: false,
                message: "Access token is required"
            });
        }

        try {
            const decoded = jwtImplementation.verify(match[1], publicKey, {
                algorithms: ["RS256"],
                issuer,
                audience
            });

            if (
                !decoded
                || typeof decoded !== "object"
                || !Number.isFinite(decoded.exp)
                || typeof decoded.sub !== "string"
                || decoded.sub.trim().length === 0
                || !Array.isArray(decoded.roles)
                || decoded.roles.length === 0
                || !decoded.roles.every(
                    (role) => typeof role === "string" && validRoles.has(role)
                )
            ) {
                throw new Error("Invalid JWT claims");
            }

            req.user = {
                userId: decoded.sub,
                roles: decoded.roles
            };
            return next();
        } catch {
            return res.status(401).json({
                success: false,
                message: "Invalid or expired access token"
            });
        }
    };
}

module.exports = {
    createAuthMiddleware
};
