const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const test = require("node:test");
const jwt = require("jsonwebtoken");
const { createAuthMiddleware } = require("../src/middleware/authMiddleware");

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
});
const otherKeyPair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
});
const auth = createAuthMiddleware({
    publicKey,
    issuer: "test-issuer",
    audience: "test-audience"
});

function createToken(claims = {}, options = {}) {
    const signOptions = {
        algorithm: options.algorithm || "RS256"
    };

    if (options.includeIssuer !== false) {
        signOptions.issuer = options.issuer || "test-issuer";
    }
    if (options.includeAudience !== false) {
        signOptions.audience = options.audience || "test-audience";
    }
    if (options.includeExpiration !== false) {
        signOptions.expiresIn = options.expiresIn ?? 60;
    }
    if (options.subject !== undefined) {
        signOptions.subject = options.subject;
    }

    return jwt.sign(
        claims,
        options.privateKey || privateKey,
        signOptions
    );
}

function runAuth(authorization) {
    const req = { headers: {} };
    if (authorization !== undefined) {
        req.headers.authorization = authorization;
    }

    let statusCode;
    let responseBody;
    let nextCalled = false;
    auth(req, {
        status(code) {
            statusCode = code;
            return this;
        },
        json(body) {
            responseBody = body;
            return this;
        }
    }, () => {
        nextCalled = true;
    });

    return { req, statusCode, responseBody, nextCalled };
}

test("rejects missing and malformed Bearer authorization headers", () => {
    for (const header of [undefined, "", "Basic token", "Bearer", "Bearer  "]) {
        const result = runAuth(header);
        assert.equal(result.statusCode, 401);
        assert.equal(result.nextCalled, false);
    }
});

test("rejects malformed, invalid-signature, expired, and non-RS256 tokens", () => {
    const invalidSignature = createToken(
        { roles: ["CUSTOMER"] },
        { privateKey: otherKeyPair.privateKey, subject: "user-1" }
    );
    const expired = createToken(
        { roles: ["CUSTOMER"], iat: Math.floor(Date.now() / 1000) - 60 },
        { expiresIn: 30, subject: "user-1" }
    );
    const wrongAlgorithm = jwt.sign(
        { roles: ["CUSTOMER"], sub: "user-1" },
        "test-secret",
        {
            algorithm: "HS256",
            issuer: "test-issuer",
            audience: "test-audience",
            expiresIn: 60
        }
    );

    for (const token of ["not-a-jwt", invalidSignature, expired, wrongAlgorithm]) {
        const result = runAuth(`Bearer ${token}`);
        assert.equal(result.statusCode, 401);
        assert.equal(result.nextCalled, false);
    }
});

test("rejects incorrect issuer and audience", () => {
    for (const options of [
        { issuer: "another-issuer", subject: "user-1" },
        { audience: "another-audience", subject: "user-1" }
    ]) {
        const result = runAuth(`Bearer ${createToken({ roles: ["CUSTOMER"] }, options)}`);
        assert.equal(result.statusCode, 401);
        assert.equal(result.nextCalled, false);
    }
});

test("rejects tokens without expiration or a non-empty subject", () => {
    const missingExpiration = createToken(
        { roles: ["CUSTOMER"], sub: "user-1" },
        { includeExpiration: false }
    );
    const missingSubject = createToken({ roles: ["CUSTOMER"] });
    const emptySubject = createToken({ roles: ["CUSTOMER"] }, { subject: " " });
    const nonStringSubject = createToken({ roles: ["CUSTOMER"], sub: 17 });

    for (const token of [
        missingExpiration,
        missingSubject,
        emptySubject,
        nonStringSubject
    ]) {
        const result = runAuth(`Bearer ${token}`);
        assert.equal(result.statusCode, 401);
        assert.equal(result.nextCalled, false);
    }
});

test("rejects missing, malformed, empty, and unknown roles claims", () => {
    const invalidRoleClaims = [
        {},
        { roles: null },
        { roles: "CUSTOMER" },
        { roles: [] },
        { roles: ["STAFF"] },
        { roles: ["CUSTOMER", 1] }
    ];

    for (const claims of invalidRoleClaims) {
        const result = runAuth(
            `Bearer ${createToken(claims, { subject: "user-1" })}`
        );
        assert.equal(result.statusCode, 401);
        assert.equal(result.nextCalled, false);
    }
});

test("accepts a valid RS256 token and exposes only the normalized user claims", () => {
    const result = runAuth(
        `Bearer ${createToken(
            { roles: ["CUSTOMER", "TECHNICIAN"], email: "private@example.test" },
            { subject: "user-1" }
        )}`
    );

    assert.equal(result.nextCalled, true);
    assert.equal(result.statusCode, undefined);
    assert.deepEqual(result.req.user, {
        userId: "user-1",
        roles: ["CUSTOMER", "TECHNICIAN"]
    });
});
