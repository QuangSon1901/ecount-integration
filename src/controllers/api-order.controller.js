const apiOrderService = require('../services/api/order.service');
const OrderModel = require('../models/order.model');
const { successResponse, errorResponse } = require('../utils/response');

class ApiOrderController {
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
}

module.exports = new ApiOrderController();