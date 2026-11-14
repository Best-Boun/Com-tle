const { successResponse } = require("../../../shared/utils/responseFormatter");
const { getAuditRequestId } = require("../services/auditLogService");

function createAuthController(authService) {
    return {
        register: async (req, res, next) => {
            try {
                const result = await authService.register(
                    req.body,
                    getAuditRequestId(req)
                );
                res.status(201).json(
                    successResponse("Registration successful", result)
                );
            } catch (error) {
                next(error);
            }
        },

        login: async (req, res, next) => {
            try {
                const result = await authService.login(req.body, getAuditRequestId(req));
                res.status(200).json(
                    successResponse("Login successful", result)
                );
            } catch (error) {
                next(error);
            }
        },

        refresh: async (req, res, next) => {
            try {
                const result = await authService.refresh(
                    req.body,
                    getAuditRequestId(req)
                );
                res.status(200).json(
                    successResponse("Token refreshed", result)
                );
            } catch (error) {
                next(error);
            }
        },

        logout: async (req, res, next) => {
            try {
                const result = await authService.logout(
                    req.body,
                    getAuditRequestId(req)
                );
                res.status(200).json(
                    successResponse("Logout processed", result)
                );
            } catch (error) {
                next(error);
            }
        }
    };
}

module.exports = {
    createAuthController
};
