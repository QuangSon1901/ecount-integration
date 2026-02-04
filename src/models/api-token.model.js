// src/models/api-token.model.js
const db = require('../database/connection');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

class ApiTokenModel {
    constructor() {
        this.jwtSecret = process.env.API_JWT_SECRET || 'your-secret-key-change-in-production';
    }

    /**
     * Create new token pair
     */
    async create(tokenData) {
        const connection = await db.getConnection();
        
        try {
            const accessToken = this.generateAccessToken({
                customer_id: tokenData.customerId,
                client_id: tokenData.clientId,
                environment: tokenData.environment
            }, tokenData.accessTokenTTL);

            const refreshToken = this.generateRefreshToken({
                credential_id: tokenData.credentialId,
                customer_id: tokenData.customerId
            }, tokenData.refreshTokenTTL);

            const expiresAt = new Date(Date.now() + (tokenData.accessTokenTTL * 1000));
            const refreshExpiresAt = new Date(Date.now() + (tokenData.refreshTokenTTL * 1000));

            const [result] = await connection.query(
                `INSERT INTO api_access_tokens (
                    credential_id, customer_id, access_token, refresh_token,
                    expires_at, refresh_expires_at, ip_address, user_agent
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    tokenData.credentialId,
                    tokenData.customerId,
                    accessToken,
                    refreshToken,
                    expiresAt,
                    refreshExpiresAt,
                    tokenData.ipAddress || null,
                    tokenData.userAgent || null
                ]
            );

            return {
                id: result.insertId,
                access_token: accessToken,
                refresh_token: refreshToken,
                expires_in: tokenData.accessTokenTTL,
                token_type: 'Bearer'
            };
        } finally {
            connection.release();
        }
    }

    /**
     * Find token by access token
     */
    async findByAccessToken(accessToken) {
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query(
                `SELECT 
                    t.*,
                    cu.customer_code,
                    cu.customer_name,
                    cu.status as customer_status,
                    cu.rate_limit_per_hour,
                    cu.rate_limit_per_day,
                    cu.webhook_enabled,
                    cu.bulk_order_enabled,
                    cu.max_bulk_orders,
                    c.client_id,
                    c.environment
                FROM api_access_tokens t
                JOIN api_customers cu ON cu.id = t.customer_id
                JOIN api_credentials c ON c.id = t.credential_id
                WHERE t.access_token = ?`,
                [accessToken]
            );

            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    /**
     * Find token by refresh token
     */
    async findByRefreshToken(refreshToken) {
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query(
                `SELECT t.*, c.client_id, c.environment,
                        c.access_token_ttl, c.refresh_token_ttl
                 FROM api_access_tokens t
                 JOIN api_credentials c ON c.id = t.credential_id
                 WHERE t.refresh_token = ?`,
                [refreshToken]
            );

            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    /**
     * Verify access token
     */
    async verify(accessToken) {
        try {
            // Decode JWT
            const decoded = jwt.verify(accessToken, this.jwtSecret);
            
            // Check in database
            const token = await this.findByAccessToken(accessToken);
            
            if (!token) {
                throw new Error('Token not found');
            }

            if (token.revoked) {
                throw new Error('Token has been revoked');
            }

            if (new Date(token.expires_at) < new Date()) {
                throw new Error('Token has expired');
            }

            if (token.customer_status !== 'active') {
                throw new Error('Customer account is not active');
            }

            return {
                valid: true,
                customer_id: token.customer_id,
                customer_code: token.customer_code,
                customer_name: token.customer_name,
                client_id: token.client_id,
                environment: token.environment,
                rate_limits: {
                    hourly: token.rate_limit_per_hour,
                    daily: token.rate_limit_per_day
                },
                features: {
                    webhook_enabled: token.webhook_enabled,
                    bulk_order_enabled: token.bulk_order_enabled,
                    max_bulk_orders: token.max_bulk_orders
                },
                bulk_order_enabled: token.bulk_order_enabled,
                max_bulk_orders: token.max_bulk_orders
            };

        } catch (error) {
            logger.error('Token verification failed:', error);
            return {
                valid: false,
                error: error.message
            };
        }
    }

    /**
     * Refresh access token
     */
    async refresh(refreshToken) {
        const connection = await db.getConnection();
        
        try {
            const token = await this.findByRefreshToken(refreshToken);
            
            if (!token) {
                throw new Error('Invalid refresh token');
            }

            if (token.revoked) {
                throw new Error('Token has been revoked');
            }

            if (new Date(token.refresh_expires_at) < new Date()) {
                throw new Error('Refresh token has expired');
            }

            // Generate new access token
            const newAccessToken = this.generateAccessToken({
                customer_id: token.customer_id,
                client_id: token.client_id,
                environment: token.environment
            }, token.access_token_ttl);

            const expiresAt = new Date(Date.now() + (token.access_token_ttl * 1000));

            // Update token
            await connection.query(
                `UPDATE api_access_tokens 
                 SET access_token = ?, expires_at = ?, last_used_at = NOW()
                 WHERE id = ?`,
                [newAccessToken, expiresAt, token.id]
            );

            return {
                access_token: newAccessToken,
                expires_in: token.access_token_ttl,
                token_type: 'Bearer'
            };

        } finally {
            connection.release();
        }
    }

    /**
     * Revoke token
     */
    async revoke(accessToken) {
        const connection = await db.getConnection();
        
        try {
            await connection.query(
                `UPDATE api_access_tokens 
                 SET revoked = TRUE, revoked_at = NOW()
                 WHERE access_token = ?`,
                [accessToken]
            );
        } finally {
            connection.release();
        }
    }

    /**
     * Update last used timestamp
     */
    async updateLastUsed(tokenId) {
        const connection = await db.getConnection();
        
        try {
            await connection.query(
                'UPDATE api_access_tokens SET last_used_at = NOW() WHERE id = ?',
                [tokenId]
            );
        } finally {
            connection.release();
        }
    }

    /**
     * Cleanup expired tokens
     */
    async cleanupExpired() {
        const connection = await db.getConnection();
        
        try {
            const [result] = await connection.query(
                `DELETE FROM api_access_tokens 
                 WHERE expires_at < DATE_SUB(NOW(), INTERVAL 7 DAY)`
            );

            logger.info(`Cleaned up ${result.affectedRows} expired tokens`);
            return result.affectedRows;
        } finally {
            connection.release();
        }
    }

    // Helper methods
    generateAccessToken(payload, expiresIn) {
        return jwt.sign(payload, this.jwtSecret, {
            expiresIn: expiresIn || 3600
        });
    }

    generateRefreshToken(payload, expiresIn) {
        return jwt.sign(payload, this.jwtSecret, {
            expiresIn: expiresIn || 2592000
        });
    }
}

module.exports = new ApiTokenModel();