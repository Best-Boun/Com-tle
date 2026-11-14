function configureTable(table) {
    table.engine("InnoDB");
    table.charset("utf8mb4");
    table.collate("utf8mb4_unicode_ci");
}

exports.up = async function up(knex) {
    await knex.schema.createTable("refresh_token_sessions", (table) => {
        configureTable(table);

        table.string("token_id", 36).notNullable().primary();
        table.string("session_id", 36).notNullable();
        table.string("user_id", 36).notNullable();
        table.string("token_hash", 64).notNullable().unique("refresh_token_hash_unique");
        table.dateTime("expires_at", { precision: 3 }).notNullable();
        table.dateTime("revoked_at", { precision: 3 }).nullable();
        table.string("replaced_by_token_id", 36).nullable();
        table.dateTime("created_at", { precision: 3 }).notNullable();

        table.index("session_id", "refresh_session_id_index");
        table.index("user_id", "refresh_user_id_index");
        table.index("expires_at", "refresh_expires_at_index");

        table.foreign("user_id", "refresh_user_id_foreign")
            .references("user_id")
            .inTable("users")
            .onUpdate("CASCADE")
            .onDelete("RESTRICT");
        table.foreign("replaced_by_token_id", "refresh_replaced_by_token_id_foreign")
            .references("token_id")
            .inTable("refresh_token_sessions")
            .onUpdate("CASCADE")
            .onDelete("SET NULL");
    });
};

exports.down = async function down(knex) {
    await knex.schema.dropTableIfExists("refresh_token_sessions");
};
