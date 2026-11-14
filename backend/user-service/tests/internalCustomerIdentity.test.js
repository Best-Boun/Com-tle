const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const test = require("node:test");
const jwt = require("jsonwebtoken");
const AppError = require("../../shared/errors/AppError");
const { createAuthService } = require("../src/services/authService");
const {
    createInternalCustomerIdentityService
} = require("../src/services/internalCustomerIdentityService");

const now = 1_700_000_000_000;
const nowSeconds = Math.floor(now / 1000);
const keys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
});

function createUserToken(userId = "user-1", payload = {}, signingKey = keys.privateKey) {
    return jwt.sign({
        token_use: "user_access",
        iat: nowSeconds,
        roles: ["CUSTOMER"],
        ...payload
    }, signingKey, {
        algorithm: "RS256",
        issuer: "user-service",
        audience: "com-tle-api",
        subject: userId,
        expiresIn: 60,
        mutatePayload: false
    });
}

function createDatabase({
    user = { user_id: "user-1", status: "ACTIVE" },
    customers = [{
        customer_id: "customer-1",
        user_id: "user-1",
        customer_type: "REGISTERED"
    }],
    failRead = false,
    failAudit = false
} = {}) {
    const auditRows = [];
    const db = (table) => ({
                select() {
                    if (failRead) {
                        throw new Error("database credentials or SQL details");
                    }
                    return this;
                },
                where(criteria) {
                    this.criteria = criteria;
                    return this;
                },
                async first() {
                    if (table === "users") {
                        return user?.user_id === this.criteria.user_id ? user : null;
                    }
                    throw new Error(`Unexpected first query: ${table}`);
                },
                async then(resolve, reject) {
                    if (table !== "customers") {
                        throw new Error(`Unexpected list query: ${table}`);
                    }
                    return Promise.resolve(customers.filter(
                        (customer) => customer.user_id === this.criteria.user_id
                    )).then(resolve, reject);
                },
                async insert(row) {
                    if (table !== "user_audit_logs") {
                        throw new Error(`Unexpected insert: ${table}`);
                    }
                    if (failAudit) {
                        throw new Error("audit database credentials or SQL details");
                    }
                    auditRows.push(row);
                }
            });
    db.transaction = async (callback) => callback(db);
    return { db, auditRows };
}

function createIdentityService(options = {}) {
    const database = createDatabase(options);
    const authService = createAuthService({
        db: database.db,
        jwtConfig: {
            issuer: "user-service",
            audience: "com-tle-api",
            expiresIn: 60,
            refreshExpiresIn: 3600,
            privateKey: keys.privateKey
        },
        now: () => now
    });
    const service = createInternalCustomerIdentityService({
        db: database.db,
        verifyUserAccessToken: authService.verifyAccessToken
    });
    return { ...database, service };
}

const paymentCaller = { serviceId: "payment-service" };

async function resolve(service, {
    userId = "user-1",
    token = createUserToken(userId),
    input = { user_id: userId },
    caller = paymentCaller
} = {}) {
    return service.resolveRegisteredCustomerByUserId(
        caller,
        input,
        token,
        "request:identity-1"
    );
}

test("active registered user resolves to only the verified identifiers and writes safe audit", async () => {
    const { service, auditRows } = createIdentityService();
    assert.deepEqual(await resolve(service), {
        user_id: "user-1",
        customer_id: "customer-1",
        customer_type: "REGISTERED"
    });
    assert.equal(auditRows.length, 1);
    assert.equal(auditRows[0].action, "INTERNAL.CUSTOMER_IDENTITY_RESOLVED");
    assert.equal(auditRows[0].actor_user_id, null);
    assert.equal(auditRows[0].resource_type, "user");
    assert.equal(auditRows[0].resource_id, "user-1");
    assert.deepEqual(auditRows[0].metadata, {
        calling_service: "payment-service",
        outcome: "SUCCESS",
        request_id: "request:identity-1"
    });
    assert.equal(auditRows[0].reason, "RESOLVED");
});

