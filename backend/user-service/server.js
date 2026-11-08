const express = require("express");
const helmet = require("helmet");
require("dotenv").config();
const db = require("./src/config/database");
const { loadJwtConfig } = require("./src/config/jwt");
const createAuthRouter = require("./src/routes/authRoutes");
const {
    notFoundHandler,
    errorHandler
} = require("../shared/middleware/errorMiddleware");

const app = express();
const PORT = process.env.PORT || 3001;
const jwtConfig = loadJwtConfig();

// Middleware
app.use(helmet());
app.use(express.json());

app.use("/auth", createAuthRouter({ db, jwtConfig }));

// Health Check API
app.get("/health", async (req, res) => {
    try {
        await db.raw("SELECT 1");

        res.status(200).json({
            success: true,
            service: "user-service",
            status: "running",
            database: "connected"
        });

    } catch (error) {
        console.error("Database health check failed:", error.message);

        res.status(503).json({
            success: false,
            service: "user-service",
            status: "running",
            database: "disconnected"
        });
    }
});

app.use(notFoundHandler);
app.use(errorHandler);

// Start Server
const server = app.listen(PORT, () => {
    console.log(`User Service running on port ${PORT}`);
});

// Graceful Shutdown
async function shutdown() {
    console.log("Shutting down User Service...");

    server.close(async () => {
        await db.destroy();
        console.log("User Service stopped.");
        process.exit(0);
    });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
