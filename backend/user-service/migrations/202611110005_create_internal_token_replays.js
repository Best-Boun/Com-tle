function configureTable(table) {
    table.engine("InnoDB");
    table.charset("utf8mb4");
    table.collate("utf8mb4_bin");
}

exports.up = async function up(knex) {
    await knex.schema.createTable("internal_token_replays", (table) => {
        configureTable(table);

        table.bigIncrements("internal_token_replay_id").primary();
        table.string("issuer", 255).notNullable();
        table.string("jti", 128).notNullable();
        table.string("client_id", 64).notNullable();
        table.dateTime("expires_at", { precision: 3 }).notNullable();
        table.dateTime("created_at", { precision: 3 }).notNullable();

        table.unique(
            ["issuer", "jti"],
            "internal_token_replays_issuer_jti_unique"
        );
        table.index("expires_at", "internal_token_replays_expires_at_index");
    });
};

exports.down = async function down(knex) {
    await knex.schema.dropTableIfExists("internal_token_replays");
};
