const express = require("express");
const AppError = require("../../../shared/errors/AppError");
const { getAuditRequestId } = require("../services/auditLogService");
const {
    createInternalPermissionController
} = require("../controllers/internalPermissionController");
const {
    createRequireInternalServiceAuth
} = require("../middleware/requireInternalServiceAuth");
const createInternalCustomerIdentityController = require(
    "../controllers/internalCustomerIdentityController"
);

function createInternalRouter({
    internalServiceAuthService,
    internalPermissionService,
    customerIdentityService
} = {}) {
    if (!internalPermissionService
        || typeof internalPermissionService.checkPermission !== "function") {
        throw new Error("Internal permission service is required");
    }
    const router = express.Router();
    const requireInternalServiceAuth = createRequireInternalServiceAuth(
        internalServiceAuthService
    );
    const controller = createInternalPermissionController(internalPermissionService);
    router.post(
        "/permissions/check",
        requireInternalServiceAuth,
        express.json(),
        controller.checkPermission
    );
    if (customerIdentityService) {
        if (typeof customerIdentityService.resolveRegisteredCustomerByUserId !== "function"
            || typeof customerIdentityService.recordMalformedRequest !== "function") {
            throw new Error("Internal customer identity service is invalid");
        }
        const identityJsonParser = express.json();
        const parseIdentityJson = (req, res, next) => {
            identityJsonParser(req, res, (error) => {
                if (!error) {
                    return next();
                }
                customerIdentityService.recordMalformedRequest(
                    req.internalService,
                    getAuditRequestId(req)
                ).then(
                    () => next(new AppError("Invalid customer identity request", 400)),
                    () => next(new AppError("Customer identity service unavailable", 503))
                );
            });
        };
        const identityController = createInternalCustomerIdentityController(
            customerIdentityService
        );
        router.post(
            "/customers/resolve",
            requireInternalServiceAuth,
            parseIdentityJson,
            identityController.resolveCustomer
        );
    }
    return router;
}

module.exports = createInternalRouter;
