const cors = require("cors");

function createCorsMiddleware(allowedOrigins) {
    const allowlist = new Set(allowedOrigins);
    const corsHandler = cors({
        origin(origin, callback) {
            callback(null, Boolean(origin && allowlist.has(origin)));
        },
        credentials: false,
        optionsSuccessStatus: 204
    });

    return (req, res, next) => {
        const origin = req.headers.origin;
        if (origin && !allowlist.has(origin)) {
            return res.status(403).json({
                success: false,
                message: "Origin is not allowed"
            });
        }
        return corsHandler(req, res, next);
    };
}

module.exports = {
    createCorsMiddleware
};
