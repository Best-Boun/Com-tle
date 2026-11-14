const { randomUUID, createPrivateKey } = require("node:crypto");
const jwt = require("jsonwebtoken");

const keyIdPattern = /^[A-Za-z0-9._-]{1,128}$/;
const serviceIdPattern = /^[a-z][a-z0-9-]{1,63}$/;

function createInternalServiceTokenIssuer({
    privateKey,
    kid,
    issuer,
    audience,
    serviceId,
    lifetimeSeconds = 60,
    jwtImplementation = jwt,
    createJti = randomUUID,
    now = Date.now
} = {}) {
    if (!privateKey
        || typeof kid !== "string"
        || !keyIdPattern.test(kid)
        || typeof issuer !== "string"
        || !issuer
        || typeof audience !== "string"
        || !audience
        || typeof serviceId !== "string"
        || !serviceIdPattern.test(serviceId)
        || !Number.isSafeInteger(lifetimeSeconds)
        || lifetimeSeconds < 1
        || lifetimeSeconds > 300) {
        throw new Error("Valid internal service JWT signing configuration is required");
    }
    const keyObject = createPrivateKey(privateKey);
    if (keyObject.asymmetricKeyType !== "rsa"
        || (keyObject.asymmetricKeyDetails?.modulusLength
            && keyObject.asymmetricKeyDetails.modulusLength < 2048)) {
        throw new Error("Internal service JWT signing key must be RSA of at least 2048 bits");
    }

    function createToken() {
        const issuedAt = Math.floor(now() / 1000);
        const jti = createJti();
        if (typeof jti !== "string" || jti.length < 8 || jti.length > 128) {
            throw new Error("Internal service JWT ID generator returned an invalid ID");
        }
        return jwtImplementation.sign(
            {
                token_use: "internal_service",
                client_id: serviceId,
                jti,
                iat: issuedAt
            },
            keyObject,
            {
                algorithm: "RS256",
                keyid: kid,
                subject: serviceId,
                issuer,
                audience,
                expiresIn: lifetimeSeconds
            }
        );
    }

    return { createToken };
}

module.exports = {
    createInternalServiceTokenIssuer
};
