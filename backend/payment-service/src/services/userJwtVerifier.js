const jwt = require("jsonwebtoken");

function createUserJwtVerifier({
    publicKey,
    publicKeys,
    resolvePublicKey,
    expectedKid,
    issuer,
    audience,
    jwtImplementation = jwt,
    now = Date.now
} = {}) {
    if ((!publicKey && !(publicKeys instanceof Map)
        && typeof resolvePublicKey !== "function")
        || typeof issuer !== "string"
        || !issuer
        || typeof audience !== "string"
        || !audience) {
        throw new Error("A trusted User JWT key source, issuer, and audience are required");
    }

    function selectPublicKey(header) {
        const keyId = header.kid;
        if (keyId !== undefined) {
            if (typeof keyId !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(keyId)) {
                throw new Error("Invalid User JWT key ID");
            }
            if (expectedKid && keyId !== expectedKid) {
                throw new Error("Unexpected User JWT key ID");
            }
            const resolved = resolvePublicKey
                ? resolvePublicKey(keyId)
                : publicKeys?.get(keyId)
                    || (expectedKid === keyId ? publicKey : undefined);
            if (!resolved) {
                throw new Error("Unknown User JWT key ID");
            }
            return resolved;
        }
        if (expectedKid) {
            throw new Error("User JWT key ID is required");
        }
        if (!publicKey) {
            throw new Error("User JWT key ID is required");
        }
        return publicKey;
    }

    function verify(token) {
        try {
            const decoded = jwtImplementation.decode(token, { complete: true });
            if (!decoded
                || !decoded.header
                || decoded.header.alg !== "RS256"
                || decoded.payload?.token_use !== "user_access") {
                throw new Error("Invalid User JWT type");
            }

            const verified = jwtImplementation.verify(
                token,
                selectPublicKey(decoded.header),
                {
                    algorithms: ["RS256"],
                    issuer,
                    audience,
                    clockTimestamp: Math.floor(now() / 1000)
                }
            );
            if (!verified
                || typeof verified !== "object"
                || !Number.isFinite(verified.exp)
                || typeof verified.sub !== "string"
                || verified.sub.trim().length === 0) {
                throw new Error("Invalid User JWT claims");
            }
            return Object.freeze({ userId: verified.sub });
        } catch {
            throw new Error("Invalid or expired User access token");
        }
    }

    return { verify };
}

module.exports = {
    createUserJwtVerifier
};
