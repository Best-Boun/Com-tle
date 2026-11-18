/**
 * Deposit before booking (additive):
 * - status AWAITING_DEPOSIT on bookings and booking_status_history: the slot is
 *   held while the customer pays the deposit
 * - deposit_due_at on bookings: when that hold runs out
 * No existing column or row is removed.
 */
const OLD_STATUSES = ["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"];
const NEW_STATUSES = [...OLD_STATUSES, "AWAITING_DEPOSIT"];

exports.up = async function up(knex) {
    await knex.schema.alterTable("bookings", (table) => {
        table.enu("status", NEW_STATUSES).notNullable().defaultTo("PENDING").alter();
        table.datetime("deposit_due_at", { precision: 3 }).nullable();
    });
    await knex.schema.alterTable("booking_status_history", (table) => {
        table.enu("old_status", NEW_STATUSES).nullable().alter();
        table.enu("new_status", NEW_STATUSES).notNullable().alter();
    });
};

exports.down = async function down(knex) {
    // AWAITING_DEPOSIT does not exist in the old schema: unpaid holds become cancellations.
    await knex("bookings").where({ status: "AWAITING_DEPOSIT" }).update({ status: "CANCELLED" });
    await knex("booking_status_history").where({ old_status: "AWAITING_DEPOSIT" }).update({ old_status: "CANCELLED" });
    await knex("booking_status_history").where({ new_status: "AWAITING_DEPOSIT" }).update({ new_status: "CANCELLED" });
    await knex.schema.alterTable("booking_status_history", (table) => {
        table.enu("old_status", OLD_STATUSES).nullable().alter();
        table.enu("new_status", OLD_STATUSES).notNullable().alter();
    });
    await knex.schema.alterTable("bookings", (table) => {
        table.dropColumn("deposit_due_at");
        table.enu("status", OLD_STATUSES).notNullable().defaultTo("PENDING").alter();
    });
};
