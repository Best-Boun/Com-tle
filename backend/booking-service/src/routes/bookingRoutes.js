const express = require("express");
const { PERMISSIONS } = require("../../../shared/constants");
const { requireAnyPermission } = require("../../../shared/middleware/serviceAuth");
const { createBookingController } = require("../controllers/bookingController");

const { BOOKING_CREATE, BOOKING_VIEW_OWN, BOOKING_MANAGE } = PERMISSIONS;

/**
 * Repair requests. Paths keep the /bookings prefix at the gateway, so existing
 * links and the Repair contract (booking_id) stay the same.
 */
function createBookingRouter({ bookingService, authenticate }) {
    if (!bookingService || typeof authenticate !== "function") {
        throw new Error("Booking service and authenticate middleware are required");
    }

    const router = express.Router();
    const c = createBookingController(bookingService);

    router.use(authenticate);

    // Fixed paths first, so they are not captured by "/:bookingId".
    router.get("/options", requireAnyPermission(BOOKING_CREATE, BOOKING_MANAGE), c.options);
    router.get("/me", requireAnyPermission(BOOKING_VIEW_OWN), c.listMine);

    // ?search= request number (RQ-...) or phone, for the counter.
    router.get("/", requireAnyPermission(BOOKING_MANAGE), c.listAll);
    router.post("/", requireAnyPermission(BOOKING_CREATE), c.create);

    router.get("/:bookingId", requireAnyPermission(BOOKING_VIEW_OWN, BOOKING_MANAGE), c.get);
    router.patch("/:bookingId/cancel", requireAnyPermission(BOOKING_CREATE, BOOKING_MANAGE), c.cancel);
    router.post("/:bookingId/check-in", requireAnyPermission(BOOKING_MANAGE), c.checkIn);

    return router;
}

module.exports = createBookingRouter;
