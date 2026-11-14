
const path = require("node:path");
const dotenv = require("dotenv");
const { createApplication } = require("./src/app");
const { createSecurityRuntime } = require("./src/securityRuntime");
const { createPaymentService } = require("./src/services/paymentService");
const { createPaymentRouter } = require("./src/routes/paymentRoutes");

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
        requestCustomerId: adapter.requestCustomerId
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
