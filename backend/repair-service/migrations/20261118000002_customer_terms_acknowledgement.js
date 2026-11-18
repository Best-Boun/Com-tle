async function addColumnIfMissing(knex, tableName, columnName, addColumn) {
    if (!await knex.schema.hasColumn(tableName, columnName)) {
        await knex.schema.alterTable(tableName, addColumn);
    }
}

exports.up = async function up(knex) {
    await addColumnIfMissing(knex, "work_orders", "intake_terms_acknowledged_at", (table) => {
        table.datetime("intake_terms_acknowledged_at", { precision: 3 }).nullable();
    });
    await addColumnIfMissing(knex, "work_orders", "handover_terms_acknowledged_at", (table) => {
        table.datetime("handover_terms_acknowledged_at", { precision: 3 }).nullable();
    });
};

exports.down = async function down(knex) {
    await knex.schema.alterTable("work_orders", (table) => {
        table.dropColumn("handover_terms_acknowledged_at");
        table.dropColumn("intake_terms_acknowledged_at");
    });
};
