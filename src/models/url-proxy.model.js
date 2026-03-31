const db = require('../database/connection');
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
     * @returns {{ accessKey: string, shortUrl: string }}
     */
    static async createShortUrl(originalUrl, urlType, orderId = null) {
        const accessKey = await this.create(originalUrl, urlType, orderId);
        const baseUrl = process.env.BASE_URL || '';
        const shortUrl = `${baseUrl}/api/proxy/${accessKey}`;

        return { accessKey, shortUrl };
    }
}

module.exports = UrlProxyModel;
