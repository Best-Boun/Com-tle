const { successResponse } = require("../../../shared/utils/responseFormatter");

function createAuthController(authService) {
    return {
        register: async (req, res, next) => {
            try {
                const result = await authService.register(req.body);
                res.status(201).json(
                    successResponse("Registration successful", result)
                );
            } catch (error) {
                next(error);
            }
        },

        login: async (req, res, next) => {
            try {
                const result = await authService.login(req.body);
                res.status(200).json(
                    successResponse("Login successful", result)
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
