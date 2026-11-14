function configureTable(table) {
    table.engine("InnoDB");
    table.charset("utf8mb4");
    table.collate("utf8mb4_unicode_ci");
}

exports.up = async function up(knex) {
    await knex.schema.createTable("permissions", (table) => {
        configureTable(table);

        table.string("permission_id", 36).notNullable().primary();
        table.string("permission_code", 100).notNullable()
            .unique("permissions_permission_code_unique");
        table.string("permission_name", 150).notNullable();
        table.text("description").nullable();
    });

    await knex.schema.createTable("role_permissions", (table) => {
        configureTable(table);

        table.string("role_id", 36).notNullable();
        table.string("permission_id", 36).notNullable();
        table.string("assigned_by", 36).nullable();

        table.primary(["role_id", "permission_id"]);
        table.index("permission_id", "role_permissions_permission_id_index");
        table.index("assigned_by", "role_permissions_assigned_by_index");
        table.foreign("role_id", "role_permissions_role_id_foreign")
            .references("role_id")
            .inTable("roles")
            .onUpdate("CASCADE")
            .onDelete("CASCADE");
        table.foreign("permission_id", "role_permissions_permission_id_foreign")
            .references("permission_id")
            .inTable("permissions")
            .onUpdate("CASCADE")
            .onDelete("CASCADE");
        table.foreign("assigned_by", "role_permissions_assigned_by_foreign")
            .references("user_id")
            .inTable("users")
            .onUpdate("CASCADE")
            .onDelete("RESTRICT");
    });
};

exports.down = async function down(knex) {
    await knex.schema.dropTableIfExists("role_permissions");
    await knex.schema.dropTableIfExists("permissions");
};
