const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const express = require("express");
const http = require("node:http");
const test = require("node:test");
const jwt = require("jsonwebtoken");
const { errorHandler, notFoundHandler } = require("../../shared/middleware/errorMiddleware");
const { createAuthService } = require("../src/services/authService");
const createInternalRouter = require("../src/routes/internalRoutes");
const {
    createInternalServiceAuthService
} = require("../src/services/internalServiceAuthService");
const {
    createInternalCustomerIdentityService
} = require("../src/services/internalCustomerIdentityService");

const now = 1_700_000_000_000;
const nowSeconds = Math.floor(now / 1000);
const userKeys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
});
const serviceKeys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
});
const bookingServiceKeys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
});
let serviceTokenSequence = 0;

function createDatabase() {
    const auditRows = [];
    const db = (table) => ({
                select() {
                    return this;
                },
                where(criteria) {
                    this.criteria = criteria;
                    return this;
                },
                async first() {
                    if (table === "users" && this.criteria.user_id === "user-1") {
                        return { user_id: "user-1", status: "ACTIVE" };
                    }
                    return null;
                },
                async then(resolve, reject) {
                    return Promise.resolve(table === "customers"
                        ? [{
                            customer_id: "customer-1",
                            user_id: "user-1",
                            customer_type: "REGISTERED"
                        }].filter((customer) => (
                            customer.user_id === this.criteria.user_id
                        ))
                        : []).then(resolve, reject);
                },
                async insert(row) {
                    auditRows.push(row);
                }
            });
    db.transaction = async (callback) => callback(db);
    return { db, auditRows };
}

function createInternalToken(serviceId = "payment-service") {
    const keyPair = serviceId === "payment-service"
        ? serviceKeys
        : bookingServiceKeys;
    const keyId = serviceId === "payment-service"
        ? "service-key-1"
        : "booking-key-1";
    return jwt.sign({
        token_use: "internal_service",
        client_id: serviceId,
        jti: `jti-route-${++serviceTokenSequence}`,
        iat: nowSeconds
    }, keyPair.privateKey, {
        algorithm: "RS256",
        keyid: keyId,
        subject: serviceId,
        issuer: "service-issuer",
        audience: "user-service",
        expiresIn: 60
    });
}

function createUserToken(userId = "user-1", overrides = {}) {
    return jwt.sign({
        token_use: "user_access",
        roles: ["CUSTOMER"],
        iat: nowSeconds,
        ...overrides
    }, userKeys.privateKey, {
        algorithm: "RS256",
        subject: userId,
        issuer: "user-service",
        audience: "com-tle-api",
        expiresIn: 60
    });
}

async function withServer(callback) {
    const database = createDatabase();
    const authService = createAuthService({
        db: database.db,
        jwtConfig: {
            issuer: "user-service",
            audience: "com-tle-api",
            expiresIn: 60,
            refreshExpiresIn: 3600,
            privateKey: userKeys.privateKey
        },
        now: () => now
    });
    const consumed = new Set();
    const internalServiceAuthService = createInternalServiceAuthService({
        publicKeys: new Map([
            ["service-key-1", serviceKeys.publicKey],
            ["booking-key-1", bookingServiceKeys.publicKey]
        ]),
        keyServiceIds: new Map([
            ["service-key-1", "payment-service"],
            ["booking-key-1", "booking-service"]
        ]),
        issuer: "service-issuer",
        audience: "user-service",
        allowedServices: new Set(["payment-service", "booking-service"]),
        consumeJti: async ({ issuer, jti }) => {
            const key = `${issuer}\u0000${jti}`;
            if (consumed.has(key)) {
                return false;
            }
            consumed.add(key);
            return true;
        },
        now: () => now
    });
    const customerIdentityService = createInternalCustomerIdentityService({
        db: database.db,
        verifyUserAccessToken: authService.verifyAccessToken
    });
    const app = express();
    app.use("/internal", createInternalRouter({
        internalServiceAuthService,
        internalPermissionService: {
            async checkPermission() {
                return null;
            }
        },
        customerIdentityService
    }));
    app.use(notFoundHandler);
    app.use(errorHandler);

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
        await callback(
            `http://127.0.0.1:${server.address().port}`,
            database.auditRows
        );
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });
    }
}

