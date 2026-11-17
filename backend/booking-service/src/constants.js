/**
 * Booking statuses (team schema):
 *   AWAITING_DEPOSIT – slot held for a few minutes while the customer pays the
 *                      deposit; not a booking yet. Unpaid holds expire and
 *                      become CANCELLED.
 *   PENDING          – waiting for the shop (older bookings only)
 *   CONFIRMED        – deposit paid, the appointment is booked
 *   COMPLETED        – customer arrived, Work Order created in Repair Service
 *   CANCELLED        – cancelled by the customer before the appointment, by
 *                      the shop, or an unpaid hold that ran out
 *   NO_SHOW          – the customer did not come; the shop marks it after the
 *                      appointment time, so it can be counted per customer
 */
const BOOKING_STATUS = Object.freeze({
    AWAITING_DEPOSIT: "AWAITING_DEPOSIT",
    PENDING: "PENDING",
    CONFIRMED: "CONFIRMED",
    CANCELLED: "CANCELLED",
    COMPLETED: "COMPLETED",
    NO_SHOW: "NO_SHOW"
});

// Statuses that occupy an appointment slot. A live AWAITING_DEPOSIT hold
// (deposit_due_at still in the future) also occupies it; see the repository.
const SLOT_OCCUPYING_STATUSES = Object.freeze([
    BOOKING_STATUS.PENDING,
    BOOKING_STATUS.CONFIRMED,
    BOOKING_STATUS.COMPLETED
]);

// Bookings a technician can still take, and that show in the upcoming queue.
const OPEN_STATUSES = Object.freeze([
    BOOKING_STATUS.PENDING,
    BOOKING_STATUS.CONFIRMED
]);

// COMPLETED, CANCELLED and NO_SHOW are final.
const ALLOWED_TRANSITIONS = Object.freeze({
    [BOOKING_STATUS.AWAITING_DEPOSIT]: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.CANCELLED],
    [BOOKING_STATUS.PENDING]: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.CANCELLED, BOOKING_STATUS.NO_SHOW],
    [BOOKING_STATUS.CONFIRMED]: [BOOKING_STATUS.COMPLETED, BOOKING_STATUS.CANCELLED, BOOKING_STATUS.NO_SHOW],
    [BOOKING_STATUS.COMPLETED]: [],
    [BOOKING_STATUS.CANCELLED]: [],
    [BOOKING_STATUS.NO_SHOW]: []
});

// Recorded as the cancellation reason of a hold whose deposit was never paid.
const DEPOSIT_TIMEOUT_REASON = "Deposit not paid in time";

module.exports = {
    BOOKING_STATUS,
    SLOT_OCCUPYING_STATUSES,
    OPEN_STATUSES,
    ALLOWED_TRANSITIONS,
    DEPOSIT_TIMEOUT_REASON
};
