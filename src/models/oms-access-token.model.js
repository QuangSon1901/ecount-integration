// src/models/oms-access-token.model.js
const db = require('../database/connection');

class OmsAccessTokenModel {
    /**
     * Get the cached token row for a customer (or null).
     */
    static async findByCustomerId(customerId) {
        const connection = await db.getConnection();
        try {
            const [rows] = await connection.query(
                'SELECT * FROM oms_access_tokens WHERE customer_id = ?',
                [customerId]
            );
            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    /**
     * Insert or replace the token for a customer.
     * UNIQUE(customer_id) enforces "one token per customer".
     */
    static async upsert({ customerId, accessToken, tokenType, scope, expiresAt, fingerprint }) {
        const connection = await db.getConnection();
        try {
            await connection.query(
                `INSERT INTO oms_access_tokens
                    (customer_id, access_token, token_type, scope, expires_at, credential_fingerprint, refreshed_at)
                 VALUES (?, ?, ?, ?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE
                    access_token = VALUES(access_token),
                    token_type = VALUES(token_type),
                    scope = VALUES(scope),
                    expires_at = VALUES(expires_at),
                    credential_fingerprint = VALUES(credential_fingerprint),
                    refreshed_at = NOW()`,
                [customerId, accessToken, tokenType, scope, expiresAt, fingerprint]
            );
        } finally {
            connection.release();
        }
    }

    /**
     * Drop the cached token (e.g. after a 401 from OMS, or admin-triggered invalidation).
     */
    static async deleteByCustomerId(customerId) {
        const connection = await db.getConnection();
        try {
            const [result] = await connection.query(
                'DELETE FROM oms_access_tokens WHERE customer_id = ?',
                [customerId]
            );
            return result.affectedRows > 0;
        } finally {
            connection.release();
        }
    }

    /**
     * Housekeeping: remove tokens whose expires_at is well past.
     */
    static async cleanupExpired(graceMinutes = 60) {
        const connection = await db.getConnection();
        try {
            const [result] = await connection.query(
                'DELETE FROM oms_access_tokens WHERE expires_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)',
                [graceMinutes]
            );
            return result.affectedRows;
        } finally {
            connection.release();
        }
    }
}

module.exports = OmsAccessTokenModel;
