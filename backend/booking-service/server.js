require("dotenv").config({ path: require("node:path").resolve(__dirname, ".env") });
const jwt = require("jsonwebtoken");
const db = require("./src/config/database");
const { createApp } = require("./src/app");
const { loadBookingConfig } = require("./src/config/bookingConfig");
const { createBookingRepository } = require("./src/repositories/bookingRepository");
const { createBookingService } = require("./src/services/bookingService");
const {
    createCatalogClient,
    createRepairClient
} = require("./src/clients/serviceClients");
const {
    loadServiceJwtConfig,
    createAuthenticate
} = require("../shared/middleware/serviceAuth");

const PORT = process.env.PORT || 3002;
const config = loadBookingConfig(process.env);
const jwtConfig = loadServiceJwtConfig(process.env, { baseDir: __dirname });

const bookingService = createBookingService({
    bookingRepository: createBookingRepository(db),
    catalogClient: createCatalogClient({
        baseUrl: config.catalogServiceUrl,
        timeoutMs: config.serviceCallTimeoutMs
    }),
    repairClient: createRepairClient({
        baseUrl: config.repairServiceUrl,
        timeoutMs: config.serviceCallTimeoutMs
    }),
    config
});

const app = createApp({
    bookingService,
    authenticate: createAuthenticate({ jwt, ...jwtConfig }),
    healthCheck: () => db.raw("SELECT 1")
});

const server = app.listen(PORT, () => {
    console.log(`Booking Service running on port ${PORT}`);
});

// Task 2: close requests nobody brought in within REQUEST_EXPIRY_DAYS.
// Runs once shortly after start, then every REQUEST_EXPIRY_CHECK_MINUTES.
async function expireStaleRequests() {
    try {
        const closed = await bookingService.expireStaleRequests();
        if (closed > 0) console.log(`Closed ${closed} expired repair request(s)`);
    } catch (error) {
        // The database may be unreachable for a while; try again next round.
        console.error("Expiring old repair requests failed:", error.message);
    }
}
const expiryTimer = setInterval(expireStaleRequests, config.expiryCheckMinutes * 60 * 1000);
expiryTimer.unref();
setTimeout(expireStaleRequests, 10 * 1000).unref();

async function shutdown() {
    console.log("Shutting down Booking Service...");
    clearInterval(expiryTimer);

    server.close(async () => {
        await db.destroy();
        console.log("Booking Service stopped.");
        process.exit(0);
    });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
