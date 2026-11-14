// The canonical MySQL schema stores DATETIME values as UTC; pin Node to UTC so
// mysql2 reads them without a local-timezone shift.
process.env.TZ = "UTC";

const assert = require("node:assert/strict");
const { generateKeyPairSync, randomUUID } = require("node:crypto");
const test = require("node:test");
const knexFactory = require("knex");
const { USER_ROLES } = require("../../shared/constants");
const AppError = require("../../shared/errors/AppError");
const { createAuditLogService } = require("../src/services/auditLogService");
const { createAuthService } = require("../src/services/authService");
const { createUserProfileService } = require("../src/services/userProfileService");
const {
    createUserAdministrationService
} = require("../src/services/userAdministrationService");

const enabled = process.env.USER_SERVICE_ALLOW_AUDIT_DATABASE_TESTS === "1";
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
        throw new Error("Audit database tests require a loopback DB_TEST_HOST");
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

test("audit mapping works against a pre-provisioned MySQL schema", {
    skip: enabled ? false : "Set USER_SERVICE_ALLOW_AUDIT_DATABASE_TESTS=1 with isolated DB_TEST_* settings"
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
                TABLE_NAME: "user_audit_logs"
            });
        assert.deepEqual(columns.map((row) => row.COLUMN_NAME).sort(), [
            "action",
            "actor_user_id",
            "audit_id",
            "created_at",
            "metadata",
            "reason",
            "resource_id",
            "resource_type"
        ]);

        const auditId = randomUUID();
        const requestId = `audit-it:${randomUUID()}`;
        const resourceId = randomUUID();
        const auditLog = createAuditLogService({ createId: () => auditId });
        const createdAtBeforeInsert = Date.now();
        await db.transaction((trx) => auditLog.record(trx, {
            actor_user_id: null,
            action: "TEST.AUDIT_COMPATIBILITY",
            target_entity_type: "customer",
            target_entity_id: resourceId,
            outcome: "SUCCESS",
            request_id: requestId,
            metadata: {
                reason: "INTEGRATION_TEST",
                calling_service: "user-service-test"
            }
        }));

        const inserted = await db("user_audit_logs")
            .where({ audit_id: auditId })
            .first();
        assert.ok(inserted);
        assert.equal(inserted.actor_user_id, null);
        assert.equal(inserted.action, "TEST.AUDIT_COMPATIBILITY");
        assert.equal(inserted.resource_type, "customer");
        assert.equal(inserted.resource_id, resourceId);
        assert.equal(inserted.reason, "INTEGRATION_TEST");
        assert.deepEqual(
            typeof inserted.metadata === "string"
                ? JSON.parse(inserted.metadata)
                : inserted.metadata,
            {
                calling_service: "user-service-test",
                outcome: "SUCCESS",
                request_id: requestId
            }
        );
        assert.ok(inserted.created_at);
        const createdAt = new Date(inserted.created_at).getTime();
        assert.ok(Number.isFinite(createdAt));
        assert.ok(createdAt >= createdAtBeforeInsert - 1000);
        assert.ok(createdAt <= Date.now() + 1000);

        const rollbackUserId = randomUUID();
        const rollbackEmail = `audit-it-${randomUUID()}@example.test`;
        await assert.rejects(db.transaction(async (trx) => {
            await trx("users").insert({
                user_id: rollbackUserId,
                email: rollbackEmail,
                password_hash: "integration-test-only",
                phone: null,
                status: "ACTIVE"
            });
            await auditLog.record(trx, {
                actor_user_id: null,
                action: "TEST.AUDIT_COMPATIBILITY",
                target_entity_type: "customer",
                target_entity_id: randomUUID(),
                outcome: "SUCCESS",
                request_id: requestId
            });
        }), (error) => error.code === "AUDIT_LOG_PERSISTENCE_FAILED");
        assert.equal(await db("users").where({ user_id: rollbackUserId }).first(), undefined);
    } finally {
        await db.destroy();
    }
});

function parseMetadata(value) {
    return typeof value === "string" ? JSON.parse(value) : value;
}

