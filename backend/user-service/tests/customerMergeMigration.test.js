const assert = require("node:assert/strict");
const test = require("node:test");
const migration = require("../migrations/202611140001_create_customer_merge_requests");

async function statements() {
    const sql = [];
    await migration.up({ raw: async (statement) => { sql.push(statement); } });
    return sql;
}

function statement(sql, expression) {
    const matches = sql.filter((text) => expression.test(text));
    assert.equal(matches.length, 1, `Expected one statement matching ${expression}`);
    return matches[0];
}

test("customer version and merged-customer guards are present", async () => {
    const sql = await statements();
    assert.match(statement(sql, /ALTER TABLE `customers`/i), /`row_version` BIGINT UNSIGNED NOT NULL DEFAULT 0/i);
    const update = statement(sql, /CREATE TRIGGER `trg_customers_merge_before_update`/i);
    assert.match(update, /BEFORE UPDATE ON `customers`/i);
    assert.match(update, /OLD\.`customer_type` = 'MERGED'[\s\S]*?SIGNAL SQLSTATE '45000'/i);
    assert.match(update, /OLD\.`row_version` = 18446744073709551615[\s\S]*?SIGNAL SQLSTATE '45000'/i);
    assert.match(update, /SET NEW\.`row_version` = OLD\.`row_version` \+ 1/i);
    const deletion = statement(sql, /CREATE TRIGGER `trg_customers_merge_before_delete`/i);
    assert.match(deletion, /BEFORE DELETE ON `customers`/i);
    assert.match(deletion, /OLD\.`customer_type` = 'MERGED'[\s\S]*?SIGNAL SQLSTATE '45000'/i);
});

test("merge requests retain snapshots, idempotency, references and expiry", async () => {
    const sql = statement(await statements(), /CREATE TABLE `customer_merge_requests`/i);
    for (const expression of [
        /`request_id` char\(36\) NOT NULL/i,
        /`source_customer_id` char\(36\) NOT NULL/i,
        /`target_customer_id` char\(36\) NOT NULL/i,
        /`source_user_id_snapshot` char\(36\) NOT NULL/i,
        /`target_user_id_snapshot` char\(36\) NOT NULL/i,
        /`source_version` bigint unsigned NOT NULL/i,
        /`target_version` bigint unsigned NOT NULL/i,
        /`initiated_by_user_id` char\(36\) NOT NULL/i,
        /`idempotency_key` varbinary\(128\) NOT NULL/i,
        /`request_digest` binary\(32\) NOT NULL/i,
        /`digest_version` smallint unsigned NOT NULL/i,
        /`merge_reason` varchar\(500\) DEFAULT NULL/i,
        /`decision_reason` varchar\(500\) DEFAULT NULL/i,
        /`decided_by_user_id` char\(36\) DEFAULT NULL/i,
        /`verification_reference` varchar\(500\) DEFAULT NULL/i,
        /`history_id` char\(36\) DEFAULT NULL/i,
        /`initiated_audit_id` char\(36\) NOT NULL/i,
        /`decision_audit_id` char\(36\) DEFAULT NULL/i,
        /`status` enum\('PENDING','COMPLETED','REJECTED','CANCELLED','EXPIRED'\)/i,
        /`created_at` datetime\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP\(3\)/i,
        /`expires_at` datetime\(3\) GENERATED ALWAYS AS \(`created_at` \+ INTERVAL 24 HOUR\) STORED/i,
        /`decided_at` datetime\(3\) DEFAULT NULL/i,
        /UNIQUE KEY `uq_merge_requests_initiator_key` \(`initiated_by_user_id`, `idempotency_key`\)/i,
        /CHECK \(`source_customer_id` <> `target_customer_id`\)/i,
        /CHECK \(OCTET_LENGTH\(`idempotency_key`\) > 0\)/i,
        /KEY `idx_merge_requests_expiry` \(`status`, `expires_at`\)/i
    ]) assert.match(sql, expression);

    for (const [column, table, referenced] of [
        ["source_customer_id", "customers", "customer_id"],
        ["target_customer_id", "customers", "customer_id"],
        ["source_user_id_snapshot", "users", "user_id"],
        ["target_user_id_snapshot", "users", "user_id"],
        ["initiated_by_user_id", "users", "user_id"],
        ["decided_by_user_id", "users", "user_id"],
        ["history_id", "customer_merge_history", "merge_history_id"],
        ["initiated_audit_id", "user_audit_logs", "audit_id"],
        ["decision_audit_id", "user_audit_logs", "audit_id"]
    ]) {
        assert.ok(sql.includes(`FOREIGN KEY (\`${column}\`) REFERENCES \`${table}\` (\`${referenced}\`) ON DELETE RESTRICT ON UPDATE RESTRICT`), column);
    }
    for (const column of ["history_id", "initiated_audit_id", "decision_audit_id"]) {
        assert.match(sql, new RegExp(`UNIQUE KEY [^\\n]+\\(\`${column}\`\\)`, "i"));
    }
});

