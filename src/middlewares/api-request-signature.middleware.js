// src/middlewares/api-request-signature.middleware.js
const crypto = require('crypto');
const { errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * API Request Signature Verification Middleware (Optional)
 * Verifies HMAC-SHA256 signature for extra security
 * 
 * Client must send:
 * - X-Signature: HMAC-SHA256 signature
 * - X-Timestamp: Unix timestamp (must be within 5 minutes)
 */
function apiRequestSignatureMiddleware(req, res, next) {
    // Skip if signature verification is not required
    if (process.env.API_REQUIRE_SIGNATURE !== 'true') {
        return next();
    }

    try {
        const signature = req.headers['x-signature'];
        const timestamp = req.headers['x-timestamp'];

        if (!signature || !timestamp) {
            return errorResponse(res, 'Missing signature headers', 401, {
                error_code: 'MISSING_SIGNATURE',
                message: 'X-Signature and X-Timestamp headers are required'
            });
        }

        // Check timestamp (must be within 5 minutes)
        const now = Math.floor(Date.now() / 1000);
        const requestTime = parseInt(timestamp);

        if (Math.abs(now - requestTime) > 300) { // 5 minutes
            return errorResponse(res, 'Request timestamp is too old', 401, {
                error_code: 'TIMESTAMP_EXPIRED',
                message: 'Request must be made within 5 minutes'
            });
        }

        // Get client secret from auth (must run after auth middleware)
        if (!req.auth || !req.auth.client_id) {
            return errorResponse(res, 'Authentication required for signature verification', 401);
        }

        // Compute signature
        const payload = `${req.method}${req.originalUrl}${timestamp}${JSON.stringify(req.body || {})}`;
        
        // In production, get client secret from database
        // For now, we'll verify using the access token as secret
        const ApiCredentialModel = require('../models/api-credential.model');
        
        ApiCredentialModel.findByClientId(req.auth.client_id)
            .then(credential => {
                if (!credential) {
                    return errorResponse(res, 'Invalid credentials', 401);
                }

                const expectedSignature = crypto
                    .createHmac('sha256', credential.client_secret_hash)
                    .update(payload)
                    .digest('hex');

                if (signature !== expectedSignature) {
                    logger.warn('Invalid request signature', {
                        customerId: req.auth.customer_id,
                        clientId: req.auth.client_id
                    });

                    return errorResponse(res, 'Invalid signature', 401, {
                        error_code: 'INVALID_SIGNATURE'
                    });
                }

                next();
            })
            .catch(error => {
                logger.error('Signature verification error:', error);
                return errorResponse(res, 'Signature verification failed', 500);
            });

    } catch (error) {
        logger.error('Request signature middleware error:', error);
        return errorResponse(res, 'Signature verification failed', 500);
    }
}

module.exports = apiRequestSignatureMiddleware;