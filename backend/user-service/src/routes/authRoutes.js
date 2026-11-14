const express = require("express");
const { createAuthController } = require("../controllers/authController");
const { createAuthService } = require("../services/authService");

function createAuthRouter({ db, jwtConfig, authService } = {}) {
    const router = express.Router();
    const controller = createAuthController(
        authService || createAuthService({ db, jwtConfig })
    );

    router.post("/register", controller.register);
    router.post("/login", controller.login);
    router.post("/refresh", controller.refresh);
    router.post("/logout", controller.logout);

    return router;
}

module.exports = createAuthRouter;
