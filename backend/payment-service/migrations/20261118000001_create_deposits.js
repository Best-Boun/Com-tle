/**
 * Booking deposits (additive; the rest of payment_db comes from
 * baseline/001_payment_service_fresh_schema.sql).
 *
 * One row per booking. The money is held as PAID until the booking ends:
 *   APPLIED   – credited to the repair's work order (counts as paid)
 *   REFUNDED  – booking cancelled in time or by the shop
 *   FORFEITED – the customer did not come; the shop keeps it
 */
exports.up = async function up(knex) {
    await knex.schema.createTable("deposits", (table) => {
        table.engine("InnoDB");
        table.specificType("deposit_id", "char(36)").notNullable().primary();
        table.specificType("booking_id", "char(36)").notNullable().unique("uq_deposits_booking");
        table.specificType("customer_user_id", "char(36)").notNullable().index("idx_deposits_customer");
        table.bigInteger("amount").unsigned().notNullable();
        table.specificType("currency", "char(3)").notNullable().defaultTo("THB");
        table.enu("status", ["PAID", "APPLIED", "REFUNDED", "FORFEITED"]).notNullable().defaultTo("PAID");
        table.string("payment_method", 30).notNullable();
        table.string("reference_number", 100).nullable();
        table.specificType("work_order_id", "char(36)").nullable().index("idx_deposits_work_order");
        table.datetime("paid_at", { precision: 3 }).notNullable();
        table.datetime("settled_at", { precision: 3 }).nullable();
        table.datetime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("CURRENT_TIMESTAMP(3)"));
        table.datetime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("CURRENT_TIMESTAMP(3)"));
    });
};

exports.down = async function down(knex) {
    await knex.schema.dropTableIfExists("deposits");
};
