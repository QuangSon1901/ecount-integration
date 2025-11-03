/**
 * Success response helper
 */
const successResponse = (res, data = null, message = 'Success', statusCode = 200) => {
    return res.status(statusCode).json({
        success: true,
        message,
        data,
        timestamp: new Date().toISOString()
    });
};

/**
 * Error response helper
 */
const errorResponse = (res, message = 'Error', statusCode = 500, data = null) => {
    return res.status(statusCode).json({
        success: false,
        message,
        ...(data && { data }),
        timestamp: new Date().toISOString()
    });
};

module.exports = {
    successResponse,
    errorResponse
};