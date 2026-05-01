// src/models/oms-tracking-log.model.js
//
// Per-event tracking history for OMS orders. Parallels tracking_logs but
// FK to oms_orders (Phase 4 isolation). Dedup is enforced via the
// UNIQUE(oms_order_id, event_time, event_code, status) constraint —
// `insertIfNew` swallows duplicate-key errors so the cron is idempotent.

const db = require('../database/connection');

const ER_DUP_ENTRY = 1062;

class OmsTrackingLogModel {
    /**
     * Insert one event row. Returns true if inserted, false if it was a duplicate.
     */
    static async insertIfNew(event) {
        const conn = await db.getConnection();
        try {
            await conn.query(
                `INSERT INTO oms_tracking_logs (
                    oms_order_id, tracking_number, carrier,
                    status, event_code, location, description,
                    tracking_data, event_time
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    event.omsOrderId,
                    event.trackingNumber,
                    event.carrier || 'ITC',
                    event.status || null,
                    event.eventCode || null,
                    event.location || null,
                    event.description || null,
                    event.tracking_data ? JSON.stringify(event.tracking_data) : null,
                    event.eventTime ? new Date(event.eventTime) : null,
                ]
            );
            return true;
        } catch (err) {
            if (err && err.errno === ER_DUP_ENTRY) {
                return false;
            }
            throw err;
        } finally {
            conn.release();
        }
    }

    static async listByOmsOrderId(omsOrderId, limit = 100) {
        const conn = await db.getConnection();
        try {
            const [rows] = await conn.query(
                `SELECT * FROM oms_tracking_logs
                 WHERE oms_order_id = ?
                 ORDER BY event_time DESC, id DESC
                 LIMIT ?`,
                [omsOrderId, parseInt(limit)]
            );
            return rows;
        } finally {
            conn.release();
        }
    }
}

module.exports = OmsTrackingLogModel;
