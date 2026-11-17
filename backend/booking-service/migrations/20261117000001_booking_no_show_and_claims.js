/**
 * Booking flow update (additive):
 * - status NO_SHOW on bookings and booking_status_history, so the shop can
 *   record a customer who did not come (separately from a cancellation)
 * - technician_id / technician_claimed_at on bookings: a technician takes an
 *   upcoming booking before the customer arrives; check-in then assigns the
 *   new work order to that technician.
 * No existing column or row is removed.
 */
const OLD_STATUSES = ["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED"];
const NEW_STATUSES = [...OLD_STATUSES, "NO_SHOW"];

exports.up = async function up(knex) {
    await knex.schema.alterTable("bookings", (table) => {
        table.enu("status", NEW_STATUSES).notNullable().defaultTo("PENDING").alter();
        table.specificType("technician_id", "char(36)").nullable().index();
        table.datetime("technician_claimed_at", { precision: 3 }).nullable();
    });
    await knex.schema.alterTable("booking_status_history", (table) => {
        table.enu("old_status", NEW_STATUSES).nullable().alter();
        table.enu("new_status", NEW_STATUSES).notNullable().alter();
    });
};

exports.down = async function down(knex) {
    // NO_SHOW does not exist in the old schema: keep those rows as cancellations.
    await knex("bookings").where({ status: "NO_SHOW" }).update({ status: "CANCELLED" });
    await knex("booking_status_history").where({ old_status: "NO_SHOW" }).update({ old_status: "CANCELLED" });
    await knex("booking_status_history").where({ new_status: "NO_SHOW" }).update({ new_status: "CANCELLED" });
    await knex.schema.alterTable("booking_status_history", (table) => {
        table.enu("old_status", OLD_STATUSES).nullable().alter();
        table.enu("new_status", OLD_STATUSES).notNullable().alter();
    });
    await knex.schema.alterTable("bookings", (table) => {
        table.dropIndex(["technician_id"]);
        table.dropColumn("technician_claimed_at");
        table.dropColumn("technician_id");
        table.enu("status", OLD_STATUSES).notNullable().defaultTo("PENDING").alter();
    });
};
