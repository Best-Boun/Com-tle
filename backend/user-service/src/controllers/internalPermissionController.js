const { successResponse } = require("../../../shared/utils/responseFormatter");
const AppError = require("../../../shared/errors/AppError");

function createInternalPermissionController(internalPermissionService) {
    return {
        checkPermission: async (req, res, next) => {
            try {
                const result = await internalPermissionService.checkPermission(
                    req.internalService,
                    req.body
                );
                if (!result) {
                    throw new AppError("Invalid permission-check request", 400);
                }
                res.status(200).json(
                    successResponse("Permission decision retrieved", result)
                );
            } catch (error) {
                next(error);
            }
        }
    };
}

module.exports = {
    createInternalPermissionController
};
