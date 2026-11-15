async function addColumnIfMissing(knex, tableName, columnName, addColumn) {
    if (!await knex.schema.hasColumn(tableName, columnName)) {
        await knex.schema.alterTable(tableName, addColumn);
    }
}

async function addWorkflowColumns(knex) {
    await addColumnIfMissing(knex, "work_orders", "reported_symptom", (table) => {
        table.text("reported_symptom").nullable();
    });
    await addColumnIfMissing(knex, "work_orders", "repair_result", (table) => {
        table.text("repair_result").nullable();
    });
    await addColumnIfMissing(knex, "work_orders", "handed_over_at", (table) => {
        table.datetime("handed_over_at", { precision: 3 }).nullable();
    });
    await addColumnIfMissing(knex, "quotations", "quotation_kind", (table) => {
        table.enu("quotation_kind", ["INITIAL", "ADDITIONAL"])
            .notNullable()
            .defaultTo("INITIAL");
    });
    await addColumnIfMissing(knex, "quotations", "note", (table) => {
        table.text("note").nullable();
    });
    await addColumnIfMissing(knex, "quotation_items", "part_id", (table) => {
        table.specificType("part_id", "char(36)").nullable().index();
    });
    await addColumnIfMissing(knex, "handover_records", "outstanding_amount", (table) => {
        table.bigint("outstanding_amount", { unsigned: true }).nullable();
    });
}

async function createPartTables(knex) {
    const now3 = knex.raw("CURRENT_TIMESTAMP(3)");
    if (!await knex.schema.hasTable("repair_parts_inventory")) {
        await knex.schema.createTable("repair_parts_inventory", (table) => {
            table.specificType("part_id", "char(36)").notNullable().primary();
            table.string("sku", 50).notNullable().unique();
            table.string("name", 150).notNullable();
            table.text("description").nullable();
            table.bigint("unit_price", { unsigned: true }).notNullable().defaultTo(0);
            table.decimal("stock", 12, 3).notNullable().defaultTo(0);
            table.decimal("reorder_level", 12, 3).notNullable().defaultTo(0);
            table.boolean("is_active").notNullable().defaultTo(true);
            table.datetime("created_at", { precision: 3 }).notNullable().defaultTo(now3);
            table.datetime("updated_at", { precision: 3 }).notNullable().defaultTo(now3);
        });
    }

    if (!await knex.schema.hasTable("repair_stock_movements")) {
        await knex.schema.createTable("repair_stock_movements", (table) => {
            table.specificType("movement_id", "char(36)").notNullable().primary();
            table.specificType("part_id", "char(36)").notNullable()
                .references("part_id").inTable("repair_parts_inventory").onDelete("RESTRICT");
            table.enu("movement_type", ["RECEIVE", "ISSUE", "RETURN"]).notNullable();
            table.decimal("quantity", 12, 3).notNullable();
            table.specificType("work_order_id", "char(36)").nullable()
                .references("work_order_id").inTable("work_orders").onDelete("RESTRICT");
            table.specificType("actor_user_id", "char(36)").notNullable();
            table.string("note", 1000).nullable();
            table.datetime("created_at", { precision: 3 }).notNullable().defaultTo(now3);
            table.index(["part_id", "created_at"]);
            table.index(["work_order_id", "created_at"]);
        });
    }
}

exports.up = async function up(knex) {
    await addWorkflowColumns(knex);
    await createPartTables(knex);
};

exports.down = async function down() {
    throw new Error(
        "This migration adds persistent repair workflow data and is intentionally not reversible."
    );
};
