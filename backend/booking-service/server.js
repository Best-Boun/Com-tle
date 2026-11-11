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

const app = createApp({
    bookingService: createBookingService({
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
    }),
    authenticate: createAuthenticate({ jwt, ...jwtConfig }),
    healthCheck: () => db.raw("SELECT 1")
});

const server = app.listen(PORT, () => {
    console.log(`Booking Service running on port ${PORT}`);
});

async function shutdown() {
    console.log("Shutting down Booking Service...");

    server.close(async () => {
        await db.destroy();
        console.log("Booking Service stopped.");
        process.exit(0);
    });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
