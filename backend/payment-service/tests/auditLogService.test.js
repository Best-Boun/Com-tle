const assert = require("node:assert/strict");
const test = require("node:test");
const { createAuditLogService, getAuditRequestId } = require("../src/services/auditLogService");

function createAuditTable() {
    const records = [];
    return {
        records,
        trx(tableName) {
            assert.equal(tableName, "audit_logs");
            const filters = [];
            return {
                insert(row) {
                    if (records.some((record) => record.event_key === row.event_key)) {
                        const error = new Error("duplicate event");
                        error.code = "ER_DUP_ENTRY";
                        error.errno = 1062;
                        throw error;
                    }
                    records.push(row);
                },
                select() {
                    return this;
                },
                where(criteria) {
                    filters.push(criteria);
                    return this;
                },
                async first() {
                    return records.find((row) =>
                        filters.every((filter) => Object.entries(filter).every(
                            ([key, value]) => row[key] === value
                        ))
                    );
                }
            };
        }
    };
}

function event(overrides = {}) {
    return {
        event_key: "payment.recorded:payment-1",
        actor_user_id: "staff-1",
        action: "payment.recorded",
        target_entity_type: "PAYMENT",
        target_entity_id: "payment-1",
        outcome: "SUCCESS",
        request_id: "req-1",
        metadata: {
            amount: "12.30",
            currency: "THB",
            payment_method: "cash"
        },
        occurred_at: new Date("2026-11-11T00:00:00.000Z"),
        ...overrides
    };
}

test("audit log records only allowlisted metadata and generated audit identity", async () => {
    const table = createAuditTable();
    const audit = createAuditLogService({
        createId: () => "audit-1",
        now: () => 1_800_000_000_000
    });

    await audit.record(table.trx, event());
    assert.deepEqual(table.records[0], {
        audit_id: "audit-1",
        ...event()
    });
});

test("audit log deduplicates a repeated event key", async () => {
    const table = createAuditTable();
    let id = 0;
    const audit = createAuditLogService({
        createId: () => `audit-${++id}`,
        now: Date.now
    });

    assert.equal(await audit.record(table.trx, event()), true);
    assert.equal(await audit.record(table.trx, event()), false);
    assert.equal(table.records.length, 1);
});

test("audit metadata rejects secrets and unknown fields", async () => {
    const table = createAuditTable();
    const audit = createAuditLogService({ createId: () => "audit-1", now: Date.now });
    await assert.rejects(
        audit.record(table.trx, event({
            metadata: {
                ...event().metadata,
                access_token: "do-not-store"
            }
        })),
        /Invalid audit event/
    );
    assert.equal(table.records.length, 0);
});

test("audit persistence failures are surfaced", async () => {
    const audit = createAuditLogService({ createId: () => "audit-1", now: Date.now });
    await assert.rejects(
        audit.record(() => ({
            insert() {
                throw new Error("database unavailable");
            }
        }), event()),
        (error) => error.statusCode === 503
            && error.code === "AUDIT_LOG_PERSISTENCE_FAILED"
    );
});

test("audit request IDs are validated and invalid IDs are omitted", () => {
    assert.equal(getAuditRequestId({ correlationId: "corr-1" }), "corr-1");
    assert.equal(getAuditRequestId({ request_id: "bad id" }), null);
});