test("missing, inactive, guest, merged, and missing-user mappings return the same generic 404", async () => {
    const cases = [
        { user: null, customers: [] },
        { user: { user_id: "user-1", status: "DISABLED" }, customers: [] },
        { user: { user_id: "user-1", status: "LOCKED" }, customers: [] },
        { user: { user_id: "user-1", status: "ACTIVE" }, customers: [] },
        {
            user: { user_id: "user-1", status: "ACTIVE" },
            customers: [{
                customer_id: "guest-1",
                user_id: null,
                customer_type: "GUEST"
            }]
        },
        {
            user: { user_id: "user-1", status: "ACTIVE" },
            customers: [{
                customer_id: "guest-1",
                user_id: "user-1",
                customer_type: "GUEST"
            }]
        },
        {
            user: { user_id: "user-1", status: "ACTIVE" },
            customers: [{
                customer_id: "merged-1",
                user_id: "user-1",
                customer_type: "MERGED"
            }]
        }
    ];
    for (const options of cases) {
        const { service, auditRows } = createIdentityService(options);
        await assert.rejects(resolve(service), (error) => (
            error instanceof AppError
            && error.statusCode === 404
            && error.message === "Customer identity not found"
        ));
        assert.equal(auditRows.length, 1);
        assert.equal(auditRows[0].metadata.outcome, "FAILURE");
    }
});

test("multiple Customer mappings fail closed with a safe integrity conflict audit", async () => {
    const { service, auditRows } = createIdentityService({
        customers: [
            { customer_id: "customer-1", user_id: "user-1", customer_type: "REGISTERED" },
            { customer_id: "customer-2", user_id: "user-1", customer_type: "REGISTERED" }
        ]
    });
    await assert.rejects(resolve(service), (error) => error.statusCode === 409);
    assert.equal(auditRows[0].reason, "MAPPING_INTEGRITY_CONFLICT");
});

test("User JWT signature, expiry, purpose, and subject binding are required", async () => {
    const { service, auditRows } = createIdentityService();
    const invalidTokens = [
        createUserToken("user-1", {}, generateKeyPairSync("rsa", {
            modulusLength: 2048,
            privateKeyEncoding: { type: "pkcs8", format: "pem" },
            publicKeyEncoding: { type: "spki", format: "pem" }
        }).privateKey),
        jwt.sign({
            token_use: "user_access",
            iat: nowSeconds,
            exp: nowSeconds - 1,
            roles: ["CUSTOMER"]
        }, keys.privateKey, {
            algorithm: "RS256",
            issuer: "user-service",
            audience: "com-tle-api",
            subject: "user-1"
        }),
        createUserToken("user-1", { token_use: "internal_service" })
    ];
    for (const token of invalidTokens) {
        await assert.rejects(
            resolve(service, { token }),
            (error) => error.statusCode === 401
        );
    }
    await assert.rejects(
        resolve(service, { input: { user_id: "another-user" } }),
        (error) => error.statusCode === 401
    );
    await assert.rejects(
        service.resolveRegisteredCustomerByUserId(
            paymentCaller,
            { user_id: "user-1" },
            null
        ),
        (error) => error.statusCode === 401
    );
    assert.equal(auditRows.length, 5);
    assert.ok(auditRows.every((row) => row.resource_id === null
        || row.resource_id === "user-1"));
    assert.equal(JSON.stringify(auditRows).includes("eyJ"), false);
});

test("unknown request properties and caller-supplied Customer IDs are rejected and audited", async () => {
    const { service, auditRows } = createIdentityService();
    for (const input of [
        { user_id: "user-1", extra: "claim" },
        { user_id: "user-1", customer_id: "customer-1" }
    ]) {
        await assert.rejects(
            resolve(service, { input }),
            (error) => error.statusCode === 400
        );
    }
    assert.equal(auditRows.length, 2);
    assert.ok(auditRows.every((row) => row.reason === "INVALID_REQUEST"));
});

test("only Payment-Service is authorized and denied attempts are audited", async () => {
    const { service, auditRows } = createIdentityService();
    await assert.rejects(
        resolve(service, { caller: { serviceId: "booking-service" } }),
        (error) => error.statusCode === 403
    );
    assert.equal(auditRows.length, 1);
    assert.equal(auditRows[0].reason, "CALLER_NOT_ALLOWED");
});

test("database and audit failures fail closed without disclosing Customer IDs", async () => {
    const unavailableDatabase = createIdentityService({ failRead: true });
    await assert.rejects(
        resolve(unavailableDatabase.service),
        (error) => error.statusCode === 503
            && error.message === "Customer identity service unavailable"
    );

    const unavailableAudit = createIdentityService({ failAudit: true });
    await assert.rejects(
        resolve(unavailableAudit.service),
        (error) => error.statusCode === 503
            && error.message === "Customer identity service unavailable"
    );
});
