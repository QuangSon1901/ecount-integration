const db = require('../database/connection');
const path = require('path');
const KeyGenerator = require('../utils/key-generator');

class UrlProxyModel {
    /**
     * Tạo proxy URL mới, trả về access key
     * @param {string} originalUrl - URL gốc (dài)
     * @param {string} urlType - 'label' | 'mockup' | 'design'
     * @param {number|null} orderId - ID order liên kết (optional)
     * @returns {string} access key
     */
    static async create(originalUrl, urlType, orderId = null) {
        const connection = await db.getConnection();

        try {
            const accessKey = KeyGenerator.generateLabelAccessKey();

            await connection.query(
                `INSERT INTO url_proxies (access_key, original_url, url_type, order_id)
                 VALUES (?, ?, ?, ?)`,
                [accessKey, originalUrl, urlType, orderId]
            );

            return accessKey;
        } finally {
            connection.release();
        }
    }

    /**
     * Tìm proxy URL theo access key
     */
    static async findByAccessKey(accessKey) {
        const connection = await db.getConnection();

        try {
            const [rows] = await connection.query(
                'SELECT * FROM url_proxies WHERE access_key = ?',
                [accessKey]
            );

            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    /**
     * Tạo short URL từ original URL
     * Tự detect đuôi file từ URL gốc, mặc định .png nếu không detect được
     * Ví dụ: https://domain.com/api/proxy/abc123.png
     * @returns {{ accessKey: string, shortUrl: string }}
     */
    static async createShortUrl(originalUrl, urlType, orderId = null) {
        const accessKey = await this.create(originalUrl, urlType, orderId);
        const baseUrl = process.env.BASE_URL || '';

        // Detect extension từ URL gốc
        let ext = '.png'; // default cho design/mockup (ảnh)
        try {
            const urlPath = new URL(originalUrl).pathname;
            const detectedExt = path.extname(urlPath).toLowerCase();
            if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.pdf'].includes(detectedExt)) {
                ext = detectedExt;
            }
        } catch {
            // Google Drive hoặc URL không parse được → giữ default
        }

        const shortUrl = `${baseUrl}/api/proxy/${accessKey}${ext}`;

        return { accessKey, shortUrl };
    }
}

module.exports = UrlProxyModel;
