const { successResponse } = require("../../../shared/utils/responseFormatter");

function handle(fn) {
    return async (req, res, next) => {
        try {
            await fn(req, res);
        } catch (error) {
            next(error);
        }
    };
}

function createBookingController(bookingService) {
    const context = (req) => ({ authorization: req.headers.authorization });

    return {
        availability: handle(async (req, res) => {
            const result = await bookingService.getAvailability(req.query, req.user);
            res.status(200).json(successResponse("Availability retrieved", result));
        }),

        create: handle(async (req, res) => {
            const booking = await bookingService.createBooking(req.body, req.user, context(req));
            res.status(201).json(successResponse("Booking created", booking));
        }),

        listMine: handle(async (req, res) => {
            const { items, meta } = await bookingService.listMyBookings(req.query, req.user);
            res.status(200).json(successResponse("Bookings retrieved", items, meta));
        }),

        listAll: handle(async (req, res) => {
            const { items, meta } = await bookingService.listBookings(req.query, req.user);
            res.status(200).json(successResponse("Bookings retrieved", items, meta));
        }),

        get: handle(async (req, res) => {
            const booking = await bookingService.getBooking(req.params.bookingId, req.user);
            res.status(200).json(successResponse("Booking retrieved", booking));
        }),

        confirm: handle(async (req, res) => {
            const booking = await bookingService.confirmBooking(req.params.bookingId, req.user);
            res.status(200).json(successResponse("Booking confirmed", booking));
        }),

        cancel: handle(async (req, res) => {
            const booking = await bookingService.cancelBooking(
                req.params.bookingId,
                req.body,
                req.user
            );
            res.status(200).json(successResponse("Booking cancelled", booking));
        }),

        queue: handle(async (req, res) => {
            const items = await bookingService.listQueue(req.query, req.user);
            res.status(200).json(successResponse("Upcoming bookings retrieved", items));
        }),

        claim: handle(async (req, res) => {
            const booking = await bookingService.claimBooking(req.params.bookingId, req.user);
            res.status(200).json(successResponse("Job taken", booking));
        }),

        release: handle(async (req, res) => {
            const booking = await bookingService.releaseBooking(req.params.bookingId, req.user);
            res.status(200).json(successResponse("Job given back", booking));
        }),

        noShow: handle(async (req, res) => {
            const booking = await bookingService.markNoShow(req.params.bookingId, req.body, req.user);
            res.status(200).json(successResponse("No-show recorded", booking));
        }),

        checkIn: handle(async (req, res) => {
            const booking = await bookingService.checkIn(
                req.params.bookingId,
                req.user,
                context(req),
                req.body || {}
            );
            res.status(200).json(successResponse("Booking completed, work order created", booking));
        })
    };
}

module.exports = {
    createBookingController
};
