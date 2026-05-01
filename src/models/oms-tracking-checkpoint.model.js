// src/models/oms-tracking-checkpoint.model.js
//
// One row per OMS order — milestone timestamps (in_transit / out_for_delivery /
// delivered / exception). Parallels tracking_checkpoints. UPSERT semantics so
// the cron can call recordMilestone repeatedly without churn.

const db = require('../database/connection');

const COLUMN_FOR_MILESTONE = {
    in_transit: 'in_transit_at',
    out_for_delivery: 'out_for_delivery_at',
    delivered: 'delivered_at',
    exception: 'exception_at',
};

class OmsTrackingCheckpointModel {
    static get MILESTONES() { return Object.keys(COLUMN_FOR_MILESTONE); }

    static async findByOmsOrderId(omsOrderId) {
        const conn = await db.getConnection();
        try {
            const [rows] = await conn.query(
                `SELECT * FROM oms_tracking_checkpoints WHERE oms_order_id = ?`,
                [omsOrderId]
            );
            return rows[0] || null;
        } finally {
            conn.release();
        }
    }

    /**
     * Mark a milestone. The checkpoint row is created if missing.
     * Idempotent: if the milestone column already has a value, it's NOT overwritten
     * (we record the FIRST occurrence per the existing tracking_checkpoints semantics).
     *
     * @param {object} args
     * @param {number} args.omsOrderId
     * @param {string} args.trackingNumber
     * @param {string} args.milestone — one of MILESTONES
     * @param {string|Date|null} args.eventTime
     * @param {string|null} [args.exceptionNote] — only used when milestone === 'exception'
     */
    static async recordMilestone({ omsOrderId, trackingNumber, milestone, eventTime, exceptionNote }) {
        const col = COLUMN_FOR_MILESTONE[milestone];
        if (!col) throw new Error(`Unknown milestone '${milestone}'`);
        const ts = eventTime ? new Date(eventTime) : new Date();

        const conn = await db.getConnection();
        try {
            // Insert or update. Use COALESCE so we don't overwrite the first occurrence.
            const sets = `${col} = COALESCE(${col}, VALUES(${col}))`;
            const noteClause = milestone === 'exception'
                ? `, exception_note = COALESCE(exception_note, VALUES(exception_note))`
                : '';

            await conn.query(
                `INSERT INTO oms_tracking_checkpoints (
                    oms_order_id, tracking_number, ${col}${milestone === 'exception' ? ', exception_note' : ''}
                 ) VALUES (?, ?, ?${milestone === 'exception' ? ', ?' : ''})
                 ON DUPLICATE KEY UPDATE ${sets}${noteClause}`,
                milestone === 'exception'
                    ? [omsOrderId, trackingNumber, ts, exceptionNote || null]
                    : [omsOrderId, trackingNumber, ts]
            );
        } finally {
            conn.release();
        }
    }
}

module.exports = OmsTrackingCheckpointModel;
