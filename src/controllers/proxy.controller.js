const axios = require('axios');
const path = require('path');
const UrlProxyModel = require('../models/url-proxy.model');
const { errorResponse } = require('../utils/response');
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

class ProxyController {
    /**
     * GET /api/proxy/:accessKey
     * Proxy stream file (PDF/ảnh) từ URL gốc — không lộ URL gốc
     * Dùng chung cho label, mockup, design
     */
    async getByAccessKey(req, res, next) {
        try {
            const { accessKey } = req.params;

            const proxy = await UrlProxyModel.findByAccessKey(accessKey);

            if (!proxy) {
                return errorResponse(res, 'Invalid access key', 404);
            }

            logger.info('Proxying URL:', {
                type: proxy.url_type,
                accessKey,
                orderId: proxy.order_id
            });

            // Fetch file từ URL gốc dạng stream
            const upstream = await axios.get(proxy.original_url, {
                responseType: 'stream',
                timeout: 30000,
                maxRedirects: 5,
            });

            // Xác định content-type
            let contentType = upstream.headers['content-type'];
            if (!contentType || contentType === 'application/octet-stream') {
                const urlPath = new URL(proxy.original_url).pathname;
                const ext = path.extname(urlPath).toLowerCase();
                contentType = CONTENT_TYPE_MAP[ext] || 'application/octet-stream';
            }

            // Xác định filename
            const urlPath = new URL(proxy.original_url).pathname;
            const ext = path.extname(urlPath).toLowerCase() || '.pdf';
            const filename = `${proxy.url_type}-${accessKey}${ext}`;

            // Set response headers
            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

            if (upstream.headers['content-length']) {
                res.setHeader('Content-Length', upstream.headers['content-length']);
            }

            // Cache 1 giờ
            res.setHeader('Cache-Control', 'public, max-age=3600');

            // Pipe stream về client
            upstream.data.pipe(res);

            upstream.data.on('error', (err) => {
                logger.error('Proxy stream error:', { accessKey, error: err.message });
                if (!res.headersSent) {
                    return errorResponse(res, 'Failed to stream file', 502);
                }
                res.end();
            });

        } catch (error) {
            if (error.response) {
                logger.error('Proxy upstream error:', {
                    status: error.response.status,
                    url: error.config?.url,
                });
                return errorResponse(res, 'File not available from source', error.response.status >= 500 ? 502 : 404);
            }
            next(error);
        }
    }
}

module.exports = new ProxyController();
