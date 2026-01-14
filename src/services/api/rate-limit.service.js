// src/services/api/rate-limit.service.js
const ApiRateLimitModel = require('../../models/api-rate-limit.model');
const logger = require('../../utils/logger');

class ApiRateLimitService {
    /**
     * Check all rate limits for a customer
     */
    async checkRateLimits(customerId, rateLimits) {
        try {
            // Check hourly limit
            const hourlyCheck = await ApiRateLimitModel.checkLimit(
                customerId,
                'hourly',
                rateLimits.hourly
            );

            if (hourlyCheck.exceeded) {
                // Check if already blocked
                const blocked = await ApiRateLimitModel.isBlocked(customerId, 'hourly');
                
                if (!blocked.blocked) {
                    // Block for rest of hour
                    const retryAfter = ApiRateLimitModel.getRetryAfter('hourly');
                    await ApiRateLimitModel.blockCustomer(customerId, 'hourly', retryAfter);
                }

                return {
                    allowed: false,
                    reason: 'hourly_limit_exceeded',
                    limit: hourlyCheck.limit,
                    current: hourlyCheck.current,
                    window: 'hour',
                    retry_after: ApiRateLimitModel.getRetryAfter('hourly')
                };
            }

            // Check daily limit
            const dailyCheck = await ApiRateLimitModel.checkLimit(
                customerId,
                'daily',
                rateLimits.daily
            );

            if (dailyCheck.exceeded) {
                const blocked = await ApiRateLimitModel.isBlocked(customerId, 'daily');
                
                if (!blocked.blocked) {
                    const retryAfter = ApiRateLimitModel.getRetryAfter('daily');
                    await ApiRateLimitModel.blockCustomer(customerId, 'daily', retryAfter);
                }

                return {
                    allowed: false,
                    reason: 'daily_limit_exceeded',
                    limit: dailyCheck.limit,
                    current: dailyCheck.current,
                    window: 'day',
                    retry_after: ApiRateLimitModel.getRetryAfter('daily')
                };
            }

            return {
                allowed: true,
                hourly: hourlyCheck,
                daily: dailyCheck
            };

        } catch (error) {
            logger.error('Rate limit check failed:', error);
            throw error;
        }
    }

    /**
     * Record request
     */
    async recordRequest(customerId, isSuccess = true) {
        try {
            await Promise.all([
                ApiRateLimitModel.incrementRequest(customerId, 'hourly', isSuccess),
                ApiRateLimitModel.incrementRequest(customerId, 'daily', isSuccess)
            ]);

        } catch (error) {
            logger.error('Failed to record request:', error);
            // Don't throw - this shouldn't break the request
        }
    }

    /**
     * Check consecutive errors
     */
    async checkConsecutiveErrors(customerId, maxErrors) {
        try {
            return await ApiRateLimitModel.checkConsecutiveErrors(customerId, maxErrors);

        } catch (error) {
            logger.error('Failed to check consecutive errors:', error);
            return { exceeded: false };
        }
    }

    /**
     * Get rate limit statistics
     */
    async getStats(customerId) {
        try {
            const [hourlyStats, dailyStats] = await Promise.all([
                ApiRateLimitModel.getStats(customerId, 'hourly'),
                ApiRateLimitModel.getStats(customerId, 'daily')
            ]);

            return {
                hourly: hourlyStats,
                daily: dailyStats
            };

        } catch (error) {
            logger.error('Failed to get rate limit stats:', error);
            throw error;
        }
    }
}

module.exports = new ApiRateLimitService();