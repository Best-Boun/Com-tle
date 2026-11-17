const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const test = require("node:test");
const jwt = require("jsonwebtoken");
const AppError = require("../../shared/errors/AppError");
const {
    createInternalServiceTokenIssuer
} = require("../src/services/internalServiceTokenIssuer");
const {
    createUserJwtVerifier
} = require("../src/services/userJwtVerifier");
const {
    createUserAuthorizationAdapter
} = require("../src/services/userAuthorizationAdapter");

const now = 1_700_000_000_000;
const nowSeconds = Math.floor(now / 1000);
const userKeys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
});
const otherKeys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
});
const internalKeys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
});

function createUserToken(payload = {}, options = {}) {
    return jwt.sign({
        token_use: "user_access",
        iat: nowSeconds,
        roles: ["ADMIN"],
        permissions: ["payment.record"],
        ...payload
    }, userKeys.privateKey, {
        algorithm: "RS256",
        issuer: "user-service",
        audience: "com-tle-api",
        subject: "user-verified",
        expiresIn: 60,
        ...options
    });
}

function createVerifier(options = {}) {
    return createUserJwtVerifier({
        publicKey: userKeys.publicKey,
        issuer: "user-service",
        audience: "com-tle-api",
        now: () => now,
        ...options
    });
}

function permissionResponse(userId, permission, allowed = true) {
    return {
        status: 200,
        ok: true,
        async json() {
            return {
                success: true,
                data: { user_id: userId, permission, allowed }
            };
        }
    };
}

function customerIdentityResponse(userId, customerId, customerType = "REGISTERED") {
    return {
        status: 200,
        ok: true,
        async json() {
            return {
                success: true,
                message: "Customer identity resolved",
                data: {
                    user_id: userId,
                    customer_id: customerId,
                    customer_type: customerType
                }
            };
        }
    };
}

function createAdapter(options = {}) {
    return createUserAuthorizationAdapter({
        userJwtVerifier: createVerifier(),
        internalServiceTokenIssuer: { createToken: () => "signed-internal-token" },
        userServiceUrl: "https://user-service.internal",
        ...options
    });
}

test("User JWT returns the verified subject and only known roles; never permission claims", () => {
    const verified = createVerifier().verify(createUserToken({ roles: ["ADMIN", "ROOT", "ADMIN"] }));
    assert.deepEqual(verified, { userId: "user-verified", roles: ["ADMIN"] });
    assert.equal(Object.hasOwn(verified, "permissions"), false);
    assert.deepEqual(createVerifier().verify(createUserToken({ roles: "ADMIN" })).roles, []);
});

test("User JWT rejects invalid signature, issuer, audience, expiry, subject, purpose, and key ID", () => {
    const verifier = createVerifier();
    const wrongAlgorithm = jwt.sign({
        token_use: "user_access",
        iat: nowSeconds
    }, "not-a-trusted-key", {
        algorithm: "HS256",
        issuer: "user-service",
        audience: "com-tle-api",
        subject: "user-verified",
        expiresIn: 60
    });
    const missingSubject = jwt.sign({
        token_use: "user_access",
        iat: nowSeconds
    }, userKeys.privateKey, {
        algorithm: "RS256",
        issuer: "user-service",
        audience: "com-tle-api",
        expiresIn: 60
    });
    const invalidTokens = [
        jwt.sign({ token_use: "user_access" }, otherKeys.privateKey, {
            algorithm: "RS256",
            issuer: "user-service",
            audience: "com-tle-api",
            subject: "user-verified",
            expiresIn: 60
        }),
        wrongAlgorithm,
        createUserToken({}, { issuer: "wrong-issuer" }),
        createUserToken({}, { audience: "wrong-audience" }),
        createUserToken({}, { expiresIn: -1 }),
        missingSubject,
        createUserToken({ token_use: "internal_service" })
    ];
    for (const token of invalidTokens) {
        assert.throws(() => verifier.verify(token), /Invalid or expired/);
    }

    const tokenWithKid = jwt.sign({
        token_use: "user_access"
    }, userKeys.privateKey, {
        algorithm: "RS256",
        keyid: "rotated-key",
        issuer: "user-service",
        audience: "com-tle-api",
        subject: "user-verified",
        expiresIn: 60
    });
    assert.throws(
        () => verifier.verify(tokenWithKid),
        /Invalid or expired/
    );
    assert.throws(
        () => createVerifier({ expectedKid: "expected-key" }).verify(createUserToken()),
        /Invalid or expired/
    );

    const wrongSignatureVerifier = createVerifier({ publicKey: otherKeys.publicKey });
    assert.throws(() => wrongSignatureVerifier.verify(createUserToken()), /Invalid or expired/);
});

