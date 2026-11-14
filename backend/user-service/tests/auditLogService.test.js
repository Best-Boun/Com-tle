const assert = require("node:assert/strict");
const test = require("node:test");
const {
    createAuditLogService,
    getAuditRequestId
} = require("../src/services/auditLogService");

const validEvent = {
    actor_user_id: "user-1",
    action: "AUTH.LOGIN",
    target_entity_type: "user",
    target_entity_id: "user-1",
    outcome: "SUCCESS",
    request_id: "req:123",
    metadata: {
        reason: "LOGIN_SUCCEEDED",
        role_codes: ["CUSTOMER"]
    }
};

test("audit writer maps validated events to user_audit_logs columns", async () => {
    const inserted = [];
    const auditLog = createAuditLogService({ createId: () => "audit-1" });
    const trx = (table) => ({
        async insert(row) {
            assert.equal(table, "user_audit_logs");
            inserted.push(row);
        }
    });

    const auditId = await auditLog.record(trx, validEvent);

    assert.equal(auditId, "audit-1");
    assert.deepEqual(inserted[0], {
        audit_id: "audit-1",
        actor_user_id: "user-1",
        action: "AUTH.LOGIN",
        resource_type: "user",
        resource_id: "user-1",
        reason: "LOGIN_SUCCEEDED",
        metadata: {
            role_codes: ["CUSTOMER"],
            outcome: "SUCCESS",
            request_id: "req:123"
        }
    });
    assert.deepEqual(Object.keys(inserted[0]).sort(), [
        "action",
        "actor_user_id",
        "audit_id",
        "metadata",
        "reason",
        "resource_id",
        "resource_type"
    ]);
    assert.equal(Object.hasOwn(inserted[0], "created_at"), false);
    assert.equal(Object.hasOwn(inserted[0].metadata, "reason"), false);
    assert.equal(JSON.stringify(inserted).includes("password"), false);
    assert.equal(JSON.stringify(inserted).includes("token"), false);
});

test("audit writer preserves allowlisted metadata and database-null reason", async () => {
    let inserted;
    const auditLog = createAuditLogService({ createId: () => "audit-2" });
    await auditLog.record((table) => ({
        async insert(row) {
            assert.equal(table, "user_audit_logs");
            inserted = row;
        }
    }), {
        ...validEvent,
        target_entity_type: "refresh_session",
        target_entity_id: "session-1",
        request_id: null,
        metadata: { revoked: true }
    });

    assert.equal(inserted.resource_type, "refresh_session");
    assert.equal(inserted.resource_id, "session-1");
    assert.equal(inserted.reason, null);
    assert.deepEqual(inserted.metadata, {
        revoked: true,
        outcome: "SUCCESS",
        request_id: null
    });
});

test("audit writer preserves a reason at the 500-character database limit", async () => {
    let inserted;
    const reason = "r".repeat(500);
    const auditLog = createAuditLogService({ createId: () => "audit-3" });

    await auditLog.record((table) => ({
        async insert(row) {
            assert.equal(table, "user_audit_logs");
            inserted = row;
        }
    }), {
        ...validEvent,
        metadata: { reason }
    });

    assert.equal(inserted.reason, reason);
    assert.equal(inserted.reason.length, 500);
    assert.equal(Object.hasOwn(inserted.metadata, "reason"), false);
});

test("audit writer rejects reserved metadata key collisions", async () => {
    const auditLog = createAuditLogService();
    for (const metadata of [
        { outcome: "FAILURE" },
        { request_id: "attacker-controlled" }
    ]) {
        await assert.rejects(auditLog.record(() => ({
            async insert() {
                assert.fail("invalid event must not be persisted");
            }
        }), { ...validEvent, metadata }), /Invalid audit event/);
    }
});

test("audit writer rejects invalid fields and preserves reason and request ID limits", async () => {
    const auditLog = createAuditLogService();
    const invalidEvents = [
        { ...validEvent, target_entity_type: "order" },
        { ...validEvent, request_id: "invalid request id" },
        { ...validEvent, request_id: "x".repeat(101) },
        { ...validEvent, metadata: { password: "must-not-be-recorded" } },
        { ...validEvent, metadata: { reason: "r".repeat(501) } },
        { ...validEvent, metadata: { reason: true } },
        { ...validEvent, metadata: { calling_service: "s".repeat(151) } }
    ];

    for (const event of invalidEvents) {
        await assert.rejects(
            auditLog.record(() => ({ insert() {} }), event),
            /Invalid audit event/
        );
    }
});

test("audit insert failures are surfaced with a safe error code", async () => {
    const auditLog = createAuditLogService();
    const databaseError = new Error("database details");
    await assert.rejects(auditLog.record(() => ({
        async insert() {
            throw databaseError;
        }
    }), validEvent), (error) => error.code === "AUDIT_LOG_PERSISTENCE_FAILED"
        && error.message === "Audit log persistence failed"
        && error.cause === databaseError);
});

test("audit insert failures log only non-sensitive context and retain the caller transaction", async () => {
    const sensitiveValues = {
        password: "password-canary-91f7",
        accessToken: "access-token-canary-6b21",
        refreshToken: "refresh-token-canary-5e34",
        internalServiceToken: "internal-token-canary-2a80",
        authorizationHeader: "Bearer authorization-canary-c4d9"
    };
    const event = {
        ...validEvent,
        metadata: {
            reason: Object.values(sensitiveValues).join("; ")
        }
    };
    const databaseError = new Error(
        `write failed: ${Object.values(sensitiveValues).join("; ")}`
    );
    const logs = [];
    const logger = {
        error(...args) {
            logs.push(args);
        }
    };
    const auditLog = createAuditLogService({ logger });
    let insertCount = 0;
    const transaction = (table) => ({
        async insert() {
            assert.equal(table, "user_audit_logs");
            insertCount += 1;
            throw databaseError;
        }
    });

    await assert.rejects(
        auditLog.record(transaction, event),
        (error) => error.code === "AUDIT_LOG_PERSISTENCE_FAILED"
            && error.message === "Audit log persistence failed"
            && error.cause === databaseError
    );

    assert.equal(insertCount, 1);
    assert.deepEqual(logs, [[
        "Audit log persistence failed",
        {
            code: "AUDIT_LOG_PERSISTENCE_FAILED",
            action: "AUTH.LOGIN",
            resource_type: "user"
        }
    ]]);
    const serializedLogs = JSON.stringify(logs);
    for (const value of Object.values(sensitiveValues)) {
        assert.equal(serializedLogs.includes(value), false);
    }
});

test("request IDs are accepted only in the bounded correlation format", () => {
    assert.equal(getAuditRequestId({ get: () => "req:1-abc" }), "req:1-abc");
    assert.equal(getAuditRequestId({ get: () => "invalid id" }), null);
    assert.equal(getAuditRequestId({ get: () => "x".repeat(101) }), null);
    assert.equal(getAuditRequestId({ get: () => "" }), null);
    assert.equal(getAuditRequestId(null), null);
});
