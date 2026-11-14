const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const express = require("express");
const http = require("node:http");
const test = require("node:test");
const jwt = require("jsonwebtoken");
const AppError = require("../../shared/errors/AppError");
const { errorHandler } = require("../../shared/middleware/errorMiddleware");
const {
    INTERNAL_JWT_CLOCK_SKEW_SECONDS
} = require("../src/constants/internalServiceAuth");
const {
    createRequireInternalServiceAuth
} = require("../src/middleware/requireInternalServiceAuth");
const {
    createInternalServiceAuthService
} = require("../src/services/internalServiceAuthService");
const {
    createInternalTokenReplayRepository
} = require("../src/services/internalTokenReplayRepository");

const keyPair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
});

function createFakeDb() {
    const records = new Map();
    const calls = [];
    let failure;

    function db(tableName) {
        assert.equal(tableName, "internal_token_replays");
        return {
            async insert(record) {
                calls.push({ type: "insert", record });
                if (failure) {
                    throw failure;
                }
                const key = `${record.issuer}\u0000${record.jti}`;
                if (records.has(key)) {
                    const error = new Error("duplicate");
                    error.code = "ER_DUP_ENTRY";
                    error.errno = 1062;
                    throw error;
                }
                records.set(key, record);
                return [records.size];
            },
            where(column, operator, value) {
                calls.push({ type: "where", column, operator, value });
                this.filter = { column, operator, value };
                return this;
            },
            async delete() {
                calls.push({ type: "delete", filter: this.filter });
                if (failure) {
                    throw failure;
                }
                let deleted = 0;
                for (const [key, record] of records) {
                    if (record.expires_at < this.filter.value) {
                        records.delete(key);
                        deleted += 1;
                    }
                }
                return deleted;
            }
        };
    }

    return {
        db,
        calls,
        records,
        setFailure(error) {
            failure = error;
        }
    };
}

function replayInput(overrides = {}) {
    return {
        issuer: "payment-service",
        jti: "jti-12345678",
        clientId: "payment-service",
        expiresAt: 1_700_000_060,
        ...overrides
    };
}

test("first jti insert succeeds and stores exp plus the approved UTC skew", async () => {
    const fake = createFakeDb();
    const repository = createInternalTokenReplayRepository({
        db: fake.db,
        now: () => Date.UTC(2026, 10, 11, 12, 0, 0, 123)
    });

    assert.equal(await repository.consumeJti(replayInput()), true);
    const [stored] = fake.records.values();
    assert.equal(stored.expires_at, new Date(
        (replayInput().expiresAt + INTERNAL_JWT_CLOCK_SKEW_SECONDS) * 1000
    ).toISOString().replace("T", " ").replace("Z", ""));
    assert.equal(stored.created_at, "2026-11-11 12:00:00.123");
    assert.equal(stored.client_id, "payment-service");
});

test("unique issuer and jti reject reuse but permit another issuer or jti", async () => {
    const fake = createFakeDb();
    const repository = createInternalTokenReplayRepository({
        db: fake.db,
        now: () => Date.UTC(2026, 10, 11)
    });

    assert.equal(await repository.consumeJti(replayInput()), true);
    assert.equal(await repository.consumeJti(replayInput()), false);
    assert.equal(await repository.consumeJti(replayInput({
        issuer: "another-issuer"
    })), true);
    assert.equal(await repository.consumeJti(replayInput({
        jti: "jti-87654321"
    })), true);
    assert.equal(fake.records.size, 3);
    assert.equal(fake.calls.filter((call) => call.type === "insert").length, 4);
    assert.equal(fake.calls.some((call) => call.type === "select"), false);
});

test("concurrent duplicate attempts produce exactly one insert success", async () => {
    const fake = createFakeDb();
    const repository = createInternalTokenReplayRepository({
        db: fake.db,
        now: () => Date.UTC(2026, 10, 11)
    });

    const outcomes = await Promise.all([
        repository.consumeJti(replayInput()),
        repository.consumeJti(replayInput())
    ]);
    assert.deepEqual(outcomes.sort(), [false, true]);
    assert.equal(fake.records.size, 1);
});

test("only MySQL duplicate-key errors are classified as replay", async () => {
    const fake = createFakeDb();
    const repository = createInternalTokenReplayRepository({
        db: fake.db,
        now: () => Date.UTC(2026, 10, 11)
    });
    const duplicateError = new Error("duplicate key");
    duplicateError.code = "ER_DUP_ENTRY";
    fake.setFailure(duplicateError);
    assert.equal(await repository.consumeJti(replayInput()), false);

    const storageError = new Error("connection failed");
    storageError.code = "ECONNREFUSED";
    fake.setFailure(storageError);
    await assert.rejects(
        repository.consumeJti(replayInput()),
        (error) => error instanceof AppError && error.statusCode === 503
    );
});

