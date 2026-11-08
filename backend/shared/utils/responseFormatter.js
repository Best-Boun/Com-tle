function successResponse(message, data = null, meta = null) {
    return {
        success: true,
        message,
        data,
        ...(meta && { meta })
    };
}

function errorResponse(message, errors = null) {
    return {
        success: false,
        message,
        ...(errors && { errors })
    };
}

module.exports = {
    successResponse,
    errorResponse
};
