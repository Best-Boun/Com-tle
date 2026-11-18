const { OPEN_STATUSES } = require("../constants");

const BOOKING_COLUMNS = [
    "booking_id",
    "booking_number",
    "customer_id",
    "contact_name",
    "contact_phone",
    "service_id",
    "service_code",
    "service_name",
    "service_starting_price",
    "service_currency",
    "device_type",
    "brand",
    "model",
    "serial_number",
    "symptom_group",
    "reported_symptom",
    "scheduled_at",
    "status",
    "work_order_id",
    "technician_id",
    "cancelled_at",
    "cancelled_by",
    "cancellation_reason",
    "created_at",
    "updated_at"
];

function toBooking(row) {
    if (!row) return null;
    return { ...row, service_starting_price: Number(row.service_starting_price) };
}

function escapeLike(value) {
    return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Data access for booking_db, which now holds repair requests.
 * Methods take an optional `trx`.
 */
function createBookingRepository(db) {
    if (!db) {
        throw new Error("Database is required");
    }

    const q = (trx, table) => (trx || db)(table);

    /**
     * search: a request number (RQ-... or an old BK-...) matches from the start;
     * anything else is treated as part of a phone number (digits only).
     */
    function applyFilters(query, { customerId, status, from, to, search }) {
        if (customerId) query.where("customer_id", customerId);
        if (status) query.where("status", status);
        if (from) query.where("created_at", ">=", from);
        if (to) query.where("created_at", "<", to);
        if (search) {
            const text = search.trim().toUpperCase();
            if (/^(RQ|BK)-/.test(text)) {
                query.where("booking_number", "like", `${escapeLike(text)}%`);
            } else {
                const digits = text.replace(/\D/g, "");
                if (digits) {
                    query.where("contact_phone", "like", `%${escapeLike(digits)}%`);
                } else {
                    // Nothing to match on: return no rows rather than everything.
                    query.whereRaw("1 = 0");
                }
            }
        }
        return query;
    }

    return {
        transaction(work) {
            return db.transaction(work);
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
                .orderBy([{ column: "created_at", order: "desc" }, { column: "booking_id", order: "asc" }])
                .limit(limit)
                .offset(offset);
            const [{ total }] = await applyFilters(q(null, "bookings"), filters).count({ total: "*" });
            return { items: rows.map(toBooking), total: Number(total) };
        },

        /** How many requests the customer still has open. */
        async countOpenByCustomer(customerId) {
            const [{ total }] = await q(null, "bookings")
                .where({ customer_id: customerId })
                .whereIn("status", OPEN_STATUSES)
                .count({ total: "*" });
            return Number(total);
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
