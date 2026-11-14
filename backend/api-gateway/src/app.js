const express = require("express");
const helmet = require("helmet");
const {
    notFoundHandler,
    errorHandler
} = require("./middleware/errorMiddleware");
const { createCorsMiddleware } = require("./middleware/corsMiddleware");
const { createLoginRateLimiter } = require("./middleware/loginRateLimit");
const registerServiceRoutes = require("./routes/serviceRoutes");

function createGatewayApp(config, { proxyFactory } = {}) {
    const app = express();

    app.use(helmet());
    app.use(createCorsMiddleware(config.allowedOrigins));
    app.use(express.json());

    registerServiceRoutes(app, {
        userServiceUrl: config.serviceUrls.user,
        paymentServiceUrl: config.serviceUrls.payment,
        loginRateLimiter: createLoginRateLimiter(config.loginRateLimit),
        proxyFactory
    });

    app.get("/health", (req, res) => {
        res.status(200).json({
            success: true,
            service: "api-gateway",
            status: "running"
        });
    });

    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
}

module.exports = {
    createGatewayApp
};
