const axios = require('axios');
const path = require('path');
const OrderModel = require('../models/order.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

// Map extension → content-type
const CONTENT_TYPE_MAP = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
};

class LabelController {
    /**
     * GET /api/labels/:accessKey
     * Proxy stream label file (PDF/ảnh) — không lộ URL gốc
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

            logger.info('Proxying label file:', {
                orderId: order.id,
                orderNumber: order.order_number
            });

            // Fetch file từ URL gốc dạng stream
            const upstream = await axios.get(order.label_url, {
                responseType: 'stream',
                timeout: 30000,
                maxRedirects: 5,
            });

            // Xác định content-type: ưu tiên từ upstream header, fallback theo extension
            let contentType = upstream.headers['content-type'];
            if (!contentType || contentType === 'application/octet-stream') {
                const urlPath = new URL(order.label_url).pathname;
                const ext = path.extname(urlPath).toLowerCase();
                contentType = CONTENT_TYPE_MAP[ext] || 'application/octet-stream';
            }

            // Xác định filename cho download
            const urlPath = new URL(order.label_url).pathname;
            const ext = path.extname(urlPath).toLowerCase() || '.pdf';
            const filename = `label-${order.tracking_number || order.order_number || accessKey}${ext}`;

            // Set response headers
            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

            // Forward content-length nếu có
            if (upstream.headers['content-length']) {
                res.setHeader('Content-Length', upstream.headers['content-length']);
            }

            // Cache 1 giờ (label ít khi thay đổi)
            res.setHeader('Cache-Control', 'public, max-age=3600');

            // Pipe stream về client
            upstream.data.pipe(res);

            // Xử lý lỗi stream
            upstream.data.on('error', (err) => {
                logger.error('Label stream error:', { orderId: order.id, error: err.message });
                if (!res.headersSent) {
                    return errorResponse(res, 'Failed to stream label file', 502);
                }
                res.end();
            });

        } catch (error) {
            // Lỗi khi fetch upstream (timeout, DNS, 404, v.v.)
            if (error.response) {
                logger.error('Label upstream error:', {
                    status: error.response.status,
                    url: error.config?.url,
                });
                return errorResponse(res, 'Label file not available from source', error.response.status >= 500 ? 502 : 404);
            }
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