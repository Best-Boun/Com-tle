const { successResponse } = require("../../../shared/utils/responseFormatter");
const { getAuditRequestId } = require("../services/auditLogService");

function createAdminUsersController(userAdministrationService) {
    return {
        listUsers: async (req, res, next) => {
            try {
                const result = await userAdministrationService.listUsers(req.query);
                res.status(200).json(successResponse("Users retrieved", result));
            } catch (error) {
                next(error);
            }
        },

        getUserDetails: async (req, res, next) => {
            try {
                const result = await userAdministrationService.getUserDetails(
                    req.params.userId
                );
                res.status(200).json(successResponse("User retrieved", result));
            } catch (error) {
                next(error);
            }
        },

        updateUserStatus: async (req, res, next) => {
            try {
                const result = await userAdministrationService.updateUserStatus(
                    req.params.userId,
                    req.auth.userId,
                    req.body,
                    getAuditRequestId(req)
                );
                res.status(200).json(successResponse("User status updated", result));
            } catch (error) {
                next(error);
            }
        },

        assignRole: async (req, res, next) => {
            try {
                const result = await userAdministrationService.assignRole(
                    req.params.userId,
                    req.auth.userId,
                    { role_code: req.params.roleCode },
                    getAuditRequestId(req)
                );
                res.status(200).json(successResponse("Role assigned", result));
            } catch (error) {
                next(error);
            }
        },

        removeRole: async (req, res, next) => {
            try {
                const result = await userAdministrationService.removeRole(
                    req.params.userId,
                    req.auth.userId,
                    req.params.roleCode,
                    getAuditRequestId(req)
                );
                res.status(200).json(successResponse("Role removed", result));
            } catch (error) {
                next(error);
            }
        }
    };
}

module.exports = {
    createAdminUsersController
};
