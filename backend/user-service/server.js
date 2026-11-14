const express = require("express");
const helmet = require("helmet");
require("dotenv").config();
const db = require("./src/config/database");
const { loadJwtConfig } = require("./src/config/jwt");
const { getServerBindHost } = require("./src/config/serverBinding");
const createAuthRouter = require("./src/routes/authRoutes");
const createUsersRouter = require("./src/routes/usersRoutes");
const createAdminUsersRouter = require("./src/routes/adminUsersRoutes");
const createCustomerMergeRouter = require("./src/routes/customerMergeRoutes");
const { createAuthService } = require("./src/services/authService");
const { createPermissionService } = require("./src/services/permissionService");
const { createCustomerMergeService } = require("./src/services/customerMergeService");
const { createCustomerMergeExpiryWorker } = require("./src/services/customerMergeExpiryWorker");
const { loadInternalServiceAuthConfig } = require("./src/config/internalServiceAuth");
const {
    createInternalServiceAuthService
} = require("./src/services/internalServiceAuthService");
const {
    createInternalPermissionService
} = require("./src/services/internalPermissionService");
const {
    createInternalTokenReplayRepository
} = require("./src/services/internalTokenReplayRepository");
const {
    createInternalCustomerIdentityService
} = require("./src/services/internalCustomerIdentityService");
const createInternalRouter = require("./src/routes/internalRoutes");
const {
    notFoundHandler,
    errorHandler
} = require("../shared/middleware/errorMiddleware");

const app = express();
const PORT = process.env.PORT || 3001;
const jwtConfig = loadJwtConfig();
const authService = createAuthService({ db, jwtConfig });
const permissionService = createPermissionService({ db });
const customerMergeService = createCustomerMergeService({ db });
const customerMergeExpiryWorker = process.env.USER_SERVICE_MERGE_EXPIRY_ENABLED === "1"
    ? createCustomerMergeExpiryWorker({ db, customerMergeService })
    : null;

// Middleware
app.use(helmet());

const internalServiceAuthConfig = loadInternalServiceAuthConfig();
if (internalServiceAuthConfig) {
    const internalTokenReplayRepository = createInternalTokenReplayRepository({ db });
    const internalServiceAuthService = createInternalServiceAuthService(
        {
            ...internalServiceAuthConfig,
            consumeJti: internalTokenReplayRepository.consumeJti
        }
    );
    const internalPermissionService = createInternalPermissionService({
        permissionService
    });
    const customerIdentityService = createInternalCustomerIdentityService({
        db,
        verifyUserAccessToken: (token) => {
            const claims = authService.verifyAccessToken(token);
            if (claims.token_use !== "user_access") {
                throw new Error("Invalid User access token");
            }
            return claims;
        }
    });
    app.use("/internal", createInternalRouter({
        internalServiceAuthService,
        internalPermissionService,
        customerIdentityService
    }));
}

app.use(express.json());

app.use("/auth", createAuthRouter({ authService }));
app.use("/users", createUsersRouter({ db, authService, permissionService }));
app.use("/admin/users", createAdminUsersRouter({
    db,
    authService,
    permissionService
}));
app.use("/admin/customer-merge-requests", createCustomerMergeRouter({
    db,
    authService,
    permissionService,
    customerMergeService
}));
if (customerMergeExpiryWorker) {
    customerMergeExpiryWorker.start();
}

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
const bindHost = getServerBindHost();
let server;
server = bindHost
    ? app.listen(PORT, bindHost, () => {
        const address = server.address();
        if (!address
            || typeof address === "string"
            || address.address !== "127.0.0.1") {
            console.error("User-Service HTTP test process did not bind to loopback");
            server.close(() => {
                db.destroy().then(() => {
                    process.exitCode = 1;
                });
            });
            return;
        }
        console.log(`USER_SERVICE_HTTP_TEST_READY ${address.address}:${address.port}`);
    })
    : app.listen(PORT, () => {
        console.log(`User Service running on port ${PORT}`);
    });

// Graceful Shutdown
async function shutdown() {
    console.log("Shutting down User Service...");

    server.close(async () => {
        let failed = false;
        if (customerMergeExpiryWorker) {
            try {
                await customerMergeExpiryWorker.stop();
            } catch {
                failed = true;
                console.error("Customer merge expiry worker could not stop cleanly");
            }
        }
        try {
            await db.destroy();
        } catch {
            failed = true;
            console.error("Database shutdown failed");
        }
        console.log("User Service stopped.");
        process.exit(failed ? 1 : 0);
    });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
