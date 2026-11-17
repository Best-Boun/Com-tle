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
    ["POST", /^\/checkout$/],
    ["POST", /^\/deposits$/],
    ["GET", /^\/deposits$/],
    ["GET", /^\/deposits\/[^/]+$/],
    ["POST", /^\/deposits\/[^/]+\/settle$/],
    ["POST", /^\/work-orders\/[^/]+\/(?:lock|unlock)$/],
    ["POST", /^\/refunds$/],
    ["GET", /^\/refunds$/],
    ["POST", /^\/refunds\/[^/]+\/(?:approve|reject|execute)$/]
];

// Booking-Service routes under /api/bookings (ids are UUIDs, so /health stays unmapped).
const UUID = "[0-9a-fA-F-]{36}";
const bookingRoutePatterns = [
    ["GET", /^\/availability$/],
    ["GET", /^\/me$/],
    ["GET", /^\/queue$/],
    ["GET", /^\/$/],
    ["POST", /^\/$/],
    ["GET", new RegExp(`^\\/${UUID}$`)],
    ["PATCH", new RegExp(`^\\/${UUID}\\/(?:confirm|cancel|no-show)$`)],
    ["POST", new RegExp(`^\\/${UUID}\\/(?:check-in|confirm-deposit)$`)],
    ["POST", new RegExp(`^\\/${UUID}\\/claim$`)],
    ["DELETE", new RegExp(`^\\/${UUID}\\/claim$`)]
];

// Catalog-Service routes under /api/catalog.
const catalogRoutePatterns = [
    ["GET", /^\/categories$/],
    ["POST", /^\/categories$/],
    ["PATCH", new RegExp(`^\\/categories\\/${UUID}(?:\\/status)?$`)],
    ["GET", /^\/services$/],
    ["POST", /^\/services$/],
    ["GET", new RegExp(`^\\/services\\/${UUID}$`)],
    ["PATCH", new RegExp(`^\\/services\\/${UUID}(?:\\/status)?$`)],
    ["GET", /^\/audit-logs$/]
];

// Repair-Service routes under /api/repairs.
const repairRoutePatterns = [
    ["POST", /^\/work-orders$/],
    ["POST", /^\/work-orders\/walk-in$/],
    ["GET", /^\/work-orders$/],
    ["GET", /^\/work-orders\/me$/],
    ["GET", /^\/work-orders\/assigned$/],
    ["POST", new RegExp(`^\\/work-orders\\/${UUID}\\/assign$`)],
    ["POST", new RegExp(`^\\/work-orders\\/${UUID}\\/diagnosis\\/start$`)],
    ["PUT", new RegExp(`^\\/work-orders\\/${UUID}\\/diagnosis$`)],
    ["POST", new RegExp(`^\\/work-orders\\/${UUID}\\/quotations$`)],
    ["PUT", new RegExp(`^\\/quotations\\/${UUID}\\/send$`)],
    ["POST", new RegExp(`^\\/quotations\\/${UUID}\\/(?:revise|decision)$`)],
    ["POST", new RegExp(`^\\/work-orders\\/${UUID}\\/repair\\/start$`)],
    ["PUT", new RegExp(`^\\/work-orders\\/${UUID}\\/repair\\/result$`)],
    ["POST", new RegExp(`^\\/work-orders\\/${UUID}\\/(?:tests|handover|cancel)$`)],
    ["GET", /^\/parts$/],
    ["POST", /^\/parts$/],
    ["GET", /^\/parts\/movements$/],
    ["POST", new RegExp(`^\\/parts\\/${UUID}\\/receive$`)],
    ["POST", new RegExp(`^\\/work-orders\\/${UUID}\\/parts\\/issue$`)],
    ["GET", new RegExp(`^\\/work-orders\\/${UUID}$`)]
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
    bookingServiceUrl,
    catalogServiceUrl,
    repairServiceUrl,
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

    if (bookingServiceUrl) {
        app.use("/api/bookings", allowOnly(bookingRoutePatterns), proxyFactory(bookingServiceUrl));
    }

    if (catalogServiceUrl) {
        app.use("/api/catalog", allowOnly(catalogRoutePatterns), proxyFactory(catalogServiceUrl));
    }

    if (repairServiceUrl) {
        app.use("/api/repairs", allowOnly(repairRoutePatterns), proxyFactory(repairServiceUrl));
    }

    for (const prefix of deniedProxyPrefixes) {
        app.use(prefix, denyUnmappedRoute);
    }
}

module.exports = registerServiceRoutes;
module.exports.publicUserRoutes = publicUserRoutes;
