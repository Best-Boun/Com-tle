// The canonical MySQL schema stores DATETIME values as UTC; pin Node to UTC so
// mysql2 reads them without a local-timezone shift.
process.env.TZ = "UTC";

const assert = require("node:assert/strict");
const { createHash, generateKeyPairSync, randomUUID } = require("node:crypto");
const test = require("node:test");
const bcrypt = require("bcryptjs");
const knexFactory = require("knex");
const { USER_ROLES } = require("../../shared/constants");
const AppError = require("../../shared/errors/AppError");
const { createAuthService } = require("../src/services/authService");

const enabled = process.env.USER_SERVICE_ALLOW_REFRESH_DATABASE_TESTS === "1";
const requiredVariables = [
    "DB_TEST_HOST",
    "DB_TEST_PORT",
    "DB_TEST_USER",
    "DB_TEST_PASSWORD",
    "DB_TEST_NAME"
];

function getTestTarget() {
    if (!enabled) {
        return null;
    }

    if (requiredVariables.some((name) => !process.env[name])) {
        throw new Error("Dedicated DB_TEST_* settings are required");
    }

    const host = process.env.DB_TEST_HOST.toLowerCase();
    const database = process.env.DB_TEST_NAME;
    const port = Number(process.env.DB_TEST_PORT);
    if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
        throw new Error("Refresh database tests require a loopback DB_TEST_HOST");
    }
    if (!/^[A-Za-z0-9_]+$/.test(database)
        || !/(^|_)test($|_)/i.test(database)
        || /(^|[_-])(prod|production|stage|staging|dev|development)([_-]|$)/i.test(database)) {
        throw new Error("DB_TEST_NAME must be an isolated test-only database");
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("DB_TEST_PORT must be a valid TCP port");
    }

    return { host, database, port };
}

const testTarget = getTestTarget();
const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
});

