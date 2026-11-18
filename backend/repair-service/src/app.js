const express = require("express");
const helmet = require("helmet");
const createWorkOrderRouter = require("./routes/workOrderRoutes");
const createNotificationRouter = require("./routes/notificationRoutes");
const {
    notFoundHandler,
    errorHandler
} = require("../../shared/middleware/errorMiddleware");

function createApp({ workOrderService, notificationService = null, authenticate, healthCheck }) {
    const app = express();

    app.use(helmet());
    app.use(express.json({ limit: "100kb" }));

    app.get("/health", async (req, res) => {
        try {
            await healthCheck();
            res.status(200).json({
                success: true,
                service: "repair-service",
                status: "running",
                database: "connected"
            });
        } catch (error) {
            console.error("Database health check failed:", error.message);
            res.status(503).json({
                success: false,
                service: "repair-service",
                status: "running",
                database: "disconnected"
            });
        }
    });

    if (notificationService) {
        app.use("/", createNotificationRouter({ notificationService, authenticate }));
    }
    app.use("/", createWorkOrderRouter({ workOrderService, authenticate }));
    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
}

module.exports = {
    createApp
};