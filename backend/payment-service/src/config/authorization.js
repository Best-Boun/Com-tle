const fs = require("node:fs");
const path = require("node:path");
const { createPrivateKey, createPublicKey } = require("node:crypto");

function readRsaKey(filePath, kind) {
    const pem = fs.readFileSync(filePath, "utf8");
    const key = kind === "private"
        ? createPrivateKey(pem)
        : createPublicKey(pem);
    const expectedType = kind === "private"
        ? "PRIVATE KEY"
        : "PUBLIC KEY";
    if (key.asymmetricKeyType !== "rsa"
        || !pem.startsWith(`-----BEGIN ${expectedType}-----`)
        || (key.asymmetricKeyDetails?.modulusLength
            && key.asymmetricKeyDetails.modulusLength < 2048)) {
        throw new Error(`Configured ${kind} key must be an RSA key of at least 2048 bits`);
    }
    return kind === "private" ? key.export({ type: "pkcs8", format: "pem" }) : key;
}

function loadUserServiceBaseUrl(env = process.env) {
    const value = env.PAYMENT_USER_SERVICE_BASE_URL;
    if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
        throw new Error("Missing or invalid environment variable: PAYMENT_USER_SERVICE_BASE_URL");
    }

    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error("PAYMENT_USER_SERVICE_BASE_URL must be a valid absolute URL");
    }

    if (url.username
        || url.password
        || url.search
        || url.hash
        || url.pathname !== "/"
        || !["https:", "http:"].includes(url.protocol)) {
        throw new Error("PAYMENT_USER_SERVICE_BASE_URL must be a trusted base URL");
    }

    const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
    const allowsLocalHttp = env.NODE_ENV === "development"
        && url.protocol === "http:"
        && localHosts.has(url.hostname);
    if (url.protocol !== "https:" && !allowsLocalHttp) {
        throw new Error(
            "PAYMENT_USER_SERVICE_BASE_URL must use HTTPS except for localhost in development"
        );
    }

    return url.origin;
}

function loadUserJwtVerifierConfig(env = process.env) {
    const required = [
        "PAYMENT_USER_JWT_ISSUER",
        "PAYMENT_USER_JWT_AUDIENCE",
        "PAYMENT_USER_JWT_PUBLIC_KEY_PATH"
    ];
    for (const variable of required) {
        if (!env[variable]) {
            throw new Error(`Missing environment variable: ${variable}`);
        }
    }
    const serviceRoot = path.resolve(__dirname, "../..");
    const publicKeyPath = path.resolve(serviceRoot, env.PAYMENT_USER_JWT_PUBLIC_KEY_PATH);
    return {
        issuer: env.PAYMENT_USER_JWT_ISSUER,
        audience: env.PAYMENT_USER_JWT_AUDIENCE,
        publicKey: readRsaKey(publicKeyPath, "public"),
        expectedKid: env.PAYMENT_USER_JWT_KID || undefined
    };
}

function loadInternalServiceTokenConfig(env = process.env) {
    const required = [
        "PAYMENT_INTERNAL_JWT_PRIVATE_KEY_PATH",
        "PAYMENT_INTERNAL_JWT_KID",
        "PAYMENT_INTERNAL_JWT_ISSUER",
        "PAYMENT_INTERNAL_JWT_AUDIENCE",
        "PAYMENT_INTERNAL_SERVICE_ID"
    ];
    for (const variable of required) {
        if (!env[variable]) {
            throw new Error(`Missing environment variable: ${variable}`);
        }
    }
    const lifetimeSeconds = env.PAYMENT_INTERNAL_JWT_LIFETIME_SECONDS
        ? Number(env.PAYMENT_INTERNAL_JWT_LIFETIME_SECONDS)
        : 60;
    if (!Number.isSafeInteger(lifetimeSeconds)
        || lifetimeSeconds < 1
        || lifetimeSeconds > 300) {
        throw new Error("PAYMENT_INTERNAL_JWT_LIFETIME_SECONDS must be between 1 and 300");
    }

    const serviceRoot = path.resolve(__dirname, "../..");
    const privateKeyPath = path.resolve(
        serviceRoot,
        env.PAYMENT_INTERNAL_JWT_PRIVATE_KEY_PATH
    );
    return {
        privateKey: readRsaKey(privateKeyPath, "private"),
        kid: env.PAYMENT_INTERNAL_JWT_KID,
        issuer: env.PAYMENT_INTERNAL_JWT_ISSUER,
        audience: env.PAYMENT_INTERNAL_JWT_AUDIENCE,
        serviceId: env.PAYMENT_INTERNAL_SERVICE_ID,
        lifetimeSeconds
    };
}

module.exports = {
    loadUserServiceBaseUrl,
    loadUserJwtVerifierConfig,
    loadInternalServiceTokenConfig
};
