const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const jwt = require("jsonwebtoken");
const { errorHandler, notFoundHandler } = require("../../shared/middleware/errorMiddleware");
const { PERMISSIONS } = require("../../shared/constants");
const { createInternalServiceAuthService } = require("../src/services/internalServiceAuthService");
const { createInternalPermissionService } = require("../src/services/internalPermissionService");
const createInternalRouter = require("../src/routes/internalRoutes");

const nowSeconds = 1_700_000_000;
let tokenSequence = 0;
const keys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
});

function createServiceToken(overrides = {}) {
    const { jti = `jti-test-${++tokenSequence}`, ...signOptions } = overrides;
    return jwt.sign({
        token_use: "internal_service",
        client_id: "payment-service",
        jti,
        iat: nowSeconds
    }, keys.privateKey, {
        algorithm: "RS256",
        keyid: "payment-key-1",
        subject: "payment-service",
        issuer: "payment-service",
        audience: "user-service",
        expiresIn: 60,
        ...signOptions
    });
}

async function withServer(callback, activeUserHasPermission = async (userId, permission) => (
    userId === "user-1" && permission === PERMISSIONS.PAYMENT_RECORD
)) {
    const consumedJtis = new Set();
    const internalServiceAuthService = createInternalServiceAuthService({
        publicKeys: new Map([["payment-key-1", keys.publicKey]]),
        keyServiceIds: new Map([["payment-key-1", "payment-service"]]),
        issuer: "payment-service",
        audience: "user-service",
        allowedServices: new Set(["payment-service"]),
        consumeJti: async ({ issuer, jti }) => {
            const key = `${issuer}\u0000${jti}`;
            if (consumedJtis.has(key)) {
                return false;
            }
            consumedJtis.add(key);
            return true;
        },
        now: () => nowSeconds * 1000
    });
    const internalPermissionService = createInternalPermissionService({
        permissionService: { activeUserHasPermission }
    });
    const app = express();
    app.use("/internal", createInternalRouter({
        internalServiceAuthService,
        internalPermissionService
    }));
    app.use(express.json());
    app.use(notFoundHandler);
    app.use(errorHandler);

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
        await callback(`http://127.0.0.1:${server.address().port}`);
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });
    }
}

test("internal permission route authenticates the calling service and returns only explicit decisions", async () => {
    await withServer(async (baseUrl) => {
        const missing = await fetch(`${baseUrl}/internal/permissions/check`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                user_id: "user-1",
                permission: PERMISSIONS.PAYMENT_RECORD
            })
        });
        assert.equal(missing.status, 401);

        const authorized = await fetch(`${baseUrl}/internal/permissions/check`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${createServiceToken()}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({
                user_id: "user-1",
                permission: PERMISSIONS.PAYMENT_RECORD,
                resource: { work_order_id: "work-order-1" }
            })
        });
        assert.equal(authorized.status, 200);
        assert.deepEqual((await authorized.json()).data, {
            user_id: "user-1",
            permission: PERMISSIONS.PAYMENT_RECORD,
            allowed: true
        });

        const unknownPermission = await fetch(`${baseUrl}/internal/permissions/check`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${createServiceToken()}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({
                user_id: "user-1",
                permission: "can_refund"
            })
        });
        assert.deepEqual((await unknownPermission.json()).data, {
            user_id: "user-1",
            permission: "can_refund",
            allowed: false
        });
    });
});

test("internal permission route rejects invalid tokens and caller-supplied authorization data", async () => {
    await withServer(async (baseUrl) => {
        const invalidToken = await fetch(`${baseUrl}/internal/permissions/check`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${createServiceToken({ issuer: "wrong-issuer" })}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({
                user_id: "user-1",
                permission: PERMISSIONS.PAYMENT_RECORD
            })
        });
        assert.equal(invalidToken.status, 401);

        const injectedRoles = await fetch(`${baseUrl}/internal/permissions/check`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${createServiceToken()}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({
                user_id: "user-1",
                permission: PERMISSIONS.PAYMENT_RECORD,
                roles: ["ADMIN"],
                permissions: [PERMISSIONS.PAYMENT_RECORD]
            })
        });
        assert.equal(injectedRoles.status, 400);
    });
});

test("malformed internal request consumes its token before JSON parsing fails", async () => {
    await withServer(async (baseUrl) => {
        const token = createServiceToken();
        const malformed = await fetch(`${baseUrl}/internal/permissions/check`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json"
            },
            body: "{"
        });
        assert.equal(malformed.status, 400);

        const retry = await fetch(`${baseUrl}/internal/permissions/check`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({
                user_id: "user-1",
                permission: PERMISSIONS.PAYMENT_RECORD
            })
        });
        assert.equal(retry.status, 401);
    });
});

test("permission denial and lookup failure still consume the internal token", async () => {
    await withServer(async (baseUrl) => {
        const deniedToken = createServiceToken();
        const denied = await fetch(`${baseUrl}/internal/permissions/check`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${deniedToken}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({
                user_id: "user-2",
                permission: PERMISSIONS.PAYMENT_RECORD
            })
        });
        assert.deepEqual((await denied.json()).data, {
            user_id: "user-2",
            permission: PERMISSIONS.PAYMENT_RECORD,
            allowed: false
        });
        const deniedRetry = await fetch(`${baseUrl}/internal/permissions/check`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${deniedToken}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({
                user_id: "user-1",
                permission: PERMISSIONS.PAYMENT_RECORD
            })
        });
        assert.equal(deniedRetry.status, 401);
    });

    await withServer(async (baseUrl) => {
        const token = createServiceToken();
        const failedLookup = await fetch(`${baseUrl}/internal/permissions/check`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({
                user_id: "user-1",
                permission: PERMISSIONS.PAYMENT_RECORD
            })
        });
        assert.equal(failedLookup.status, 503);
        const retry = await fetch(`${baseUrl}/internal/permissions/check`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({
                user_id: "user-1",
                permission: PERMISSIONS.PAYMENT_RECORD
            })
        });
        assert.equal(retry.status, 401);
    }, async () => {
        const error = new Error("database unavailable");
        error.statusCode = 503;
        throw error;
    });
});
