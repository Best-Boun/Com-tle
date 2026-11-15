
const path = require("node:path");
const dotenv = require("dotenv");
const { createApplication } = require("./src/app");
const { createSecurityRuntime } = require("./src/securityRuntime");
const { createPaymentService } = require("./src/services/paymentService");
const { createPaymentRouter } = require("./src/routes/paymentRoutes");

const AppError = require("../shared/errors/AppError");

// Reads a work order from Repair-Service with the caller's own token, so
// Repair-Service decides whether the caller may see it.
function createWorkOrderLoader(baseUrl) {
    const root = baseUrl.replace(/\/$/, "");
    return async function loadWorkOrder(workOrderId, authorization) {
        if (!authorization) {
            throw new AppError("Authentication required", 401);
        }
        let response;
        try {
            response = await fetch(`${root}/work-orders/${encodeURIComponent(workOrderId)}`, {
                headers: { authorization, accept: "application/json" },
                signal: AbortSignal.timeout(5000)
            });
        } catch {
            throw new AppError("Repair Service is unavailable", 503);
        }
        const payload = await response.json().catch(() => null);
        if (response.status === 404 || response.status === 403) {
            throw new AppError("Work order not found", 404);
        }
        if (!response.ok || payload?.success === false) {
            throw new AppError("Repair Service is unavailable", 503);
        }
        return payload?.data || null;
    };
}

function startServer({ env = process.env, database } = {}) {
    if (env === process.env) {
        dotenv.config({ path: path.resolve(__dirname, ".env") });
    }

    const db = database || require("./src/config/database");
    const securityRuntime = createSecurityRuntime({ env });
    const adapter = securityRuntime.userAuthorizationAdapter;
    const paymentService = createPaymentService({
        db,
        requestPermission: adapter.requestPermission,
        requestCustomerId: adapter.requestCustomerId,
        loadWorkOrder: createWorkOrderLoader(env.PAYMENT_REPAIR_SERVICE_URL || "http://localhost:3004")
    });
    const paymentRouter = createPaymentRouter({
        paymentService,
        requireUserAuth: adapter.requireUserAuth
    });
    const app = createApplication({ db, paymentRouter });
    const port = env.PORT || 3006;
    const server = app.listen(port, () => {
        console.log(`Payment Service running on port ${port}`);
    });
    let shutdownStarted = false;

    async function shutdown() {
        if (shutdownStarted) {
            return;
        }
        shutdownStarted = true;
        console.log("Shutting down Payment Service...");

        server.close(async () => {
            await db.destroy();
            console.log("Payment Service stopped.");
            process.exit(0);
        });
    }

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    return Object.freeze({
        app,
        server,
        securityRuntime,
        shutdown
    });
}

if (require.main === module) {
    startServer();
}

module.exports = {
    startServer
};
