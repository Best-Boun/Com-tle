// The canonical MySQL schema stores DATETIME values as UTC; pin Node to UTC so
// mysql2 reads them without a local-timezone shift.
process.env.TZ = "UTC";

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");
const knexFactory = require("knex");
const { USER_ROLES } = require("../../shared/constants");
const AppError = require("../../shared/errors/AppError");
const { CUSTOMER_MERGE_PERMISSIONS } = require("../src/constants/customerMergePermissions");
const { createCustomerMergeService } = require("../src/services/customerMergeService");

const enabled = process.env.USER_SERVICE_ALLOW_MERGE_DATABASE_TESTS === "1";
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
        throw new Error("Merge database tests require a loopback DB_TEST_HOST");
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

function connect() {
    return knexFactory({
        client: "mysql2",
        connection: {
            host: testTarget.host,
            port: testTarget.port,
            user: process.env.DB_TEST_USER,
            password: process.env.DB_TEST_PASSWORD,
            database: testTarget.database
        },
        pool: { min: 0, max: 4 },
        acquireConnectionTimeout: 10000
    });
}

async function ensurePermission(db, code) {
    const existing = await db("permissions").where({ permission_code: code }).first();
    if (existing) {
        return existing.permission_id;
    }
    const permissionId = randomUUID();
    await db("permissions").insert({
        permission_id: permissionId,
        permission_code: code,
        permission_name: code,
        description: null
    });
    return permissionId;
}

async function grant(db, roleId, permissionId) {
    const existing = await db("role_permissions")
        .where({ role_id: roleId, permission_id: permissionId })
        .first();
    if (!existing) {
        await db("role_permissions").insert({ role_id: roleId, permission_id: permissionId });
    }
}

async function createUser(db, roleIds) {
    const userId = randomUUID();
    await db.transaction(async (trx) => {
        await trx("users").insert({
            user_id: userId,
            email: `merge-it-${userId}@example.test`,
            password_hash: "integration-test-only",
            phone: null,
            status: "ACTIVE"
        });
        for (const roleId of roleIds) {
            await trx("user_roles").insert({ user_id: userId, role_id: roleId, assigned_by: null });
        }
    });
    return userId;
}

async function createRegisteredCustomer(db, customerRoleId) {
    const userId = await createUser(db, [customerRoleId]);
    const customerId = randomUUID();
    await db("customers").insert({
        customer_id: customerId,
        user_id: userId,
        full_name: "Merge Integration Customer",
        phone: null,
        email: `merge-it-${userId}@example.test`,
        customer_type: "REGISTERED"
    });
    return customerId;
}

