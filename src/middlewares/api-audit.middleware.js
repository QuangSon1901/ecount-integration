// src/middlewares/api-audit.middleware.js
const ApiAuditLogModel = require('../models/api-audit-log.model');
const ApiRateLimitService = require('../services/api/rate-limit.service');
const logger = require('../utils/logger');

/**
 * API Audit Logging Middleware
 * Logs all API requests and responses
 */
function apiAuditMiddleware(req, res, next) {
    const startTime = Date.now();
    const requestId = ApiAuditLogModel.generateRequestId();

    // Attach request ID to request
    req.requestId = requestId;

    // Store original send function
    const originalSend = res.send;

    // Capture response
    let responseBody = null;
    res.send = function(data) {
        responseBody = data;
        originalSend.call(this, data);
    };

    // Log after response is sent
    res.on('finish', async () => {
        const durationMs = Date.now() - startTime;
        const success = res.statusCode >= 200 && res.statusCode < 400;

        try {
            // Parse response body if it's JSON string
            let parsedResponse = responseBody;
            if (typeof responseBody === 'string') {
                try {
                    parsedResponse = JSON.parse(responseBody);
                } catch (e) {
                    // Keep as string
                }
            }

            // Create audit log
            await ApiAuditLogModel.create({
                customerId: req.auth?.customer_id || null,
                requestId: requestId,
                method: req.method,
                endpoint: req.originalUrl || req.url,
                clientId: req.auth?.client_id || null,
                accessToken: req.accessToken || null,
                requestHeaders: {
                    'content-type': req.headers['content-type'],
                    'user-agent': req.headers['user-agent']
                },
                requestBody: req.body || {},
                responseStatus: res.statusCode,
                responseBody: parsedResponse || {},
                durationMs: durationMs,
                ipAddress: req.ip || req.connection.remoteAddress,
                userAgent: req.headers['user-agent'],
                success: success,
                errorCode: !success ? parsedResponse?.error_code : null,
                errorMessage: !success ? parsedResponse?.message : null
            });

            // Record in rate limit (async, don't wait)
            if (req.auth?.customer_id) {
                ApiRateLimitService.recordRequest(req.auth.customer_id, success)
                    .catch(err => logger.error('Failed to record rate limit:', err));
            }

        } catch (error) {
            logger.error('Failed to create audit log:', error);
            // Don't throw - logging failure shouldn't affect the response
        }
    });

    next();
}

module.exports = apiAuditMiddleware;