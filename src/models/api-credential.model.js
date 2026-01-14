// src/models/api-credential.model.js
const db = require('../database/connection');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const logger = require('../utils/logger');

class ApiCredentialModel {
    /**
     * Create new credentials
     */
    static async create(credentialData) {
        const connection = await db.getConnection();
        
        try {
            const clientId = this.generateClientId();
            const clientSecret = this.generateClientSecret();
            const secretHash = await bcrypt.hash(clientSecret, 10);

            const [result] = await connection.query(
                `INSERT INTO api_credentials (
                    customer_id, client_id, client_secret_hash,
                    environment, access_token_ttl, refresh_token_ttl,
                    status
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    credentialData.customerId,
                    clientId,
                    secretHash,
                    credentialData.environment || 'production',
                    credentialData.accessTokenTTL || 3600,
                    credentialData.refreshTokenTTL || 2592000,
                    'active'
                ]
            );

            logger.info('Created API credentials', {
                customerId: credentialData.customerId,
                clientId,
                environment: credentialData.environment
            });

            return {
                id: result.insertId,
                client_id: clientId,
                client_secret: clientSecret // Only returned once
            };
        } finally {
            connection.release();
        }
    }

    /**
     * Find credential by client ID
     */
    static async findByClientId(clientId) {
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query(
                `SELECT c.*, cu.customer_code, cu.status as customer_status,
                        cu.rate_limit_per_hour, cu.rate_limit_per_day,
                        cu.webhook_enabled, cu.bulk_order_enabled, cu.max_bulk_orders
                 FROM api_credentials c
                 JOIN api_customers cu ON cu.id = c.customer_id
                 WHERE c.client_id = ?`,
                [clientId]
            );

            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    /**
     * Verify client secret
     */
    static async verifySecret(clientId, clientSecret) {
        const credential = await this.findByClientId(clientId);
        
        if (!credential) {
            return { valid: false, credential: null };
        }

        const valid = await bcrypt.compare(clientSecret, credential.client_secret_hash);
        
        return { valid, credential: valid ? credential : null };
    }

    /**
     * Update last used timestamp
     */
    static async updateLastUsed(credentialId) {
        const connection = await db.getConnection();
        
        try {
            await connection.query(
                'UPDATE api_credentials SET last_used_at = NOW() WHERE id = ?',
                [credentialId]
            );
        } finally {
            connection.release();
        }
    }

    /**
     * Revoke credential
     */
    static async revoke(credentialId, reason = null) {
        const connection = await db.getConnection();
        
        try {
            await connection.query(
                `UPDATE api_credentials 
                 SET status = 'revoked', revoked_at = NOW(), revoked_reason = ?
                 WHERE id = ?`,
                [reason, credentialId]
            );

            logger.info('Revoked API credential', { credentialId, reason });
        } finally {
            connection.release();
        }
    }

    /**
     * List credentials by customer
     */
    static async listByCustomer(customerId, environment = null) {
        const connection = await db.getConnection();
        
        try {
            let query = `
                SELECT id, customer_id, client_id, environment, 
                       status, last_used_at, created_at
                FROM api_credentials
                WHERE customer_id = ?
            `;
            const params = [customerId];

            if (environment) {
                query += ' AND environment = ?';
                params.push(environment);
            }

            query += ' ORDER BY created_at DESC';

            const [rows] = await connection.query(query, params);
            return rows;
        } finally {
            connection.release();
        }
    }

    // Helper methods
    static generateClientId() {
        return `thg_${crypto.randomBytes(16).toString('hex')}`;
    }

    static generateClientSecret() {
        return crypto.randomBytes(32).toString('hex');
    }
}

module.exports = ApiCredentialModel;