const assert = require("node:assert/strict");
const test = require("node:test");
const {
    loadGatewayConfig,
    parseAllowedOrigins
} = require("../src/config/gatewayConfig");

const validEnvironment = {
    JWT_ISSUER: "com-tle-user-service",
    JWT_AUDIENCE: "com-tle-api",
    JWT_PUBLIC_KEY_PATH: "keys/public.pem",
    CORS_ALLOWED_ORIGINS: "https://frontend.example.test, http://localhost:5173",
    LOGIN_RATE_LIMIT_WINDOW_MS: "60000",
    LOGIN_RATE_LIMIT_MAX: "5",
    USER_SERVICE_URL: "http://localhost:3001",
    BOOKING_SERVICE_URL: "http://localhost:3002",
    CATALOG_SERVICE_URL: "http://localhost:3003",
    REPAIR_SERVICE_URL: "http://localhost:3004",
    INVENTORY_SERVICE_URL: "http://localhost:3005",
    PAYMENT_SERVICE_URL: "http://localhost:3006"
};

test("loads the Gateway JWT, CORS, rate-limit, and service configuration", () => {
    const config = loadGatewayConfig(validEnvironment);

    assert.equal(config.issuer, validEnvironment.JWT_ISSUER);
    assert.equal(config.audience, validEnvironment.JWT_AUDIENCE);
    assert.equal(config.loginRateLimit.windowMs, 60_000);
    assert.equal(config.loginRateLimit.max, 5);
    assert.deepEqual(config.allowedOrigins, [
        "https://frontend.example.test",
        "http://localhost:5173"
    ]);
    assert.equal(config.serviceUrls.user, validEnvironment.USER_SERVICE_URL);
});

test("rejects missing and invalid required security configuration", () => {
    assert.throws(
        () => loadGatewayConfig({ ...validEnvironment, JWT_ISSUER: "" }),
        /Missing environment variable: JWT_ISSUER/
    );
    assert.throws(
        () => loadGatewayConfig({
            ...validEnvironment,
            LOGIN_RATE_LIMIT_MAX: "0"
        }),
        /LOGIN_RATE_LIMIT_MAX must be a positive integer/
    );
    assert.throws(
        () => loadGatewayConfig({
            ...validEnvironment,
            CORS_ALLOWED_ORIGINS: "*"
        }),
        /must not contain a wildcard/
    );
});

test("accepts an empty CORS allowlist and rejects non-origin entries", () => {
    assert.deepEqual(parseAllowedOrigins(""), []);
    assert.throws(
        () => parseAllowedOrigins("https://example.test/path"),
        /exact HTTP\(S\) origins/
    );
});
