// src/models/api-customer.model.js
const db = require('../database/connection');
const logger = require('../utils/logger');

class ApiCustomerModel {
    /**
     * Create new API customer
     */
    static async create(customerData) {
        const connection = await db.getConnection();
        
        try {
            const [result] = await connection.query(
                `INSERT INTO api_customers (
                    customer_code, customer_name, email, phone,
                    environment, status,
                    rate_limit_per_hour, rate_limit_per_day, max_consecutive_errors,
                    webhook_enabled, bulk_order_enabled, max_bulk_orders,
                    metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    customerData.customerCode,
                    customerData.customerName,
                    customerData.email || null,
                    customerData.phone || null,
                    customerData.environment || 'production',
                    customerData.status || 'active',
                    customerData.rateLimitPerHour || 6000,
                    customerData.rateLimitPerDay || 10000,
                    customerData.maxConsecutiveErrors || 30,
                    customerData.webhookEnabled !== false,
                    customerData.bulkOrderEnabled !== false,
                    customerData.maxBulkOrders || 100,
                    JSON.stringify(customerData.metadata || {})
                ]
            );
            
            return result.insertId;
        } finally {
            connection.release();
        }
    }

    /**
     * Find customer by ID
     */
    static async findById(id) {
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query(
                'SELECT * FROM api_customers WHERE id = ?',
                [id]
            );
            
            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    /**
     * Find customer by code
     */
    static async findByCode(customerCode) {
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query(
                'SELECT * FROM api_customers WHERE customer_code = ?',
                [customerCode]
            );
            
            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    /**
     * Update customer
     */
    static async update(id, updateData) {
        const connection = await db.getConnection();
        
        try {
            const fields = [];
            const values = [];

            if (updateData.customerName !== undefined) {
                fields.push('customer_name = ?');
                values.push(updateData.customerName);
            }
            if (updateData.email !== undefined) {
                fields.push('email = ?');
                values.push(updateData.email);
            }
            if (updateData.phone !== undefined) {
                fields.push('phone = ?');
                values.push(updateData.phone);
            }
            if (updateData.status !== undefined) {
                fields.push('status = ?');
                values.push(updateData.status);
            }
            if (updateData.rateLimitPerHour !== undefined) {
                fields.push('rate_limit_per_hour = ?');
                values.push(updateData.rateLimitPerHour);
            }
            if (updateData.rateLimitPerDay !== undefined) {
                fields.push('rate_limit_per_day = ?');
                values.push(updateData.rateLimitPerDay);
            }
            if (updateData.webhookEnabled !== undefined) {
                fields.push('webhook_enabled = ?');
                values.push(updateData.webhookEnabled);
            }
            if (updateData.bulkOrderEnabled !== undefined) {
                fields.push('bulk_order_enabled = ?');
                values.push(updateData.bulkOrderEnabled);
            }
            if (updateData.metadata !== undefined) {
                fields.push('metadata = ?');
                values.push(JSON.stringify(updateData.metadata));
            }
            if (updateData.telegramResponsibles !== undefined) {
                fields.push('telegram_responsibles = ?');
                values.push(updateData.telegramResponsibles || null);
            }
            if (updateData.telegramGroupIds !== undefined) {
                fields.push('telegram_group_ids = ?');
                values.push(updateData.telegramGroupIds || null);
            }

            if (fields.length === 0) return false;

            values.push(id);

            const [result] = await connection.query(
                `UPDATE api_customers SET ${fields.join(', ')} WHERE id = ?`,
                values
            );

            return result.affectedRows > 0;
        } finally {
            connection.release();
        }
    }

    /**
     * List customers with filters
     */
    static async list(filters = {}) {
        const connection = await db.getConnection();
        
        try {
            let query = 'SELECT * FROM api_customers WHERE 1=1';
            const params = [];

            if (filters.status) {
                query += ' AND status = ?';
                params.push(filters.status);
            }

            if (filters.environment) {
                query += ' AND environment = ?';
                params.push(filters.environment);
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
     * Set portal password (bcrypt hash)
     */
    static async setPortalPassword(customerId, passwordHash) {
        const connection = await db.getConnection();
        try {
            const [result] = await connection.query(
                'UPDATE api_customers SET portal_password_hash = ? WHERE id = ?',
                [passwordHash, customerId]
            );
            return result.affectedRows > 0;
        } finally {
            connection.release();
        }
    }

    /**
     * Verify portal login: tìm customer theo code + compare bcrypt password.
     * Returns customer row nếu hợp lệ, null nếu không.
     */
    static async verifyPortalPassword(customerCode, passwordHash) {
        const connection = await db.getConnection();
        try {
            const [rows] = await connection.query(
                `SELECT * FROM api_customers
                 WHERE customer_code = ? AND portal_password_hash IS NOT NULL AND status = 'active'`,
                [customerCode]
            );
            return rows[0] || null; // caller dùng bcrypt.compare với portal_password_hash
        } finally {
            connection.release();
        }
    }

    /**
     * Get customer statistics
     */
    static async getStats(customerId) {
        const connection = await db.getConnection();
        
        try {
            const [stats] = await connection.query(
                `SELECT 
                    COUNT(DISTINCT at.id) as total_tokens,
                    SUM(CASE WHEN at.revoked = FALSE AND at.expires_at > NOW() THEN 1 ELSE 0 END) as active_tokens,
                    (SELECT COUNT(*) FROM api_audit_logs WHERE customer_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)) as requests_24h,
                    (SELECT COUNT(*) FROM api_audit_logs WHERE customer_id = ? AND success = TRUE AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)) as successful_requests_24h
                FROM api_access_tokens at
                WHERE at.customer_id = ?`,
                [customerId, customerId, customerId]
            );

            return stats[0];
        } finally {
            connection.release();
        }
    }
}

module.exports = ApiCustomerModel;