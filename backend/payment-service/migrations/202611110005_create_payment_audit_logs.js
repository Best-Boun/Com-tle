function configureTable(table) {
    table.engine("InnoDB");
    table.charset("utf8mb4");
    table.collate("utf8mb4_unicode_ci");
}

exports.up = async function up(knex) {
    await knex.schema.createTable("audit_logs", (table) => {
        configureTable(table);

        table.string("audit_id", 36).notNullable().primary();
        table.string("event_key", 191).notNullable().unique();
        table.string("actor_user_id", 36).nullable();
        table.string("action", 100).notNullable();
        table.string("target_entity_type", 50).notNullable();
        table.string("target_entity_id", 36).nullable();
        table.dateTime("occurred_at", { precision: 3 }).notNullable();
        table.enu("outcome", ["SUCCESS", "FAILURE", "UNKNOWN"]).notNullable();
        table.string("request_id", 100).nullable();
        table.json("metadata").nullable();

        table.index(
            ["target_entity_type", "target_entity_id", "occurred_at"],
            "payment_audit_target_occurred_index"
        );
        table.index(["action", "occurred_at"], "payment_audit_action_occurred_index");
        table.index(["actor_user_id", "occurred_at"], "payment_audit_actor_occurred_index");
        table.check(
            "action IN ('payment.recorded', 'payment.record.rejected', 'refund.requested', 'refund.approved', 'refund.rejected', 'refund.execution.started', 'refund.execution.retry_attempted', 'refund.execution.completed', 'refund.execution.failed', 'refund.execution.unknown')",
            [],
            "payment_audit_action_allowed"
        );
        table.check(
            "(target_entity_type = 'PAYMENT' AND action LIKE 'payment.%') OR (target_entity_type = 'REFUND' AND action LIKE 'refund.%')",
            [],
            "payment_audit_target_action_consistent"
        );
    });
};

exports.down = async function down(knex) {
    await knex.schema.dropTableIfExists("audit_logs");
};
