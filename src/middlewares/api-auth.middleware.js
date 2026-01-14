// src/middlewares/api-auth.middleware.js
const ApiAuthService = require('../services/api/auth.service');
const ApiAuditLogModel = require('../models/api-audit-log.model');
const { errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * API Authentication Middleware
 * Verifies Bearer token and attaches auth info to request
 */
async function apiAuthMiddleware(req, res, next) {
    try {
        // Extract token from Authorization header
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return errorResponse(res, 'Missing or invalid authorization header', 401, {
                error_code: 'MISSING_AUTH_TOKEN',
                message: 'Please provide a valid Bearer token in Authorization header'
            });
        }

        const accessToken = authHeader.substring(7); // Remove 'Bearer '

        // Verify token
        const verification = await ApiAuthService.verifyToken(accessToken);

        if (!verification.success) {
            return errorResponse(res, 'Invalid or expired token', 401, {
                error_code: 'INVALID_TOKEN',
                message: verification.error || 'Token verification failed'
            });
        }

        // Attach auth info to request
        req.auth = verification.data;
        req.accessToken = accessToken;

        // Log token usage (async, don't wait)
        setImmediate(() => {
            const ApiTokenModel = require('../models/api-token.model');
            ApiTokenModel.findByAccessToken(accessToken)
                .then(token => {
                    if (token) {
                        ApiTokenModel.updateLastUsed(token.id);
                    }
                })
                .catch(err => logger.error('Failed to update token last used:', err));
        });

        next();

    } catch (error) {
        logger.error('API auth middleware error:', error);
        return errorResponse(res, 'Authentication failed', 401, {
            error_code: 'AUTH_ERROR'
        });
    }
}

module.exports = apiAuthMiddleware;