test("refresh lifecycle works against the existing MySQL schema", {
    skip: enabled ? false : "Set USER_SERVICE_ALLOW_REFRESH_DATABASE_TESTS=1 with isolated DB_TEST_* settings"
}, async () => {
    const db = knexFactory({
        client: "mysql2",
        connection: {
            host: testTarget.host,
            port: testTarget.port,
            user: process.env.DB_TEST_USER,
            password: process.env.DB_TEST_PASSWORD,
            database: testTarget.database
        },
        pool: { min: 0, max: 2 },
        acquireConnectionTimeout: 10000
    });

    try {
        const columns = await db("information_schema.COLUMNS")
            .select("COLUMN_NAME")
            .where({
                TABLE_SCHEMA: testTarget.database,
                TABLE_NAME: "refresh_token_sessions"
            });
        const actualColumns = columns.map((row) => row.COLUMN_NAME).sort();
        assert.deepEqual(actualColumns, [
            "created_at",
            "expires_at",
            "last_used_at",
            "revoked_at",
            "replaced_by_token_id",
            "session_id",
            "token_family_id",
            "token_hash",
            "user_id"
        ].sort());

        const customerRole = await db("roles")
            .select("role_id")
            .where({ role_code: USER_ROLES.CUSTOMER })
            .first();
        assert.ok(customerRole, "The isolated test schema must contain the CUSTOMER role");

        const userId = randomUUID();
        const email = `refresh-it-${randomUUID()}@example.test`;
        await db.transaction(async (trx) => {
            await trx("users").insert({
                user_id: userId,
                email,
                password_hash: await bcrypt.hash("test-only-password", 4),
                phone: null,
                status: "ACTIVE"
            });
            await trx("user_roles").insert({
                user_id: userId,
                role_id: customerRole.role_id,
                assigned_by: null
            });
        });

        const jwtConfig = {
            privateKey,
            issuer: "user-service-refresh-test",
            audience: "com-tle-refresh-test",
            expiresIn: 60,
            refreshExpiresIn: 3600
        };
        // The production audit-to-dump mapping is unresolved; isolate refresh DB behavior.
        const testAuditLog = { record: async () => {} };
        const auth = createAuthService({ db, jwtConfig, auditLog: testAuditLog });
        const credentials = { email, password: "test-only-password" };
        const firstLogin = await auth.login(credentials);
        const otherDeviceLogin = await auth.login(credentials);
        const firstFamilyId = (await db("refresh_token_sessions")
            .select("token_family_id")
            .where({ token_hash: createHash("sha256")
                .update(firstLogin.refresh_token, "utf8")
                .digest("hex") })
            .first()).token_family_id;
        const otherFamilyId = (await db("refresh_token_sessions")
            .select("token_family_id")
            .where({ token_hash: createHash("sha256")
                .update(otherDeviceLogin.refresh_token, "utf8")
                .digest("hex") })
            .first()).token_family_id;
        assert.notEqual(firstFamilyId, otherFamilyId);

        const rotated = await auth.refresh({ refresh_token: firstLogin.refresh_token });
        const oldRow = await db("refresh_token_sessions")
            .where({ token_hash: createHash("sha256")
                .update(firstLogin.refresh_token, "utf8")
                .digest("hex") })
            .first();
        const replacementRow = await db("refresh_token_sessions")
            .where({ token_hash: createHash("sha256")
                .update(rotated.refresh_token, "utf8")
                .digest("hex") })
            .first();
        assert.notEqual(oldRow.session_id, replacementRow.session_id);
        assert.equal(oldRow.token_family_id, replacementRow.token_family_id);
        assert.equal(oldRow.replaced_by_token_id, replacementRow.session_id);
        assert.ok(oldRow.revoked_at);
        assert.equal(replacementRow.revoked_at, null);
        assert.notEqual(oldRow.token_hash, firstLogin.refresh_token);

        await assert.rejects(
            auth.refresh({ refresh_token: firstLogin.refresh_token }),
            (error) => error instanceof AppError && error.statusCode === 401
        );
        const firstFamilyRows = await db("refresh_token_sessions")
            .where({ token_family_id: firstFamilyId });
        const otherFamilyRows = await db("refresh_token_sessions")
            .where({ token_family_id: otherFamilyId });
        assert.ok(firstFamilyRows.every((row) => row.revoked_at !== null));
        assert.ok(otherFamilyRows.some((row) => row.revoked_at === null));

        assert.deepEqual(await auth.logout({
            refresh_token: otherDeviceLogin.refresh_token
        }), { revoked: true });
        const afterLogoutRows = await db("refresh_token_sessions")
            .where({ token_family_id: otherFamilyId });
        assert.ok(afterLogoutRows.every((row) => row.revoked_at !== null));
        await assert.rejects(
            auth.refresh({ refresh_token: otherDeviceLogin.refresh_token }),
            (error) => error instanceof AppError && error.statusCode === 401
        );

        const rollbackLogin = await auth.login(credentials);
        const failingAuditAuth = createAuthService({
            db,
            jwtConfig,
            auditLog: {
                record: async (_trx, event) => {
                    if (event.action === "AUTH.REFRESH_ROTATED") {
                        throw new Error("Intentional test failure to verify rollback");
                    }
                }
            }
        });
        await assert.rejects(
            failingAuditAuth.refresh({ refresh_token: rollbackLogin.refresh_token }),
            (error) => error instanceof AppError && error.statusCode === 503
        );
        const rollbackRows = await db("refresh_token_sessions")
            .where({ user_id: userId, token_family_id: (
                await db("refresh_token_sessions")
                    .select("token_family_id")
                    .where({ token_hash: createHash("sha256")
                        .update(rollbackLogin.refresh_token, "utf8")
                        .digest("hex") })
                    .first()
            ).token_family_id });
        assert.equal(rollbackRows.length, 1);
        assert.equal(rollbackRows[0].revoked_at, null);
        assert.equal(rollbackRows[0].replaced_by_token_id, null);

        const expiredLogin = await auth.login(credentials);
        const expiresAt = (await db("refresh_token_sessions")
            .select("expires_at")
            .where({ token_hash: createHash("sha256")
                .update(expiredLogin.refresh_token, "utf8")
                .digest("hex") })
            .first()).expires_at;
        const expiredAuth = createAuthService({
            db,
            jwtConfig,
            auditLog: testAuditLog,
            now: () => new Date(expiresAt).getTime() + 1
        });
        await assert.rejects(
            expiredAuth.refresh({ refresh_token: expiredLogin.refresh_token }),
            (error) => error instanceof AppError && error.statusCode === 401
        );
    } finally {
        await db.destroy();
    }
});

