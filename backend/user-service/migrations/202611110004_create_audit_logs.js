function configureTable(table) {
    table.engine("InnoDB");
    table.charset("utf8mb4");
    table.collate("utf8mb4_unicode_ci");
}

exports.up = async function up(knex) {
    await knex.schema.createTable("audit_logs", (table) => {
        configureTable(table);

        table.string("audit_id", 36).notNullable().primary();
        table.string("actor_user_id", 36).nullable();
        table.string("action", 100).notNullable();
        table.string("target_entity_type", 50).notNullable();
        table.string("target_entity_id", 36).nullable();
        table.dateTime("occurred_at", { precision: 3 }).notNullable();
        table.enu("outcome", ["SUCCESS", "FAILURE"]).notNullable();
        table.string("request_id", 100).nullable();
        table.json("metadata").nullable();

        table.index(["actor_user_id", "occurred_at"], "audit_actor_occurred_index");
        table.index(
            ["target_entity_type", "target_entity_id", "occurred_at"],
            "audit_target_occurred_index"
        );
        table.index(["action", "occurred_at"], "audit_action_occurred_index");
        table.foreign("actor_user_id", "audit_actor_user_id_foreign")
            .references("user_id")
            .inTable("users")
            .onUpdate("CASCADE")
            .onDelete("SET NULL");
    });
};

exports.down = async function down(knex) {
    await knex.schema.dropTableIfExists("audit_logs");
};
