// src/services/api/auth.service.js
const ApiCustomerModel = require('../../models/api-customer.model');
const ApiCredentialModel = require('../../models/api-credential.model');
const ApiTokenModel = require('../../models/api-token.model');
const ApiRateLimitModel = require('../../models/api-rate-limit.model');
const ApiAuditLogModel = require('../../models/api-audit-log.model');
const logger = require('../../utils/logger');

class ApiAuthService {
    /**
     * Generate credentials for customer
     */
    async generateCredentials(customerId, environment = 'production') {
        try {
            // Verify customer exists and is active
            const customer = await ApiCustomerModel.findById(customerId);
            
            if (!customer) {
                throw new Error('Customer not found');
            }

            if (customer.status !== 'active') {
                throw new Error('Customer account is not active');
            }

            // Generate credentials
            const credentials = await ApiCredentialModel.create({
                customerId,
                environment
            });

            logger.info('Generated API credentials', {
                customerId,
                clientId: credentials.client_id,
                environment
            });

            return {
                success: true,
                data: {
                    customer_code: customer.customer_code,
                    client_id: credentials.client_id,
                    client_secret: credentials.client_secret, // Only shown once
                    environment,
                    created_at: new Date()
                }
            };

        } catch (error) {
            logger.error('Failed to generate credentials:', error);
            throw error;
        }
    }

    /**
     * Authenticate and generate token
     */
    async authenticate(clientId, clientSecret, ipAddress, userAgent) {
        try {
            // Verify credentials
            const { valid, credential } = await ApiCredentialModel.verifySecret(
                clientId,
                clientSecret
            );

            if (!valid) {
                throw new Error('Invalid client credentials');
            }

            // Check credential status
            if (credential.status !== 'active') {
                throw new Error('Credentials have been revoked');
            }

            // Check customer status
            if (credential.customer_status !== 'active') {
                throw new Error('Customer account is not active');
            }

            // Generate tokens
            const tokens = await ApiTokenModel.create({
                credentialId: credential.id,
                customerId: credential.customer_id,
                clientId: credential.client_id,
                environment: credential.environment,
                accessTokenTTL: credential.access_token_ttl,
                refreshTokenTTL: credential.refresh_token_ttl,
                ipAddress,
                userAgent
            });

            // Update last used
            await ApiCredentialModel.updateLastUsed(credential.id);

            logger.info('Generated access token', {
                customerId: credential.customer_id,
                clientId: credential.client_id,
                environment: credential.environment
            });

            return {
                success: true,
                data: {
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                    token_type: tokens.token_type,
                    expires_in: tokens.expires_in,
                    environment: credential.environment
                }
            };

        } catch (error) {
            logger.error('Authentication failed:', error);
            throw error;
        }
    }

    /**
     * Refresh access token
     */
    async refreshToken(refreshToken) {
        try {
            const newToken = await ApiTokenModel.refresh(refreshToken);

            logger.info('Refreshed access token');

            return {
                success: true,
                data: newToken
            };

        } catch (error) {
            logger.error('Token refresh failed:', error);
            throw error;
        }
    }

    /**
     * Verify access token
     */
    async verifyToken(accessToken) {
        try {
            const verification = await ApiTokenModel.verify(accessToken);

            if (!verification.valid) {
                throw new Error(verification.error || 'Invalid token');
            }

            return {
                success: true,
                data: verification
            };

        } catch (error) {
            logger.error('Token verification failed:', error);
            throw error;
        }
    }

    /**
     * Revoke access token
     */
    async revokeToken(accessToken) {
        try {
            await ApiTokenModel.revoke(accessToken);

            logger.info('Revoked access token');

            return {
                success: true,
                message: 'Token revoked successfully'
            };

        } catch (error) {
            logger.error('Token revocation failed:', error);
            throw error;
        }
    }

    /**
     * Revoke credentials
     */
    async revokeCredentials(credentialId, reason = null) {
        try {
            await ApiCredentialModel.revoke(credentialId, reason);

            logger.info('Revoked credentials', { credentialId, reason });

            return {
                success: true,
                message: 'Credentials revoked successfully'
            };

        } catch (error) {
            logger.error('Credential revocation failed:', error);
            throw error;
        }
    }
}

module.exports = new ApiAuthService();