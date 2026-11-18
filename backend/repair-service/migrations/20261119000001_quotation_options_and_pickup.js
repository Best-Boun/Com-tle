/**
 * New repair flow (additive; no existing column or row is removed):
 *
 * - quotation_options / quotation_option_items: a technician sends several
 *   priced options in one quotation. The system adds one more option itself:
 *   "no repair" (inspection fee) on an initial quotation, or "skip the extra
 *   work" (0 THB) on an additional one.
 * - quotations.selected_option_id: the option the customer (or the shop, for a
 *   walk-in) chose. The chosen option's items are copied into quotation_items,
 *   so parts allowance and Payment-Service keep reading APPROVED quotations.
 * - work_orders.repair_declined: the customer chose "no repair"; the device
 *   goes straight to pick-up and only the inspection fee is billed.
 * - work_orders.ready_at: when the device became ready for pick-up. Free
 *   storage is counted from here.
 */
async function addColumnIfMissing(knex, tableName, columnName, addColumn) {
    if (!await knex.schema.hasColumn(tableName, columnName)) {
        await knex.schema.alterTable(tableName, addColumn);
    }
}

exports.up = async function up(knex) {
    const now3 = knex.raw("CURRENT_TIMESTAMP(3)");

    if (!await knex.schema.hasTable("quotation_options")) {
        await knex.schema.createTable("quotation_options", (table) => {
            table.specificType("option_id", "char(36)").notNullable().primary();
            table.specificType("quotation_id", "char(36)").notNullable().index();
            table.specificType("work_order_id", "char(36)").notNullable().index();
            table.integer("sort_order").unsigned().notNullable();
            table.enu("option_kind", ["REPAIR", "NO_REPAIR", "SKIP_EXTRA"]).notNullable();
            table.string("title", 200).notNullable();
            table.text("description").nullable();
            table.bigint("total_amount", { unsigned: true }).notNullable().defaultTo(0);
            table.datetime("created_at", { precision: 3 }).notNullable().defaultTo(now3);
            table.unique(["quotation_id", "sort_order"]);
        });
    }

    if (!await knex.schema.hasTable("quotation_option_items")) {
        await knex.schema.createTable("quotation_option_items", (table) => {
            table.specificType("option_item_id", "char(36)").notNullable().primary();
            table.specificType("option_id", "char(36)").notNullable()
                .references("option_id").inTable("quotation_options").onDelete("RESTRICT");
            table.integer("sort_order").unsigned().notNullable();
            table.enu("item_type", ["PART", "LABOR"]).notNullable();
            table.string("description", 1000).notNullable();
            table.specificType("part_id", "char(36)").nullable();
            table.integer("quantity").unsigned().notNullable();
            table.bigint("unit_price", { unsigned: true }).notNullable();
            table.bigint("subtotal", { unsigned: true }).notNullable();
            table.index(["option_id", "sort_order"]);
        });
    }

    await addColumnIfMissing(knex, "quotations", "selected_option_id", (table) => {
        table.specificType("selected_option_id", "char(36)").nullable();
    });
    await addColumnIfMissing(knex, "work_orders", "repair_declined", (table) => {
        table.boolean("repair_declined").notNullable().defaultTo(false);
    });
    await addColumnIfMissing(knex, "work_orders", "ready_at", (table) => {
        table.datetime("ready_at", { precision: 3 }).nullable().index();
    });

    // Devices already waiting for pick-up: count free storage from the moment
    // they last became ready.
    await knex.raw(`
        UPDATE work_orders wo
        JOIN (
            SELECT work_order_id, MAX(created_at) AS ready_at
            FROM work_order_status_history
            WHERE new_status = 'RETURN_PENDING'
            GROUP BY work_order_id
        ) h ON h.work_order_id = wo.work_order_id
        SET wo.ready_at = h.ready_at
        WHERE wo.ready_at IS NULL
    `);
};

exports.down = async function down() {
    throw new Error(
        "This migration adds persistent quotation data and is intentionally not reversible."
    );
};
