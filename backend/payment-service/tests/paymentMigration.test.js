const assert = require("node:assert/strict");
const test = require("node:test");
const knex = require("knex")({ client: "mysql2" });
const migration = require("../migrations/202611110001_create_payment_schema");
const paymentRecordingMigration = require("../migrations/202611110002_add_payment_recording_fields");
const refundReasonMigration = require("../migrations/202611110003_add_refund_reason");
const refundExecutionMigration = require("../migrations/202611110004_add_refund_execution_fields");
const paymentAuditMigration = require("../migrations/202611110005_create_payment_audit_logs");

async function compileMigration(method) {
    const statements = [];
    const schema = {
        createTable(tableName, callback) {
            statements.push(...knex.schema.createTable(tableName, callback)
                .toSQL()
                .map((statement) => statement.sql));
            return Promise.resolve();
        },
        alterTable(tableName, callback) {
            statements.push(...knex.schema.alterTable(tableName, callback)
                .toSQL()
                .map((statement) => statement.sql));
            return Promise.resolve();
        },
        dropTableIfExists(tableName) {
            statements.push(...knex.schema.dropTableIfExists(tableName)
                .toSQL()
                .map((statement) => statement.sql));
            return Promise.resolve();
        }
    };
    await migration[method]({ schema });
    return statements;
}

test("payment migration defines exact local tables and DECIMAL monetary columns", async () => {
    const statements = await compileMigration("up");
    const sql = statements.join("\n").toLowerCase();

    for (const tableName of [
        "work_order_payment_accounts",
        "payments",
        "refunds"
    ]) {
        assert.match(sql, new RegExp(`create table \`${tableName}\``));
        assert.match(
            sql.match(new RegExp(`create table \`${tableName}\`[^;]+`))[0],
            /engine = innodb/
        );
    }

    assert.match(sql, /`amount_due` decimal\(12, 2\) not null/);
    assert.match(sql, /`amount` decimal\(12, 2\) not null/);
    assert.equal((sql.match(/decimal\(12, 2\)/g) || []).length, 3);
    assert.match(sql, /`status` enum\('pending', 'completed', 'failed', 'cancelled'\) not null/);
    assert.match(sql, /`status` enum\('requested', 'approved', 'rejected', 'processing', 'completed', 'failed', 'cancelled'\) not null/);
    assert.match(sql, /`review_decision` enum\('approved', 'rejected'\) null/);
    assert.match(sql, /`reviewer_user_id` varchar\(36\) null/);
    assert.match(sql, /`initiated_by` varchar\(36\) not null/);
    assert.match(sql, /default character set utf8mb4/);
});

test("payment schema compiles positive amount, currency, two-person, and review checks", async () => {
    const sql = (await compileMigration("up")).join("\n").toLowerCase();

    assert.match(sql, /payment_accounts_amount_due_positive/);
    assert.match(sql, /payments_amount_positive/);
    assert.match(sql, /refunds_amount_positive/);
    assert.match(sql, /currency_format/);
    assert.match(sql, /refunds_two_person_review/);
    assert.match(sql, /reviewer_user_id.*initiated_by/);
    assert.match(sql, /refunds_review_fields_consistent/);
});

test("payment schema allows multiple payments per work order and uses only local foreign keys", async () => {
    const sql = (await compileMigration("up")).join("\n").toLowerCase();
    const paymentStatements = sql.split("create table `payments`")[1]
        .split("create table `refunds`")[0];

    assert.match(sql, /payments_work_order_status_index/);
    assert.doesNotMatch(paymentStatements, /unique/);
    assert.match(sql, /payments_work_order_id_foreign/);
    assert.match(sql, /references `work_order_payment_accounts` \(`work_order_id`\)/);
    assert.match(sql, /refunds_payment_id_foreign/);
    assert.match(sql, /references `payments` \(`payment_id`\)/);
    assert.doesNotMatch(sql, /references `(work_orders|customers|users)`/);
    assert.match(sql, /on delete restrict/);
});

test("payment migration rollback drops dependents before the account table", async () => {
    assert.deepEqual(await compileMigration("down"), [
        "drop table if exists `refunds`",
        "drop table if exists `payments`",
        "drop table if exists `work_order_payment_accounts`"
    ]);
});

