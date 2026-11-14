const jwt = require("jsonwebtoken");
const AppError = require("../../../shared/errors/AppError");
const {
    INTERNAL_JWT_CLOCK_SKEW_SECONDS
} = require("../constants/internalServiceAuth");

const keyIdPattern = /^[A-Za-z0-9._-]{1,128}$/;
const serviceIdPattern = /^[a-z][a-z0-9-]{1,63}$/;
const jtiPattern = /^[A-Za-z0-9._-]{8,128}$/;

function hasValidKeyServiceIds(publicKeys, keyServiceIds, allowedServices) {
    if (!(keyServiceIds instanceof Map)
        || keyServiceIds.size !== publicKeys.size) {
        return false;
    }

    for (const [keyId, serviceId] of keyServiceIds) {
        if (!publicKeys.has(keyId)
            || !keyIdPattern.test(keyId)
            || !serviceIdPattern.test(serviceId)
            || !allowedServices.has(serviceId)) {
            return false;
        }
    }
    return true;
}

function createInternalServiceAuthService({
    publicKeys,
    keyServiceIds,
    issuer,
    audience,
    allowedServices,
    maxLifetimeSeconds = 300,
    consumeJti,
    jwtImplementation = jwt,
    now = Date.now,
    logger = console
} = {}) {
    if (!(publicKeys instanceof Map)
        || publicKeys.size === 0
        || typeof issuer !== "string"
        || !issuer
        || typeof audience !== "string"
        || !audience
        || !(allowedServices instanceof Set)
        || allowedServices.size === 0
        || !hasValidKeyServiceIds(publicKeys, keyServiceIds, allowedServices)
        || !Number.isSafeInteger(maxLifetimeSeconds)
        || maxLifetimeSeconds < 1
        || maxLifetimeSeconds > 300
        || typeof consumeJti !== "function"
        || typeof now !== "function"
        || !logger
        || typeof logger.warn !== "function"
        || typeof logger.error !== "function") {
        throw new Error("Valid internal service JWT configuration is required");
    }

    async function verifyServiceToken(token) {
        const nowSeconds = Math.floor(now() / 1000);
        let decoded;
        try {
            decoded = jwtImplementation.decode(token, { complete: true });
        } catch {
            throw new AppError("Invalid internal service token", 401);
        }
        const keyId = decoded?.header?.kid;
        if (decoded?.header?.alg !== "RS256"
            || typeof keyId !== "string"
            || !keyIdPattern.test(keyId)
            || !publicKeys.has(keyId)) {
            throw new AppError("Invalid internal service token", 401);
        }

        try {
            decoded = jwtImplementation.verify(token, publicKeys.get(keyId), {
                algorithms: ["RS256"],
                ignoreExpiration: true,
                ignoreNotBefore: true
            });
        } catch (error) {
            const errorName = error?.name;
            if (errorName === "JsonWebTokenError"
                || errorName === "TokenExpiredError"
                || errorName === "NotBeforeError") {
                throw new AppError("Invalid internal service token", 401);
            }
            throw new AppError("Internal authentication failed", 500);
        }

        if (typeof decoded.iss !== "string" || decoded.iss !== issuer) {
            throw new AppError("Invalid internal service token", 401);
        }
        const audiences = Array.isArray(decoded.aud) ? decoded.aud : [decoded.aud];
        if (!audiences.includes(audience)) {
            throw new AppError("Invalid internal service token", 401);
        }
        if (!Number.isSafeInteger(decoded.exp)
            || !Number.isSafeInteger(decoded.iat)
            || decoded.exp <= decoded.iat) {
            throw new AppError("Invalid internal service token", 401);
        }
        if (nowSeconds > decoded.exp + INTERNAL_JWT_CLOCK_SKEW_SECONDS) {
            throw new AppError("Expired internal service token", 401);
        }
        if (decoded.iat > nowSeconds + INTERNAL_JWT_CLOCK_SKEW_SECONDS) {
            throw new AppError("Invalid internal service token", 401);
        }
        if (typeof decoded.jti !== "string" || !jtiPattern.test(decoded.jti)) {
            throw new AppError("Invalid internal service token", 401);
        }
        if (decoded.token_use !== "internal_service") {
            throw new AppError("Invalid internal service token", 401);
        }
        if (typeof decoded.client_id !== "string"
            || !serviceIdPattern.test(decoded.client_id)
            || !allowedServices.has(decoded.client_id)
            || keyServiceIds.get(keyId) !== decoded.client_id
            || typeof decoded.sub !== "string"
            || decoded.sub !== decoded.client_id) {
            throw new AppError("Invalid internal service identity", 403);
        }
        if (decoded.exp - decoded.iat > maxLifetimeSeconds) {
            throw new AppError("Invalid internal service token", 401);
        }

        let consumed;
        try {
            consumed = await consumeJti({
                issuer: decoded.iss,
                jti: decoded.jti,
                clientId: decoded.client_id,
                expiresAt: decoded.exp
            });
        } catch {
            logger.error("Internal JWT replay storage unavailable", {
                service_id: decoded.client_id
            });
            throw new AppError("Internal authentication service unavailable", 503);
        }
        if (consumed === false) {
            logger.warn("Internal JWT replay rejected", {
                service_id: decoded.client_id
            });
            throw new AppError("Internal service token has already been used", 401);
        }
        if (consumed !== true) {
            logger.error("Internal JWT replay consumption could not be verified", {
                service_id: decoded.client_id
            });
            throw new AppError("Internal authentication service unavailable", 503);
        }

        return Object.freeze({
            serviceId: decoded.client_id,
            jti: decoded.jti
        });
    }

    return { verifyServiceToken };
}

module.exports = {
    createInternalServiceAuthService
};
