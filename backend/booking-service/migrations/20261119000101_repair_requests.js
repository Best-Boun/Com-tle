/**
 * Bookings become repair requests ("แจ้งซ่อมล่วงหน้า"), additive:
 *
 * - the customer tells the shop which device and what kind of fault
 *   (symptom_group) before bringing it in; there is no appointment time,
 *   so scheduled_at becomes nullable (old bookings keep theirs)
 * - contact_name / contact_phone: who the counter calls, and what staff search
 *   by when the customer arrives (phone is stored as digits only)
 * - status EXPIRED: a request nobody brought in is closed after 30 days
 * - unpaid holds left by the removed deposit feature (AWAITING_DEPOSIT) are
 *   cancelled, with a history row, so no booking stays stuck in that status
 *
 * New numbers are RQ-YYYYMMDD-XXXXXX in booking_number; old BK- numbers stay.
 * No column or row is removed.
 */
const OLD_STATUSES = ["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW", "AWAITING_DEPOSIT"];
const NEW_STATUSES = [...OLD_STATUSES, "EXPIRED"];
const DEPOSIT_REMOVED = "Deposit feature removed";

async function addColumnIfMissing(knex, columnName, addColumn) {
    if (!await knex.schema.hasColumn("bookings", columnName)) {
        await knex.schema.alterTable("bookings", addColumn);
    }
}

exports.up = async function up(knex) {
    await knex.schema.alterTable("bookings", (table) => {
        table.enu("status", NEW_STATUSES).notNullable().defaultTo("PENDING").alter();
        table.datetime("scheduled_at", { precision: 3 }).nullable().alter();
    });
    await knex.schema.alterTable("booking_status_history", (table) => {
        table.enu("old_status", NEW_STATUSES).nullable().alter();
        table.enu("new_status", NEW_STATUSES).notNullable().alter();
    });

    await addColumnIfMissing(knex, "symptom_group", (table) => {
        table.string("symptom_group", 50).nullable();
    });
    await addColumnIfMissing(knex, "contact_name", (table) => {
        table.string("contact_name", 150).nullable();
    });
    await addColumnIfMissing(knex, "contact_phone", (table) => {
        table.string("contact_phone", 20).nullable().index();
    });

    await knex.raw(
        `INSERT INTO booking_status_history
            (history_id, booking_id, old_status, new_status, changed_by, reason, created_at)
         SELECT UUID(), booking_id, 'AWAITING_DEPOSIT', 'CANCELLED', NULL, ?, CURRENT_TIMESTAMP(3)
         FROM bookings WHERE status = 'AWAITING_DEPOSIT'`,
        [DEPOSIT_REMOVED]
    );
    await knex("bookings").where({ status: "AWAITING_DEPOSIT" }).update({
        status: "CANCELLED",
        cancelled_at: knex.raw("CURRENT_TIMESTAMP(3)"),
        cancellation_reason: DEPOSIT_REMOVED,
        updated_at: knex.raw("CURRENT_TIMESTAMP(3)")
    });
};

exports.down = async function down(knex) {
    // EXPIRED does not exist in the old schema; requests without a time get their creation time.
    await knex("bookings").where({ status: "EXPIRED" }).update({ status: "CANCELLED" });
    await knex("booking_status_history").where({ old_status: "EXPIRED" }).update({ old_status: "CANCELLED" });
    await knex("booking_status_history").where({ new_status: "EXPIRED" }).update({ new_status: "CANCELLED" });
    await knex("bookings").whereNull("scheduled_at").update({ scheduled_at: knex.ref("created_at") });

    await knex.schema.alterTable("booking_status_history", (table) => {
        table.enu("old_status", OLD_STATUSES).nullable().alter();
        table.enu("new_status", OLD_STATUSES).notNullable().alter();
    });
    await knex.schema.alterTable("bookings", (table) => {
        table.dropIndex(["contact_phone"]);
        table.dropColumn("contact_phone");
        table.dropColumn("contact_name");
        table.dropColumn("symptom_group");
        table.datetime("scheduled_at", { precision: 3 }).notNullable().alter();
        table.enu("status", OLD_STATUSES).notNullable().defaultTo("PENDING").alter();
    });
};
