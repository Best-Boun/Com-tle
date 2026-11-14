const assert = require("node:assert/strict");
const { generateKeyPairSync, randomUUID } = require("node:crypto");
const test = require("node:test");
const express = require("express");
const http = require("node:http");
const jwt = require("jsonwebtoken");
const knexFactory = require("knex");
const {
    PERMISSIONS,
    USER_ROLES
} = require("../../shared/constants");
const { errorHandler, notFoundHandler } = require("../../shared/middleware/errorMiddleware");
const { createAuthService } = require("../src/services/authService");
const { ADMIN_PERMISSIONS } = require("../src/constants/adminPermissions");
const { CUSTOMER_MERGE_PERMISSIONS } = require("../src/constants/customerMergePermissions");
const { createPermissionService } = require("../src/services/permissionService");
const { seed } = require("../seeds/002_permissions");
const createUsersRouter = require("../src/routes/usersRoutes");

const enabled = process.env.USER_SERVICE_ALLOW_PERMISSION_DATABASE_TESTS === "1";
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
        throw new Error("Permission database tests require a loopback DB_TEST_HOST");
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
const jwtConfig = {
    privateKey,
    issuer: "user-service-permission-test",
    audience: "com-tle-permission-test",
    expiresIn: 300,
    refreshExpiresIn: 3600
};
const fixedNow = 1_800_000_000_000;

function createToken(userId, roleCode) {
    return jwt.sign({
        roles: [roleCode],
        iat: Math.floor(fixedNow / 1000),
        token_use: "user_access"
    }, privateKey, {
        algorithm: "RS256",
        subject: userId,
        issuer: jwtConfig.issuer,
        audience: jwtConfig.audience,
        expiresIn: 300
    });
}

async function getColumns(db, database, tableName) {
    const columns = await db("information_schema.COLUMNS")
        .select("COLUMN_NAME")
        .where({ TABLE_SCHEMA: database, TABLE_NAME: tableName });
    return columns.map((row) => row.COLUMN_NAME).sort();
}

async function insertTestUser(db, userId, roleId, status) {
    await db.transaction(async (trx) => {
        await trx("users").insert({
            user_id: userId,
            email: `permission-it-${userId}@example.test`,
            password_hash: "integration-test-only",
            phone: null,
            status
        });
        await trx("user_roles").insert({
            user_id: userId,
            role_id: roleId,
            assigned_by: null
        });
    });
}

