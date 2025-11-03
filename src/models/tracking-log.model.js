const db = require('../database/connection');

class TrackingLogModel {
    /**
     * Tạo tracking log
     */
    static async create(logData) {
        const connection = await db.getConnection();
        
        try {
            const [result] = await connection.query(
                `INSERT INTO tracking_logs (
                    order_id,
                    tracking_number,
                    carrier,
                    status,
                    location,
                    description,
                    tracking_data,
                    event_time
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    logData.orderId,
                    logData.trackingNumber,
                    logData.carrier,
                    logData.status || null,
                    logData.location || null,
                    logData.description || null,
                    JSON.stringify(logData.trackingData || {}),
                    logData.eventTime || null
                ]
            );
            
            return result.insertId;
        } finally {
            connection.release();
        }
    }

    /**
     * Lấy tracking logs của order
     */
    static async findByOrderId(orderId, limit = 50) {
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query(
                `SELECT * FROM tracking_logs 
                WHERE order_id = ? 
                ORDER BY event_time DESC, created_at DESC 
                LIMIT ?`,
                [orderId, limit]
            );
            
            return rows;
        } finally {
            connection.release();
        }
    }

    /**
     * Lấy tracking log mới nhất
     */
    static async getLatestByOrderId(orderId) {
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query(
                `SELECT * FROM tracking_logs 
                WHERE order_id = ? 
                ORDER BY event_time DESC, created_at DESC 
                LIMIT 1`,
                [orderId]
            );
            
            return rows[0] || null;
        } finally {
            connection.release();
        }
    }
}

module.exports = TrackingLogModel;