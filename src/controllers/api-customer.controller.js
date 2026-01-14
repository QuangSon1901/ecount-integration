// src/controllers/api-customer.controller.js
const ApiCustomerModel = require('../models/api-customer.model');
const ApiAuthService = require('../services/api/auth.service');
const ApiCredentialModel = require('../models/api-credential.model');
const ApiRateLimitModel = require('../models/api-rate-limit.model');
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
                rate_limit_per_day = 10000
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

            // Create customer
            const customerId = await ApiCustomerModel.create({
                customerCode: customer_code,
                customerName: customer_name,
                email,
                phone,
                environment,
                rateLimitPerHour: rate_limit_per_hour,
                rateLimitPerDay: rate_limit_per_day
            });

            // Generate credentials
            const credentials = await ApiAuthService.generateCredentials(customerId, environment);

            logger.info('Created API customer', {
                customerId,
                customerCode: customer_code
            });

            return successResponse(res, {
                customer_id: customerId,
                customer_code,
                credentials: credentials.data
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

            // Get credentials
            const credentials = await ApiCredentialModel.listByCustomer(customerId);

            // Get stats
            const stats = await ApiCustomerModel.getStats(customerId);

            return successResponse(res, {
                ...customer,
                credentials: credentials.map(c => ({
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
            const updateData = req.body;

            const customer = await ApiCustomerModel.findById(customerId);

            if (!customer) {
                return errorResponse(res, 'Customer not found', 404);
            }

            await ApiCustomerModel.update(customerId, updateData);

            logger.info('Updated customer', { customerId });

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
}

module.exports = new ApiCustomerController();