test("lifecycle distinguishes all terminal states without nullable-check loopholes", async () => {
    const sql = statement(await statements(), /CREATE TABLE `customer_merge_requests`/i);
    const branch = (status) => {
        const match = sql.match(new RegExp(`\\(\`status\` = '${status}'([\\s\\S]*?)(?=\\n\\s*OR \\(\`status\`|\\n\\s*\\)\\n\\s*\\) ENGINE)`, "i"));
        assert.ok(match, status);
        return match[1];
    };
    const pending = branch("PENDING");
    for (const column of ["decided_by_user_id", "decision_reason", "verification_reference", "history_id", "decision_audit_id", "decided_at"]) {
        assert.match(pending, new RegExp(`\`${column}\` IS NULL`, "i"));
    }
    const completed = branch("COMPLETED");
    for (const column of ["decided_by_user_id", "verification_reference", "history_id", "decision_audit_id", "decided_at"]) {
        assert.match(completed, new RegExp(`\`${column}\` IS NOT NULL`, "i"));
    }
    assert.match(completed, /`decision_reason` IS NULL/i);
    assert.match(completed, /`decided_by_user_id` <> `initiated_by_user_id`/i);
    assert.match(completed, /`verification_reference` REGEXP '\[\^\[:space:\]\]'/i);
    assert.match(completed, /`decided_at` < `expires_at`/i);
    for (const status of ["REJECTED", "CANCELLED", "EXPIRED"]) {
        const part = branch(status);
        for (const column of ["verification_reference", "history_id"]) {
            assert.match(part, new RegExp(`\`${column}\` IS NULL`, "i"));
        }
        assert.match(part, /`decision_audit_id` IS NOT NULL/i);
        assert.match(part, /`decided_at` IS NOT NULL/i);
    }
    assert.match(branch("REJECTED"), /`decided_by_user_id` IS NOT NULL AND `decided_by_user_id` <> `initiated_by_user_id`/i);
    assert.match(branch("CANCELLED"), /`decided_by_user_id` IS NOT NULL AND `decided_by_user_id` = `initiated_by_user_id`/i);
    assert.match(branch("EXPIRED"), /`decided_by_user_id` IS NULL/i);
    assert.match(branch("EXPIRED"), /`decision_reason` IS NULL/i);
    assert.match(branch("EXPIRED"), /`decided_at` >= `expires_at`/i);
});

test("decision audit cannot reuse the initiation audit", async () => {
    const sql = statement(await statements(), /CREATE TABLE `customer_merge_requests`/i);
    assert.match(sql, /CONSTRAINT `chk_merge_requests_distinct_audits` CHECK \(`decision_audit_id` IS NULL OR `decision_audit_id` <> `initiated_audit_id`\)/i);
});

test("request triggers force trusted times, immutable inputs and retention", async () => {
    const sql = await statements();
    const insert = statement(sql, /CREATE TRIGGER `trg_merge_requests_before_insert`/i);
    assert.match(insert, /BEFORE INSERT ON `customer_merge_requests`/i);
    assert.match(insert, /NEW\.`status` <> 'PENDING'[\s\S]*?SIGNAL SQLSTATE '45000'/i);
    assert.match(insert, /SET NEW\.`created_at` = UTC_TIMESTAMP\(3\)/i);
    const update = statement(sql, /CREATE TRIGGER `trg_merge_requests_before_update`/i);
    assert.match(update, /OLD\.`status` <> 'PENDING' OR NEW\.`status` NOT IN \('COMPLETED','REJECTED','CANCELLED','EXPIRED'\)/i);
    assert.match(update, /SET NEW\.`decided_at` = UTC_TIMESTAMP\(3\)/i);
    for (const column of [
        "request_id", "source_customer_id", "target_customer_id", "source_user_id_snapshot",
        "target_user_id_snapshot", "source_version", "target_version",
        "initiated_by_user_id", "idempotency_key", "request_digest", "digest_version",
        "merge_reason", "initiated_audit_id", "created_at"
    ]) {
        assert.match(update, new RegExp(`NEW\\.\`${column}\` <=> (?:BINARY )?OLD\\.\`${column}\``, "i"), column);
    }
    const deletion = statement(sql, /CREATE TRIGGER `trg_merge_requests_before_delete`/i);
    assert.match(deletion, /BEFORE DELETE ON `customer_merge_requests`[\s\S]*?SIGNAL SQLSTATE '45000'/i);
});

test("reservations enforce global customer exclusivity and restricted references", async () => {
    const sql = statement(await statements(), /CREATE TABLE `customer_merge_reservations`/i);
    assert.match(sql, /PRIMARY KEY \(`customer_id`\)/i);
    assert.match(sql, /`participant` enum\('SOURCE','TARGET'\) NOT NULL/i);
    assert.match(sql, /UNIQUE KEY [^\n]+\(`request_id`, `participant`\)/i);
    assert.match(sql, /FOREIGN KEY \(`customer_id`\) REFERENCES `customers` \(`customer_id`\) ON DELETE RESTRICT ON UPDATE RESTRICT/i);
    assert.match(sql, /FOREIGN KEY \(`request_id`\) REFERENCES `customer_merge_requests` \(`request_id`\) ON DELETE RESTRICT ON UPDATE RESTRICT/i);
});

test("rollback fails without executing any destructive SQL", async () => {
    let called = false;
    await assert.rejects(migration.down({ raw() { called = true; } }), /rollback is unsafe/i);
    assert.equal(called, false);
    assert.deepEqual(migration.config, { transaction: false });
});