test("customer merge lifecycle, ADMIN_ONLY, and database guards on MySQL", {
    skip: enabled
        ? false
        : "Set USER_SERVICE_ALLOW_MERGE_DATABASE_TESTS=1 with isolated DB_TEST_* settings and the merge schema"
}, async () => {
    const db = connect();
    try {
        const schema = await db("information_schema.TABLES")
            .select("TABLE_NAME")
            .where({ TABLE_SCHEMA: testTarget.database })
            .whereIn("TABLE_NAME", ["customer_merge_requests", "customer_merge_reservations"]);
        assert.equal(schema.length, 2, "Apply the customer merge migration to the isolated test DB first");

        const roles = new Map((await db("roles").select("role_id", "role_code"))
            .map((row) => [row.role_code, row.role_id]));
        const requestPermission = await ensurePermission(db, CUSTOMER_MERGE_PERMISSIONS.REQUEST);
        const approvePermission = await ensurePermission(db, CUSTOMER_MERGE_PERMISSIONS.APPROVE);
        // Local isolated fixture grants only; not a Railway grant decision.
        await grant(db, roles.get(USER_ROLES.ADMIN), requestPermission);
        await grant(db, roles.get(USER_ROLES.ADMIN), approvePermission);

        const initiator = await createUser(db, [roles.get(USER_ROLES.ADMIN)]);
        const approver = await createUser(db, [roles.get(USER_ROLES.ADMIN)]);
        const service = createCustomerMergeService({ db });
        const requestId = `merge-it:${randomUUID()}`;

        // Initiate, then replay the same idempotency key.
        const source = await createRegisteredCustomer(db, roles.get(USER_ROLES.CUSTOMER));
        const target = await createRegisteredCustomer(db, roles.get(USER_ROLES.CUSTOMER));
        const input = {
            source_customer_id: source,
            target_customer_id: target,
            merge_reason: "Duplicate account",
            idempotency_key: `key-${randomUUID()}`
        };
        const pending = await service.initiate(initiator, input, requestId);
        assert.equal(pending.status, "PENDING");
        const expiresAt = new Date(pending.expires_at).getTime();
        const createdAt = new Date(pending.created_at).getTime();
        assert.equal(expiresAt - createdAt, 24 * 60 * 60 * 1000);
        assert.ok(Math.abs(createdAt - Date.now()) < 60_000, "created_at must be current UTC");
        assert.equal((await service.initiate(initiator, input, requestId)).request_id,
            pending.request_id);
        assert.equal((await db("customer_merge_reservations")
            .where({ request_id: pending.request_id })).length, 2);

        // Two-person rule, then completion.
        await assert.rejects(
            service.approve(initiator, pending.request_id, { verification_reference: "ref-1" }),
            (error) => error instanceof AppError && error.statusCode === 403
        );
        const selfApprovalAudits = (await db("user_audit_logs")
            .where({ action: "CUSTOMER.MERGE_COMPLETED", actor_user_id: initiator }))
            .filter((row) => {
                const metadata = typeof row.metadata === "string"
                    ? JSON.parse(row.metadata)
                    : row.metadata;
                return metadata.outcome === "FAILURE"
                    && metadata.merge_request_id === pending.request_id;
            });
        assert.equal(selfApprovalAudits.length, 1, "Denied self-approval must be audited");
        assert.equal(
            selfApprovalAudits[0].reason,
            "A different administrator must decide the request"
        );
        const expireEarly = await service.expire(pending.request_id);
        assert.equal(expireEarly.performed, false);
        const completed = await service.approve(approver, pending.request_id, {
            verification_reference: "ref-1"
        }, requestId);
        assert.equal(completed.status, "COMPLETED");
        const mergedSource = await db("customers").where({ customer_id: source }).first();
        assert.equal(mergedSource.customer_type, "MERGED");
        assert.equal(mergedSource.merged_into_customer_id, target);
        assert.equal((await db("customer_merge_reservations")
            .where({ request_id: pending.request_id })).length, 0);
        const history = await db("customer_merge_history")
            .where({ merge_history_id: completed.history_id })
            .first();
        assert.equal(history.verified_by_user_id, approver);
        const audits = await db("user_audit_logs")
            .whereIn("action", ["CUSTOMER.MERGE_REQUESTED", "CUSTOMER.MERGE_COMPLETED"])
            .where({ resource_id: source });
        assert.equal(audits.length, 2);

        // Database guards: merged customers, merge requests, and lifecycle checks.
        await assert.rejects(
            db("customers").where({ customer_id: source }).update({ full_name: "Changed" }),
            /Merged customers cannot be updated/
        );
        await assert.rejects(
            db("customer_merge_requests").where({ request_id: pending.request_id }).delete(),
            /Merge requests cannot be deleted/
        );
        await assert.rejects(
            db("customer_merge_requests")
                .where({ request_id: pending.request_id })
                .update({ status: "REJECTED" }),
            /Invalid merge request transition/
        );

        // Rejection by the second admin and cancellation by the initiator.
        const rejectSource = await createRegisteredCustomer(db, roles.get(USER_ROLES.CUSTOMER));
        const rejectTarget = await createRegisteredCustomer(db, roles.get(USER_ROLES.CUSTOMER));
        const toReject = await service.initiate(initiator, {
            source_customer_id: rejectSource,
            target_customer_id: rejectTarget,
            idempotency_key: `key-${randomUUID()}`
        });
        assert.equal((await service.reject(approver, toReject.request_id, {
            reason: "Not a duplicate"
        })).status, "REJECTED");
        await assert.rejects(
            service.cancel(approver, toReject.request_id, {}),
            (error) => error instanceof AppError && error.statusCode === 403
        );

        const cancelSource = await createRegisteredCustomer(db, roles.get(USER_ROLES.CUSTOMER));
        const cancelTarget = await createRegisteredCustomer(db, roles.get(USER_ROLES.CUSTOMER));
        const toCancel = await service.initiate(initiator, {
            source_customer_id: cancelSource,
            target_customer_id: cancelTarget,
            idempotency_key: `key-${randomUUID()}`
        });
        assert.equal((await service.cancel(initiator, toCancel.request_id, {
            reason: "Withdrawn"
        })).status, "CANCELLED");
        assert.equal((await db("customers").where({ customer_id: cancelSource }).first())
            .customer_type, "REGISTERED");

        // A reserved customer cannot join a second concurrent request.
        const busySource = await createRegisteredCustomer(db, roles.get(USER_ROLES.CUSTOMER));
        const busyTarget = await createRegisteredCustomer(db, roles.get(USER_ROLES.CUSTOMER));
        const busy = await service.initiate(initiator, {
            source_customer_id: busySource,
            target_customer_id: busyTarget,
            idempotency_key: `key-${randomUUID()}`
        });
        await assert.rejects(
            service.initiate(approver, {
                source_customer_id: busyTarget,
                target_customer_id: busySource,
                idempotency_key: `key-${randomUUID()}`
            }),
            (error) => error instanceof AppError && error.statusCode === 409
        );
        await service.cancel(initiator, busy.request_id, {});

        // ADMIN_ONLY: an ADMIN whose request permission comes only from CUSTOMER is denied.
        await grant(db, roles.get(USER_ROLES.CUSTOMER), requestPermission);
        try {
            const mixedAdmin = await createUser(db, [
                roles.get(USER_ROLES.ADMIN),
                roles.get(USER_ROLES.CUSTOMER)
            ]);
            await db("role_permissions")
                .where({ role_id: roles.get(USER_ROLES.ADMIN), permission_id: requestPermission })
                .delete();
            const deniedSource = await createRegisteredCustomer(db, roles.get(USER_ROLES.CUSTOMER));
            const deniedTarget = await createRegisteredCustomer(db, roles.get(USER_ROLES.CUSTOMER));
            await assert.rejects(
                service.initiate(mixedAdmin, {
                    source_customer_id: deniedSource,
                    target_customer_id: deniedTarget,
                    idempotency_key: `key-${randomUUID()}`
                }),
                (error) => error instanceof AppError && error.statusCode === 403
            );
        } finally {
            await db("role_permissions")
                .where({ role_id: roles.get(USER_ROLES.CUSTOMER), permission_id: requestPermission })
                .delete();
            await grant(db, roles.get(USER_ROLES.ADMIN), requestPermission);
        }
    } finally {
        await db.destroy();
    }
});
