const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const {
    buildChildEnvironment,
    validTokenTestsEnabled,
    preflightError,
    runPreflightQuery
} = require("./httpIntegrationHarnessConfig");
const {
    stopChild,
    cleanupHarness,
    withHarnessCleanup
} = require("./httpIntegrationHarnessCleanup");

test("child environment replaces inherited internal JWT configuration only", () => {
    const childEnv = buildChildEnvironment({
        DB_HOST: "expected-host",
        DB_NAME: "user_db",
        INTERNAL_SERVICE_JWT_ISSUER: "inherited-issuer",
        INTERNAL_SERVICE_JWT_EXTRA: "inherited-setting",
        USER_SERVICE_ALLOW_RAILWAY_HTTP_HARNESS: "1",
        USER_SERVICE_ALLOW_VALID_INTERNAL_TOKEN_HTTP_TESTS: "1",
        USER_SERVICE_SA_APPROVED_REPLAY_WRITES: "1"
    }, {
        publicKeysDirectory: "C:\\Temp\\public",
        privateKeyPath: "C:\\Temp\\test-private.pem",
        issuer: "user-service-http-test-issuer",
        audience: "user-service-http-test-audience",
        keyId: "it-payment-key"
    });

    assert.equal(childEnv.DB_HOST, "expected-host");
    assert.equal(childEnv.DB_NAME, "user_db");
    assert.equal(childEnv.PORT, "0");
    assert.equal(childEnv.USER_SERVICE_HTTP_INTEGRATION_TEST, "1");
    assert.equal(childEnv.INTERNAL_SERVICE_JWT_ISSUER, "user-service-http-test-issuer");
    assert.equal(childEnv.INTERNAL_SERVICE_JWT_ALLOWED_SERVICES, "payment-service");
    assert.equal(childEnv.INTERNAL_SERVICE_JWT_KEY_SERVICES, "it-payment-key:payment-service");
    assert.equal(Object.keys(childEnv).some((name) =>
        name.startsWith("INTERNAL_SERVICE_JWT_EXTRA")
    ), false);
    assert.equal(Object.hasOwn(childEnv, "USER_SERVICE_ALLOW_RAILWAY_HTTP_HARNESS"), false);
    assert.equal(Object.hasOwn(childEnv, "USER_SERVICE_ALLOW_VALID_INTERNAL_TOKEN_HTTP_TESTS"), false);
    assert.equal(Object.hasOwn(childEnv, "USER_SERVICE_SA_APPROVED_REPLAY_WRITES"), false);
});

test("valid-token HTTP cases require both explicit opt-ins", () => {
    assert.equal(validTokenTestsEnabled({}), false);
    assert.equal(validTokenTestsEnabled({
        USER_SERVICE_ALLOW_VALID_INTERNAL_TOKEN_HTTP_TESTS: "1"
    }), false);
    assert.equal(validTokenTestsEnabled({
        USER_SERVICE_SA_APPROVED_REPLAY_WRITES: "1"
    }), false);
    assert.equal(validTokenTestsEnabled({
        USER_SERVICE_ALLOW_VALID_INTERNAL_TOKEN_HTTP_TESTS: "1",
        USER_SERVICE_SA_APPROVED_REPLAY_WRITES: "1"
    }), true);
});

test("preflight query acquires and releases its connection and preserves the result", async () => {
    const connection = {};
    const calls = [];
    const expected = [[{ database_name: "user_db" }]];
    const db = {
        client: {
            async acquireConnection() {
                calls.push("acquire");
                return connection;
            },
            async releaseConnection(actual) {
                assert.equal(actual, connection);
                calls.push("release");
            }
        },
        raw(sql) {
            assert.equal(sql, "SELECT identity");
            return {
                async connection(actual) {
                    assert.equal(actual, connection);
                    calls.push("query");
                    return expected;
                }
            };
        }
    };

    assert.equal(await runPreflightQuery(db, "SELECT identity", "identity query"), expected);
    assert.deepEqual(calls, ["acquire", "query", "release"]);
});

