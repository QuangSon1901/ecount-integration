const apiOrderService = require('../services/api/order.service');
const OrderModel = require('../models/order.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

class ApiOrderController {
    /**
     * POST /api/v1/orders
     * Create single order on ECount
     */
    async createOrder(req, res, next) {
        try {
            const orderData = req.body;

            logger.info('Received order creation request', {
                customerId: req.auth.customer_id,
                customerCode: req.auth.customer_code
            });

            const result = await apiOrderService.createOrder(orderData, req.auth);

            return successResponse(res, result.data, result.message, 201);

        } catch (error) {
            logger.error('Order creation failed:', error);
            next(error);
        }
    }

    /**
     * POST /api/v1/orders/bulk
     * Create multiple orders on ECount
     */
    async createBulkOrders(req, res, next) {
        try {
            const { orders } = req.body;

            // Validate
            if (!orders || !Array.isArray(orders) || orders.length === 0) {
                return errorResponse(res, 'orders array is required and must not be empty', 400);
            }

            // Check bulk permission
            const maxBulkOrders = req.auth.max_bulk_orders || 100;
            if (orders.length > maxBulkOrders) {
                return errorResponse(res, `Maximum ${maxBulkOrders} orders per request`, 400);
            }            

            if (!req.auth.bulk_order_enabled) {
                return errorResponse(res, 'Bulk order feature not enabled', 403);
            }

            logger.info('Received bulk order creation request', {
                customerId: req.auth.customer_id,
                orderCount: orders.length
            });

            const result = await apiOrderService.createBulkOrders(orders, req.auth);

            return res.status(result.success ? 201 : 207).json({
                success: result.success,
                message: result.message,
                data: result.data,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/v1/orders/:orderId
     * Get order details
     */
    async getOrder(req, res, next) {
        try {
            const { orderId } = req.params;

            const order = await OrderModel.findById(orderId);

            if (!order) {
                return errorResponse(res, 'Order not found', 404);
            }

            // Verify ownership
            if (order.api_customer_id !== req.auth.customer_id) {
                return errorResponse(res, 'Access denied', 403);
            }

            return successResponse(res, apiOrderService.formatOrderResponse(order));

        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/v1/orders
     * List orders
     */
    async listOrders(req, res, next) {
        try {
            const {
                status,
                start_date,
                end_date,
                limit = 50,
                offset = 0
            } = req.query;

            const orders = await OrderModel.findByApiCustomer(
                req.auth.customer_id,
                {
                    status,
                    startDate: start_date,
                    endDate: end_date,
                    limit,
                    offset
                }
            );

            const formatted = orders.map(order => 
                apiOrderService.formatOrderResponse(order)
            );

            return successResponse(res, {
                orders: formatted,
                total: formatted.length,
                limit: parseInt(limit),
                offset: parseInt(offset)
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new ApiOrderController();