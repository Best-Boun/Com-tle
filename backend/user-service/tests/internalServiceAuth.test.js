const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const jwt = require("jsonwebtoken");
const { PERMISSIONS } = require("../../shared/constants");
const AppError = require("../../shared/errors/AppError");
const {
    createInternalServiceAuthService
} = require("../src/services/internalServiceAuthService");
const { loadInternalServiceAuthConfig } = require("../src/config/internalServiceAuth");
const {
    createInternalPermissionService
} = require("../src/services/internalPermissionService");

const now = 1_700_000_000_000;
const nowSeconds = Math.floor(now / 1000);
const pair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
});
const otherPair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
});

function createService(options = {}) {
    return createInternalServiceAuthService({
        publicKeys: new Map([["payment-key-1", pair.publicKey]]),
        keyServiceIds: new Map([["payment-key-1", "payment-service"]]),
        issuer: "payment-service",
        audience: "user-service",
        allowedServices: new Set(["payment-service"]),
        consumeJti: async () => true,
        now: () => now,
        ...options
    });
}

function createToken(claimOverrides = {}, options = {}) {
    return jwt.sign({
        token_use: "internal_service",
        client_id: "payment-service",
        sub: "payment-service",
        jti: "jti-12345678",
        iat: nowSeconds,
        exp: nowSeconds + 60,
        ...claimOverrides
    }, pair.privateKey, {
        algorithm: "RS256",
        keyid: "payment-key-1",
        issuer: "payment-service",
        audience: "user-service",
        ...options
    });
}

test("internal service JWT requires RS256, kid, issuer, audience, expiry, jti, purpose, and allowlisted identity", async () => {
    const consumed = [];
    const auth = createService({
        consumeJti: async (value) => {
            consumed.push(value);
            return true;
        }
    });
    assert.deepEqual(await auth.verifyServiceToken(createToken()), {
        serviceId: "payment-service",
        jti: "jti-12345678"
    });

    const wrongAlgorithm = jwt.sign({
        token_use: "internal_service",
        client_id: "payment-service",
        sub: "payment-service",
        jti: "jti-12345678",
        iat: nowSeconds,
        exp: nowSeconds + 60
    }, "not-an-rsa-key", {
        algorithm: "HS256",
        issuer: "payment-service",
        audience: "user-service"
    });
    const invalidTokens = [
        wrongAlgorithm,
        createToken({}, { issuer: "wrong-issuer" }),
        createToken({}, { audience: "wrong-audience" }),
        createToken({ token_use: "user_access" }),
        createToken({ jti: undefined }),
        createToken({ iat: nowSeconds - 301, exp: nowSeconds })
    ];
    for (const token of invalidTokens) {
        await assert.rejects(
            auth.verifyServiceToken(token),
            (error) => error instanceof AppError && error.statusCode === 401
        );
    }
    assert.deepEqual(consumed, [{
        issuer: "payment-service",
        jti: "jti-12345678",
        clientId: "payment-service",
        expiresAt: nowSeconds + 60
    }]);
    await assert.rejects(
        auth.verifyServiceToken(createToken({ client_id: "unknown-service" })),
        (error) => error instanceof AppError && error.statusCode === 403
    );
    assert.equal(consumed.length, 1);

    const wrongKid = jwt.sign({
        token_use: "internal_service",
        client_id: "payment-service",
        jti: "jti-12345678",
        iat: nowSeconds,
        exp: nowSeconds + 60
    }, pair.privateKey, {
        algorithm: "RS256",
        keyid: "unknown-key",
        issuer: "payment-service",
        audience: "user-service"
    });
    await assert.rejects(
        auth.verifyServiceToken(wrongKid),
        (error) => error.statusCode === 401
    );
    assert.equal(consumed.length, 1);
});

