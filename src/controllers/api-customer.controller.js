// src/controllers/api-customer.controller.js
const ApiCustomerModel = require('../models/api-customer.model');
const ApiAuthService = require('../services/api/auth.service');
const ApiCredentialModel = require('../models/api-credential.model');
const ApiRateLimitModel = require('../models/api-rate-limit.model');
const WebhookModel = require('../models/webhook.model');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('../database/connection');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

class ApiCustomerController {
    /**
     * POST /api/v1/admin/customers
     * Create new API customer (Admin only)
     */
    async createCustomer(req, res, next) {
        try {
            const {
                customer_code,
                customer_name,
                email,
                phone,
                environment = 'production',
                rate_limit_per_hour = 6000,
                rate_limit_per_day = 10000,
                webhook_enabled = true,
                bulk_order_enabled = true
            } = req.body;

            // Validate required fields
            if (!customer_code || !customer_name) {
                return errorResponse(res, 'customer_code and customer_name are required', 400);
            }

            // Check if customer code already exists
            const existing = await ApiCustomerModel.findByCode(customer_code);
            if (existing) {
                return errorResponse(res, 'Customer code already exists', 409, {
                    error_code: 'DUPLICATE_CUSTOMER_CODE'
                });
            }

            // Generate random portal password (12 chars, alphanumeric)
            const portalPassword = crypto.randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);

            // Create customer
            const customerId = await ApiCustomerModel.create({
                customerCode: customer_code,
                customerName: customer_name,
                email,
                phone,
                environment,
                rateLimitPerHour: rate_limit_per_hour,
                rateLimitPerDay: rate_limit_per_day,
                webhookEnabled: webhook_enabled,
                bulkOrderEnabled: bulk_order_enabled
            });

            // Set portal password (hashed)
            const passwordHash = await bcrypt.hash(portalPassword, 10);
            await ApiCustomerModel.setPortalPassword(customerId, passwordHash);

            logger.info('Created API customer', {
                customerId,
                customerCode: customer_code
            });

            return successResponse(res, {
                customer_id: customerId,
                customer_code,
                portal_password: portalPassword  // shown once for admin to copy
            }, 'Customer created successfully', 201);

        } catch (error) {
            logger.error('Failed to create customer:', error);
            next(error);
        }
    }

    /**
     * GET /api/v1/admin/customers
     * List all customers (Admin only)
     */
    async listCustomers(req, res, next) {
        try {
            const { status, environment, limit = 50, offset = 0 } = req.query;

            const customers = await ApiCustomerModel.list({
                status,
                environment,
                limit,
                offset
            });

            return successResponse(res, {
                customers,
                total: customers.length,
                limit: parseInt(limit),
                offset: parseInt(offset)
            }, 'Customers retrieved successfully');

        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/v1/admin/customers/:customerId
     * Get customer details (Admin only)
     */
    async getCustomer(req, res, next) {
        try {
            const { customerId } = req.params;

            const customer = await ApiCustomerModel.findById(customerId);

            if (!customer) {
                return errorResponse(res, 'Customer not found', 404);
            }

            // Get credentials (only active ones — revoked are hidden)
            const allCredentials = await ApiCredentialModel.listByCustomer(customerId);
            const activeCredentials = allCredentials.filter(c => c.status === 'active');

            // Get stats
            const stats = await ApiCustomerModel.getStats(customerId);

            return successResponse(res, {
                ...customer,
                credentials: activeCredentials.map(c => ({
                    id: c.id,
                    client_id: c.client_id,
                    environment: c.environment,
                    status: c.status,
                    last_used_at: c.last_used_at,
                    created_at: c.created_at
                })),
                stats
            }, 'Customer retrieved successfully');

        } catch (error) {
            next(error);
        }
    }

    /**
     * PATCH /api/v1/admin/customers/:customerId
     * Update customer (Admin only)
     */
    async updateCustomer(req, res, next) {
        try {
            const { customerId } = req.params;
            const {
                customerName, email, phone, status,
                rateLimitPerHour, rateLimitPerDay,
                webhookEnabled, bulkOrderEnabled, metadata,
                telegramResponsibles, telegramGroupIds
            } = req.body;

            const customer = await ApiCustomerModel.findById(customerId);

            if (!customer) {
                return errorResponse(res, 'Customer not found', 404);
            }

            // Validate status if provided
            if (status !== undefined && !['active', 'suspended', 'inactive'].includes(status)) {
                return errorResponse(res, 'Invalid status. Must be active, suspended, or inactive', 400);
            }

            // Validate customerName if provided
            if (customerName !== undefined && !customerName.trim()) {
                return errorResponse(res, 'Customer name cannot be empty', 400);
            }

            // Build sanitized update data (only allowed fields)
            const updateData = {};
            if (customerName !== undefined) updateData.customerName = customerName.trim();
            if (email !== undefined) updateData.email = email;
            if (phone !== undefined) updateData.phone = phone;
            if (status !== undefined) updateData.status = status;
            if (rateLimitPerHour !== undefined) updateData.rateLimitPerHour = parseInt(rateLimitPerHour);
            if (rateLimitPerDay !== undefined) updateData.rateLimitPerDay = parseInt(rateLimitPerDay);
            if (webhookEnabled !== undefined) updateData.webhookEnabled = webhookEnabled;
            if (bulkOrderEnabled !== undefined) updateData.bulkOrderEnabled = bulkOrderEnabled;
            if (metadata !== undefined) updateData.metadata = metadata;
            if (telegramResponsibles !== undefined) updateData.telegramResponsibles = telegramResponsibles ? telegramResponsibles.trim() : null;
            if (telegramGroupIds !== undefined) updateData.telegramGroupIds = telegramGroupIds ? telegramGroupIds.trim() : null;

            if (Object.keys(updateData).length === 0) {
                return errorResponse(res, 'No valid fields to update', 400);
            }

            await ApiCustomerModel.update(customerId, updateData);

            logger.info('Updated customer', { customerId, fields: Object.keys(updateData) });

            return successResponse(res, null, 'Customer updated successfully');

        } catch (error) {
            next(error);
        }
    }

    /**
     * POST /api/v1/admin/customers/:customerId/credentials
     * Generate new credentials for customer (Admin only)
     */
    async generateCredentials(req, res, next) {
        try {
            const { customerId } = req.params;
            const { environment = 'production' } = req.body;

            const customer = await ApiCustomerModel.findById(customerId);

            if (!customer) {
                return errorResponse(res, 'Customer not found', 404);
            }

            const credentials = await ApiAuthService.generateCredentials(customerId, environment);

            return successResponse(res, credentials.data, 'Credentials generated successfully', 201);

        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/v1/admin/customers/:customerId/credentials
     * Get current credentials (customer hoặc admin)
     * Chỉ trả về client_id, KHÔNG trả về client_secret (bảo mật)
     */
    async getCredentials(req, res, next) {
        try {
            const { customerId } = req.params;

            const customer = await ApiCustomerModel.findById(customerId);

            if (!customer) {
                return errorResponse(res, 'Customer not found', 404);
            }

            // Get active credentials (only client_id, + secret for sandbox)
            const credentials = await ApiCredentialModel.listByCustomer(customerId, null);

            // Find active credential
            const activeCredential = credentials.find(c => c.status === 'active');

            if (!activeCredential) {
                return successResponse(res, credentials, 'No active credentials found');
            }

            const responseData = {
                client_id: activeCredential.client_id,
                environment: activeCredential.environment,
                created_at: activeCredential.created_at,
                expires_at: activeCredential.expires_at,
                status: activeCredential.status
            };

            // Sandbox: include plaintext secret so customer can view/copy it
            if (activeCredential.environment === 'sandbox' && activeCredential.client_secret_plain) {
                responseData.client_secret = activeCredential.client_secret_plain;
            }

            return successResponse(res, responseData, 'Credentials retrieved successfully');

        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/v1/admin/customers/:customerId/rate-limits
     * Get rate limit statistics (Admin only)
     */
    async getRateLimitStats(req, res, next) {
        try {
            const { customerId } = req.params;

            const customer = await ApiCustomerModel.findById(customerId);

            if (!customer) {
                return errorResponse(res, 'Customer not found', 404);
            }

            const [hourlyStats, dailyStats] = await Promise.all([
                ApiRateLimitModel.getStats(customerId, 'hourly'),
                ApiRateLimitModel.getStats(customerId, 'daily')
            ]);

            return successResponse(res, {
                hourly: hourlyStats,
                daily: dailyStats
            }, 'Rate limit stats retrieved successfully');

        } catch (error) {
            next(error);
        }
    }

    // ─── Portal Password ──────────────────────────────────────────

    /**
     * POST /api/v1/admin/customers/:customerId/portal-password
     * Admin set/reset mật khẩu portal cho khách hàng
     */
    async setPortalPassword(req, res, next) {
        try {
            const { customerId } = req.params;

            const customer = await ApiCustomerModel.findById(customerId);
            if (!customer) {
                return errorResponse(res, 'Customer not found', 404);
            }

            // Generate random password (12 chars, alphanumeric)
            const newPassword = crypto.randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);

            const hash = await bcrypt.hash(newPassword, 10);
            await ApiCustomerModel.setPortalPassword(customerId, hash);

            logger.info('Portal password reset', { customerId });
            return successResponse(res, {
                portal_password: newPassword  // shown once for admin to copy
            }, 'Portal password reset successfully');

        } catch (error) {
            next(error);
        }
    }

    // ─── Change Portal Password (customer self-service) ──────────

    /**
     * POST /api/v1/admin/customers/:customerId/change-password
     * Customer changes their own portal password
     */
    async changePortalPassword(req, res, next) {
        try {
            const { customerId } = req.params;
            const { current_password, new_password } = req.body;

            if (!current_password || !new_password) {
                return errorResponse(res, 'Current password and new password are required', 400);
            }

            if (new_password.length < 6) {
                return errorResponse(res, 'New password must be at least 6 characters', 400);
            }

            const customer = await ApiCustomerModel.findById(customerId);
            if (!customer) {
                return errorResponse(res, 'Customer not found', 404);
            }

            // Verify current password
            if (!customer.portal_password_hash) {
                return errorResponse(res, 'No portal password set. Please contact admin.', 400);
            }

            const valid = await bcrypt.compare(current_password, customer.portal_password_hash);
            if (!valid) {
                return errorResponse(res, 'Current password is incorrect', 401);
            }

            // Hash and set new password
            const hash = await bcrypt.hash(new_password, 10);
            await ApiCustomerModel.setPortalPassword(customerId, hash);

            logger.info('Customer changed portal password', { customerId });
            return successResponse(res, null, 'Password changed successfully');

        } catch (error) {
            next(error);
        }
    }

    // ─── Refresh Credentials ──────────────────────────────────────

    /**
     * POST /api/v1/admin/customers/:customerId/credentials/refresh
     * Revoke credential cũ + tạo credential mới cùng environment.
     * Body: { credentialId } — ID của credential muốn refresh.
     */
    async refreshCredentials(req, res, next) {
        try {
            const { customerId } = req.params;
            const { credentialId } = req.body;

            const customer = await ApiCustomerModel.findById(customerId);
            if (!customer) {
                return errorResponse(res, 'Customer not found', 404);
            }

            // Sandbox customers cannot refresh credentials themselves (admin can)
            if (customer.environment === 'sandbox' && !req.isAdmin) {
                return errorResponse(res, 'Sandbox customers cannot reset credentials. Please contact admin.', 403);
            }

            if (!credentialId) {
                return errorResponse(res, 'credentialId is required', 400);
            }

            // Verify credential belongs to this customer
            const credentials = await ApiCredentialModel.listByCustomer(customerId);
            const target = credentials.find(c => c.id === parseInt(credentialId));
            if (!target) {
                return errorResponse(res, 'Credential not found for this customer', 404);
            }

            // Revoke cũ
            await ApiCredentialModel.revoke(target.id, 'Refreshed by admin/portal');

            // Tạo mới cùng environment
            const newCred = await ApiCredentialModel.create({
                customerId: parseInt(customerId),
                environment: target.environment
            });

            logger.info('Credentials refreshed', { customerId, oldId: target.id, newId: newCred.id });

            return successResponse(res, {
                client_id: newCred.client_id,
                client_secret: newCred.client_secret,
                environment: target.environment
            }, 'Credentials refreshed successfully', 201);

        } catch (error) {
            next(error);
        }
    }

    // ─── Revoke Credential ─────────────────────────────────────────

    /**
     * POST /api/v1/admin/customers/:customerId/credentials/:credentialId/revoke
     * Revoke a specific credential (Admin only)
     */
    async revokeCredential(req, res, next) {
        try {
            const { customerId, credentialId } = req.params;

            const customer = await ApiCustomerModel.findById(customerId);
            if (!customer) {
                return errorResponse(res, 'Customer not found', 404);
            }

            // Verify credential belongs to this customer
            const credentials = await ApiCredentialModel.listByCustomer(customerId);
            const target = credentials.find(c => c.id === parseInt(credentialId));
            if (!target) {
                return errorResponse(res, 'Credential not found for this customer', 404);
            }

            if (target.status === 'revoked') {
                return errorResponse(res, 'Credential is already revoked', 400);
            }

            await ApiCredentialModel.revoke(target.id, 'Revoked by admin');

            logger.info('Credential revoked', { customerId, credentialId: target.id });

            return successResponse(res, null, 'Credential revoked successfully');

        } catch (error) {
            next(error);
        }
    }

    // ─── Webhooks (for detail page) ───────────────────────────────

    /**
     * GET /api/v1/admin/customers/:customerId/webhooks
     */
    async getWebhooks(req, res, next) {
        try {
            const { customerId } = req.params;

            const customer = await ApiCustomerModel.findById(customerId);
            if (!customer) {
                return errorResponse(res, 'Customer not found', 404);
            }

            const webhooks = await WebhookModel.listByCustomer(parseInt(customerId));
            const formatted = webhooks.map(w => ({
                id: w.id,
                url: w.url,
                events: typeof w.events === 'string' ? JSON.parse(w.events) : w.events,
                status: w.status,
                fail_count: w.fail_count,
                created_at: w.created_at,
                updated_at: w.updated_at
            }));

            return successResponse(res, formatted);

        } catch (error) {
            next(error);
        }
    }

    /**
     * DELETE /api/v1/admin/customers/:customerId/webhooks/:webhookId
     */
    async deleteWebhook(req, res, next) {
        try {
            const { customerId, webhookId } = req.params;

            const customer = await ApiCustomerModel.findById(customerId);
            if (!customer) {
                return errorResponse(res, 'Customer not found', 404);
            }

            const deleted = await WebhookModel.deleteById(parseInt(webhookId), parseInt(customerId));
            if (!deleted) {
                return errorResponse(res, 'Webhook not found', 404);
            }

            return successResponse(res, null, 'Webhook deleted successfully');

        } catch (error) {
            next(error);
        }
    }

    /**
     * POST /api/v1/admin/customers/:customerId/webhooks/:webhookId/test
     * Body: { event: 'tracking.updated' | 'order.status' | 'order.exception' }
     * Gửi test webhook đồng bộ — bắt buộc chọn event type
     */
    async testWebhook(req, res, next) {
        try {
            const { customerId, webhookId } = req.params;
            const { event } = req.body || {};

            if (!event) {
                return errorResponse(res, 'Event type is required', 400);
            }

            const customer = await ApiCustomerModel.findById(customerId);
            if (!customer) {
                return errorResponse(res, 'Customer not found', 404);
            }

            const webhook = await WebhookModel.findById(parseInt(webhookId), parseInt(customerId));
            if (!webhook) {
                return errorResponse(res, 'Webhook not found', 404);
            }

            const webhookService = require('../services/api/webhook.service');
            const result = await webhookService.testDeliver(webhook, event);

            return successResponse(res, result, result.success
                ? `Test webhook [${event}] sent successfully (HTTP ${result.httpStatus})`
                : `Test webhook [${event}] failed: ${result.error}`
            );

        } catch (error) {
            next(error);
        }
    }

    /**
     * POST /api/v1/admin/customers/:customerId/webhooks
     * Register webhook (từ detail page)
     */
    async createWebhook(req, res, next) {
        try {
            const { customerId } = req.params;
            const { url, secret, events } = req.body;

            const customer = await ApiCustomerModel.findById(customerId);
            if (!customer) {
                return errorResponse(res, 'Customer not found', 404);
            }

            const webhookService = require('../services/api/webhook.service');
            const webhook = await webhookService.register({
                customerId: parseInt(customerId),
                url,
                secret,
                events
            });

            return successResponse(res, webhookService.formatWebhook(webhook), 'Webhook registered', 201);

        } catch (error) {
            next(error);
        }
    }

    // ─── Webhook Delivery Logs ────────────────────────────────────

    /**
     * GET /api/v1/admin/customers/:customerId/webhook-logs
     * Query: ?limit=50&offset=0&event=&status=
     */
    async getWebhookLogs(req, res, next) {
        try {
            const { customerId } = req.params;
            const { limit = 50, offset = 0, event, status } = req.query;

            const customer = await ApiCustomerModel.findById(customerId);
            if (!customer) {
                return errorResponse(res, 'Customer not found', 404);
            }

            const connection = await db.getConnection();
            try {
                let where = 'WHERE wdl.customer_id = ?';
                const params = [parseInt(customerId)];

                if (event) {
                    where += ' AND wdl.event = ?';
                    params.push(event);
                }
                if (status) {
                    where += ' AND wdl.status = ?';
                    params.push(status);
                }

                // Total count
                const [countRows] = await connection.query(
                    `SELECT COUNT(*) as total FROM webhook_delivery_logs wdl ${where}`,
                    params
                );
                const total = countRows[0].total;

                // Paginated rows
                const [rows] = await connection.query(
                    `SELECT wdl.*, wr.url as webhook_url
                     FROM webhook_delivery_logs wdl
                     LEFT JOIN webhook_registrations wr ON wdl.webhook_id = wr.id
                     ${where}
                     ORDER BY wdl.created_at DESC
                     LIMIT ? OFFSET ?`,
                    [...params, parseInt(limit), parseInt(offset)]
                );

                return successResponse(res, {
                    logs: rows,
                    total,
                    limit: parseInt(limit),
                    offset: parseInt(offset)
                });

            } finally {
                connection.release();
            }

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new ApiCustomerController();