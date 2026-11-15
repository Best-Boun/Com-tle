
require("dotenv").config({ path: require("node:path").resolve(__dirname, ".env") });
const jwt = require("jsonwebtoken");
const db = require("./src/config/database");
const { createApp } = require("./src/app");
const { createWorkOrderRepository } = require("./src/repositories/workOrderRepository");
const { createWorkOrderService } = require("./src/services/workOrderService");
const {
    loadServiceJwtConfig,
    createAuthenticate
} = require("../shared/middleware/serviceAuth");
const AppError = require("../shared/errors/AppError");

const PORT = process.env.PORT || 3004;
const jwtConfig = loadServiceJwtConfig(process.env, { baseDir: __dirname });
const paymentServiceUrl = (process.env.PAYMENT_SERVICE_URL || "http://localhost:3006")
    .replace(/\/$/, "");

async function getPaymentBalance(workOrderId, authorization) {
    if (!authorization) {
        throw new AppError("Authentication required", 401);
    }

    let response;
    try {
        response = await fetch(
            `${paymentServiceUrl}/balances/${encodeURIComponent(workOrderId)}`,
            {
                headers: { authorization, accept: "application/json" },
                signal: AbortSignal.timeout(3000)
            }
        );
    } catch (error) {
        const unavailable = new AppError("Payment Service is unavailable", 503);
        unavailable.cause = error;
        throw unavailable;
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false) {
        const message = payload?.message || "Payment balance could not be verified";
        throw new AppError(
            response.status === 404 ? "No issued bill for this work order" : message,
            response.status === 404 ? 409 : response.status >= 500 ? 503 : response.status
        );
    }
    return payload?.data;
}

const app = createApp({
    workOrderService: createWorkOrderService({
        workOrderRepository: createWorkOrderRepository(db),
        getPaymentBalance
    }),
    authenticate: createAuthenticate({ jwt, ...jwtConfig }),
    healthCheck: () => db.raw("SELECT 1")
});

const server = app.listen(PORT, () => {
    console.log(`Repair Service running on port ${PORT}`);
});

async function shutdown() {
    console.log("Shutting down Repair Service...");
    server.close(async () => {
        await db.destroy();
        console.log("Repair Service stopped.");
        process.exit(0);
    });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