test("internal JWT verifier requires the replay repository at construction", () => {
    assert.throws(
        () => createInternalServiceAuthService({
            publicKeys: new Map([["payment-key-1", pair.publicKey]]),
            keyServiceIds: new Map([["payment-key-1", "payment-service"]]),
            issuer: "payment-service",
            audience: "user-service",
            allowedServices: new Set(["payment-service"]),
            now: () => now
        }),
        /Valid internal service JWT configuration is required/
    );
});

test("internal JWT key identity must match the claimed caller service", async () => {
    let consumed = false;
    const auth = createService({
        publicKeys: new Map([
            ["payment-key-1", pair.publicKey],
            ["booking-key-1", otherPair.publicKey]
        ]),
        keyServiceIds: new Map([
            ["payment-key-1", "payment-service"],
            ["booking-key-1", "booking-service"]
        ]),
        allowedServices: new Set(["payment-service", "booking-service"]),
        consumeJti: async () => {
            consumed = true;
            return true;
        }
    });
    const spoofedToken = jwt.sign({
        token_use: "internal_service",
        client_id: "payment-service",
        sub: "payment-service",
        jti: "jti-spoof-12345",
        iat: nowSeconds,
        exp: nowSeconds + 60
    }, otherPair.privateKey, {
        algorithm: "RS256",
        keyid: "booking-key-1",
        issuer: "payment-service",
        audience: "user-service"
    });

    await assert.rejects(
        auth.verifyServiceToken(spoofedToken),
        (error) => error instanceof AppError && error.statusCode === 403
    );
    assert.equal(consumed, false);
});

