const fs = require("node:fs");
const path = require("node:path");

function loadJwtConfig(env = process.env) {
    const requiredVariables = [
        "JWT_ISSUER",
        "JWT_AUDIENCE",
        "JWT_EXPIRES_IN",
        "JWT_PRIVATE_KEY_PATH"
    ];

    for (const variable of requiredVariables) {
        if (!env[variable]) {
            throw new Error(`Missing environment variable: ${variable}`);
        }
    }

    if (!/^[1-9]\d*$/.test(env.JWT_EXPIRES_IN)) {
        throw new Error("JWT_EXPIRES_IN must be a positive number of seconds");
    }

    if (!/^[1-9]\d*$/.test(env.JWT_REFRESH_EXPIRES_IN || "")) {
        throw new Error("JWT_REFRESH_EXPIRES_IN must be a positive number of seconds");
    }

    const expiresIn = Number(env.JWT_EXPIRES_IN);
    const refreshExpiresIn = Number(env.JWT_REFRESH_EXPIRES_IN);
    if (!Number.isSafeInteger(expiresIn)) {
        throw new Error("JWT_EXPIRES_IN must be a positive number of seconds");
    }
    if (!Number.isSafeInteger(refreshExpiresIn)) {
        throw new Error("JWT_REFRESH_EXPIRES_IN must be a positive number of seconds");
    }

    const serviceRoot = path.resolve(__dirname, "../..");
    const privateKeyPath = path.resolve(serviceRoot, env.JWT_PRIVATE_KEY_PATH);
    const privateKey = fs.readFileSync(privateKeyPath, "utf8");
    const keyObject = require("node:crypto").createPrivateKey(privateKey);

    if (keyObject.asymmetricKeyType !== "rsa") {
        throw new Error("JWT private key must be an RSA key");
    }

    const modulusLength = keyObject.asymmetricKeyDetails?.modulusLength;
    if (modulusLength && modulusLength < 2048) {
        throw new Error("JWT RSA private key must be at least 2048 bits");
    }

    return {
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
        expiresIn,
        refreshExpiresIn,
        privateKey
    };
}

module.exports = {
    loadJwtConfig
};