test("permission seed and authorization work against the existing MySQL schema", {
    skip: enabled
        ? false
        : "Set USER_SERVICE_ALLOW_PERMISSION_DATABASE_TESTS=1 with isolated DB_TEST_* settings"
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
    let server;

    try {
        assert.deepEqual(await getColumns(db, testTarget.database, "roles"), [
            "created_at",
            "description",
            "role_code",
            "role_id",
            "role_name"
        ]);
        assert.deepEqual(await getColumns(db, testTarget.database, "permissions"), [
            "created_at",
            "description",
            "permission_code",
            "permission_id",
            "permission_name"
        ]);
        assert.deepEqual(await getColumns(db, testTarget.database, "role_permissions"), [
            "assigned_at",
            "permission_id",
            "role_id"
        ]);

        const roleRows = await db("roles").select("role_id", "role_code");
        assert.deepEqual(roleRows.map((row) => row.role_code).sort(), [
            USER_ROLES.ADMIN,
            USER_ROLES.CUSTOMER,
            USER_ROLES.TECHNICIAN
        ].sort());
        const ownProfile = [PERMISSIONS.USER_PROFILE_VIEW_OWN, PERMISSIONS.USER_PROFILE_UPDATE_OWN];
        // Must match the approved Railway user_db role_permissions (2026-11-14).
        const expectedAssignments = new Set([
            ...[
                PERMISSIONS.PAYMENT_RECORD,
                PERMISSIONS.PAYMENT_VIEW_ALL,
                PERMISSIONS.PAYMENT_REFUND,
                ...Object.values(ADMIN_PERMISSIONS),
                ...Object.values(CUSTOMER_MERGE_PERMISSIONS),
                ...ownProfile
            ].map((code) => `${USER_ROLES.ADMIN}:${code}`),
            ...[PERMISSIONS.PAYMENT_VIEW_OWN, ...ownProfile]
                .map((code) => `${USER_ROLES.CUSTOMER}:${code}`),
            ...ownProfile.map((code) => `${USER_ROLES.TECHNICIAN}:${code}`)
        ]);
        const knownPermissionCodes = new Set([
            ...Object.values(PERMISSIONS),
            ...Object.values(ADMIN_PERMISSIONS),
            ...Object.values(CUSTOMER_MERGE_PERMISSIONS)
        ]);
        const priorPermissions = await db("permissions")
            .select("permission_code", "permission_name");
        assert.ok(priorPermissions.every((row) =>
            knownPermissionCodes.has(row.permission_code)
            && row.permission_name === row.permission_code
        ), "Refusing to seed unknown or conflicting permission definitions");
        const priorAssignments = await db("role_permissions as rp")
            .join("roles as r", "rp.role_id", "r.role_id")
            .join("permissions as p", "rp.permission_id", "p.permission_id")
            .select("r.role_code", "p.permission_code");
        assert.ok(priorAssignments.every((row) =>
            expectedAssignments.has(`${row.role_code}:${row.permission_code}`)
        ), "Refusing to proceed when unapproved role assignments already exist");

        await seed(db);
        const afterFirstSeed = {
            permissions: await db("permissions")
                .select("permission_id", "permission_code", "permission_name", "description")
                .orderBy("permission_code"),
            assignments: await db("role_permissions as rp")
                .join("roles as r", "rp.role_id", "r.role_id")
                .join("permissions as p", "rp.permission_id", "p.permission_id")
                .select("r.role_code", "p.permission_code", "rp.assigned_at")
                .orderBy("r.role_code")
                .orderBy("p.permission_code")
        };
        await seed(db);
        const afterSecondSeed = {
            permissions: await db("permissions")
                .select("permission_id", "permission_code", "permission_name", "description")
                .orderBy("permission_code"),
            assignments: await db("role_permissions as rp")
                .join("roles as r", "rp.role_id", "r.role_id")
                .join("permissions as p", "rp.permission_id", "p.permission_id")
                .select("r.role_code", "p.permission_code", "rp.assigned_at")
                .orderBy("r.role_code")
                .orderBy("p.permission_code")
        };
        assert.deepEqual(afterSecondSeed, afterFirstSeed, "The permission seed must be idempotent");
        assert.deepEqual(
            afterFirstSeed.permissions.map((row) => row.permission_code).sort(),
            [...knownPermissionCodes].sort()
        );
        assert.equal(
            afterFirstSeed.permissions.some((row) => row.permission_code === "can_refund"),
            false
        );
        assert.deepEqual(
            afterFirstSeed.assignments.map((row) => (
                `${row.role_code}:${row.permission_code}`
            )).sort(),
            [...expectedAssignments].sort()
        );
        assert.ok(afterFirstSeed.assignments.every((row) => row.assigned_at));

        const rolesByCode = new Map(roleRows.map((row) => [row.role_code, row.role_id]));
        const adminId = randomUUID();
        const customerId = randomUUID();
        const technicianId = randomUUID();
        const disabledId = randomUUID();
        const lockedId = randomUUID();
        await insertTestUser(db, adminId, rolesByCode.get(USER_ROLES.ADMIN), "ACTIVE");
        await insertTestUser(db, customerId, rolesByCode.get(USER_ROLES.CUSTOMER), "ACTIVE");
        await insertTestUser(db, technicianId, rolesByCode.get(USER_ROLES.TECHNICIAN), "ACTIVE");
        await insertTestUser(db, disabledId, rolesByCode.get(USER_ROLES.CUSTOMER), "DISABLED");
        // Starts LOCKED so the inactive-user assertion below is meaningful.
        await insertTestUser(db, lockedId, rolesByCode.get(USER_ROLES.CUSTOMER), "LOCKED");

        const permissionService = createPermissionService({ db });
        assert.equal(
            await permissionService.userHasPermission(adminId, PERMISSIONS.PAYMENT_RECORD),
            true
        );
        assert.equal(
            await permissionService.userHasPermission(customerId, PERMISSIONS.PAYMENT_VIEW_OWN),
            true
        );
        assert.equal(
            await permissionService.userHasPermission(customerId, PERMISSIONS.PAYMENT_RECORD),
            false
        );
        assert.equal(
            await permissionService.userHasPermission(technicianId, PERMISSIONS.PAYMENT_RECORD),
            false
        );
        assert.equal(
            await permissionService.userHasPermission(
                adminId,
                ADMIN_PERMISSIONS.USER_LIST,
                { requiredRole: USER_ROLES.ADMIN }
            ),
            true
        );
        assert.equal(
            await permissionService.activeUserHasPermission(adminId, "can_refund"),
            false
        );
        assert.equal(await permissionService.isActiveUser(disabledId), false);
        assert.equal(await permissionService.isActiveUser(lockedId), false);

        const authService = createAuthService({
            db,
            jwtConfig,
            now: () => fixedNow
        });
        const app = express();
        app.use("/users", createUsersRouter({
            authService,
            permissionService,
            profileService: {}
        }));
        app.use(notFoundHandler);
        app.use(errorHandler);
        server = http.createServer(app);
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        const baseUrl = `http://127.0.0.1:${server.address().port}`;
        const customerToken = createToken(customerId, USER_ROLES.CUSTOMER);
        const activeResponse = await fetch(`${baseUrl}/users/me/permissions`, {
            headers: { authorization: `Bearer ${customerToken}` }
        });
        assert.equal(activeResponse.status, 200);
        assert.deepEqual((await activeResponse.json()).data.permissions, [
            PERMISSIONS.PAYMENT_VIEW_OWN,
            PERMISSIONS.USER_PROFILE_UPDATE_OWN,
            PERMISSIONS.USER_PROFILE_VIEW_OWN
        ]);

        await db("users").where({ user_id: customerId }).update({ status: "DISABLED" });
        const disabledResponse = await fetch(`${baseUrl}/users/me/permissions`, {
            headers: { authorization: `Bearer ${customerToken}` }
        });
        assert.equal(disabledResponse.status, 401);

        const lockedToken = createToken(lockedId, USER_ROLES.CUSTOMER);
        await db("users").where({ user_id: lockedId }).update({ status: "LOCKED" });
        const lockedResponse = await fetch(`${baseUrl}/users/me/permissions`, {
            headers: { authorization: `Bearer ${lockedToken}` }
        });
        assert.equal(lockedResponse.status, 401);
    } finally {
        if (server) {
            await new Promise((resolve, reject) => {
                server.close((error) => error ? reject(error) : resolve());
            });
        }
        await db.destroy();
    }
});
