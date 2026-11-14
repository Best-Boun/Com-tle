const express = require("express");
const helmet = require("helmet");
const {
    notFoundHandler,
    errorHandler
} = require("../../shared/middleware/errorMiddleware");

function createHealthHandler(db) {
    return async function healthHandler(req, res) {
        try {
            await db.raw("SELECT 1");

            res.status(200).json({
                success: true,
                service: "payment-service",
                status: "running",
                database: "connected"
            });
        } catch (error) {
            console.error("Database health check failed:", error.message);

            res.status(503).json({
                success: false,
                service: "payment-service",
                status: "running",
                database: "disconnected"
            });
        }
    };
}

function createApplication({ db } = {}) {
    if (!db || typeof db.raw !== "function") {
        throw new Error("Payment-Service database handle is required");
    }

    const app = express();
    app.use(helmet());
    app.use(express.json());

    app.get("/health", createHealthHandler(db));

    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
}

module.exports = {
    createApplication,
    createHealthHandler
};
