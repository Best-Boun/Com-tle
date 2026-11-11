const express = require("express");
const helmet = require("helmet");
const createCatalogRouter = require("./routes/catalogRoutes");
const {
    notFoundHandler,
    errorHandler
} = require("../../shared/middleware/errorMiddleware");

function createApp({ catalogService, authenticate, healthCheck }) {
    const app = express();

    app.use(helmet());
    app.use(express.json({ limit: "100kb" }));

    app.get("/health", async (req, res) => {
        try {
            await healthCheck();
            res.status(200).json({
                success: true,
                service: "catalog-service",
                status: "running",
                database: "connected"
            });
        } catch (error) {
            console.error("Database health check failed:", error.message);
            res.status(503).json({
                success: false,
                service: "catalog-service",
                status: "running",
                database: "disconnected"
            });
        }
    });

    app.use("/", createCatalogRouter({ catalogService, authenticate }));

    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
}

module.exports = {
    createApp
};
