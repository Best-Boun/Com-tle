const {
    createProxyMiddleware,
    fixRequestBody
} = require("http-proxy-middleware");

const publicUserRoutes = new Set([
    "POST /auth/register",
    "POST /auth/login",
    "POST /auth/refresh",
    "POST /auth/logout"
]);

const publicUserRoutePatterns = [
    ["GET", /^\/users\/me(?:\/permissions)?$/],
    ["PATCH", /^\/users\/me$/],
    ["GET", /^\/admin\/users(?:\/[^/]+)?$/],
    ["PATCH", /^\/admin\/users\/[^/]+\/status$/],
    ["PUT", /^\/admin\/users\/[^/]+\/roles\/[^/]+$/],
    ["DELETE", /^\/admin\/users\/[^/]+\/roles\/[^/]+$/],
    ["POST", /^\/admin\/customer-merge-requests$/],
    ["POST", /^\/admin\/customer-merge-requests\/[^/]+\/(?:approve|reject|cancel)$/]
];

const deniedProxyPrefixes = [
    "/api/bookings",
    "/api/catalog",
    "/api/repairs",
    "/api/inventory",
    "/api/payments"
];

// Payment-Service routes under /api/payments. Health and anything else stay unmapped.
const paymentRoutePatterns = [
    ["POST", /^\/$/],
    ["GET", /^\/$/],
    ["POST", /^\/[^/]+\/void$/],
    ["POST", /^\/bills$/],
    ["GET", /^\/balances(?:\/[^/]+)?$/],
    ["GET", /^\/my$/],
    ["POST", /^\/work-orders\/[^/]+\/(?:lock|unlock)$/],
    ["POST", /^\/refunds$/],
    ["GET", /^\/refunds$/],
    ["POST", /^\/refunds\/[^/]+\/(?:approve|reject|execute)$/]
];

function allowOnly(patterns) {
    return (req, res, next) => (
        patterns.some(([method, pathPattern]) => req.method === method && pathPattern.test(req.path))
            ? next()
            : denyUnmappedRoute(req, res)
    );
}

function denyUnmappedRoute(req, res) {
    return res.status(404).json({
        success: false,
        message: "API endpoint not found",
        path: req.originalUrl
    });
}

function createServiceProxy(target) {
    return createProxyMiddleware({
        target,
        changeOrigin: true,
        on: {
            proxyReq: fixRequestBody
        }
    });
}

function registerServiceRoutes(app, {
    userServiceUrl,
    paymentServiceUrl,
    loginRateLimiter,
    proxyFactory = createServiceProxy
} = {}) {
    if (!userServiceUrl || typeof loginRateLimiter !== "function") {
        throw new Error("User Service URL and login rate limiter are required");
    }

    app.use(
        "/api/users",
        (req, res, next) => {
            const routeKey = `${req.method} ${req.path}`;
            const isAllowed = publicUserRoutes.has(routeKey)
                || publicUserRoutePatterns.some(([method, pathPattern]) => (
                    req.method === method && pathPattern.test(req.path)
                ));
            if (!isAllowed) {
                return denyUnmappedRoute(req, res);
            }
            return next();
        },
        (req, res, next) => {
            if (req.method === "POST" && req.path === "/auth/login") {
                return loginRateLimiter(req, res, next);
            }
            return next();
        },
        proxyFactory(userServiceUrl)
    );

    if (paymentServiceUrl) {
        app.use("/api/payments", allowOnly(paymentRoutePatterns), proxyFactory(paymentServiceUrl));
    }

    for (const prefix of deniedProxyPrefixes) {
        app.use(prefix, denyUnmappedRoute);
    }
}

module.exports = registerServiceRoutes;
module.exports.publicUserRoutes = publicUserRoutes;
