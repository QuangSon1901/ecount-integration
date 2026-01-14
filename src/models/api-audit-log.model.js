// src/models/api-audit-log.model.js
const db = require('../database/connection');
const crypto = require('crypto');
const logger = require('../utils/logger');

class ApiAuditLogModel {
    /**
     * Create audit log
     */
    static async create(logData) {
        const connection = await db.getConnection();
        
        try {
            const requestId = logData.requestId || this.generateRequestId();
            const accessTokenSuffix = logData.accessToken 
                ? logData.accessToken.slice(-16) 
                : null;

            const [result] = await connection.query(
                `INSERT INTO api_audit_logs (
                    customer_id, request_id, method, endpoint,
                    client_id, access_token_suffix,
                    request_headers, request_body,
                    response_status, response_body,
                    duration_ms, ip_address, user_agent,
                    success, error_code, error_message
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    logData.customerId || null,
                    requestId,
                    logData.method,
                    logData.endpoint,
                    logData.clientId || null,
                    accessTokenSuffix,
                    JSON.stringify(logData.requestHeaders || {}),
                    JSON.stringify(logData.requestBody || {}),
                    logData.responseStatus || null,
                    JSON.stringify(logData.responseBody || {}),
                    logData.durationMs || null,
                    logData.ipAddress || null,
                    logData.userAgent || null,
                    logData.success !== false,
                    logData.errorCode || null,
                    logData.errorMessage || null
                ]
            );

            return {
                id: result.insertId,
                request_id: requestId
            };

        } finally {
            connection.release();
        }
    }

    /**
     * Find log by request ID
     */
    static async findByRequestId(requestId) {
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query(
                'SELECT * FROM api_audit_logs WHERE request_id = ?',
                [requestId]
            );

            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    /**
     * List logs with filters
     */
    static async list(filters = {}) {
        const connection = await db.getConnection();
        
        try {
            let query = 'SELECT * FROM api_audit_logs WHERE 1=1';
            const params = [];

            if (filters.customerId) {
                query += ' AND customer_id = ?';
                params.push(filters.customerId);
            }

            if (filters.clientId) {
                query += ' AND client_id = ?';
                params.push(filters.clientId);
            }

            if (filters.endpoint) {
                query += ' AND endpoint LIKE ?';
                params.push(`%${filters.endpoint}%`);
            }

            if (filters.success !== undefined) {
                query += ' AND success = ?';
                params.push(filters.success);
            }

            if (filters.startDate) {
                query += ' AND created_at >= ?';
                params.push(filters.startDate);
            }

            if (filters.endDate) {
                query += ' AND created_at <= ?';
                params.push(filters.endDate);
            }

            query += ' ORDER BY created_at DESC';

            if (filters.limit) {
                query += ' LIMIT ?';
                params.push(parseInt(filters.limit));
            }

            if (filters.offset) {
                query += ' OFFSET ?';
                params.push(parseInt(filters.offset));
            }

            const [rows] = await connection.query(query, params);
            return rows;

        } finally {
            connection.release();
        }
    }

    /**
     * Get statistics
     */
    static async getStats(customerId, startDate = null, endDate = null) {
        const connection = await db.getConnection();
        
        try {
            let query = `
                SELECT 
                    COUNT(*) as total_requests,
                    SUM(CASE WHEN success = TRUE THEN 1 ELSE 0 END) as successful_requests,
                    SUM(CASE WHEN success = FALSE THEN 1 ELSE 0 END) as failed_requests,
                    AVG(duration_ms) as avg_duration_ms,
                    MAX(duration_ms) as max_duration_ms,
                    MIN(duration_ms) as min_duration_ms
                FROM api_audit_logs
                WHERE customer_id = ?
            `;
            const params = [customerId];

            if (startDate) {
                query += ' AND created_at >= ?';
                params.push(startDate);
            }

            if (endDate) {
                query += ' AND created_at <= ?';
                params.push(endDate);
            }

            const [rows] = await connection.query(query, params);
            return rows[0];

        } finally {
            connection.release();
        }
    }

    /**
     * Get endpoint usage
     */
    static async getEndpointUsage(customerId, startDate = null, endDate = null) {
        const connection = await db.getConnection();
        
        try {
            let query = `
                SELECT 
                    endpoint,
                    COUNT(*) as request_count,
                    SUM(CASE WHEN success = TRUE THEN 1 ELSE 0 END) as success_count,
                    AVG(duration_ms) as avg_duration_ms
                FROM api_audit_logs
                WHERE customer_id = ?
            `;
            const params = [customerId];

            if (startDate) {
                query += ' AND created_at >= ?';
                params.push(startDate);
            }

            if (endDate) {
                query += ' AND created_at <= ?';
                params.push(endDate);
            }

            query += ' GROUP BY endpoint ORDER BY request_count DESC';

            const [rows] = await connection.query(query, params);
            return rows;

        } finally {
            connection.release();
        }
    }

    /**
     * Cleanup old logs
     */
    static async cleanup(daysOld = 30) {
        const connection = await db.getConnection();
        
        try {
            const [result] = await connection.query(
                `DELETE FROM api_audit_logs
                 WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
                [daysOld]
            );

            logger.info(`Cleaned up ${result.affectedRows} old audit logs`);
            return result.affectedRows;

        } finally {
            connection.release();
        }
    }

    // Helper methods
    static generateRequestId() {
        return `req_${crypto.randomBytes(16).toString('hex')}`;
    }
}

module.exports = ApiAuditLogModel;