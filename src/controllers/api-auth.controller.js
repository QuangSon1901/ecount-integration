// src/controllers/api-auth.controller.js
const ApiAuthService = require('../services/api/auth.service');
const ApiCustomerModel = require('../models/api-customer.model');
const ApiCredentialModel = require('../models/api-credential.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

class ApiAuthController {
    /**
     * POST /api/v1/auth/token
     * Generate access token from client credentials
     */
    async generateToken(req, res, next) {
        try {
            const { client_id, client_secret, grant_type } = req.body;

            // Validate input
            if (!client_id || !client_secret) {
                return errorResponse(res, 'client_id and client_secret are required', 400, {
                    error_code: 'MISSING_CREDENTIALS'
                });
            }

            if (grant_type && grant_type !== 'client_credentials') {
                return errorResponse(res, 'Invalid grant_type. Only "client_credentials" is supported', 400, {
                    error_code: 'INVALID_GRANT_TYPE'
                });
            }

            // Get client info
            const ipAddress = req.ip || req.connection.remoteAddress;
            const userAgent = req.headers['user-agent'];

            // Authenticate
            const result = await ApiAuthService.authenticate(
                client_id,
                client_secret,
                ipAddress,
                userAgent
            );

            logger.info('Access token generated', {
                clientId: client_id,
                ipAddress
            });

            return successResponse(res, result.data, 'Token generated successfully');

        } catch (error) {
            logger.error('Token generation failed:', error);
            return errorResponse(res, error.message, 401, {
                error_code: 'AUTHENTICATION_FAILED'
            });
        }
    }

    /**
     * POST /api/v1/auth/refresh
     * Refresh access token using refresh token
     */
    async refreshToken(req, res, next) {
        try {
            const { refresh_token } = req.body;

            if (!refresh_token) {
                return errorResponse(res, 'refresh_token is required', 400, {
                    error_code: 'MISSING_REFRESH_TOKEN'
                });
            }

            const result = await ApiAuthService.refreshToken(refresh_token);

            logger.info('Access token refreshed');

            return successResponse(res, result.data, 'Token refreshed successfully');

        } catch (error) {
            logger.error('Token refresh failed:', error);
            return errorResponse(res, error.message, 401, {
                error_code: 'REFRESH_FAILED'
            });
        }
    }

    /**
     * POST /api/v1/auth/revoke
     * Revoke current access token
     */
    async revokeToken(req, res, next) {
        try {
            const accessToken = req.accessToken;

            if (!accessToken) {
                return errorResponse(res, 'No active token to revoke', 400);
            }

            await ApiAuthService.revokeToken(accessToken);

            logger.info('Access token revoked', {
                customerId: req.auth.customer_id
            });

            return successResponse(res, null, 'Token revoked successfully');

        } catch (error) {
            logger.error('Token revocation failed:', error);
            next(error);
        }
    }

    /**
     * GET /api/v1/auth/verify
     * Verify current token and return token info
     */
    async verifyToken(req, res, next) {
        try {
            // Token already verified by middleware
            return successResponse(res, {
                valid: true,
                customer_id: req.auth.customer_id,
                customer_code: req.auth.customer_code,
                environment: req.auth.environment,
                rate_limits: req.auth.rate_limits
            }, 'Token is valid');

        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/v1/auth/me
     * Get current authenticated customer info
     */
    async getCurrentCustomer(req, res, next) {
        try {
            const customer = await ApiCustomerModel.findById(req.auth.customer_id);

            if (!customer) {
                return errorResponse(res, 'Customer not found', 404);
            }

            // Get statistics
            const stats = await ApiCustomerModel.getStats(customer.id);

            return successResponse(res, {
                customer_code: customer.customer_code,
                customer_name: customer.customer_name,
                email: customer.email,
                environment: customer.environment,
                status: customer.status,
                rate_limits: {
                    hourly: customer.rate_limit_per_hour,
                    daily: customer.rate_limit_per_day
                },
                features: {
                    webhook_enabled: customer.webhook_enabled,
                    bulk_order_enabled: customer.bulk_order_enabled,
                    max_bulk_orders: customer.max_bulk_orders
                },
                stats: stats
            }, 'Customer info retrieved successfully');

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new ApiAuthController();