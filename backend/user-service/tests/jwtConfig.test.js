const assert = require("node:assert/strict");
const test = require("node:test");
const { loadJwtConfig } = require("../src/config/jwt");

test("JWT configuration reports missing required environment variables", () => {
    assert.throws(
        () => loadJwtConfig({}),
        /Missing environment variable: JWT_ISSUER/
    );
});

test("JWT configuration rejects non-positive or non-integer expiry values", () => {
    const env = {
        JWT_ISSUER: "issuer",
        JWT_AUDIENCE: "audience",
        JWT_EXPIRES_IN: "1.5",
        JWT_REFRESH_EXPIRES_IN: "3600",
        JWT_PRIVATE_KEY_PATH: "unused.pem"
    };

    assert.throws(
        () => loadJwtConfig(env),
        /JWT_EXPIRES_IN must be a positive number of seconds/
    );
    assert.throws(
        () => loadJwtConfig({ ...env, JWT_EXPIRES_IN: "60", JWT_REFRESH_EXPIRES_IN: "0" }),
        /JWT_REFRESH_EXPIRES_IN must be a positive number of seconds/
    );
});
