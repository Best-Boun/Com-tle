/**
 * Booking statuses (team schema):
 *   PENDING   – waiting for the shop (older bookings only: new bookings are
 *               confirmed straight away, because slot capacity is already checked)
 *   CONFIRMED – the appointment is booked
 *   COMPLETED – customer arrived, Work Order created in Repair Service
 *   CANCELLED – cancelled by the customer before the appointment, or by the shop
 *   NO_SHOW   – the customer did not come; the shop marks it after the
 *               appointment time, so it can be counted per customer
 */
const BOOKING_STATUS = Object.freeze({
    PENDING: "PENDING",
    CONFIRMED: "CONFIRMED",
    CANCELLED: "CANCELLED",
    COMPLETED: "COMPLETED",
    NO_SHOW: "NO_SHOW"
});

// Statuses that still occupy an appointment slot.
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
    [BOOKING_STATUS.PENDING]: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.CANCELLED, BOOKING_STATUS.NO_SHOW],
    [BOOKING_STATUS.CONFIRMED]: [BOOKING_STATUS.COMPLETED, BOOKING_STATUS.CANCELLED, BOOKING_STATUS.NO_SHOW],
    [BOOKING_STATUS.COMPLETED]: [],
    [BOOKING_STATUS.CANCELLED]: [],
    [BOOKING_STATUS.NO_SHOW]: []
});

module.exports = {
    BOOKING_STATUS,
    SLOT_OCCUPYING_STATUSES,
    OPEN_STATUSES,
    ALLOWED_TRANSITIONS
};
