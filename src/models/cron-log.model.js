const db = require('../database/connection');

class CronLogModel {
    /**
     * Bắt đầu cron job
     */
    static async start(jobName) {
        const connection = await db.getConnection();
        
        try {
            const [result] = await connection.query(
                `INSERT INTO cron_logs (job_name, status) VALUES (?, 'started')`,
                [jobName]
            );
            
            return result.insertId;
        } finally {
            connection.release();
        }
    }

    /**
     * Cập nhật cron job
     */
    static async update(id, updateData) {
        const connection = await db.getConnection();
        
        try {
            const fields = [];
            const values = [];
            
            if (updateData.status) {
                fields.push('status = ?');
                values.push(updateData.status);
            }
            if (updateData.ordersProcessed !== undefined) {
                fields.push('orders_processed = ?');
                values.push(updateData.ordersProcessed);
            }
            if (updateData.ordersSuccess !== undefined) {
                fields.push('orders_success = ?');
                values.push(updateData.ordersSuccess);
            }
            if (updateData.ordersFailed !== undefined) {
                fields.push('orders_failed = ?');
                values.push(updateData.ordersFailed);
            }
            if (updateData.errorMessage) {
                fields.push('error_message = ?');
                values.push(updateData.errorMessage);
            }
            if (updateData.executionTimeMs !== undefined) {
                fields.push('execution_time_ms = ?');
                values.push(updateData.executionTimeMs);
            }
            
            fields.push('completed_at = CURRENT_TIMESTAMP');
            values.push(id);
            
            await connection.query(
                `UPDATE cron_logs SET ${fields.join(', ')} WHERE id = ?`,
                values
            );
        } finally {
            connection.release();
        }
    }
}

module.exports = CronLogModel;