const AppError = require("../../../shared/errors/AppError");
const { successResponse } = require("../../../shared/utils/responseFormatter");
const { getAuditRequestId } = require("../services/auditLogService");

function createCustomerMergeController(service) {
    return {
        initiate: async (req, res, next) => {
            try {
                if (!req.body || typeof req.body !== "object"
                    || Array.isArray(req.body)
                    || Object.hasOwn(req.body, "idempotency_key")) {
                    throw new AppError("Invalid merge request", 400);
                }
                const result = await service.initiate(req.auth.userId, {
                    ...req.body,
                    idempotency_key: req.get("idempotency-key")
                }, getAuditRequestId(req));
                res.status(201).json(successResponse("Merge request created", result));
            } catch (error) {
                next(error);
            }
        },
        approve: async (req, res, next) => {
            try {
                const result = await service.approve(
                    req.auth.userId, req.params.requestId, req.body, getAuditRequestId(req)
                );
                res.status(200).json(successResponse("Merge request approved", result));
            } catch (error) {
                next(error);
            }
        },
        reject: async (req, res, next) => {
            try {
                const result = await service.reject(
                    req.auth.userId, req.params.requestId, req.body, getAuditRequestId(req)
                );
                res.status(200).json(successResponse("Merge request rejected", result));
            } catch (error) {
                next(error);
            }
        },
        cancel: async (req, res, next) => {
            try {
                const result = await service.cancel(
                    req.auth.userId, req.params.requestId, req.body, getAuditRequestId(req)
                );
                res.status(200).json(successResponse("Merge request cancelled", result));
            } catch (error) {
                next(error);
            }
        }
    };
}

module.exports = {
    createCustomerMergeController
};
