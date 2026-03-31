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

// Detect file extension from magic bytes
function detectExtensionFromBuffer(buffer) {
    if (!buffer || buffer.length < 8) return null;
    const hex = buffer.slice(0, 8).toString('hex').toUpperCase();

    if (hex.startsWith('89504E47')) return '.png';
    if (hex.startsWith('FFD8FF')) return '.jpg';
    if (hex.startsWith('47494638')) return '.gif';
    if (hex.startsWith('25504446')) return '.pdf';
    if (hex.startsWith('424D')) return '.bmp';
    if (hex.startsWith('52494646') && buffer.slice(8, 12).toString('ascii') === 'WEBP') return '.webp';

    return null;
}

// Extract Google Drive file ID from various URL formats
function extractGoogleDriveFileId(url) {
    if (!url) return null;
    const dMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (dMatch) return dMatch[1];
    const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (idMatch) return idMatch[1];
    return null;
}

class ProxyController {
    /**
     * GET /api/proxy/:accessKey
     * Download file từ URL gốc rồi trả về client.
     * Hỗ trợ Google Drive links (bypass confirmation page).
     * Dùng chung cho label, mockup, design.
     */
    async getByAccessKey(req, res, next) {
        try {
            // Tách accessKey ra khỏi extension nếu có (vd: abc123.png → abc123)
            let { accessKey } = req.params;
            accessKey = accessKey.replace(/\.[a-zA-Z0-9]+$/, '');

            const proxy = await UrlProxyModel.findByAccessKey(accessKey);

            if (!proxy) {
                return errorResponse(res, 'Invalid access key', 404);
            }

            logger.info('Proxying URL:', {
                type: proxy.url_type,
                accessKey,
                orderId: proxy.order_id
            });

            // Download file vào buffer (hỗ trợ Google Drive)
            const buffer = await this._downloadFile(proxy.original_url);

            // Detect content-type từ magic bytes
            const detectedExt = detectExtensionFromBuffer(buffer);
            const contentType = detectedExt
                ? (CONTENT_TYPE_MAP[detectedExt] || 'application/octet-stream')
                : 'application/octet-stream';

            const ext = detectedExt || '.bin';
            const filename = `${proxy.url_type}-${accessKey}${ext}`;

            // Set response headers
            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
            res.setHeader('Content-Length', buffer.length);
            res.setHeader('Cache-Control', 'public, max-age=3600');

            res.send(buffer);

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

    /**
     * Download file từ URL, xử lý Google Drive confirmation page
     * @param {string} url - URL gốc
     * @returns {Promise<Buffer>}
     */
    async _downloadFile(url) {
        const fileId = extractGoogleDriveFileId(url);
        let downloadUrl = fileId
            ? `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`
            : url;

        const response = await axios.get(downloadUrl, {
            responseType: 'arraybuffer',
            timeout: 60000,
            maxRedirects: 10,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        let buffer = Buffer.from(response.data);

        // Google Drive có thể trả về HTML confirmation page thay vì file
        if (fileId && buffer.length < 200000) {
            const content = buffer.toString('utf-8', 0, Math.min(buffer.length, 1000));
            if (content.includes('virus scan') || content.includes('confirm=') || content.includes('Google Drive')) {
                const confirmUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
                const retryResponse = await axios.get(confirmUrl, {
                    responseType: 'arraybuffer',
                    timeout: 60000,
                    maxRedirects: 10,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });
                buffer = Buffer.from(retryResponse.data);
                logger.info('Downloaded file from Google Drive (retry)', {
                    url, fileId, size: buffer.length
                });
                return buffer;
            }
        }

        logger.info('Downloaded file for proxy', {
            url: fileId ? `gdrive:${fileId}` : url,
            size: buffer.length
        });

        return buffer;
    }
}

module.exports = new ProxyController();
