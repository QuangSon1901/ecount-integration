// src/models/api-rate-limit.model.js
const db = require('../database/connection');
const logger = require('../utils/logger');

class ApiRateLimitModel {
    /**
     * Get or create rate limit record
     */
    static async getOrCreate(customerId, windowType) {
        const connection = await db.getConnection();
        
        try {
            const windowStart = this.getWindowStart(windowType);

            // Try to get existing record
            const [rows] = await connection.query(
                `SELECT * FROM api_rate_limits
                 WHERE customer_id = ? 
                 AND window_type = ?
                 AND window_start = ?`,
                [customerId, windowType, windowStart]
            );

            if (rows.length > 0) {
                return rows[0];
            }

            // Create new record
            const [result] = await connection.query(
                `INSERT INTO api_rate_limits (
                    customer_id, window_start, window_type,
                    request_count, error_count, success_count
                ) VALUES (?, ?, ?, 0, 0, 0)`,
                [customerId, windowStart, windowType]
            );

            return {
                id: result.insertId,
                customer_id: customerId,
                window_start: windowStart,
                window_type: windowType,
                request_count: 0,
                error_count: 0,
                success_count: 0,
                limit_exceeded: false,
                blocked_until: null
            };

        } finally {
            connection.release();
        }
    }

    /**
     * Increment request counter
     */
    static async incrementRequest(customerId, windowType, isSuccess = true) {
        const connection = await db.getConnection();
        
        try {
            const windowStart = this.getWindowStart(windowType);

            await connection.query(
                `INSERT INTO api_rate_limits (
                    customer_id, window_start, window_type,
                    request_count, error_count, success_count
                ) VALUES (?, ?, ?, 1, ?, ?)
                ON DUPLICATE KEY UPDATE
                    request_count = request_count + 1,
                    error_count = error_count + ?,
                    success_count = success_count + ?,
                    updated_at = NOW()`,
                [
                    customerId, 
                    windowStart, 
                    windowType,
                    isSuccess ? 0 : 1,
                    isSuccess ? 1 : 0,
                    isSuccess ? 0 : 1,
                    isSuccess ? 1 : 0
                ]
            );

        } finally {
            connection.release();
        }
    }

    /**
     * Check if limit exceeded
     */
    static async checkLimit(customerId, windowType, limit) {
        const record = await this.getOrCreate(customerId, windowType);
        
        return {
            exceeded: record.request_count >= limit,
            current: record.request_count,
            limit: limit,
            remaining: Math.max(0, limit - record.request_count)
        };
    }

    /**
     * Check consecutive errors
     */
    static async checkConsecutiveErrors(customerId, maxErrors) {
        const connection = await db.getConnection();
        
        try {
            // Get recent error count from audit logs
            const [rows] = await connection.query(
                `SELECT COUNT(*) as error_count
                 FROM api_audit_logs
                 WHERE customer_id = ?
                 AND success = FALSE
                 AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)
                 ORDER BY created_at DESC
                 LIMIT ?`,
                [customerId, maxErrors]
            );

            const errorCount = rows[0]?.error_count || 0;

            return {
                exceeded: errorCount >= maxErrors,
                current: errorCount,
                limit: maxErrors
            };

        } finally {
            connection.release();
        }
    }

    /**
     * Block customer temporarily
     */
    static async blockCustomer(customerId, windowType, durationSeconds) {
        const connection = await db.getConnection();
        
        try {
            const windowStart = this.getWindowStart(windowType);
            const blockedUntil = new Date(Date.now() + (durationSeconds * 1000));

            await connection.query(
                `UPDATE api_rate_limits
                 SET limit_exceeded = TRUE, blocked_until = ?
                 WHERE customer_id = ? AND window_type = ? AND window_start = ?`,
                [blockedUntil, customerId, windowType, windowStart]
            );

            logger.warn('Customer blocked due to rate limit', {
                customerId,
                windowType,
                blockedUntil
            });

        } finally {
            connection.release();
        }
    }

    /**
     * Check if customer is blocked
     */
    static async isBlocked(customerId, windowType) {
        const connection = await db.getConnection();
        
        try {
            const windowStart = this.getWindowStart(windowType);

            const [rows] = await connection.query(
                `SELECT blocked_until FROM api_rate_limits
                 WHERE customer_id = ?
                 AND window_type = ?
                 AND window_start = ?
                 AND limit_exceeded = TRUE
                 AND blocked_until > NOW()`,
                [customerId, windowType, windowStart]
            );

            if (rows.length > 0) {
                return {
                    blocked: true,
                    blockedUntil: rows[0].blocked_until
                };
            }

            return { blocked: false };

        } finally {
            connection.release();
        }
    }

    /**
     * Get rate limit stats
     */
    static async getStats(customerId, windowType) {
        const record = await this.getOrCreate(customerId, windowType);
        
        return {
            window_type: windowType,
            window_start: record.window_start,
            total_requests: record.request_count,
            successful_requests: record.success_count,
            failed_requests: record.error_count,
            limit_exceeded: record.limit_exceeded,
            blocked_until: record.blocked_until
        };
    }

    /**
     * Cleanup old records
     */
    static async cleanup(daysOld = 7) {
        const connection = await db.getConnection();
        
        try {
            const [result] = await connection.query(
                `DELETE FROM api_rate_limits
                 WHERE window_start < DATE_SUB(NOW(), INTERVAL ? DAY)`,
                [daysOld]
            );

            logger.info(`Cleaned up ${result.affectedRows} old rate limit records`);
            return result.affectedRows;

        } finally {
            connection.release();
        }
    }

    // Helper methods
    static getWindowStart(windowType) {
        const now = new Date();
        
        if (windowType === 'hourly') {
            now.setMinutes(0, 0, 0);
        } else if (windowType === 'daily') {
            now.setHours(0, 0, 0, 0);
        }
        
        return now;
    }

    static getRetryAfter(windowType) {
        const now = new Date();
        
        if (windowType === 'hourly') {
            const nextHour = new Date(now);
            nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
            return Math.ceil((nextHour - now) / 1000);
        } else {
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(0, 0, 0, 0);
            return Math.ceil((tomorrow - now) / 1000);
        }
    }
}

module.exports = ApiRateLimitModel;