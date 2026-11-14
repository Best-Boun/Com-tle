const assert = require("node:assert/strict");
const test = require("node:test");
const { loadBaselineStatements } = require("../scripts/apply-fresh-baseline");

test("fresh baseline uses the canonical user_audit_logs contract", () => {
    const sql = loadBaselineStatements().join("\n");
    const auditTable = sql.match(/CREATE TABLE `user_audit_logs` \([\s\S]*?\) ENGINE=/i);

    assert.ok(auditTable);
    for (const column of [
        "`audit_id` char(36) NOT NULL",
        "`actor_user_id` char(36) DEFAULT NULL",
        "`action` varchar(100) NOT NULL",
        "`resource_type` varchar(100) NOT NULL",
        "`resource_id` varchar(100) DEFAULT NULL",
        "`reason` varchar(500) DEFAULT NULL",
        "`metadata` json DEFAULT NULL",
        "`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)"
    ]) {
        assert.ok(auditTable[0].includes(column), `Missing canonical audit definition: ${column}`);
    }
    assert.match(auditTable[0], /`fk_user_audit_actor` FOREIGN KEY/i);
    assert.match(auditTable[0], /`idx_user_audit_actor_created`/i);
    assert.match(auditTable[0], /`idx_user_audit_resource_created`/i);
    assert.match(auditTable[0], /`idx_user_audit_created`/i);
    assert.doesNotMatch(sql, /CREATE TABLE `audit_logs`/i);
});
