exports.up = async function up(knex) {
    await knex.schema.alterTable("payments", (table) => {
        table.string("payment_method", 50).nullable();
        table.string("recorded_by", 36).nullable();
    });
};

exports.down = async function down(knex) {
    await knex.schema.alterTable("payments", (table) => {
        table.dropColumn("recorded_by");
        table.dropColumn("payment_method");
    });
};
