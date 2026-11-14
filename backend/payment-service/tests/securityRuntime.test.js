const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const jwt = require("jsonwebtoken");
const { createApplication } = require("../src/app");
const {
    loadUserServiceBaseUrl
} = require("../src/config/authorization");
const { createSecurityRuntime } = require("../src/securityRuntime");

function createConfigFixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "payment-security-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

    const userKeys = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" }
    });
    const internalKeys = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" }
    });
    const userPublicKeyPath = path.join(directory, "user-public.pem");
    const internalPrivateKeyPath = path.join(directory, "internal-private.pem");
    fs.writeFileSync(userPublicKeyPath, userKeys.publicKey);
    fs.writeFileSync(internalPrivateKeyPath, internalKeys.privateKey);

    return {
        userKeys,
        env: {
            NODE_ENV: "test",
            PAYMENT_USER_SERVICE_BASE_URL: "https://users.internal",
            PAYMENT_USER_JWT_ISSUER: "user-service",
            PAYMENT_USER_JWT_AUDIENCE: "com-tle-api",
            PAYMENT_USER_JWT_PUBLIC_KEY_PATH: userPublicKeyPath,
            PAYMENT_INTERNAL_JWT_PRIVATE_KEY_PATH: internalPrivateKeyPath,
            PAYMENT_INTERNAL_JWT_KID: "payment-key-1",
            PAYMENT_INTERNAL_JWT_ISSUER: "payment-service",
            PAYMENT_INTERNAL_JWT_AUDIENCE: "user-service",
            PAYMENT_INTERNAL_SERVICE_ID: "payment-service",
            PAYMENT_INTERNAL_JWT_LIFETIME_SECONDS: "60"
        },
        invalidKeyPath: path.join(directory, "invalid.pem")
    };
}

