exports.up = async function up(knex) {
    await knex.schema.alterTable("refunds", (table) => {
        table.dateTime("execution_started_at", { precision: 3 }).nullable();
        table.string("executing_by", 36).nullable();
        table.integer("execution_attempts").unsigned().notNullable().defaultTo(0);
        table.string("external_reference_id", 191).nullable();
        table.enu("execution_result", ["SUCCEEDED", "FAILED", "UNKNOWN"]).nullable();
        table.string("idempotency_key", 64).nullable();
        table.string("execution_lease_token", 36).nullable();
        table.dateTime("execution_lease_until", { precision: 3 }).nullable();

        table.unique("idempotency_key", "refunds_idempotency_key_unique");
        table.index(
            ["status", "execution_lease_until"],
            "refunds_execution_lease_index"
        );
    });
};

exports.down = async function down(knex) {
    await knex.schema.alterTable("refunds", (table) => {
        table.dropIndex(
            ["status", "execution_lease_until"],
            "refunds_execution_lease_index"
        );
        table.dropUnique("idempotency_key", "refunds_idempotency_key_unique");
        table.dropColumn("execution_lease_until");
        table.dropColumn("execution_lease_token");
        table.dropColumn("idempotency_key");
        table.dropColumn("execution_result");
        table.dropColumn("external_reference_id");
        table.dropColumn("execution_attempts");
        table.dropColumn("executing_by");
        table.dropColumn("execution_started_at");
    });
};
