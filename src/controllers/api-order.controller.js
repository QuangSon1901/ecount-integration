const apiOrderService = require('../services/api/order.service');
const apiPodOrderService = require('../services/api/pod-order.service');
const OrderModel = require('../models/order.model');
const { successResponse, errorResponse } = require('../utils/response');

// Used by getOrder to detect POD orders and format accordingly
const isPodOrder = (order) => order.order_type === 'pod' || (order.order_number && order.order_number.startsWith('POD-'));

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

    /**
     * POST /api/v1/orders/pod/bulk
     * Create multiple POD orders on ECount
     */
    async createBulkPodOrders(req, res, next) {
        try {
            const { orders } = req.body;

            if (!orders || !Array.isArray(orders) || orders.length === 0) {
                return errorResponse(res, 'orders array is required and must not be empty', 400);
            }

            const maxBulkOrders = req.auth.max_bulk_orders || 100;
            if (orders.length > maxBulkOrders) {
                return errorResponse(res, `Maximum ${maxBulkOrders} orders per request`, 400);
            }

            if (!req.auth.bulk_order_enabled) {
                return errorResponse(res, 'Bulk order feature not enabled', 403);
            }

            const result = await apiPodOrderService.createBulkOrders(orders, req.auth);

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
            const { referenceCode } = req.params;

            let order = await OrderModel.findByReferenceCode(referenceCode);

            if (!order) {
                return errorResponse(res, 'Order not found', 404);
            }

            // Verify ownership
            if (order.partner_id !== req.auth.customer_code) {
                return errorResponse(res, 'Order not found!', 404);
            }

            // If order has erp_order_code, find the latest order with that erp_order_code
            if (order.erp_order_code) {
                const latestOrder = await OrderModel.findLatestByErpOrderCode(order.erp_order_code);
                if (latestOrder && latestOrder.partner_id === req.auth.customer_code) {
                    order = latestOrder;
                }
            }

            const formatted = isPodOrder(order)
                ? apiPodOrderService.formatPodOrderResponse(order)
                : apiOrderService.formatOrderResponse(order);
            return successResponse(res, formatted);

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new ApiOrderController();