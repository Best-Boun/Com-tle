const fs = require("node:fs");
const crypto = require("node:crypto");
const {
    USER_ROLES,
    PERMISSIONS,
    ROLE_PERMISSIONS
} = require("../constants");

const validRoles = new Set(Object.values(USER_ROLES));
const validPermissions = new Set(Object.values(PERMISSIONS));

/**
 * Load the JWT verification settings a Business Service needs.
 * Business Services verify the token themselves (defense in depth),
 * using the same RS256 public key, issuer and audience as the Gateway.
 */
function loadServiceJwtConfig(env = process.env, { baseDir = process.cwd() } = {}) {
    for (const name of ["JWT_ISSUER", "JWT_AUDIENCE", "JWT_PUBLIC_KEY_PATH"]) {
        if (!env[name] || !env[name].trim()) {
            throw new Error(`Missing environment variable: ${name}`);
        }
    }

    const keyPath = require("node:path").resolve(baseDir, env.JWT_PUBLIC_KEY_PATH);
    let publicKey;
    try {
        publicKey = fs.readFileSync(keyPath, "utf8");
        const keyObject = crypto.createPublicKey(publicKey);
        const modulusLength = keyObject.asymmetricKeyDetails?.modulusLength;
        if (keyObject.asymmetricKeyType !== "rsa" || (modulusLength && modulusLength < 2048)) {
            throw new Error("Invalid RSA public key");
        }
    } catch {
        throw new Error("JWT_PUBLIC_KEY_PATH must point to a valid RSA public key");
    }

    return {
        publicKey,
        issuer: env.JWT_ISSUER.trim(),
        audience: env.JWT_AUDIENCE.trim()
    };
}

/**
 * Create an Express middleware that verifies a Bearer access token.
 * The jsonwebtoken library is injected because /shared has no node_modules.
 */
function createAuthenticate({ jwt, publicKey, issuer, audience } = {}) {
    if (!jwt || !publicKey || !issuer || !audience) {
        throw new Error("jwt implementation, public key, issuer and audience are required");
    }

    return (req, res, next) => {
        const header = req.headers.authorization;
        const match = typeof header === "string"
            ? header.match(/^Bearer\s+(\S+)$/i)
            : null;

        if (!match) {
            return res.status(401).json({
                success: false,
                message: "Access token is required"
            });
        }

        try {
            const decoded = jwt.verify(match[1], publicKey, {
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
                || !decoded.roles.every((role) => typeof role === "string" && validRoles.has(role))
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

function hasPermission(user, permission) {
    if (!user || !Array.isArray(user.roles) || !validPermissions.has(permission)) {
        return false;
    }
    return user.roles.some(
        (role) => validRoles.has(role) && ROLE_PERMISSIONS[role].includes(permission)
    );
}

/**
 * Allow the request when the user holds at least one of the listed permissions.
 * Resource-level checks (ownership etc.) stay in the owning service.
 */
function requireAnyPermission(...permissions) {
    if (permissions.length === 0 || !permissions.every((p) => validPermissions.has(p))) {
        throw new Error("requireAnyPermission needs valid permissions");
    }

    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: "Authentication required"
            });
        }

        if (!permissions.some((permission) => hasPermission(req.user, permission))) {
            return res.status(403).json({
                success: false,
                message: "You do not have permission"
            });
        }

        return next();
    };
}

module.exports = {
    loadServiceJwtConfig,
    createAuthenticate,
    hasPermission,
    requireAnyPermission
};