test("missing replay table fails closed through internal authentication with HTTP 503", async () => {
    const fake = createFakeDb();
    const missingTableError = new Error("Table does not exist");
    missingTableError.code = "ER_NO_SUCH_TABLE";
    missingTableError.errno = 1146;
    fake.setFailure(missingTableError);

    const issuedAt = 1_700_000_000;
    const repository = createInternalTokenReplayRepository({
        db: fake.db,
        now: () => issuedAt * 1000
    });
    const replayInputValue = replayInput({
        jti: "jti-missing-table"
    });

    await assert.rejects(
        repository.consumeJti(replayInputValue),
        (error) => error instanceof AppError && error.statusCode === 503
    );

    const token = jwt.sign({
        token_use: "internal_service",
        client_id: "payment-service",
        jti: replayInputValue.jti,
        iat: issuedAt
    }, keyPair.privateKey, {
        algorithm: "RS256",
        keyid: "payment-key-1",
        subject: "payment-service",
        issuer: "payment-service",
        audience: "user-service",
        expiresIn: 60
    });
    const auth = createInternalServiceAuthService({
        publicKeys: new Map([["payment-key-1", keyPair.publicKey]]),
        keyServiceIds: new Map([["payment-key-1", "payment-service"]]),
        issuer: "payment-service",
        audience: "user-service",
        allowedServices: new Set(["payment-service"]),
        consumeJti: repository.consumeJti,
        now: () => issuedAt * 1000,
        logger: { warn() {}, error() {} }
    });
    const app = express();
    let acceptedRequests = 0;
    app.get(
        "/protected",
        createRequireInternalServiceAuth(auth),
        (req, res) => {
            acceptedRequests += 1;
            res.sendStatus(200);
        }
    );
    app.use(errorHandler);

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
        const response = await fetch(
            `http://127.0.0.1:${server.address().port}/protected`,
            { headers: { authorization: `Bearer ${token}` } }
        );
        assert.equal(response.status, 503);
        assert.equal(acceptedRequests, 0);
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });
    }

    assert.equal(fake.records.size, 0);
    assert.equal(fake.calls.filter((call) => call.type === "insert").length, 2);
});

test("cleanup deletes only records strictly earlier than the UTC cutoff", async () => {
    const fake = createFakeDb();
    const repository = createInternalTokenReplayRepository({
        db: fake.db,
        now: () => Date.UTC(2026, 10, 11, 12)
    });
    await repository.consumeJti(replayInput({
        jti: "jti-before",
        expiresAt: Math.floor(Date.UTC(2026, 10, 11, 11, 59, 29) / 1000)
    }));
    await repository.consumeJti(replayInput({
        jti: "jti-boundary",
        expiresAt: Math.floor(Date.UTC(2026, 10, 11, 11, 59, 30) / 1000)
    }));

    const deleted = await repository.cleanupExpired(Date.UTC(2026, 10, 11, 12));
    assert.equal(deleted, 1);
    const cleanupWhere = fake.calls.filter((call) => call.type === "where").at(-1);
    assert.deepEqual(cleanupWhere, {
        type: "where",
        column: "expires_at",
        operator: "<",
        value: "2026-11-11 12:00:00.000"
    });
    assert.equal(fake.records.size, 1);
});

test("cleanup preserves replay rows until the verifier no longer accepts their token", async () => {
    const fake = createFakeDb();
    let currentTime = Date.UTC(2026, 10, 11, 12, 0, 0);
    const repository = createInternalTokenReplayRepository({
        db: fake.db,
        now: () => currentTime
    });
    const issuedAt = Math.floor(currentTime / 1000);
    const expiresAt = issuedAt + 60;
    const effectiveExpiry = (expiresAt + INTERNAL_JWT_CLOCK_SKEW_SECONDS) * 1000;
    const token = jwt.sign({
        token_use: "internal_service",
        client_id: "payment-service",
        sub: "payment-service",
        jti: "jti-cleanup-1234",
        iat: issuedAt,
        exp: expiresAt
    }, keyPair.privateKey, {
        algorithm: "RS256",
        keyid: "payment-key-1",
        issuer: "payment-service",
        audience: "user-service"
    });
    const auth = createInternalServiceAuthService({
        publicKeys: new Map([["payment-key-1", keyPair.publicKey]]),
        keyServiceIds: new Map([["payment-key-1", "payment-service"]]),
        issuer: "payment-service",
        audience: "user-service",
        allowedServices: new Set(["payment-service"]),
        consumeJti: repository.consumeJti,
        now: () => currentTime
    });

    await auth.verifyServiceToken(token);

    currentTime = effectiveExpiry + 999;
    assert.equal(await repository.cleanupExpired(), 0);
    assert.equal(fake.records.size, 1);
    const cleanupQuery = fake.calls
        .filter((call) => call.type === "where")
        .at(-1);
    assert.deepEqual(cleanupQuery, {
        type: "where",
        column: "expires_at",
        operator: "<",
        value: new Date(effectiveExpiry).toISOString().replace("T", " ").replace("Z", "")
    });
    await assert.rejects(
        auth.verifyServiceToken(token),
        (error) => error.statusCode === 401
            && error.message === "Internal service token has already been used"
    );

    currentTime = effectiveExpiry + 1000;
    assert.equal(await repository.cleanupExpired(), 1);
    assert.equal(fake.records.size, 0);
    await assert.rejects(
        auth.verifyServiceToken(token),
        (error) => error.statusCode === 401
            && error.message === "Expired internal service token"
    );
});

test("cleanup failure is explicit and cannot authorize a request", async () => {
    const fake = createFakeDb();
    const repository = createInternalTokenReplayRepository({
        db: fake.db,
        now: () => Date.UTC(2026, 10, 11)
    });
    fake.setFailure(new Error("storage unavailable"));
    await assert.rejects(
        repository.cleanupExpired(),
        (error) => error.statusCode === 503
    );
    await assert.rejects(
        repository.consumeJti(replayInput()),
        (error) => error.statusCode === 503
    );
});
