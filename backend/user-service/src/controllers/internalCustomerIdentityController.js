const { successResponse } = require("../../../shared/utils/responseFormatter");
const { getAuditRequestId } = require("../services/auditLogService");

function createInternalCustomerIdentityController(customerIdentityService) {
    return {
        resolveCustomer: async (req, res, next) => {
            try {
                const result = await customerIdentityService
                    .resolveRegisteredCustomerByUserId(
                        req.internalService,
                        req.body,
                        req.get("x-user-access-token"),
                        getAuditRequestId(req)
                    );
                res.status(200).json(
                    successResponse("Customer identity resolved", result)
                );
            } catch (error) {
                next(error);
            }
        }
    };
}

module.exports = createInternalCustomerIdentityController;
