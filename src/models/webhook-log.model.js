// src/models/webhook-log.model.js
const db = require('../database/connection');
const logger = require('../utils/logger');

class WebhookLogModel {
    /**
     * Lưu webhook request vào DB
     */
    static async create({
        source,
        event = null,
        method = 'POST',
        url = null,
        headers = null,
        body = null,
        statusCode = 200,
        response = null,
        orderId = null,
        podWarehouseOrderId = null,
        processingResult = null,
        processingError = null,
        ipAddress = null
    }) {
        const connection = await db.getConnection();
        try {
            const [result] = await connection.query(
                `INSERT INTO webhook_logs
                    (source, event, method, url, headers, body, status_code, response,
                     order_id, pod_warehouse_order_id, processing_result, processing_error, ip_address)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    source,
                    event,
                    method,
                    url,
                    headers ? JSON.stringify(headers) : null,
                    body ? JSON.stringify(body) : null,
                    statusCode,
                    response ? JSON.stringify(response) : null,
                    orderId,
                    podWarehouseOrderId,
                    processingResult,
                    processingError,
                    ipAddress
                ]
            );
            return result.insertId;
        } catch (error) {
            logger.error('[WebhookLog] Failed to save webhook log:', error.message);
            // Không throw - webhook log fail không nên ảnh hưởng webhook processing
            return null;
        } finally {
            connection.release();
        }
    }

    /**
     * Update processing result sau khi xử lý xong
     */
    static async updateResult(id, { orderId, processingResult, processingError, response }) {
        const connection = await db.getConnection();
        try {
            const updates = [];
            const values = [];

            if (orderId !== undefined) { updates.push('order_id = ?'); values.push(orderId); }
            if (processingResult !== undefined) { updates.push('processing_result = ?'); values.push(processingResult); }
            if (processingError !== undefined) { updates.push('processing_error = ?'); values.push(processingError); }
            if (response !== undefined) { updates.push('response = ?'); values.push(JSON.stringify(response)); }

            if (updates.length === 0) return;

            values.push(id);
            await connection.query(
                `UPDATE webhook_logs SET ${updates.join(', ')} WHERE id = ?`,
                values
            );
        } catch (error) {
            logger.error('[WebhookLog] Failed to update webhook log:', error.message);
        } finally {
            connection.release();
        }
    }

    /**
     * Lấy webhook logs theo source, phân trang
     */
    static async findBySource(source, { limit = 50, offset = 0 } = {}) {
        const connection = await db.getConnection();
        try {
            const [rows] = await connection.query(
                `SELECT * FROM webhook_logs WHERE source = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
                [source, limit, offset]
            );
            return rows;
        } finally {
            connection.release();
        }
    }
}

module.exports = WebhookLogModel;
