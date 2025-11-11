const OrderModel = require('../models/order.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

class LabelController {
    /**
     * GET /api/labels/:accessKey
     * Redirect đến label URL gốc
     */
    async getLabelByAccessKey(req, res, next) {
        try {
            const { accessKey } = req.params;
            
            logger.info('Truy cập label bằng access key:', { accessKey });
            
            const order = await OrderModel.findByLabelAccessKey(accessKey);
            
            if (!order) {
                return errorResponse(res, 'Invalid access key', 404);
            }
            
            if (!order.label_url) {
                return errorResponse(res, 'Label URL not available', 404);
            }
            
            logger.info('Redirecting to label URL:', {
                orderId: order.id,
                orderNumber: order.order_number
            });
            
            // Redirect đến label URL gốc
            return res.redirect(order.label_url);
            
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/labels/:accessKey/info
     * Lấy thông tin label (không redirect)
     */
    async getLabelInfo(req, res, next) {
        try {
            const { accessKey } = req.params;
            
            const order = await OrderModel.findByLabelAccessKey(accessKey);
            
            if (!order) {
                return errorResponse(res, 'Invalid access key', 404);
            }
            
            return successResponse(res, {
                orderNumber: order.order_number,
                trackingNumber: order.tracking_number,
                waybillNumber: order.waybill_number,
                labelUrl: order.label_url,
                carrier: order.carrier,
                status: order.status,
                createdAt: order.created_at
            }, 'Label info retrieved successfully');
            
        } catch (error) {
            next(error);
        }
    }

    /**
     * POST /api/labels/generate-access-key
     * Generate access key cho order (manual)
     */
    async generateAccessKey(req, res, next) {
        try {
            const { orderId } = req.body;
            
            if (!orderId) {
                return errorResponse(res, 'orderId is required', 400);
            }
            
            const order = await OrderModel.findById(orderId);
            
            if (!order) {
                return errorResponse(res, 'Order not found', 404);
            }
            
            if (!order.label_url) {
                return errorResponse(res, 'Order does not have label URL', 400);
            }
            
            const accessKey = await OrderModel.generateLabelAccessKey(orderId);
            
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const shortUrl = `${baseUrl}/api/labels/${accessKey}`;
            
            return successResponse(res, {
                accessKey,
                shortUrl,
                orderId,
                orderNumber: order.order_number,
                trackingNumber: order.tracking_number
            }, 'Access key generated successfully', 201);
            
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new LabelController();