test("existing producers write their audit rows to MySQL user_audit_logs", {
    skip: enabled ? false : "Set USER_SERVICE_ALLOW_AUDIT_DATABASE_TESTS=1 with isolated DB_TEST_* settings"
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
    const auditRows = (resourceId, action) => db("user_audit_logs")
        .where({ resource_id: resourceId, action })
        .orderBy("created_at");

    try {
        const roles = new Map((await db("roles").select("role_id", "role_code"))
            .map((row) => [row.role_code, row.role_id]));
        for (const roleCode of Object.values(USER_ROLES)) {
            assert.ok(roles.has(roleCode), `The isolated test schema must contain ${roleCode}`);
        }

        const { privateKey } = generateKeyPairSync("rsa", {
            modulusLength: 2048,
            privateKeyEncoding: { type: "pkcs8", format: "pem" },
            publicKeyEncoding: { type: "spki", format: "pem" }
        });
        const auth = createAuthService({
            db,
            jwtConfig: {
                privateKey,
                issuer: "user-service-audit-test",
                audience: "com-tle-audit-test",
                expiresIn: 60,
                refreshExpiresIn: 3600
            }
        });
        const requestId = `audit-producers:${randomUUID()}`;
        const email = `audit-producer-${randomUUID()}@example.test`;
        const password = "test-only-password";

        // Registration
        const registered = await auth.register({
            full_name: "Audit Producer",
            email,
            password,
            phone: null
        }, requestId);
        const userId = registered.user.user_id;
        const [registeredAudit] = await auditRows(userId, "USER.REGISTERED");
        assert.ok(registeredAudit, "Registration must write an audit row");
        assert.equal(registeredAudit.actor_user_id, userId);
        assert.equal(registeredAudit.resource_type, "user");
        assert.deepEqual(parseMetadata(registeredAudit.metadata), {
            role_codes: [USER_ROLES.CUSTOMER],
            outcome: "SUCCESS",
            request_id: requestId
        });
        const createdAt = new Date(registeredAudit.created_at).getTime();
        assert.ok(Math.abs(createdAt - Date.now()) < 60_000, "created_at must be current UTC time");

        // Duplicate registration is rejected and audited without the email.
        const duplicateRequestId = `audit-duplicate:${randomUUID()}`;
        await assert.rejects(
            auth.register({ full_name: "Duplicate", email, password }, duplicateRequestId),
            (error) => error instanceof AppError && error.statusCode === 409
        );
        const duplicateAudits = (await db("user_audit_logs")
            .where({ action: "USER.REGISTERED", reason: "DUPLICATE_EMAIL" })
            .whereNull("resource_id"))
            .filter((row) => parseMetadata(row.metadata).request_id === duplicateRequestId);
        assert.equal(duplicateAudits.length, 1);
        assert.equal(duplicateAudits[0].actor_user_id, null);
        assert.equal(parseMetadata(duplicateAudits[0].metadata).outcome, "FAILURE");
        assert.equal(JSON.stringify(duplicateAudits[0]).includes(email), false);

        // Login failure and success
        await assert.rejects(
            auth.login({ email, password: "wrong-password" }, requestId),
            (error) => error instanceof AppError && error.statusCode === 401
        );
        await auth.login({ email, password }, requestId);
        const loginAudits = await auditRows(userId, "AUTH.LOGIN");
        const failedLogin = loginAudits.find((row) =>
            parseMetadata(row.metadata).outcome === "FAILURE");
        const successfulLogin = loginAudits.find((row) =>
            parseMetadata(row.metadata).outcome === "SUCCESS");
        assert.ok(failedLogin, "Failed login must write an audit row");
        assert.equal(failedLogin.actor_user_id, null);
        assert.equal(failedLogin.reason, "INVALID_CREDENTIALS");
        assert.equal(JSON.stringify(failedLogin).includes("wrong-password"), false);
        assert.ok(successfulLogin, "Successful login must write an audit row");
        assert.equal(successfulLogin.actor_user_id, userId);
        assert.deepEqual(parseMetadata(successfulLogin.metadata).role_codes, [USER_ROLES.CUSTOMER]);

        // Profile update
        await createUserProfileService({ db }).updateProfile(
            userId,
            { full_name: "Audit Producer Updated" },
            requestId
        );
        const [profileAudit] = await auditRows(userId, "USER.PROFILE_UPDATED");
        assert.ok(profileAudit, "Profile update must write an audit row");
        assert.deepEqual(parseMetadata(profileAudit.metadata).changed_fields, ["full_name"]);

        // Administrative status and role changes (local isolated DB only)
        const adminId = randomUUID();
        await db.transaction(async (trx) => {
            await trx("users").insert({
                user_id: adminId,
                email: `audit-admin-${randomUUID()}@example.test`,
                password_hash: "integration-test-only",
                phone: null,
                status: "ACTIVE"
            });
            await trx("user_roles").insert({
                user_id: adminId,
                role_id: roles.get(USER_ROLES.ADMIN),
                assigned_by: null
            });
        });
        const administration = createUserAdministrationService({ db });
        await administration.updateUserStatus(userId, adminId, { status: "DISABLED" }, requestId);
        await administration.updateUserStatus(userId, adminId, { status: "ACTIVE" }, requestId);
        const statusAudits = await auditRows(userId, "ADMIN.USER_STATUS_CHANGED");
        assert.deepEqual(statusAudits.map((row) => {
            const metadata = parseMetadata(row.metadata);
            return [row.actor_user_id, metadata.from_status, metadata.to_status];
        }), [
            [adminId, "ACTIVE", "DISABLED"],
            [adminId, "DISABLED", "ACTIVE"]
        ]);

        await administration.assignRole(
            userId, adminId, { role_code: USER_ROLES.TECHNICIAN }, requestId
        );
        await administration.removeRole(userId, adminId, USER_ROLES.TECHNICIAN, requestId);
        const [assignedAudit] = await auditRows(userId, "ADMIN.USER_ROLE_ASSIGNED");
        const [removedAudit] = await auditRows(userId, "ADMIN.USER_ROLE_REMOVED");
        assert.equal(assignedAudit.actor_user_id, adminId);
        assert.equal(parseMetadata(assignedAudit.metadata).role_code, USER_ROLES.TECHNICIAN);
        assert.equal(removedAudit.actor_user_id, adminId);
        assert.equal(parseMetadata(removedAudit.metadata).role_code, USER_ROLES.TECHNICIAN);
        assert.ok([assignedAudit, removedAudit].every((row) =>
            parseMetadata(row.metadata).request_id === requestId));

        // A rejected admin mutation (self status change) is audited as FAILURE.
        await assert.rejects(
            administration.updateUserStatus(adminId, adminId, { status: "DISABLED" }, requestId),
            (error) => error instanceof AppError && error.statusCode === 403
        );
        const [selfChangeAudit] = await auditRows(adminId, "ADMIN.USER_STATUS_CHANGED");
        assert.ok(selfChangeAudit, "Rejected admin mutation must write an audit row");
        assert.equal(selfChangeAudit.actor_user_id, adminId);
        assert.equal(selfChangeAudit.reason, "Administrators cannot change their own status");
        assert.equal(parseMetadata(selfChangeAudit.metadata).outcome, "FAILURE");
    } finally {
        await db.destroy();
    }
});
