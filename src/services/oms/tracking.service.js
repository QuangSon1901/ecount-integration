// src/services/oms/tracking.service.js
//
// Phase 9 (revised): poll ITC order detail for one OMS order and advance
// internal_status based on ITC's status_text field.
//
// Strategy change: instead of parsing raw tracking events (which don't carry
// a reliable status), we call GET /orders/{itc_sid} and map the top-level
// status_text directly to our internal_status.
//
// State transitions only flow forward; we never downgrade.

const itcClient = require('../itc/itc.client');
const OmsOrderModel = require('../../models/oms-order.model');
const logger = require('../../utils/logger');

// Lifecycle order — used to prevent backwards transitions
const STATUS_RANK = {
    pending: 0,
    selected: 1,
    label_purchasing: 2,
    label_purchased: 3,
    oms_updated: 4,
    shipped: 5,
    delivered: 6,
    failed: 7,
    // terminal/orthogonal: cancelled, error → rank treated as "no upgrade allowed"
};

// ITC status_text (lowercased) → our internal_status target
// Generated / Warning → no transition (label exists but not in carrier hands yet)
// Scanned / Processing / Processed → shipped
// Delivered → delivered
// Failed / OrderFailed → failed
const ITC_STATUS_MAP = {
    scanned:     'shipped',
    processing:  'shipped',
    processed:   'shipped',
    delivered:   'delivered',
    failed:      'failed',
    orderfailed: 'failed',
};

class OmsTrackingService {
    /**
     * Fetch ITC order detail for one OMS order and advance internal_status.
     * Returns a stats object describing what happened.
     *
     * Prerequisites: omsOrder must have itc_sid populated (set at label-purchase time).
     *
     * @param {object} omsOrder — full oms_orders row
     */
    async checkAndUpdate(omsOrder) {
        if (!omsOrder.itc_sid) {
            return { skipped: 'NO_ITC_SID' };
        }

        let detail;
        try {
            detail = await itcClient.fetchOrderDetail(omsOrder.itc_sid);
        } catch (err) {
            if (err.code === 'NOT_FOUND') {
                await OmsOrderModel.updateTrackingTimestamps(omsOrder.id, false);
                return { skipped: 'ITC_ORDER_NOT_FOUND' };
            }
            throw err;
        }

        const itcStatusText = detail.statusText || '';
        const targetStatus  = ITC_STATUS_MAP[itcStatusText.toLowerCase().replace(/\s+/g, '')] || null;

        let transitionedTo = null;
        if (targetStatus) {
            const advanced = this._isForwardTransition(omsOrder.internal_status, targetStatus);
            if (advanced) {
                const ok = await OmsOrderModel.transitionInternalStatus(
                    omsOrder.id,
                    ['label_purchased', 'oms_updated', 'shipped', 'error'],
                    targetStatus,
                    `ITC status_text=${itcStatusText} → ${targetStatus}`,
                );
                if (ok) transitionedTo = targetStatus;
            }
        }

        await OmsOrderModel.updateTrackingTimestamps(omsOrder.id, false);

        return {
            itcSid:        detail.sid,
            itcStatus:     detail.status,
            itcStatusText: itcStatusText,
            targetStatus,
            transitionedTo,
        };
    }

    /**
     * Returns true only when moving to a higher-ranked status.
     * Terminal / orthogonal statuses (cancelled, error) are never upgraded.
     */
    _isForwardTransition(currentStatus, targetStatus) {
        const currentRank = STATUS_RANK[currentStatus];
        const targetRank  = STATUS_RANK[targetStatus];
        if (currentRank === undefined || targetRank === undefined) return false;
        return targetRank > currentRank;
    }
}

module.exports = new OmsTrackingService();