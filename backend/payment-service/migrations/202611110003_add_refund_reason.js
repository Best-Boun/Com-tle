exports.up = async function up(knex) {
    await knex.schema.alterTable("refunds", (table) => {
        table.string("reason", 500).nullable();
    });
};

exports.down = async function down(knex) {
    await knex.schema.alterTable("refunds", (table) => {
        table.dropColumn("reason");
    });
};
