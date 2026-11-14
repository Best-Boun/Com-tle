function configureTable(table) {
    table.engine("InnoDB");
    table.charset("utf8mb4");
    table.collate("utf8mb4_unicode_ci");
}

exports.up = async function up(knex) {
    await knex.schema.createTable("users", (table) => {
        configureTable(table);

        table.string("user_id", 36).notNullable().primary();
        table.string("email", 255).notNullable().unique("users_email_unique");
        table.string("password_hash", 255).notNullable();
        table.string("phone", 30).nullable();
        table.string("status", 20).notNullable();
    });

    await knex.schema.createTable("roles", (table) => {
        configureTable(table);

        table.string("role_id", 36).notNullable().primary();
        table.string("role_code", 50).notNullable().unique("roles_role_code_unique");
        table.string("role_name", 100).notNullable().unique("roles_role_name_unique");
        table.text("description").nullable();
    });

    await knex.schema.createTable("customers", (table) => {
        configureTable(table);

        table.string("customer_id", 36).notNullable().primary();
        table.string("user_id", 36).nullable().unique("customers_user_id_unique");
        table.string("full_name", 150).notNullable();
        table.string("phone", 30).nullable();
        table.string("email", 255).notNullable();
        table.enu("customer_type", ["REGISTERED", "GUEST"]).notNullable();

        table.check(
            "((customer_type = 'REGISTERED' AND user_id IS NOT NULL) OR (customer_type = 'GUEST' AND user_id IS NULL))",
            [],
            "customers_type_user_check"
        );
        table.foreign("user_id", "customers_user_id_foreign")
            .references("user_id")
            .inTable("users")
            .onUpdate("CASCADE")
            .onDelete("RESTRICT");
    });

    await knex.schema.createTable("user_roles", (table) => {
        configureTable(table);

        table.string("user_id", 36).notNullable();
        table.string("role_id", 36).notNullable();
        table.string("assigned_by", 36).nullable();

        table.primary(["user_id", "role_id"]);
        table.index("role_id", "user_roles_role_id_index");
        table.foreign("user_id", "user_roles_user_id_foreign")
            .references("user_id")
            .inTable("users")
            .onUpdate("CASCADE")
            .onDelete("RESTRICT");
        table.foreign("role_id", "user_roles_role_id_foreign")
            .references("role_id")
            .inTable("roles")
            .onUpdate("CASCADE")
            .onDelete("RESTRICT");
        table.foreign("assigned_by", "user_roles_assigned_by_foreign")
            .references("user_id")
            .inTable("users")
            .onUpdate("CASCADE")
            .onDelete("RESTRICT");
    });
};

exports.down = async function down(knex) {
    await knex.schema.dropTableIfExists("user_roles");
    await knex.schema.dropTableIfExists("customers");
    await knex.schema.dropTableIfExists("roles");
    await knex.schema.dropTableIfExists("users");
};