test("internal service issuer creates short-lived RS256 tokens with kid, jti, audience, and distinct purpose", () => {
    const issuer = createInternalServiceTokenIssuer({
        privateKey: internalKeys.privateKey,
        kid: "payment-key-1",
        issuer: "payment-service",
        audience: "user-service",
        serviceId: "payment-service",
        lifetimeSeconds: 30,
        now: () => now,
        createJti: () => "jti-12345678"
    });
    const token = issuer.createToken();
    const decoded = jwt.decode(token, { complete: true });

    assert.equal(decoded.header.alg, "RS256");
    assert.equal(decoded.header.kid, "payment-key-1");
    assert.equal(decoded.payload.token_use, "internal_service");
    assert.equal(decoded.payload.client_id, "payment-service");
    assert.equal(decoded.payload.sub, "payment-service");
    assert.equal(decoded.payload.jti, "jti-12345678");
    assert.equal(decoded.payload.iss, "payment-service");
    assert.equal(decoded.payload.aud, "user-service");
    assert.equal(decoded.payload.exp - decoded.payload.iat, 30);
});

test("permissions come from the verified token's roles, without calling User-Service", async () => {
    let calls = 0;
    const adapter = createAdapter({
        fetchImplementation: async () => {
            calls += 1;
            throw new Error("User-Service is down");
        }
    });
    const admin = adapter.authenticateToken(createUserToken({ roles: ["ADMIN"] }));
    const customer = adapter.authenticateToken(createUserToken({ roles: ["CUSTOMER"] }));
    const technician = adapter.authenticateToken(createUserToken({ roles: ["TECHNICIAN"] }));

    assert.equal(await adapter.authorizePaymentRecorder(admin), "user-verified");
    assert.equal(await adapter.authorizeRefundActor(admin, "payment.refund"), "user-verified");
    for (const permission of ["payment.record", "payment.view_all", "payment.refund"]) {
        assert.equal(await adapter.requestPermission(admin, permission), true);
        assert.equal(await adapter.requestPermission(customer, permission), false);
        assert.equal(await adapter.requestPermission(technician, permission), false);
    }
    assert.equal(await adapter.requestPermission(customer, "payment.view_own"), true);
    assert.equal(await adapter.requestPermission(customer, "payment.view_own", { work_order_id: "wo-1" }), true);
    assert.equal(await adapter.requestPermission(admin, "payment.view_own"), false);
    assert.equal(calls, 0, "no User-Service call for authorization");
    assert.equal(Object.hasOwn(admin, "roles"), false);
    assert.equal(Object.hasOwn(admin, "permissions"), false);
});

test("adapter denies unknown roles and permissions, forged contexts and bad resources", async () => {
    const adapter = createAdapter({ fetchImplementation: async () => { throw new Error("unused"); } });
    const unknownRole = adapter.authenticateToken(createUserToken({ roles: ["SUPERUSER"] }));
    await assert.rejects(adapter.authorizePaymentRecorder(unknownRole), (error) => error.statusCode === 403);
    await assert.rejects(
        adapter.authorizeRefundActor(adapter.authenticateToken(createUserToken({ roles: ["CUSTOMER"] })), "payment.refund"),
        (error) => error.statusCode === 403
    );
    const admin = adapter.authenticateToken(createUserToken());
    assert.equal(await adapter.requestPermission(admin, "not-approved"), false);
    await assert.rejects(adapter.requestPermission(admin, "payment.record", { anything: "x" }), (error) => error.statusCode === 400);
    // A context the adapter did not create (e.g. built from request data) is rejected.
    await assert.rejects(
        adapter.authorizePaymentRecorder({ userId: "client-supplied-user" }),
        (error) => error.statusCode === 401
    );
    assert.throws(() => adapter.authenticateToken("not-a-token"), (error) => error.statusCode === 401);
});

test("customer resolution sends the verified subject and original User JWT separately", async () => {
    let identityRequest;
    const userToken = createUserToken();
    const adapter = createAdapter({
        internalServiceTokenIssuer: {
            createToken: async () => "fresh-internal-token"
        },
        fetchImplementation: async (url, options) => {
            identityRequest = { url, options };
            return customerIdentityResponse("user-verified", "customer-verified");
        }
    });
    assert.equal(
        await adapter.requestCustomerId(adapter.authenticateToken(userToken)),
        "customer-verified"
    );
    assert.equal(
        identityRequest.url,
        "https://user-service.internal/internal/customers/resolve"
    );
    assert.equal(identityRequest.options.headers.authorization, "Bearer fresh-internal-token");
    assert.equal(identityRequest.options.headers["x-user-access-token"], userToken);
    assert.deepEqual(JSON.parse(identityRequest.options.body), { user_id: "user-verified" });
    assert.equal(identityRequest.options.redirect, "error");
});

