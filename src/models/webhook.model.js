const db = require('../database/connection');

class WebhookModel {
    /**
     * Tạo webhook mới
     * @returns {number} insertId
     */
    static async create({ customerId, url, secretHash, events }) {
        const connection = await db.getConnection();
        try {
            const [result] = await connection.query(
                `INSERT INTO webhook_registrations (customer_id, url, secret, events, status)
                 VALUES (?, ?, ?, ?, 'active')`,
                [customerId, url, secretHash, JSON.stringify(events)]
            );
            return result.insertId;
        } finally {
            connection.release();
        }
    }

    /**
     * Find by ID + customer_id (scope to owner) — dùng cho API endpoints
     */
    static async findById(webhookId, customerId) {
        const connection = await db.getConnection();
        try {
            const [rows] = await connection.query(
                'SELECT * FROM webhook_registrations WHERE id = ? AND customer_id = ?',
                [webhookId, customerId]
            );
            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    /**
     * Find by ID only (no customer scope) — dùng cho internal worker
     */
    static async findByIdOnly(webhookId) {
        const connection = await db.getConnection();
        try {
            const [rows] = await connection.query(
                'SELECT * FROM webhook_registrations WHERE id = ?',
                [webhookId]
            );
            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    /**
     * List webhooks của một customer
     */
    static async listByCustomer(customerId) {
        const connection = await db.getConnection();
        try {
            const [rows] = await connection.query(
                'SELECT * FROM webhook_registrations WHERE customer_id = ? ORDER BY created_at DESC',
                [customerId]
            );
            return rows;
        } finally {
            connection.release();
        }
    }

    /**
     * Xóa webhook (scope to owner)
     * @returns {boolean}
     */
    static async deleteById(webhookId, customerId) {
        const connection = await db.getConnection();
        try {
            const [result] = await connection.query(
                'DELETE FROM webhook_registrations WHERE id = ? AND customer_id = ?',
                [webhookId, customerId]
            );
            return result.affectedRows > 0;
        } finally {
            connection.release();
        }
    }

    /**
     * Lấy các webhook active của customer đang subscribe một event cụ thể
     */
    static async findActiveByCustomerAndEvent(customerId, event) {
        const connection = await db.getConnection();
        try {
            const [rows] = await connection.query(
                `SELECT * FROM webhook_registrations
                 WHERE customer_id = ? AND status = 'active'
                 AND JSON_CONTAINS(events, ?)`,
                [customerId, JSON.stringify(event)]
            );
            return rows;
        } finally {
            connection.release();
        }
    }

    /**
     * Reset fail_count khi delivery thành công
     */
    static async resetFailCount(webhookId) {
        const connection = await db.getConnection();
        try {
            await connection.query(
                'UPDATE webhook_registrations SET fail_count = 0 WHERE id = ?',
                [webhookId]
            );
        } finally {
            connection.release();
        }
    }

    /**
     * Increment fail_count. Nếu >= 5 -> set inactive.
     */
    static async incrementFailCount(webhookId) {
        const connection = await db.getConnection();
        try {
            await connection.query(
                `UPDATE webhook_registrations
                 SET fail_count = fail_count + 1,
                     status = CASE WHEN fail_count + 1 >= 5 THEN 'inactive' ELSE status END
                 WHERE id = ?`,
                [webhookId]
            );
        } finally {
            connection.release();
        }
    }

    // ─── Delivery Logs ────────────────────────────────────────────

    /**
     * Ghi delivery log sau khi worker gửi xong (1 lần, không cần update sau).
     * Retry logic do jobs table + base.worker quản — ở đây chỉ ghi history.
     */
    static async createDeliveryLog({ webhookId, customerId, event, orderId, payload, status, httpStatus, responseBody, errorMessage }) {
        const connection = await db.getConnection();
        try {
            const [result] = await connection.query(
                `INSERT INTO webhook_delivery_logs
                 (webhook_id, customer_id, event, order_id, payload, status, http_status,
                  response_body, error_message, attempts, delivered_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
                [
                    webhookId,
                    customerId,
                    event,
                    orderId || null,
                    JSON.stringify(payload),
                    status,                                          // 'success' | 'failed'
                    httpStatus || null,
                    responseBody || null,
                    errorMessage || null,
                    status === 'success' ? new Date() : null        // delivered_at
                ]
            );
            return result.insertId;
        } finally {
            connection.release();
        }
    }
}

module.exports = WebhookModel;
