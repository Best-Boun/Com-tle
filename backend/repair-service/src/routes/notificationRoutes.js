const express = require("express");
const { PERMISSIONS } = require("../../../shared/constants");
const { requireAnyPermission } = require("../../../shared/middleware/serviceAuth");
const { successResponse } = require("../../../shared/utils/responseFormatter");

/**
 * Task 13: a customer's own notifications.
 *   GET  /notifications/me        latest 50 + unread count
 *   POST /notifications/me/read   { ids?: [uuid] } — none = mark all read
 */
function createNotificationRouter({ notificationService, authenticate }) {
    const router = express.Router();
    const handle = (status, message, action) => async (req, res, next) => {
        try {
            res.status(status).json(successResponse(message, await action(req)));
        } catch (error) {
            next(error);
        }
    };

    router.get(
        "/notifications/me",
        authenticate,
        requireAnyPermission(PERMISSIONS.REPAIR_HISTORY_VIEW_OWN),
        handle(200, "Notifications retrieved", (req) => notificationService.listMine(req.user))
    );
    router.post(
        "/notifications/me/read",
        authenticate,
        requireAnyPermission(PERMISSIONS.REPAIR_HISTORY_VIEW_OWN),
        handle(200, "Notifications marked as read", (req) => notificationService.markRead(req.body, req.user))
    );
    return router;
}

module.exports = createNotificationRouter;
