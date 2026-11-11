/**
 * Booking schema — the team's original booking_db design
 *   (bookings, booking_status_history)
 * plus additive columns on bookings: booking_number and the service snapshot
 * (service_code, service_name, service_starting_price, service_currency).
 * No original column was changed or removed.
 *
 * - customer_id refers to User Service (JWT `sub`); no account data is copied.
 * - scheduled_at is stored in UTC (DATETIME(3)).
 * - work_order_id is unique: 1 Booking = at most 1 Work Order.
 * - Bookings are never deleted; every status change goes to booking_status_history.
 */
const BOOKING_STATUSES = ["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED"];

exports.up = async function up(knex) {
    const now3 = knex.raw("CURRENT_TIMESTAMP(3)");

    await knex.schema.createTable("bookings", (table) => {
        table.specificType("booking_id", "char(36)").notNullable().primary();
        // Added to the team schema: human-friendly reference, e.g. BK-20261120-FAK643
        table.string("booking_number", 30).notNullable().unique();
        table.specificType("customer_id", "char(36)").notNullable().index();
        table.specificType("service_id", "char(36)").notNullable().index();
        // Added to the team schema: snapshot of the Catalog service at booking time,
        // so later catalog name/price changes do not rewrite past bookings.
        table.string("service_code", 50).notNullable();
        table.string("service_name", 150).notNullable();
        table.bigInteger("service_starting_price").unsigned().notNullable();
        table.specificType("service_currency", "char(3)").notNullable().defaultTo("THB");
        table.string("device_type", 100).notNullable();
        table.string("brand", 100).nullable();
        table.string("model", 150).nullable();
        table.string("serial_number", 150).nullable();
        table.text("reported_symptom").notNullable();
        table.datetime("scheduled_at", { precision: 3 }).notNullable().index();
        table.enu("status", BOOKING_STATUSES).notNullable().defaultTo("PENDING").index();
        table.specificType("work_order_id", "char(36)").nullable().unique();
        table.datetime("cancelled_at", { precision: 3 }).nullable();
        table.specificType("cancelled_by", "char(36)").nullable().index();
        table.string("cancellation_reason", 500).nullable();
        table.datetime("created_at", { precision: 3 }).notNullable().defaultTo(now3);
        table.datetime("updated_at", { precision: 3 }).notNullable().defaultTo(now3);
    });

    await knex.schema.createTable("booking_status_history", (table) => {
        table.specificType("history_id", "char(36)").notNullable().primary();
        table.specificType("booking_id", "char(36)").notNullable()
            .references("booking_id").inTable("bookings").onDelete("RESTRICT");
        table.enu("old_status", BOOKING_STATUSES).nullable();
        table.enu("new_status", BOOKING_STATUSES).notNullable();
        table.specificType("changed_by", "char(36)").nullable().index();
        table.string("reason", 500).nullable();
        table.datetime("created_at", { precision: 3 }).notNullable().defaultTo(now3);
    });
};

exports.down = async function down(knex) {
    await knex.schema.dropTableIfExists("booking_status_history");
    await knex.schema.dropTableIfExists("bookings");
};