test("internal key configuration requires a complete allowlisted kid-to-service map", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "user-service-internal-auth-"));
    try {
        fs.writeFileSync(path.join(directory, "payment-key-1.pem"), pair.publicKey);
        fs.writeFileSync(path.join(directory, "booking-key-1.pem"), otherPair.publicKey);
        const env = {
            INTERNAL_SERVICE_JWT_PUBLIC_KEYS_DIR: directory,
            INTERNAL_SERVICE_JWT_ISSUER: "user-service",
            INTERNAL_SERVICE_JWT_AUDIENCE: "com-tle",
            INTERNAL_SERVICE_JWT_ALLOWED_SERVICES: "payment-service,booking-service",
            INTERNAL_SERVICE_JWT_KEY_SERVICES:
                "payment-key-1:payment-service,booking-key-1:booking-service"
        };

        const config = loadInternalServiceAuthConfig(env);
        assert.deepEqual([...config.keyServiceIds], [
            ["payment-key-1", "payment-service"],
            ["booking-key-1", "booking-service"]
        ]);
        assert.throws(
            () => loadInternalServiceAuthConfig({
                ...env,
                INTERNAL_SERVICE_JWT_KEY_SERVICES: "payment-key-1:payment-service"
            }),
            /no service identity mapping|references an unknown kid/
        );
        assert.throws(
            () => loadInternalServiceAuthConfig({
                ...env,
                INTERNAL_SERVICE_JWT_KEY_SERVICES:
                    "payment-key-1:unapproved-service,booking-key-1:booking-service"
            }),
            /INTERNAL_SERVICE_JWT_KEY_SERVICES is invalid/
        );
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("internal JWT accepts exactly the configured expiry skew but rejects tokens beyond it", async () => {
    const token = createToken({
        iat: nowSeconds - 90,
        exp: nowSeconds - 30
    });
    await createService({
        now: () => now
    }).verifyServiceToken(token);
    await assert.rejects(
        createService({
            now: () => now + 1000
        }).verifyServiceToken(token),
        (error) => error instanceof AppError && error.statusCode === 401
    );
});

test("internal JWT remains acceptable through the final fractional second of its effective expiry", async () => {
    const exp = nowSeconds - 30;
    const token = createToken({
        iat: exp - 60,
        exp
    });
    const effectiveExpiry = (exp + 30) * 1000;

    for (const currentTime of [
        effectiveExpiry - 1,
        effectiveExpiry,
        effectiveExpiry + 999
    ]) {
        await createService({
            now: () => currentTime
        }).verifyServiceToken(token);
    }

    await assert.rejects(
        createService({
            now: () => effectiveExpiry + 1000
        }).verifyServiceToken(token),
        (error) => error instanceof AppError
            && error.statusCode === 401
            && error.message === "Expired internal service token"
    );
});

test("internal service JWT rejects expired tokens and reports replay-store failures", async () => {
    const auth = createService();
    await assert.rejects(
        auth.verifyServiceToken(createToken({
            iat: nowSeconds - 60,
            exp: nowSeconds - 31
        })),
        (error) => error.statusCode === 401
    );

    const consumed = new Set();
    const replayProtected = createService({
        consumeJti: async ({ jti }) => {
            if (consumed.has(jti)) {
                return false;
            }
            consumed.add(jti);
            return true;
        }
    });
    await replayProtected.verifyServiceToken(createToken());
    await assert.rejects(
        replayProtected.verifyServiceToken(createToken()),
        (error) => error.statusCode === 401
    );

    const unavailable = createService({
        consumeJti: async () => {
            throw new Error("storage unavailable");
        }
    });
    await assert.rejects(
        unavailable.verifyServiceToken(createToken()),
        (error) => error.statusCode === 503
    );
});

test("internal permission checks use current database permissions and explicitly deny unknown codes", async () => {
    const lookups = [];
    const service = createInternalPermissionService({
        permissionService: {
            async activeUserHasPermission(userId, permission) {
                lookups.push({ userId, permission });
                return userId === "user-1" && permission === PERMISSIONS.PAYMENT_RECORD;
            }
        }
    });
    const trustedService = { serviceId: "payment-service" };

    assert.deepEqual(await service.checkPermission(trustedService, {
        user_id: "user-1",
        permission: PERMISSIONS.PAYMENT_RECORD,
        resource: { work_order_id: "work-order-1" }
    }), {
        user_id: "user-1",
        permission: PERMISSIONS.PAYMENT_RECORD,
        allowed: true
    });
    assert.deepEqual(await service.checkPermission(trustedService, {
        user_id: "user-2",
        permission: PERMISSIONS.PAYMENT_RECORD
    }), {
        user_id: "user-2",
        permission: PERMISSIONS.PAYMENT_RECORD,
        allowed: false
    });
    assert.equal((await service.checkPermission(trustedService, {
        user_id: "user-1",
        permission: "can_refund"
    })).allowed, false);
    assert.equal(await service.checkPermission(trustedService, {
        user_id: "user-1",
        permission: PERMISSIONS.PAYMENT_VIEW_OWN
    }), null);
    assert.equal((await service.checkPermission(trustedService, {
        user_id: "user-1",
        permission: PERMISSIONS.PAYMENT_RECORD,
        roles: ["ADMIN"],
        permissions: [PERMISSIONS.PAYMENT_RECORD]
    })), null);
    assert.equal(lookups.length, 2);
});

test("internal permission check denies user-administration codes without a lookup", async () => {
    const lookups = [];
    const service = createInternalPermissionService({
        permissionService: {
            async activeUserHasPermission(userId, permission) {
                lookups.push(permission);
                return true;
            }
        }
    });
    for (const permission of [
        "user.list",
        "user.view",
        "user.status.manage",
        "user.role.manage",
        "customer.merge.request",
        "customer.merge.approve"
    ]) {
        assert.deepEqual(await service.checkPermission({ serviceId: "payment-service" }, {
            user_id: "user-1",
            permission
        }), {
            user_id: "user-1",
            permission,
            allowed: false
        }, permission);
    }
    assert.deepEqual(lookups, []);
});

test("internal permission check propagates current-permission lookup failures", async () => {
    const service = createInternalPermissionService({
        permissionService: {
            async activeUserHasPermission() {
                throw new AppError("Authorization service unavailable", 503);
            }
        }
    });
    await assert.rejects(
        service.checkPermission({ serviceId: "payment-service" }, {
            user_id: "user-1",
            permission: PERMISSIONS.PAYMENT_RECORD
        }),
        (error) => error.statusCode === 503
    );
});
