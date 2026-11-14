const express = require("express");
const { USER_ROLES } = require("../../../shared/constants");
const { ADMIN_PERMISSIONS } = require("../constants/adminPermissions");
const { createAdminUsersController } = require("../controllers/adminUsersController");
const { createRequireAuth } = require("../middleware/requireAuth");
const { createRequirePermission } = require("../middleware/requirePermission");
const { createUserAdministrationService } = require("../services/userAdministrationService");

function createAdminUsersRouter({
    db,
    authService,
    permissionService,
    userAdministrationService
} = {}) {
    if (!authService || typeof authService.verifyAccessToken !== "function") {
        throw new Error("Authentication service is required");
    }

    const service = userAdministrationService
        || createUserAdministrationService({ db });
    const router = express.Router();
    const controller = createAdminUsersController(service);
    const requireAuth = createRequireAuth(
        authService.verifyAccessToken,
        permissionService
    );
    const requirePermission = createRequirePermission(permissionService);

    router.get(
        "/",
        requireAuth,
        requirePermission(ADMIN_PERMISSIONS.USER_LIST, { requiredRole: USER_ROLES.ADMIN }),
        controller.listUsers
    );
    router.get(
        "/:userId",
        requireAuth,
        requirePermission(ADMIN_PERMISSIONS.USER_VIEW, { requiredRole: USER_ROLES.ADMIN }),
        controller.getUserDetails
    );
    router.patch(
        "/:userId/status",
        requireAuth,
        requirePermission(ADMIN_PERMISSIONS.USER_STATUS_MANAGE, { requiredRole: USER_ROLES.ADMIN }),
        controller.updateUserStatus
    );
    router.put(
        "/:userId/roles/:roleCode",
        requireAuth,
        requirePermission(ADMIN_PERMISSIONS.USER_ROLE_MANAGE, { requiredRole: USER_ROLES.ADMIN }),
        controller.assignRole
    );
    router.delete(
        "/:userId/roles/:roleCode",
        requireAuth,
        requirePermission(ADMIN_PERMISSIONS.USER_ROLE_MANAGE, { requiredRole: USER_ROLES.ADMIN }),
        controller.removeRole
    );

    return router;
}

module.exports = createAdminUsersRouter;