test("security runtime validates configuration and composes only security dependencies", async (t) => {
    const fixture = createConfigFixture(t);
    let networkCalls = 0;
    let databaseCalls = 0;
    const requests = [];
    const runtime = createSecurityRuntime({
        env: fixture.env,
        fetchImplementation: async (url, options) => {
            networkCalls += 1;
            requests.push({ url, options });
            return {
                status: 200,
                ok: true,
                async json() {
                    return {
                        success: true,
                        data: {
                            user_id: "user-1",
                            permission: "payment.record",
                            allowed: true
                        }
                    };
                }
            };
        },
        paymentDb() {
            databaseCalls += 1;
            throw new Error("Database must not be queried during construction");
        }
    });

    assert.deepEqual(Object.keys(runtime).sort(), [
        "internalServiceTokenIssuer",
        "userAuthorizationAdapter",
        "userJwtVerifier"
    ]);
    assert.notEqual(runtime.userJwtVerifier, runtime.internalServiceTokenIssuer);
    assert.equal(networkCalls, 0);
    assert.equal(databaseCalls, 0);

    const userToken = jwt.sign(
        { token_use: "user_access" },
        fixture.userKeys.privateKey,
        {
            algorithm: "RS256",
            issuer: "user-service",
            audience: "com-tle-api",
            subject: "user-1",
            expiresIn: 60
        }
    );
    const authContext = runtime.userAuthorizationAdapter.authenticateToken(userToken);
    assert.equal(
        await runtime.userAuthorizationAdapter.requestPermission(
            authContext,
            "payment.record"
        ),
        true
    );
    assert.equal(
        await runtime.userAuthorizationAdapter.requestPermission(
            authContext,
            "payment.record"
        ),
        true
    );

    assert.equal(networkCalls, 2);
    assert.equal(databaseCalls, 0);
    assert.deepEqual(requests.map(({ url }) => url), [
        "https://users.internal/internal/permissions/check",
        "https://users.internal/internal/permissions/check"
    ]);
    const internalTokens = requests.map(({ options }) =>
        options.headers.authorization.slice("Bearer ".length)
    );
    const internalClaims = internalTokens.map((token) => jwt.decode(token));
    assert.ok(internalClaims.every((claims) =>
        claims.token_use === "internal_service"
        && claims.sub === "payment-service"
        && claims.iss === "payment-service"
        && claims.aud === "user-service"
    ));
    assert.notEqual(internalClaims[0].jti, internalClaims[1].jti);
    assert.equal(runtime.userAuthorizationAdapter.createPaymentService, undefined);
    assert.equal(runtime.userAuthorizationAdapter.verifyApprovedPaymentAccount, undefined);
    assert.equal(runtime.userAuthorizationAdapter.isApprovedPaymentMethod, undefined);

    assert.throws(
        () => createSecurityRuntime({ env: {} }),
        /PAYMENT_USER_JWT_ISSUER/
    );
    const missingInternalConfig = { ...fixture.env };
    delete missingInternalConfig.PAYMENT_INTERNAL_JWT_KID;
    assert.throws(
        () => createSecurityRuntime({ env: missingInternalConfig }),
        /PAYMENT_INTERNAL_JWT_KID/
    );

    assert.throws(
        () => loadUserServiceBaseUrl({
            NODE_ENV: "production",
            PAYMENT_USER_SERVICE_BASE_URL: "http://localhost:3001"
        }),
        /must use HTTPS/
    );
    assert.throws(
        () => loadUserServiceBaseUrl({
            NODE_ENV: "test",
            PAYMENT_USER_SERVICE_BASE_URL: "http://localhost:3001"
        }),
        /must use HTTPS/
    );
    assert.equal(
        loadUserServiceBaseUrl({
            NODE_ENV: "development",
            PAYMENT_USER_SERVICE_BASE_URL: "http://localhost:3001"
        }),
        "http://localhost:3001"
    );
    assert.throws(
        () => loadUserServiceBaseUrl({
            NODE_ENV: "development",
            PAYMENT_USER_SERVICE_BASE_URL: "http://users.internal"
        }),
        /must use HTTPS/
    );
    for (const url of [
        "https://user:password@users.internal",
        "https://users.internal?token=value",
        "https://users.internal/api"
    ]) {
        assert.throws(
            () => loadUserServiceBaseUrl({
                NODE_ENV: "production",
                PAYMENT_USER_SERVICE_BASE_URL: url
            }),
            /trusted base URL/
        );
    }
    assert.throws(
        () => loadUserServiceBaseUrl({
            NODE_ENV: "production",
            PAYMENT_USER_SERVICE_BASE_URL: ""
        }),
        /PAYMENT_USER_SERVICE_BASE_URL/
    );
    assert.throws(
        () => createSecurityRuntime({
            env: {
                ...fixture.env,
                PAYMENT_USER_SERVICE_BASE_URL: ""
            }
        }),
        /PAYMENT_USER_SERVICE_BASE_URL/
    );

    fs.writeFileSync(fixture.invalidKeyPath, "not a PEM key");
    assert.throws(
        () => createSecurityRuntime({
            env: {
                ...fixture.env,
                PAYMENT_USER_JWT_PUBLIC_KEY_PATH: fixture.invalidKeyPath
            }
        })
    );
    assert.throws(
        () => createSecurityRuntime({
            env: {
                ...fixture.env,
                PAYMENT_INTERNAL_JWT_PRIVATE_KEY_PATH: fixture.invalidKeyPath
            }
        })
    );
});

test("application factory keeps health isolated and registers no business routes", async () => {
    const queries = [];
    const db = {
        async raw(query) {
            queries.push(query);
        }
    };
    const app = createApplication({ db });
    const routeLayers = app.router.stack.filter((layer) => layer.route);

    assert.deepEqual(routeLayers.map((layer) => layer.route.path), ["/health"]);
    assert.deepEqual(Object.keys(routeLayers[0].route.methods), ["get"]);
    assert.equal(routeLayers[0].route.methods.get, true);
    assert.equal(queries.length, 0);
    assert.equal(
        require.cache[require.resolve("../src/services/paymentService")],
        undefined
    );

    const response = {
        statusCode: undefined,
        body: undefined,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
    await routeLayers[0].route.stack[0].handle({}, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
        success: true,
        service: "payment-service",
        status: "running",
        database: "connected"
    });
    assert.deepEqual(queries, ["SELECT 1"]);
    assert.equal(JSON.stringify(response.body).includes("PRIVATE KEY"), false);
    assert.equal(JSON.stringify(response.body).includes("secret"), false);
});

test("server module import does not initialize the database or listen", () => {
    const databasePath = require.resolve("../src/config/database");
    const originalListen = http.Server.prototype.listen;
    http.Server.prototype.listen = () => {
        throw new Error("Server must not listen during import");
    };

    try {
        const { startServer } = require("../server");
        assert.equal(typeof startServer, "function");
        assert.equal(require.cache[databasePath], undefined);
    } finally {
        http.Server.prototype.listen = originalListen;
    }
});
