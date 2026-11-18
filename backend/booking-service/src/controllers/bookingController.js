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
        options: handle(async (req, res) => {
            res.status(200).json(successResponse("Request options retrieved", bookingService.getOptions()));
        }),

        create: handle(async (req, res) => {
            const booking = await bookingService.createBooking(req.body, req.user, context(req));
            res.status(201).json(successResponse("Repair request created", booking));
        }),

        listMine: handle(async (req, res) => {
            const { items, meta } = await bookingService.listMyBookings(req.query, req.user);
            res.status(200).json(successResponse("Repair requests retrieved", items, meta));
        }),

        listAll: handle(async (req, res) => {
            const { items, meta } = await bookingService.listBookings(req.query, req.user);
            res.status(200).json(successResponse("Repair requests retrieved", items, meta));
        }),

        get: handle(async (req, res) => {
            const booking = await bookingService.getBooking(req.params.bookingId, req.user);
            res.status(200).json(successResponse("Repair request retrieved", booking));
        }),

        cancel: handle(async (req, res) => {
            const booking = await bookingService.cancelBooking(req.params.bookingId, req.body, req.user);
            res.status(200).json(successResponse("Repair request cancelled", booking));
        }),

        checkIn: handle(async (req, res) => {
            const booking = await bookingService.checkIn(
                req.params.bookingId,
                req.user,
                context(req),
                req.body || {}
            );
            res.status(200).json(successResponse("Device received, work order created", booking));
        })
    };
}

module.exports = {
    createBookingController
};
