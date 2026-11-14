const express = require("express");
const { createUsersController } = require("../controllers/usersController");
const { createRequireAuth } = require("../middleware/requireAuth");
const { createRequirePermission } = require("../middleware/requirePermission");
const { PERMISSIONS } = require("../../../shared/constants");
const { createPermissionService } = require("../services/permissionService");
const { createUserProfileService } = require("../services/userProfileService");

function createUsersRouter({
    db,
    authService,
    profileService,
    permissionService
} = {}) {
    if (!authService || typeof authService.verifyAccessToken !== "function") {
        throw new Error("Authentication service is required");
    }

    const router = express.Router();
    const resolvedProfileService = profileService || createUserProfileService({ db });
    const resolvedPermissionService = permissionService || createPermissionService({ db });
    const controller = createUsersController(
        resolvedProfileService,
        resolvedPermissionService
    );
    const requireAuth = createRequireAuth(
        authService.verifyAccessToken,
        resolvedPermissionService
    );
    const requirePermission = createRequirePermission(resolvedPermissionService);

    router.get(
        "/me",
        requireAuth,
        requirePermission(PERMISSIONS.USER_PROFILE_VIEW_OWN),
        controller.getMe
    );
    router.patch(
        "/me",
        requireAuth,
        requirePermission(PERMISSIONS.USER_PROFILE_UPDATE_OWN),
        controller.updateMe
    );
    router.get("/me/permissions", requireAuth, controller.getMyAccess);

    return router;
}

module.exports = createUsersRouter;
