const {
    createProxyMiddleware,
    fixRequestBody
} = require("http-proxy-middleware");

const publicUserRoutes = new Set([
    "POST /auth/register",
    "POST /auth/login"
]);

const deniedProxyPrefixes = [
    "/api/bookings",
    "/api/catalog",
    "/api/repairs",
    "/api/inventory",
    "/api/payments"
];

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
            if (!publicUserRoutes.has(routeKey)) {
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

    for (const prefix of deniedProxyPrefixes) {
        app.use(prefix, denyUnmappedRoute);
    }
}

module.exports = registerServiceRoutes;
module.exports.publicUserRoutes = publicUserRoutes;
