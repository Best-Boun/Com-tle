require("dotenv").config({ path: require("node:path").resolve(__dirname, ".env") });
const jwt = require("jsonwebtoken");
const db = require("./src/config/database");
const { createApp } = require("./src/app");
const { createServiceRepository } = require("./src/repositories/serviceRepository");
const { createCatalogService } = require("./src/services/catalogService");
const {
    loadServiceJwtConfig,
    createAuthenticate
} = require("../shared/middleware/serviceAuth");

const PORT = process.env.PORT || 3003;
const jwtConfig = loadServiceJwtConfig(process.env, { baseDir: __dirname });

const app = createApp({
    catalogService: createCatalogService({
        serviceRepository: createServiceRepository(db)
    }),
    authenticate: createAuthenticate({ jwt, ...jwtConfig }),
    healthCheck: () => db.raw("SELECT 1")
});

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
