const express = require("express");
const helmet = require("helmet");
const createBookingRouter = require("./routes/bookingRoutes");
const {
    notFoundHandler,
    errorHandler
} = require("../../shared/middleware/errorMiddleware");

/**
 * Routes are mounted at the service root because the API Gateway strips its
 * "/api/bookings" prefix before proxying (same as "/api/users" -> "/auth/...").
 */
function createApp({ bookingService, authenticate, healthCheck }) {
    const app = express();

    app.use(helmet());
    app.use(express.json({ limit: "100kb" }));

    app.get("/health", async (req, res) => {
        try {
            await healthCheck();
            res.status(200).json({
                success: true,
                service: "booking-service",
                status: "running",
                database: "connected"
            });
        } catch (error) {
            console.error("Database health check failed:", error.message);
            res.status(503).json({
                success: false,
                service: "booking-service",
                status: "running",
                database: "disconnected"
            });
        }
    });

    app.use("/", createBookingRouter({ bookingService, authenticate }));

    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
}

module.exports = {
    createApp
};
