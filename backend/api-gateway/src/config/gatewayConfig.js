const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const gatewayRoot = path.resolve(__dirname, "../..");
const serviceUrlVariables = {
    user: "USER_SERVICE_URL",
    booking: "BOOKING_SERVICE_URL",
    catalog: "CATALOG_SERVICE_URL",
    repair: "REPAIR_SERVICE_URL",
    inventory: "INVENTORY_SERVICE_URL",
    payment: "PAYMENT_SERVICE_URL"
};

function requiredValue(env, name) {
    const value = env[name]?.trim();
    if (!value) {
        throw new Error(`Missing environment variable: ${name}`);
    }
    return value;
}

function positiveInteger(env, name) {
    const value = requiredValue(env, name);
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new Error(`${name} must be a positive integer`);
    }
    return Number(value);
}

function parseAllowedOrigins(value) {
    if (value === undefined || value === null) {
        return [];
    }

    if (typeof value !== "string") {
        throw new Error("CORS_ALLOWED_ORIGINS must be a string");
    }

    if (value.trim() === "") {
        return [];
    }

    return value.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
        .map((origin) => {
            if (origin === "*") {
                throw new Error("CORS_ALLOWED_ORIGINS must not contain a wildcard");
            }

            let parsed;
            try {
                parsed = new URL(origin);
            } catch {
                throw new Error("CORS_ALLOWED_ORIGINS must contain valid origins");
            }

            if (
                !["http:", "https:"].includes(parsed.protocol)
                || parsed.origin !== origin
                || parsed.username
                || parsed.password
            ) {
                throw new Error("CORS_ALLOWED_ORIGINS must contain exact HTTP(S) origins");
            }

            return origin;
        });
}

function loadGatewayConfig(env = process.env) {
    const issuer = requiredValue(env, "JWT_ISSUER");
    const audience = requiredValue(env, "JWT_AUDIENCE");
    const publicKeyPath = path.resolve(
        gatewayRoot,
        requiredValue(env, "JWT_PUBLIC_KEY_PATH")
    );

    let publicKey;
    try {
        publicKey = fs.readFileSync(publicKeyPath, "utf8");
        const keyObject = crypto.createPublicKey(publicKey);
        const modulusLength = keyObject.asymmetricKeyDetails?.modulusLength;
        if (
            keyObject.asymmetricKeyType !== "rsa"
            || (modulusLength && modulusLength < 2048)
        ) {
            throw new Error("Invalid RSA public key");
        }
    } catch {
        throw new Error("JWT_PUBLIC_KEY_PATH must point to a valid RSA public key");
    }

    const serviceUrls = Object.fromEntries(
        Object.entries(serviceUrlVariables).map(([service, variable]) => [
            service,
            requiredValue(env, variable)
        ])
    );

    return {
        issuer,
        audience,
        publicKey,
        allowedOrigins: parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS),
        loginRateLimit: {
            windowMs: positiveInteger(env, "LOGIN_RATE_LIMIT_WINDOW_MS"),
            max: positiveInteger(env, "LOGIN_RATE_LIMIT_MAX")
        },
        serviceUrls
    };
}

module.exports = {
    loadGatewayConfig,
    parseAllowedOrigins
};