test("customer resolution requires a context created by authenticateToken", async () => {
    const adapter = createAdapter({
        fetchImplementation: async () => customerIdentityResponse("user-verified", "customer-verified")
    });
    await assert.rejects(
        adapter.requestCustomerId({ userId: "user-verified" }),
        (error) => error.statusCode === 401
    );
});

test("identity resolver rejects response mismatches", async () => {
    for (const identityResponse of [
        customerIdentityResponse("another-user", "customer-verified"),
        customerIdentityResponse("user-verified", "customer-verified", "GUEST"),
        {
            status: 200,
            ok: true,
            async json() {
                return {
                    success: true,
                    message: "Customer identity resolved",
                    data: {
                        user_id: "user-verified",
                        customer_id: "customer-verified",
                        customer_type: "REGISTERED",
                        email: "private@example.test"
                    }
                };
            }
        }
    ]) {
        const adapter = createAdapter({ fetchImplementation: async () => identityResponse });
        await assert.rejects(
            adapter.requestCustomerId(adapter.authenticateToken(createUserToken())),
            (error) => error.statusCode === 503
        );
    }
});

test("identity lookup returns null on User-Service 401, 403, and 404 and fails closed on 503", async () => {
    const reply = (status) => ({
        status,
        ok: false,
        async json() {
            return { success: false, message: "no" };
        }
    });
    for (const status of [401, 403, 404]) {
        const adapter = createAdapter({ fetchImplementation: async () => reply(status) });
        assert.equal(
            await adapter.requestCustomerId(adapter.authenticateToken(createUserToken())),
            null
        );
    }
    const unavailable = createAdapter({ fetchImplementation: async () => reply(503) });
    await assert.rejects(
        unavailable.requestCustomerId(unavailable.authenticateToken(createUserToken())),
        (error) => error.statusCode === 503
    );
});

test("timeout covers response-body parsing and does not retry", async () => {
    for (const call of ["identity"]) {
        let requests = 0;
        const adapter = createAdapter({
            timeoutMs: 10,
            fetchImplementation: async (_url, { signal }) => {
                requests += 1;
                return {
                    status: 200,
                    ok: true,
                    async json() {
                        return new Promise((resolve, reject) => {
                            signal.addEventListener(
                                "abort",
                                () => reject(new Error("response body aborted")),
                                { once: true }
                            );
                        });
                    }
                };
            }
        });
        const context = adapter.authenticateToken(createUserToken());
        await assert.rejects(
            call === "identity"
                ? adapter.requestCustomerId(context)
                : adapter.requestPermission(context, "payment.record"),
            (error) => error.statusCode === 503
        );
        assert.equal(requests, 1);
    }
});

test("a resolved customer id is remembered, so it keeps working while User-Service is down", async () => {
    const internalTokens = [];
    let up = true;
    const adapter = createAdapter({
        internalServiceTokenIssuer: {
            async createToken() {
                const token = `internal-${internalTokens.length + 1}`;
                internalTokens.push(token);
                return token;
            }
        },
        fetchImplementation: async () => {
            if (!up) throw new Error("User-Service is down");
            return customerIdentityResponse("user-verified", "customer-verified");
        }
    });
    assert.equal(await adapter.requestCustomerId(adapter.authenticateToken(createUserToken())), "customer-verified");
    up = false;
    assert.equal(await adapter.requestCustomerId(adapter.authenticateToken(createUserToken())), "customer-verified");
    assert.deepEqual(internalTokens, ["internal-1"]);
});

test("a customer never resolved before still needs User-Service, and null answers are not remembered", async () => {
    let status = 404;
    const adapter = createAdapter({
        fetchImplementation: async () => (status === 200
            ? customerIdentityResponse("user-verified", "customer-verified")
            : { status, ok: false, async json() { return { success: false, message: "no" }; } })
    });
    assert.equal(await adapter.requestCustomerId(adapter.authenticateToken(createUserToken())), null);
    status = 503;
    await assert.rejects(
        adapter.requestCustomerId(adapter.authenticateToken(createUserToken())),
        (error) => error.statusCode === 503
    );
    status = 200;
    assert.equal(await adapter.requestCustomerId(adapter.authenticateToken(createUserToken())), "customer-verified");
});
