const { successResponse } = require("../../../shared/utils/responseFormatter");
const { getAuditRequestId } = require("../services/auditLogService");

function createUsersController(profileService, permissionService) {
    return {
        getMe: async (req, res, next) => {
            try {
                const profile = await profileService.getProfile(req.auth.userId);
                res.status(200).json(successResponse("Profile retrieved", profile));
            } catch (error) {
                next(error);
            }
        },

        updateMe: async (req, res, next) => {
            try {
                const profile = await profileService.updateProfile(
                    req.auth.userId,
                    req.body,
                    getAuditRequestId(req)
                );
                res.status(200).json(successResponse("Profile updated", profile));
            } catch (error) {
                next(error);
            }
        },

        getMyAccess: async (req, res, next) => {
            try {
                const access = await permissionService.getUserAccess(req.auth.userId);
                res.status(200).json(successResponse("Access retrieved", access));
            } catch (error) {
                next(error);
            }
        }
    };
}

module.exports = {
    createUsersController
};
