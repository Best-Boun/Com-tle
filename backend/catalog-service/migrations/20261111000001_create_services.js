/**
 * Catalog schema — recreates the team's original catalog_db design:
 *   service_categories, services, catalog_audit_logs
 *
 * starting_price is an unsigned integer in whole baht (500 = 500 THB),
 * together with `currency`.
 * Services/categories are deactivated, never deleted.
 */
exports.up = async function up(knex) {
    const now3 = knex.raw("CURRENT_TIMESTAMP(3)");

    await knex.schema.createTable("service_categories", (table) => {
        table.specificType("category_id", "char(36)").notNullable().primary();
        table.string("category_code", 50).notNullable().unique();
        table.string("category_name", 150).notNullable().unique();
        table.string("description", 500).nullable();
        table.boolean("is_active").notNullable().defaultTo(true).index();
        table.datetime("created_at", { precision: 3 }).notNullable().defaultTo(now3);
        table.datetime("updated_at", { precision: 3 }).notNullable().defaultTo(now3);
    });

    await knex.schema.createTable("services", (table) => {
        table.specificType("service_id", "char(36)").notNullable().primary();
        table.specificType("category_id", "char(36)").notNullable()
            .references("category_id").inTable("service_categories").onDelete("RESTRICT");
        table.string("service_code", 50).notNullable().unique();
        table.string("service_name", 150).notNullable();
        table.text("description").nullable();
        table.bigInteger("starting_price").unsigned().notNullable();
        table.specificType("currency", "char(3)").notNullable().defaultTo("THB");
        table.integer("estimated_duration_minutes").unsigned().notNullable();
        table.boolean("is_active").notNullable().defaultTo(true).index();
        table.datetime("created_at", { precision: 3 }).notNullable().defaultTo(now3);
        table.datetime("updated_at", { precision: 3 }).notNullable().defaultTo(now3);
    });

    await knex.schema.createTable("catalog_audit_logs", (table) => {
        table.specificType("audit_id", "char(36)").notNullable().primary();
        table.specificType("actor_user_id", "char(36)").nullable().index();
        table.string("action", 100).notNullable();
        table.string("resource_type", 100).notNullable();
        table.string("resource_id", 100).nullable();
        table.json("old_values").nullable();
        table.json("new_values").nullable();
        table.datetime("created_at", { precision: 3 }).notNullable().defaultTo(now3).index();
        table.index(["resource_type", "resource_id"]);
    });
};

exports.down = async function down(knex) {
    await knex.schema.dropTableIfExists("catalog_audit_logs");
    await knex.schema.dropTableIfExists("services");
    await knex.schema.dropTableIfExists("service_categories");
};
