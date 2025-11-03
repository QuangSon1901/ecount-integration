const logger = require('../utils/logger');
const { errorResponse } = require('../utils/response');

const errorMiddleware = (err, req, res, next) => {
    logger.error('Error:', {
        message: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        ip: req.ip
    });

    // Default error
    let statusCode = err.statusCode || 500;
    let message = err.message || 'Internal Server Error';

    // Axios errors
    if (err.isAxiosError) {
        statusCode = err.response?.status || 500;
        message = err.response?.data?.message || err.message;
    }

    // Puppeteer errors
    if (err.name === 'TimeoutError') {
        statusCode = 408;
        message = 'Request timeout - operation took too long';
    }

    // Validation errors
    if (err.name === 'ValidationError') {
        statusCode = 400;
    }

    return errorResponse(res, message, statusCode, {
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
};

module.exports = errorMiddleware;