test("preflight diagnostics distinguish acquisition and query failures without leaking secrets", async () => {
    const secret = "synthetic-password-token-user-id";
    const failure = Object.assign(new Error(`query contained ${secret}`), {
        code: "PROTOCOL_CONNECTION_LOST",
        cause: { code: "ECONNRESET" }
    });
    failure.stack = `Error: ${secret}\n    at C:\\private\\connection.js:24:8`;
    const expectedDetails = {
        code: "PROTOCOL_CONNECTION_LOST",
        name: "Error",
        message: "Error message withheld to protect sensitive data",
        causeCode: "ECONNRESET",
        stackLocation: "connection.js:24:8"
    };
    const parseError = (error, stage) => {
        assert.equal(error.message.includes(secret), false);
        assert.equal(error.cause, undefined);
        assert.deepEqual(
            JSON.parse(error.message.slice("Railway preflight failed: ".length)),
            { stage, ...expectedDetails }
        );
        return true;
    };
    let releases = 0;
    const db = {
        client: {
            async acquireConnection() {
                throw failure;
            },
            async releaseConnection() {
                releases += 1;
            }
        },
        raw() {
            return { connection: async () => { throw failure; } };
        }
    };

    await assert.rejects(
        runPreflightQuery(db, "SELECT identity", "identity query"),
        (error) => parseError(error, "connection acquisition")
    );
    assert.equal(releases, 0);

    db.client.acquireConnection = async () => ({});
    await assert.rejects(
        runPreflightQuery(db, "SELECT identity", "identity query"),
        (error) => parseError(error, "identity query")
    );
    assert.equal(releases, 1);
});

test("preflight diagnostics preserve a known safe MySQL error message", () => {
    const error = Object.assign(
        new Error("Connection lost: The server closed the connection."),
        { code: "PROTOCOL_CONNECTION_LOST" }
    );
    const diagnostic = preflightError(error, "connection acquisition");
    assert.match(diagnostic.message, /Connection lost: The server closed the connection\./);
    assert.match(diagnostic.message, /PROTOCOL_CONNECTION_LOST/);
});

test("preflight reports both sanitized query and connection release failures", async () => {
    const secret = "synthetic-connection-secret";
    const db = {
        client: {
            acquireConnection: async () => ({}),
            releaseConnection: async () => { throw new Error(secret); }
        },
        raw: () => ({
            connection: async () => { throw new Error(secret); }
        })
    };

    await assert.rejects(
        runPreflightQuery(db, "SELECT identity", "identity query"),
        (error) => error instanceof AggregateError
            && error.errors.length === 2
            && error.errors[0].message.includes('"stage":"identity query"')
            && error.errors[1].message.includes('"stage":"connection release"')
            && !error.errors.some((entry) => entry.message.includes(secret))
    );
});

function fakeChild(onSignal) {
    const child = new EventEmitter();
    child.pid = 123;
    child.exitCode = null;
    child.signalCode = null;
    child.kill = (signal) => onSignal(child, signal);
    return child;
}

function exitChild(child, signal) {
    child.signalCode = signal;
    child.emit("exit", null, signal);
    return true;
}

test("normal harness cleanup confirms child exit and destroys Knex exactly once", async () => {
    const signals = [];
    const child = fakeChild((process, signal) => {
        signals.push(signal);
        return exitChild(process, signal);
    });
    let destroys = 0;
    const removed = [];
    const result = await cleanupHarness({
        child,
        db: { destroy: async () => { destroys += 1; } },
        temporaryDirectory: "test-directory"
    }, { removeDirectory: (directory) => { removed.push(directory); } });

    assert.deepEqual(signals, ["SIGTERM"]);
    assert.equal(result.child, "sigterm-exited");
    assert.equal(result.database, "destroyed");
    assert.equal(result.temporaryDirectory, "removed");
    assert.deepEqual(result.errors, []);
    assert.equal(destroys, 1);
    assert.deepEqual(removed, ["test-directory"]);
});

