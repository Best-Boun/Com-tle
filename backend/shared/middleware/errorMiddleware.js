
const AppError = require("../errors/AppError");
const { errorResponse } = require("../utils/responseFormatter");

// Handle unknown API endpoints
function notFoundHandler(req, res, next) {
    next(
        new AppError(
            `Route ${req.originalUrl} not found`,
            404
        )
    );
}

// Centralized Error Handler
function errorHandler(err, req, res, next) {

    if (res.headersSent) {
        return next(err);
    }

    const statusCode = err.statusCode || 500;

    const message = err.isOperational
        ? err.message
        : "Internal Server Error";

    if (statusCode >= 500) {
        console.error("Server Error:", err);
    }

    res.status(statusCode).json(
        errorResponse(message)
    );
}

module.exports = {
    notFoundHandler,
    errorHandler
};
