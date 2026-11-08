
const express = require("express");
const helmet = require("helmet");
const db = require("./src/config/database");
const {
    notFoundHandler,
    errorHandler
} = require("../shared/middleware/errorMiddleware");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3003;

app.use(helmet());
app.use(express.json());

app.get("/health", async (req, res) => {
    try {
        await db.raw("SELECT 1");

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

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(PORT, () => {
    console.log(`Catalog Service running on port ${PORT}`);
});

async function shutdown() {
    console.log("Shutting down Catalog Service...");

    server.close(async () => {
        await db.destroy();
        console.log("Catalog Service stopped.");
        process.exit(0);
    });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