test("original probe error survives separate cleanup errors", async () => {
    const original = new Error("original probe failure");
    let destroys = 0;
    const logs = [];
    const logger = {
        log: (...args) => logs.push(args),
        error: (...args) => logs.push(args)
    };
    const resources = {
        child: fakeChild((child, signal) => exitChild(child, signal)),
        db: { destroy: async () => { destroys += 1; } },
        temporaryDirectory: "test-directory"
    };

    await assert.rejects(withHarnessCleanup(
        async () => { throw original; },
        resources,
        {
            logger,
            removeDirectory: () => { throw new Error("sensitive filesystem detail"); }
        }
    ), (error) => error === original);
    assert.equal(destroys, 1);
    assert.equal(logs[0][1].child, "sigterm-exited");
    assert.equal(logs[0][1].database, "destroyed");
    assert.equal(logs[0][1].temporaryDirectory, "failed");
    assert.deepEqual(logs[1][1], ["Temporary key directory cleanup failed"]);
});

test("already-exited child is not signaled", async () => {
    const child = fakeChild(() => assert.fail("already-exited child was signaled"));
    child.exitCode = 0;
    assert.equal(await stopChild(child), "already-exited");
});

test("graceful timeout forces termination and waits for exit", async () => {
    const signals = [];
    const child = fakeChild((process, signal) => {
        signals.push(signal);
        if (signal === "SIGKILL") {
            setImmediate(() => exitChild(process, signal));
        }
        return true;
    });
    assert.equal(await stopChild(child, 5), "forced");
    assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
    assert.equal(child.signalCode, "SIGKILL");
});

test("child termination failure does not prevent Knex and key cleanup", async () => {
    const signals = [];
    const child = fakeChild((process, signal) => {
        signals.push(signal);
        return false;
    });
    let destroys = 0;
    let removals = 0;
    const result = await cleanupHarness({
        child,
        db: { destroy: async () => { destroys += 1; } },
        temporaryDirectory: "test-directory"
    }, { timeoutMs: 5, removeDirectory: () => { removals += 1; } });

    assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
    assert.equal(result.child, "failed");
    assert.equal(result.database, "destroyed");
    assert.equal(result.temporaryDirectory, "removed");
    assert.equal(destroys, 1);
    assert.equal(removals, 1);
    assert.deepEqual(result.errors.map((error) => error.message), [
        "Child process cleanup failed"
    ]);
});

test("Knex destruction failure does not prevent child and key cleanup", async () => {
    let destroys = 0;
    let removals = 0;
    const result = await cleanupHarness({
        child: fakeChild((child, signal) => exitChild(child, signal)),
        db: { destroy: async () => { destroys += 1; throw new Error("database detail"); } },
        temporaryDirectory: "test-directory"
    }, { removeDirectory: () => { removals += 1; } });

    assert.equal(result.child, "sigterm-exited");
    assert.equal(result.database, "failed");
    assert.equal(result.temporaryDirectory, "removed");
    assert.equal(destroys, 1);
    assert.equal(removals, 1);
    assert.deepEqual(result.errors.map((error) => error.message), ["Knex cleanup failed"]);
});

test("cleanup failures fail a successful probe with an aggregate error", async () => {
    await assert.rejects(withHarnessCleanup(async () => "ok", {
        db: { destroy: async () => { throw new Error("database detail"); } },
        temporaryDirectory: "test-directory"
    }, {
        logger: { log() {}, error() {} },
        removeDirectory: () => { throw new Error("filesystem detail"); }
    }), (error) => error instanceof AggregateError
        && error.errors.length === 2
        && error.errors[0].message === "Knex cleanup failed"
        && error.errors[1].message === "Temporary key directory cleanup failed");
});

test("failed graceful signal is reported when forced termination succeeds", async () => {
    const child = fakeChild((process, signal) => {
        if (signal === "SIGTERM") {
            throw new Error("signal failed");
        }
        return exitChild(process, signal);
    });
    assert.equal(await stopChild(child, 5), "forced-after-signal-error");
});

test("failed-to-spawn child is not signaled", async () => {
    const child = fakeChild(() => assert.fail("unstarted child was signaled"));
    child.pid = undefined;
    assert.equal(await stopChild(child), "not-started");
});

test("unconfirmed forced termination is bounded and reported", async () => {
    const child = fakeChild(() => true);
    const result = await cleanupHarness({ child }, { timeoutMs: 5 });
    assert.equal(result.child, "failed");
    assert.equal(result.errors[0].message, "Child process cleanup failed");
});
