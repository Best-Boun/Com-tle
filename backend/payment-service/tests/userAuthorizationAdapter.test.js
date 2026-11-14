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

test("User JWT accepts a trusted RS256 user token without using role or permission claims", () => {
    const verified = createVerifier().verify(createUserToken());
    assert.deepEqual(verified, { userId: "user-verified" });
    assert.equal(Object.hasOwn(verified, "roles"), false);
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

test("authorization adapter derives actor identity from verified token and sends a fresh internal token", async () => {
    let request;
    const adapter = createAdapter({
        fetchImplementation: async (url, options) => {
            request = { url, options };
            return permissionResponse("user-verified", "payment.record");
        }
    });
    const authContext = adapter.authenticateToken(createUserToken());
    const actorUserId = await adapter.authorizePaymentRecorder(authContext);

    assert.equal(actorUserId, "user-verified");
    assert.equal(request.url, "https://user-service.internal/internal/permissions/check");
    assert.equal(request.options.headers.authorization, "Bearer signed-internal-token");
    assert.deepEqual(JSON.parse(request.options.body), {
        user_id: "user-verified",
        permission: "payment.record",
        resource: {}
    });
    assert.equal(Object.hasOwn(authContext, "roles"), false);
    assert.equal(Object.hasOwn(authContext, "permissions"), false);
});

test("adapter distinguishes permission denial, User JWT failure, and internal authentication failure", async () => {
    const denied = createAdapter({
        fetchImplementation: async () =>
            permissionResponse("user-verified", "payment.record", false)
    });
    const authContext = denied.authenticateToken(createUserToken());
    await assert.rejects(
        denied.authorizePaymentRecorder(authContext),
        (error) => error.statusCode === 403
    );
    await assert.rejects(
        denied.authorizePaymentRecorder({ userId: "client-supplied-user" }),
        (error) => error.statusCode === 401
    );
    assert.throws(
        () => denied.authenticateToken("not-a-token"),
        (error) => error.statusCode === 401
    );

    const internalAuthFailure = createAdapter({
        fetchImplementation: async () => ({
            status: 401,
            ok: false,
            async json() {
                return {};
            }
        })
    });
    await assert.rejects(
        internalAuthFailure.authorizePaymentRecorder(
            internalAuthFailure.authenticateToken(createUserToken())
        ),
        (error) => error.statusCode === 401
    );
});

test("adapter fails closed on timeout, network failure, malformed response, and unapproved permission", async () => {
    const networkFailure = createAdapter({
        fetchImplementation: async () => {
            throw new Error("timeout");
        }
    });
    await assert.rejects(
        networkFailure.requestPermission(
            networkFailure.authenticateToken(createUserToken()),
            "payment.record"
        ),
        (error) => error.statusCode === 503
    );

    const timedOut = createAdapter({
        timeoutMs: 5,
        fetchImplementation: async (_url, { signal }) => new Promise((resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")), {
                once: true
            });
        })
    });
    await assert.rejects(
        timedOut.requestPermission(
            timedOut.authenticateToken(createUserToken()),
            "payment.record"
        ),
        (error) => error.statusCode === 503
    );

    const unavailable = createAdapter({
        fetchImplementation: async () => ({
            status: 503,
            ok: false
        })
    });
    await assert.rejects(
        unavailable.requestPermission(
            unavailable.authenticateToken(createUserToken()),
            "payment.record"
        ),
        (error) => error.statusCode === 503
    );

    const badResponse = createAdapter({
        fetchImplementation: async () => ({
            status: 200,
            ok: true,
            async json() {
                return {
                    success: true,
                    data: {
                        user_id: "attacker-user",
                        permission: "payment.record",
                        allowed: true
                    }
                };
            }
        })
    });
    await assert.rejects(
        badResponse.requestPermission(
            badResponse.authenticateToken(createUserToken()),
            "payment.record"
        ),
        (error) => error.statusCode === 503
    );
    assert.equal(
        await badResponse.requestPermission(
            badResponse.authenticateToken(createUserToken()),
            "not-approved"
        ),
        false
    );

    const refundDenied = createAdapter({
        fetchImplementation: async () =>
            permissionResponse("user-verified", "payment.refund", false)
    });
    await assert.rejects(
        refundDenied.authorizeRefundActor(
            refundDenied.authenticateToken(createUserToken()),
            "payment.refund"
        ),
        (error) => error.statusCode === 403
    );
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
    for (const call of ["identity", "permission"]) {
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

test("each identity request issues a new Internal Service JWT", async () => {
    const internalTokens = [];
    const adapter = createAdapter({
        internalServiceTokenIssuer: {
            async createToken() {
                const token = `internal-${internalTokens.length + 1}`;
                internalTokens.push(token);
                return token;
            }
        },
        fetchImplementation: async () => customerIdentityResponse("user-verified", "customer-verified")
    });
    const authContext = adapter.authenticateToken(createUserToken());
    await adapter.requestCustomerId(authContext);
    await adapter.requestCustomerId(authContext);
    assert.deepEqual(internalTokens, ["internal-1", "internal-2"]);
});
