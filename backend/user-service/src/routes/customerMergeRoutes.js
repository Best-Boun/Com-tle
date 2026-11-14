const express = require("express");
const { USER_ROLES } = require("../../../shared/constants");
const { CUSTOMER_MERGE_PERMISSIONS } = require("../constants/customerMergePermissions");
const { createCustomerMergeController } = require("../controllers/customerMergeController");
const { createRequireAuth } = require("../middleware/requireAuth");
const { createRequirePermission } = require("../middleware/requirePermission");
const { createCustomerMergeService } = require("../services/customerMergeService");

function createCustomerMergeRouter({
    db,
    authService,
    permissionService,
    customerMergeService
} = {}) {
    if (!authService || typeof authService.verifyAccessToken !== "function") {
        throw new Error("Authentication service is required");
    }

    const service = customerMergeService || createCustomerMergeService({ db });
    const controller = createCustomerMergeController(service);
    const requireAuth = createRequireAuth(authService.verifyAccessToken, permissionService);
    const requirePermission = createRequirePermission(permissionService);
    const router = express.Router();

    router.post(
        "/",
        requireAuth,
        requirePermission(CUSTOMER_MERGE_PERMISSIONS.REQUEST, { requiredRole: USER_ROLES.ADMIN }),
        controller.initiate
    );
    router.post(
        "/:requestId/approve",
        requireAuth,
        requirePermission(CUSTOMER_MERGE_PERMISSIONS.APPROVE, { requiredRole: USER_ROLES.ADMIN }),
        controller.approve
    );
    router.post(
        "/:requestId/reject",
        requireAuth,
        requirePermission(CUSTOMER_MERGE_PERMISSIONS.APPROVE, { requiredRole: USER_ROLES.ADMIN }),
        controller.reject
    );
    router.post("/:requestId/cancel", requireAuth, controller.cancel);

    return router;
}

module.exports = createCustomerMergeRouter;