test("payment recording migration adds nullable legacy-safe method and actor columns", async () => {
    const up = (await compileMigrationWith(paymentRecordingMigration, "up"))
        .join("\n")
        .toLowerCase();
    assert.match(up, /alter table `payments`/);
    assert.match(up, /`payment_method` varchar\(50\) null/);
    assert.match(up, /`recorded_by` varchar\(36\) null/);
    assert.doesNotMatch(up, /references `users`/);

    assert.deepEqual(await compileMigrationWith(paymentRecordingMigration, "down"), [
        "alter table `payments` drop `recorded_by`",
        "alter table `payments` drop `payment_method`"
    ]);
});

test("refund reason migration is nullable for existing records and reversible", async () => {
    const up = (await compileMigrationWith(refundReasonMigration, "up"))
        .join("\n")
        .toLowerCase();
    assert.match(up, /alter table `refunds`/);
    assert.match(up, /`reason` varchar\(500\) null/);

    assert.deepEqual(await compileMigrationWith(refundReasonMigration, "down"), [
        "alter table `refunds` drop `reason`"
    ]);
});

test("refund execution migration adds legacy-safe execution and idempotency fields", async () => {
    const up = (await compileMigrationWith(refundExecutionMigration, "up"))
        .join("\n")
        .toLowerCase();
    assert.match(up, /`execution_started_at` datetime\(3\) null/);
    assert.match(up, /`executing_by` varchar\(36\) null/);
    assert.match(up, /`execution_attempts` int unsigned not null default '0'/);
    assert.match(up, /`external_reference_id` varchar\(191\) null/);
    assert.match(up, /`execution_result` enum\('succeeded', 'failed', 'unknown'\) null/);
    assert.match(up, /`idempotency_key` varchar\(64\) null/);
    assert.match(up, /refunds_idempotency_key_unique/);
    assert.match(up, /refunds_execution_lease_index/);

    const down = (await compileMigrationWith(refundExecutionMigration, "down"))
        .join("\n")
        .toLowerCase();
    assert.match(down, /drop index `refunds_execution_lease_index`/);
    assert.match(down, /drop index `refunds_idempotency_key_unique`/);
    assert.match(down, /drop `execution_started_at`/);
});

test("Payment-Service audit migration defines append-only safe audit fields and indexes", async () => {
    const statements = await compileMigrationWith(paymentAuditMigration, "up");
    const sql = statements.join("\n").toLowerCase();
    assert.match(sql, /create table `audit_logs`/);
    assert.match(sql, /engine = innodb/);
    assert.match(sql, /`event_key` varchar\(191\) not null/);
    assert.match(sql, /unique `audit_logs_event_key_unique`\(`event_key`\)/);
    assert.match(sql, /`actor_user_id` varchar\(36\) null/);
    assert.match(sql, /`outcome` enum\('success', 'failure', 'unknown'\) not null/);
    assert.match(sql, /`metadata` json null/);
    assert.match(sql, /payment_audit_target_occurred_index/);
    assert.match(sql, /payment_audit_action_occurred_index/);
    assert.match(sql, /payment_audit_actor_occurred_index/);
    assert.doesNotMatch(sql, /references `users`/);
    assert.doesNotMatch(sql, /access_token|refresh_token|password|secret/);
    assert.deepEqual(await compileMigrationWith(paymentAuditMigration, "down"), [
        "drop table if exists `audit_logs`"
    ]);
});

async function compileMigrationWith(selectedMigration, method) {
    const statements = [];
    const schema = {
        alterTable(tableName, callback) {
            statements.push(...knex.schema.alterTable(tableName, callback)
                .toSQL()
                .map((statement) => statement.sql));
            return Promise.resolve();
        },
        createTable(tableName, callback) {
            statements.push(...knex.schema.createTable(tableName, callback)
                .toSQL()
                .map((statement) => statement.sql));
            return Promise.resolve();
        },
        dropTableIfExists(tableName) {
            statements.push(...knex.schema.dropTableIfExists(tableName)
                .toSQL()
                .map((statement) => statement.sql));
            return Promise.resolve();
        }
    };
    await selectedMigration[method]({ schema });
    return statements;
}