function parseMetadata(value) {
    return typeof value === "string" ? JSON.parse(value) : value;
}

test("refresh audit rows, logout idempotency, expiry scope, and inactive users on MySQL", {
    skip: enabled ? false : "Set USER_SERVICE_ALLOW_REFRESH_DATABASE_TESTS=1 with isolated DB_TEST_* settings"
}, async () => {
    const db = knexFactory({
        client: "mysql2",
        connection: {
            host: testTarget.host,
            port: testTarget.port,
            user: process.env.DB_TEST_USER,
            password: process.env.DB_TEST_PASSWORD,
            database: testTarget.database
        },
        pool: { min: 0, max: 2 },
        acquireConnectionTimeout: 10000
    });
    const hashOf = (token) => createHash("sha256").update(token, "utf8").digest("hex");
    const sessionFor = (token) => db("refresh_token_sessions")
        .where({ token_hash: hashOf(token) })
        .first();

    try {
        const customerRole = await db("roles")
            .select("role_id")
            .where({ role_code: USER_ROLES.CUSTOMER })
            .first();
        assert.ok(customerRole, "The isolated test schema must contain the CUSTOMER role");

        const userId = randomUUID();
        const email = `refresh-audit-it-${randomUUID()}@example.test`;
        await db.transaction(async (trx) => {
            await trx("users").insert({
                user_id: userId,
                email,
                password_hash: await bcrypt.hash("test-only-password", 4),
                phone: null,
                status: "ACTIVE"
            });
            await trx("user_roles").insert({
                user_id: userId,
                role_id: customerRole.role_id,
                assigned_by: null
            });
        });

        const jwtConfig = {
            privateKey,
            issuer: "user-service-refresh-test",
            audience: "com-tle-refresh-test",
            expiresIn: 60,
            refreshExpiresIn: 3600
        };
        // Production audit writer: verifies the real user_audit_logs mapping.
        const auth = createAuthService({ db, jwtConfig });
        const credentials = { email, password: "test-only-password" };
        const requestId = `refresh-it:${randomUUID()}`;

        // Rotation and reuse write real audit rows.
        const login = await auth.login(credentials, requestId);
        const loginRow = await sessionFor(login.refresh_token);
        await auth.refresh({ refresh_token: login.refresh_token }, requestId);
        const rotatedAudit = await db("user_audit_logs")
            .where({ action: "AUTH.REFRESH_ROTATED", resource_id: loginRow.session_id })
            .first();
        assert.ok(rotatedAudit, "Rotation must write an audit row");
        assert.equal(rotatedAudit.actor_user_id, userId);
        assert.equal(rotatedAudit.resource_type, "refresh_session");
        assert.deepEqual(parseMetadata(rotatedAudit.metadata), {
            outcome: "SUCCESS",
            request_id: requestId
        });

        await assert.rejects(
            auth.refresh({ refresh_token: login.refresh_token }, requestId),
            (error) => error instanceof AppError && error.statusCode === 401
        );
        const reuseAudit = await db("user_audit_logs")
            .where({
                action: "AUTH.REFRESH_REUSE_DETECTED",
                resource_id: loginRow.session_id
            })
            .first();
        assert.ok(reuseAudit, "Reuse detection must write an audit row");
        assert.equal(reuseAudit.reason, "REVOKED_TOKEN");
        assert.equal(parseMetadata(reuseAudit.metadata).outcome, "FAILURE");
        assert.equal(parseMetadata(reuseAudit.metadata).request_id, requestId);

        // Logout with an unknown token is idempotent and audited without a session.
        assert.deepEqual(
            await auth.logout({ refresh_token: `unknown-${randomUUID()}` }, requestId),
            { revoked: false }
        );
        const unknownLogoutAudits = (await db("user_audit_logs")
            .where({ action: "AUTH.LOGOUT" })
            .whereNull("resource_id"))
            .map((row) => parseMetadata(row.metadata))
            .filter((metadata) => metadata.request_id === requestId);
        assert.equal(unknownLogoutAudits.length, 1);
        assert.equal(unknownLogoutAudits[0].revoked, false);
        assert.equal(unknownLogoutAudits[0].outcome, "SUCCESS");

        // Repeating logout on an already revoked family reports revoked=false.
        const repeatLogin = await auth.login(credentials);
        assert.deepEqual(await auth.logout({ refresh_token: repeatLogin.refresh_token }), {
            revoked: true
        });
        assert.deepEqual(await auth.logout({ refresh_token: repeatLogin.refresh_token }), {
            revoked: false
        });
        assert.ok((await sessionFor(repeatLogin.refresh_token)).revoked_at);

        // An expired token revokes only its own session, not other families.
        const expiringLogin = await auth.login(credentials);
        const otherFamilyLogin = await auth.login(credentials);
        const expiringRow = await sessionFor(expiringLogin.refresh_token);
        const expiredAuth = createAuthService({
            db,
            jwtConfig,
            now: () => new Date(expiringRow.expires_at).getTime() + 1
        });
        await assert.rejects(
            expiredAuth.refresh({ refresh_token: expiringLogin.refresh_token }, requestId),
            (error) => error instanceof AppError && error.statusCode === 401
        );
        assert.ok((await sessionFor(expiringLogin.refresh_token)).revoked_at);
        assert.equal((await sessionFor(otherFamilyLogin.refresh_token)).revoked_at, null);
        const expiredAudit = await db("user_audit_logs")
            .where({
                action: "AUTH.REFRESH_REJECTED",
                resource_id: expiringRow.session_id
            })
            .first();
        assert.ok(expiredAudit);
        assert.equal(expiredAudit.reason, "EXPIRED_TOKEN");

        // Concurrent refresh with one token: real row locks serialize the two
        // requests; one rotates, the other is treated as reuse and revokes the family.
        const concurrentLogin = await auth.login(credentials);
        const concurrentFamily = (await sessionFor(concurrentLogin.refresh_token)).token_family_id;
        const concurrent = await Promise.allSettled([
            auth.refresh({ refresh_token: concurrentLogin.refresh_token }),
            auth.refresh({ refresh_token: concurrentLogin.refresh_token })
        ]);
        assert.equal(concurrent.filter((outcome) => outcome.status === "fulfilled").length, 1);
        assert.equal(concurrent.filter((outcome) => outcome.status === "rejected").length, 1);
        const concurrentRows = await db("refresh_token_sessions")
            .where({ token_family_id: concurrentFamily });
        assert.equal(concurrentRows.length, 2);
        assert.ok(concurrentRows.every((row) => row.revoked_at !== null));

        // A disabled user cannot refresh; the presented session is revoked.
        const otherFamilyRow = await sessionFor(otherFamilyLogin.refresh_token);
        await db("users").where({ user_id: userId }).update({ status: "DISABLED" });
        await assert.rejects(
            auth.refresh({ refresh_token: otherFamilyLogin.refresh_token }, requestId),
            (error) => error instanceof AppError && error.statusCode === 401
        );
        const disabledRow = await sessionFor(otherFamilyLogin.refresh_token);
        assert.ok(disabledRow.revoked_at);
        assert.equal(disabledRow.replaced_by_token_id, null);
        assert.equal(
            (await db("refresh_token_sessions")
                .where({ token_family_id: otherFamilyRow.token_family_id })).length,
            1,
            "A rejected inactive refresh must not issue a replacement"
        );
        const inactiveAudit = (await db("user_audit_logs")
            .where({
                action: "AUTH.REFRESH_REJECTED",
                resource_type: "user",
                resource_id: userId
            }))
            .find((row) => row.reason === "INACTIVE_ACCOUNT");
        assert.ok(inactiveAudit);
    } finally {
        await db.destroy();
    }
});
