const fs = require("node:fs");
const path = require("node:path");
const { createPublicKey } = require("node:crypto");

const serviceIdPattern = /^[a-z][a-z0-9-]{1,63}$/;
const keyIdPattern = /^[A-Za-z0-9._-]{1,128}$/;

function loadInternalServiceAuthConfig(env = process.env) {
    const variables = [
        "INTERNAL_SERVICE_JWT_PUBLIC_KEYS_DIR",
        "INTERNAL_SERVICE_JWT_ISSUER",
        "INTERNAL_SERVICE_JWT_AUDIENCE",
        "INTERNAL_SERVICE_JWT_ALLOWED_SERVICES",
        "INTERNAL_SERVICE_JWT_KEY_SERVICES"
    ];
    const configured = variables.filter((name) => Boolean(env[name]));
    if (configured.length === 0) {
        return null;
    }
    if (configured.length !== variables.length) {
        const missing = variables.find((name) => !env[name]);
        throw new Error(`Missing environment variable: ${missing}`);
    }

    const maxLifetimeSeconds = env.INTERNAL_SERVICE_JWT_MAX_LIFETIME_SECONDS
        ? Number(env.INTERNAL_SERVICE_JWT_MAX_LIFETIME_SECONDS)
        : 300;
    if (!Number.isSafeInteger(maxLifetimeSeconds)
        || maxLifetimeSeconds < 1
        || maxLifetimeSeconds > 300) {
        throw new Error(
            "INTERNAL_SERVICE_JWT_MAX_LIFETIME_SECONDS must be between 1 and 300"
        );
    }

    const allowedServices = env.INTERNAL_SERVICE_JWT_ALLOWED_SERVICES
        .split(",")
        .map((serviceId) => serviceId.trim())
        .filter(Boolean);
    if (allowedServices.length === 0
        || allowedServices.some((serviceId) => !serviceIdPattern.test(serviceId))) {
        throw new Error("INTERNAL_SERVICE_JWT_ALLOWED_SERVICES is invalid");
    }

    const keyServiceIds = new Map();
    for (const mapping of env.INTERNAL_SERVICE_JWT_KEY_SERVICES.split(",")) {
        const [keyId, serviceId, ...extra] = mapping.trim().split(":");
        if (extra.length > 0
            || !keyIdPattern.test(keyId)
            || !serviceIdPattern.test(serviceId)
            || !allowedServices.includes(serviceId)
            || keyServiceIds.has(keyId)) {
            throw new Error("INTERNAL_SERVICE_JWT_KEY_SERVICES is invalid");
        }
        keyServiceIds.set(keyId, serviceId);
    }

    const publicKeysDirectory = path.resolve(
        path.resolve(__dirname, "../.."),
        env.INTERNAL_SERVICE_JWT_PUBLIC_KEYS_DIR
    );
    const publicKeys = new Map();
    for (const fileName of fs.readdirSync(publicKeysDirectory).sort()) {
        if (!fileName.endsWith(".pem")) {
            continue;
        }
        const keyId = fileName.slice(0, -4);
        if (!keyIdPattern.test(keyId)) {
            throw new Error("Internal service public key filename has an invalid kid");
        }
        if (!keyServiceIds.has(keyId)) {
            throw new Error("Internal service public key has no service identity mapping");
        }
        const pem = fs.readFileSync(path.join(publicKeysDirectory, fileName), "utf8");
        if (!/^-----BEGIN (?:PUBLIC KEY|RSA PUBLIC KEY)-----/.test(pem)) {
            throw new Error("Internal service key files must contain public keys");
        }
        const key = createPublicKey(pem);
        const modulusLength = key.asymmetricKeyDetails?.modulusLength;
        if (key.asymmetricKeyType !== "rsa"
            || (modulusLength && modulusLength < 2048)) {
            throw new Error("Internal service public keys must be RSA keys of at least 2048 bits");
        }
        publicKeys.set(keyId, key);
    }
    if (publicKeys.size === 0) {
        throw new Error("No internal service public keys are configured");
    }
    if (publicKeys.size !== keyServiceIds.size) {
        throw new Error("Internal service key identity mapping references an unknown kid");
    }

    return {
        publicKeys,
        keyServiceIds,
        issuer: env.INTERNAL_SERVICE_JWT_ISSUER,
        audience: env.INTERNAL_SERVICE_JWT_AUDIENCE,
        allowedServices: new Set(allowedServices),
        maxLifetimeSeconds
    };
}

module.exports = {
    loadInternalServiceAuthConfig
};