async function identityRequest(baseUrl, {
    serviceToken = createInternalToken(),
    userToken = createUserToken(),
    body = { user_id: "user-1" }
} = {}) {
    return fetch(`${baseUrl}/internal/customers/resolve`, {
        method: "POST",
        headers: {
            authorization: `Bearer ${serviceToken}`,
            "x-user-access-token": userToken,
            "content-type": "application/json"
        },
        body: JSON.stringify(body)
    });
}

test("internal identity route verifies both tokens and returns the minimal mapping", async () => {
    await withServer(async (baseUrl, auditRows) => {
        const response = await identityRequest(baseUrl);
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).data, {
            user_id: "user-1",
            customer_id: "customer-1",
            customer_type: "REGISTERED"
        });
        assert.equal(auditRows.length, 1);
        assert.equal(JSON.stringify(auditRows).includes("eyJ"), false);
    });
});

test("invalid and replayed Internal Service JWTs are rejected before identity lookup", async () => {
    await withServer(async (baseUrl, auditRows) => {
        const invalid = await identityRequest(baseUrl, {
            serviceToken: "invalid-token"
        });
        assert.equal(invalid.status, 401);
        assert.equal(auditRows.length, 0);

        const token = createInternalToken();
        const first = await identityRequest(baseUrl, { serviceToken: token });
        assert.equal(first.status, 200);
        const replay = await identityRequest(baseUrl, { serviceToken: token });
        assert.equal(replay.status, 401);
        assert.equal(auditRows.length, 1);
    });
});

test("a valid but unapproved calling service is forbidden and audited", async () => {
    await withServer(async (baseUrl, auditRows) => {
        const response = await identityRequest(baseUrl, {
            serviceToken: createInternalToken("booking-service")
        });
        assert.equal(response.status, 403);
        assert.equal(auditRows.length, 1);
        assert.equal(auditRows[0].metadata.calling_service, "booking-service");
        assert.equal(auditRows[0].reason, "CALLER_NOT_ALLOWED");
    });
});

test("User JWT subject mismatch and token-purpose mismatch are denied", async () => {
    await withServer(async (baseUrl, auditRows) => {
        const mismatched = await identityRequest(baseUrl, {
            userToken: createUserToken("another-user")
        });
        assert.equal(mismatched.status, 401);

        const wrongPurpose = await identityRequest(baseUrl, {
            userToken: createUserToken("user-1", { token_use: "internal_service" })
        });
        assert.equal(wrongPurpose.status, 401);
        assert.equal(auditRows.length, 2);
        assert.ok(auditRows.every((row) => row.metadata.outcome === "FAILURE"));
    });
});

test("missing User JWT is rejected without disclosing identity", async () => {
    await withServer(async (baseUrl, auditRows) => {
        const response = await fetch(`${baseUrl}/internal/customers/resolve`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${createInternalToken()}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({ user_id: "user-1" })
        });
        assert.equal(response.status, 401);
        assert.equal((await response.json()).success, false);
        assert.equal(auditRows.length, 1);
        assert.equal(auditRows[0].resource_id, null);
    });
});

test("malformed JSON consumes the Internal JWT and writes a denied audit event", async () => {
    await withServer(async (baseUrl, auditRows) => {
        const serviceToken = createInternalToken();
        const malformed = await fetch(`${baseUrl}/internal/customers/resolve`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${serviceToken}`,
                "x-user-access-token": createUserToken(),
                "content-type": "application/json"
            },
            body: "{"
        });
        assert.equal(malformed.status, 400);
        assert.equal(auditRows.length, 1);
        assert.equal(auditRows[0].reason, "MALFORMED_REQUEST");

        const replay = await identityRequest(baseUrl, { serviceToken });
        assert.equal(replay.status, 401);
    });
});
