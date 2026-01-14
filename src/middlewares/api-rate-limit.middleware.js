// src/middlewares/api-rate-limit.middleware.js
const ApiRateLimitService = require('../services/api/rate-limit.service');
const { errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * API Rate Limiting Middleware
 * Checks hourly and daily limits
 */
async function apiRateLimitMiddleware(req, res, next) {
    try {
        if (!req.auth) {
            // Auth middleware should run first
            return next();
        }

        const customerId = req.auth.customer_id;
        const rateLimits = req.auth.rate_limits;

        // Check rate limits
        const check = await ApiRateLimitService.checkRateLimits(customerId, rateLimits);

        if (!check.allowed) {
            logger.warn('Rate limit exceeded', {
                customerId,
                customerCode: req.auth.customer_code,
                reason: check.reason,
                current: check.current,
                limit: check.limit
            });

            // Set rate limit headers
            res.set({
                'X-RateLimit-Limit': check.limit,
                'X-RateLimit-Remaining': 0,
                'X-RateLimit-Reset': new Date(Date.now() + (check.retry_after * 1000)).toISOString(),
                'Retry-After': check.retry_after
            });

            return errorResponse(res, 'Rate limit exceeded', 429, {
                error_code: 'RATE_LIMIT_EXCEEDED',
                message: `You have exceeded the ${check.window}ly rate limit`,
                limit: check.limit,
                current: check.current,
                window: check.window,
                retry_after: check.retry_after,
                retry_after_date: new Date(Date.now() + (check.retry_after * 1000)).toISOString()
            });
        }

        // Set rate limit headers for successful requests
        res.set({
            'X-RateLimit-Limit-Hourly': check.hourly.limit,
            'X-RateLimit-Remaining-Hourly': check.hourly.remaining,
            'X-RateLimit-Limit-Daily': check.daily.limit,
            'X-RateLimit-Remaining-Daily': check.daily.remaining
        });

        // Store check result for recording later
        req.rateLimitCheck = check;

        next();

    } catch (error) {
        logger.error('Rate limit middleware error:', error);
        // Don't block request on rate limit check error
        next();
    }
}

module.exports = apiRateLimitMiddleware;