const orderService = require('../services/order.service');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');
const { YUNEXPRESS } = require('../config/carriers.config');

class OrderController {
    /**
     * POST /api/orders
     * Tạo đơn hàng và cập nhật ERP (luồng chính)
     */
    async createOrder(req, res, next) {
        try {
            const orderData = req.body;
            
            const result = await orderService.processOrder(orderData);
            
            return successResponse(res, result.data, result.message, 201);
        } catch (error) {
            next(error);
        }
    }

    async createOrderMulti(req, res, next) {
        try {
            const { orders } = req.body;
            
            // Validate
            if (!orders || !Array.isArray(orders) || orders.length === 0) {
                return errorResponse(res, 'orders array is required and must not be empty', 400);
            }

            if (orders.length > 100) {
                return errorResponse(res, 'Maximum 100 orders per request', 400);
            }

            logger.info(`Nhận yêu cầu tạo ${orders.length} đơn hàng`);
            
            const result = await orderService.processOrderMulti(orders);
            
            // Nếu có đơn bị block, trả về 409 Conflict
            if (!result.success && result.data.blocked && result.data.blocked.length > 0) {
                return res.status(409).json({
                    success: false,
                    message: result.message,
                    data: result.data,
                    timestamp: new Date().toISOString()
                });
            }
            
            // Success case
            return successResponse(res, result.data, result.message, 201);
            
        } catch (error) {
            next(error);
        }
    }

    /**
     * POST /api/orders/create-only
     * Chỉ tạo đơn hàng, không cập nhật ERP
     */
    async createOrderOnly(req, res, next) {
        try {
            const orderData = req.body;
            
            const result = await orderService.createOrderOnly(orderData);
            
            return successResponse(res, result.data, result.message, 201);
        } catch (error) {
            next(error);
        }
    }

    /**
     * POST /api/orders/update-erp
     * Chỉ cập nhật ERP với tracking number có sẵn
     */
    async updateErpOnly(req, res, next) {
        try {
            const { erpOrderCode, trackingNumber, status } = req.body;
            
            if (!erpOrderCode) {
                return errorResponse(res, 'erpOrderCode are required', 400);
            }
            
            const result = await orderService.updateErpOnly(erpOrderCode, trackingNumber, status);
            
            return successResponse(res, result.data, result.message);
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/orders/carriers
     * Lấy danh sách carriers khả dụng
     */
    async getCarriers(req, res, next) {
        try {
            const carriers = orderService.getAvailableCarriers();
            
            return successResponse(res, { carriers }, 'Available carriers retrieved');
        } catch (error) {
            next(error);
        }
    }

    async trackByTrackingNumber(req, res, next) {
        try {
            const { trackingNumber } = req.params;
            const { carrier } = req.query;
            
            const result = await orderService.trackByTrackingNumber(
                trackingNumber,
                carrier
            );
            
            return successResponse(res, result.data, result.message);
        } catch (error) {
            next(error);
        }
    }

    async getProducts(req, res, next) {
        try {
            const { country_code } = req.query;
            
            const carrier = 'YUNEXPRESS';
            const result = await orderService.getProducts(
                country_code,
                carrier
            );
            
            return successResponse(res, result, 'Products retrieved successfully');
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/orders/info/:orderCode
     * Lấy thông tin chi tiết đơn hàng
     */
    async getOrderInfo(req, res, next) {
        try {
            const { orderCode } = req.params;
            const { carrier, type, path } = req.query;
            
            const result = await orderService.getOrderInfo(
                orderCode,
                carrier || 'YUNEXPRESS',
                type || 'carrier',
                path || '',
            );
            
            return successResponse(res, result.data, result.message);
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/orders/pending
     * Lấy danh sách orders đang chờ theo trạng thái
     */
    async getPendingOrders(req, res, next) {
        try {
            const { status, limit = 50, offset = 0 } = req.query;
            
            const result = await orderService.getPendingOrders({
                status,
                limit: parseInt(limit),
                offset: parseInt(offset)
            });
            
            return successResponse(res, result, 'Pending orders retrieved successfully');
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/orders/pending/summary
     * Lấy tổng quan orders đang chờ
     */
    async getPendingSummary(req, res, next) {
        try {
            const result = await orderService.getPendingSummary();
            
            return successResponse(res, result, 'Pending summary retrieved successfully');
        } catch (error) {
            next(error);
        }
    }

    /**
     * POST /api/orders/status/batch
     * Lấy trạng thái nhiều đơn hàng theo erp_order_code
     */
    async getStatusBatch(req, res, next) {
        try {
            const { erp_order_codes } = req.body;
            
            // Validate
            if (!erp_order_codes || !Array.isArray(erp_order_codes) || erp_order_codes.length === 0) {
                return errorResponse(res, 'erp_order_codes array is required and must not be empty', 400);
            }

            if (erp_order_codes.length > 100) {
                return errorResponse(res, 'Maximum 100 order codes per request', 400);
            }

            logger.info(`Tra cứu trạng thái ${erp_order_codes.length} đơn hàng`);
            
            const result = await orderService.getStatusBatch(erp_order_codes);
            
            return successResponse(res, result, 'Status retrieved successfully');
            
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/orders/health
     * Health check
     */
    async healthCheck(req, res) {
        return successResponse(res, {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            carriers: orderService.getAvailableCarriers()
        });
    }
}

module.exports = new OrderController();