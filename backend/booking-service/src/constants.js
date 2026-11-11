/**
 * Booking statuses (team schema):
 *   PENDING   – customer booked, waiting for the shop
 *   CONFIRMED – shop accepted the appointment
 *   COMPLETED – customer arrived, Work Order created in Repair Service
 *   CANCELLED – cancelled by customer or shop (also used for no-shows, with a reason)
 */
const BOOKING_STATUS = Object.freeze({
    PENDING: "PENDING",
    CONFIRMED: "CONFIRMED",
    CANCELLED: "CANCELLED",
    COMPLETED: "COMPLETED"
});

// Statuses that still occupy an appointment slot.
const SLOT_OCCUPYING_STATUSES = Object.freeze([
    BOOKING_STATUS.PENDING,
    BOOKING_STATUS.CONFIRMED,
    BOOKING_STATUS.COMPLETED
]);

// COMPLETED and CANCELLED are final.
const ALLOWED_TRANSITIONS = Object.freeze({
    [BOOKING_STATUS.PENDING]: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.CANCELLED],
    [BOOKING_STATUS.CONFIRMED]: [BOOKING_STATUS.COMPLETED, BOOKING_STATUS.CANCELLED],
    [BOOKING_STATUS.COMPLETED]: [],
    [BOOKING_STATUS.CANCELLED]: []
});

module.exports = {
    BOOKING_STATUS,
    SLOT_OCCUPYING_STATUSES,
    ALLOWED_TRANSITIONS
};
