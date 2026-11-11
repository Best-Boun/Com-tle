const { SLOT_OCCUPYING_STATUSES } = require("../constants");

const BOOKING_COLUMNS = [
    "booking_id",
    "booking_number",
    "customer_id",
    "service_id",
    "service_code",
    "service_name",
    "service_starting_price",
    "service_currency",
    "device_type",
    "brand",
    "model",
    "serial_number",
    "reported_symptom",
    "scheduled_at",
    "status",
    "work_order_id",
    "cancelled_at",
    "cancelled_by",
    "cancellation_reason",
    "created_at",
    "updated_at"
];

const SLOT_LOCK_TIMEOUT_SECONDS = 10;

function toBooking(row) {
    if (!row) return null;
    return { ...row, service_starting_price: Number(row.service_starting_price) };
}

/**
 * Data access for booking_db (team schema). Methods take an optional `trx`.
 */
function createBookingRepository(db) {
    if (!db) {
        throw new Error("Database is required");
    }

    const q = (trx, table) => (trx || db)(table);

    function applyFilters(query, { customerId, status, from, to }) {
        if (customerId) query.where("customer_id", customerId);
        if (status) query.where("status", status);
        if (from) query.where("scheduled_at", ">=", from);
        if (to) query.where("scheduled_at", "<", to);
        return query;
    }

    return {
        transaction(work) {
            return db.transaction(work);
        },

        /**
         * Run `work(trx)` in a transaction while holding a MySQL named lock for
         * the slot, so two requests cannot both take the last place in a slot.
         * (Named locks need no extra table.)
         *
         * Lock, transaction and unlock all run on ONE pooled connection, and the
         * lock is released only AFTER COMMIT — releasing it before commit would
         * let the next request count before this insert is visible.
         */
        async withSlotLock(slotKey, work) {
            const lockName = `booking_slot:${slotKey}`;
            const connection = await db.client.acquireConnection();
            const exec = (sql, params = []) => new Promise((resolve, reject) => {
                connection.query(sql, params, (error, rows) => (error ? reject(error) : resolve(rows)));
            });
            // Query builder bound to this connection, used like a knex trx: trx("table")
            const trx = (table) => db(table).connection(connection);

            let locked = false;
            try {
                const [row] = await exec("SELECT GET_LOCK(?, ?) AS acquired", [lockName, SLOT_LOCK_TIMEOUT_SECONDS]);
                if (Number(row.acquired) !== 1) {
                    const error = new Error("Could not lock booking slot");
                    error.code = "SLOT_LOCK_TIMEOUT";
                    throw error;
                }
                locked = true;

                await exec("START TRANSACTION");
                let result;
                try {
                    result = await work(trx);
                    await exec("COMMIT");
                } catch (error) {
                    await exec("ROLLBACK").catch(() => {});
                    throw error;
                }
                return result;
            } finally {
                if (locked) {
                    await exec("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => {});
                }
                await db.client.releaseConnection(connection);
            }
        },

        async countActiveAt(trx, scheduledAt) {
            const [{ total }] = await q(trx, "bookings")
                .where("scheduled_at", scheduledAt)
                .whereIn("status", SLOT_OCCUPYING_STATUSES)
                .count({ total: "*" });
            return Number(total);
        },

        /** Active bookings between [from, to), returned as their scheduled_at values. */
        async listActiveTimes(from, to) {
            const rows = await q(null, "bookings")
                .select("scheduled_at")
                .where("scheduled_at", ">=", from)
                .where("scheduled_at", "<", to)
                .whereIn("status", SLOT_OCCUPYING_STATUSES);
            return rows.map((r) => new Date(r.scheduled_at));
        },

        async insertBooking(trx, booking) {
            await q(trx, "bookings").insert(booking);
        },

        async insertHistory(trx, entry) {
            await q(trx, "booking_status_history").insert(entry);
        },

        async findById(bookingId, trx = null) {
            const row = await q(trx, "bookings").select(BOOKING_COLUMNS).where({ booking_id: bookingId }).first();
            return toBooking(row);
        },

        async findHistory(bookingId) {
            return q(null, "booking_status_history")
                .select("history_id", "old_status", "new_status", "changed_by", "reason", "created_at")
                .where({ booking_id: bookingId })
                .orderBy("created_at");
        },

        async list(filters, { limit, offset }) {
            const rows = await applyFilters(q(null, "bookings").select(BOOKING_COLUMNS), filters)
                .orderBy([{ column: "scheduled_at", order: "desc" }, { column: "created_at", order: "desc" }])
                .limit(limit)
                .offset(offset);
            const [{ total }] = await applyFilters(q(null, "bookings"), filters).count({ total: "*" });
            return { items: rows.map(toBooking), total: Number(total) };
        },

        /**
         * Change status only if the booking is still in `fromStatus`.
         * Returns false when someone else changed it first.
         */
        async updateStatus(trx, bookingId, fromStatus, changes) {
            const affected = await q(trx, "bookings")
                .where({ booking_id: bookingId, status: fromStatus })
                .update({ ...changes, updated_at: new Date() });
            return affected === 1;
        }
    };
}

module.exports = {
    createBookingRepository
};
