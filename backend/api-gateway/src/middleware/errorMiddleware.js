function notFoundHandler(req, res, next) {
    res.status(404).json({
        success: false,
        message: "API endpoint not found",
        path: req.originalUrl
    });
}

function errorHandler(err, req, res, next) {
    console.error("API Error:", err.message);

    const statusCode = err.statusCode || 500;

    res.status(statusCode).json({
        success: false,
        message: statusCode === 500
            ? "Internal Server Error"
            : err.message
    });
}

module.exports = {
    notFoundHandler,
    errorHandler
};
