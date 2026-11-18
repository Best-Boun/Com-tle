
require("dotenv").config({ path: require("node:path").resolve(__dirname, ".env") });
const jwt = require("jsonwebtoken");
const db = require("./src/config/database");
const { createApp } = require("./src/app");
const { createWorkOrderRepository } = require("./src/repositories/workOrderRepository");
const { createWorkOrderService } = require("./src/services/workOrderService");
const { loadWorkflowConfig } = require("./src/config/workflowConfig");
const { createNotificationRepository } = require("./src/repositories/notificationRepository");
const { createNotificationService } = require("./src/services/notificationService");
const { createMailer } = require("./src/services/mailer");
const {
    loadServiceJwtConfig,
    createAuthenticate
} = require("../shared/middleware/serviceAuth");
const AppError = require("../shared/errors/AppError");

const PORT = process.env.PORT || 3004;
const jwtConfig = loadServiceJwtConfig(process.env, { baseDir: __dirname });
const paymentServiceUrl = (process.env.PAYMENT_SERVICE_URL || "http://localhost:3006")
    .replace(/\/$/, "");

const userServiceUrl = (process.env.USER_SERVICE_URL || "http://localhost:3001")
    .replace(/\/$/, "");

// Calls another service with the caller's own token, so that service still
// checks the caller's permissions. Returns { status, data }.
async function callService(url, authorization, { method = "GET", body } = {}) {
    if (!authorization) {
        throw new AppError("Authentication required", 401);
    }
    let response;
    try {
        response = await fetch(url, {
            method,
            headers: {
                authorization,
                accept: "application/json",
                ...(body ? { "content-type": "application/json" } : {})
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(3000)
        });
    } catch (error) {
        const unavailable = new AppError(`${new URL(url).host} is unavailable`, 503);
        unavailable.cause = error;
        throw unavailable;
    }
    const payload = await response.json().catch(() => null);
    return { response, payload, data: payload?.data };
}

function serviceError(response, payload, fallback) {
    return new AppError(
        payload?.message || fallback,
        response.status >= 500 ? 503 : response.status
    );
}

async function getPaymentBalance(workOrderId, authorization) {
    const { response, payload, data } = await callService(
        `${paymentServiceUrl}/balances/${encodeURIComponent(workOrderId)}`,
        authorization
    );
    if (response.status === 404) {
        throw new AppError("No issued bill for this work order", 409);
    }
    if (!response.ok || payload?.success === false) {
        throw serviceError(response, payload, "Payment balance could not be verified");
    }
    return data;
}

const payment = {
    async getBalance(workOrderId, authorization) {
        const { response, payload, data } = await callService(
            `${paymentServiceUrl}/balances/${encodeURIComponent(workOrderId)}`,
            authorization
        );
        if (response.status === 404) {
            return null;
        }
        if (!response.ok || payload?.success === false) {
            throw serviceError(response, payload, "Payment balance could not be verified");
        }
        return data;
    },
    async registerBill(bill, authorization) {
        const { response, payload, data } = await callService(
            `${paymentServiceUrl}/bills`,
            authorization,
            { method: "POST", body: bill }
        );
        if (!response.ok || payload?.success === false) {
            throw serviceError(response, payload, "The bill could not be registered");
        }
        return data;
    }
};

// Work orders from a registered customer carry their user_id; the bill must
// name their User-Service customer_id.
async function resolveCustomerId(userId, authorization) {
    const { response, payload, data } = await callService(
        `${userServiceUrl}/admin/users/${encodeURIComponent(userId)}`,
        authorization
    );
    if (!response.ok || payload?.success === false) {
        throw serviceError(response, payload, "Unable to resolve the registered customer for billing");
    }
    if (!data?.customer?.customer_id) {
        throw new AppError("Unable to resolve the registered customer for billing", 502);
    }
    return data.customer.customer_id;
}

// The customer's email for notification emails (customer contact first,
// then the account email). Read with the check-in admin's token.
async function resolveCustomerEmail(userId, authorization) {
    const { response, data } = await callService(
        `${userServiceUrl}/admin/users/${encodeURIComponent(userId)}`,
        authorization
    );
    if (!response.ok) {
        return null;
    }
    return data?.customer?.email || data?.email || null;
}

const rules = loadWorkflowConfig();
const notificationService = createNotificationService({
    notificationRepository: createNotificationRepository(db),
    mailer: createMailer(process.env),
    rules,
    webBaseUrl: process.env.WEB_BASE_URL || null
});

const app = createApp({
    workOrderService: createWorkOrderService({
        workOrderRepository: createWorkOrderRepository(db),
        getPaymentBalance,
        payment,
        resolveCustomerId,
        resolveCustomerEmail,
        notifications: notificationService,
        rules
    }),
    notificationService,
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
