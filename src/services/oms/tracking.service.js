// src/services/oms/tracking.service.js
//
// Phase 9: pull tracking events from ITC for one OMS order, persist them,
// roll up checkpoints, and advance internal_status only forward.
//
// Idempotency: the dedup UNIQUE on oms_tracking_logs makes re-runs safe;
// checkpoint columns use COALESCE so first-occurrence wins.
//
// State transitions only flow forward; we never downgrade
// (e.g. a delivered order doesn't drop back to shipped on a stale event).

const itcClient = require('../itc/itc.client');
const OmsOrderModel = require('../../models/oms-order.model');
const OmsTrackingLogModel = require('../../models/oms-tracking-log.model');
const OmsTrackingCheckpointModel = require('../../models/oms-tracking-checkpoint.model');
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
    // terminal/orthogonal: cancelled, failed, error → rank treated as "no upgrade allowed"
};

// ITC event-status (lowercased) → our milestone + (optional) target internal_status
const STATUS_MAPPING = {
    in_transit:        { milestone: 'in_transit',        target: 'shipped'   },
    intransit:         { milestone: 'in_transit',        target: 'shipped'   },
    transit:           { milestone: 'in_transit',        target: 'shipped'   },
    out_for_delivery:  { milestone: 'out_for_delivery',  target: 'shipped'   },
    delivered:         { milestone: 'delivered',         target: 'delivered' },
    delivery_completed:{ milestone: 'delivered',         target: 'delivered' },
    exception:         { milestone: 'exception',         target: null        },
    failure:           { milestone: 'exception',         target: null        },
    returned:          { milestone: 'exception',         target: null        },
};

class OmsTrackingService {
    /**
     * Poll ITC for one order, persist events + checkpoints, advance status.
     * Returns a stats object describing what happened.
     *
     * @param {object} omsOrder — full row
     */
    async checkAndUpdate(omsOrder) {
        if (!omsOrder.tracking_number) {
            return { skipped: 'NO_TRACKING_NUMBER' };
        }

        let response;
        try {
            response = await itcClient.fetchTracking(omsOrder.tracking_number);
        } catch (err) {
            // 404 from ITC = label exists but no events yet — common for fresh labels
            if (err.code === 'NOT_FOUND') {
                await OmsOrderModel.updateTrackingTimestamps(omsOrder.id, false);
                return { skipped: 'ITC_NO_EVENTS' };
            }
            throw err;
        }

        const events = response.events || [];
        let inserted = 0;

        for (const ev of events) {
            const wasNew = await OmsTrackingLogModel.insertIfNew({
                omsOrderId: omsOrder.id,
                trackingNumber: omsOrder.tracking_number,
                carrier: omsOrder.carrier || 'ITC',
                status: ev.status,
                eventCode: ev.eventCode,
                location: ev.location,
                description: ev.description,
                tracking_data: ev.raw,
                eventTime: ev.eventTime,
            });
            if (wasNew) inserted++;
        }

        // Roll milestones up — only the first occurrence of each milestone is kept
        const milestonesHit = new Set();
        for (const ev of events) {
            const mapping = STATUS_MAPPING[String(ev.status || '').toLowerCase()];
            if (!mapping) continue;
            await OmsTrackingCheckpointModel.recordMilestone({
                omsOrderId: omsOrder.id,
                trackingNumber: omsOrder.tracking_number,
                milestone: mapping.milestone,
                eventTime: ev.eventTime,
                exceptionNote: mapping.milestone === 'exception' ? ev.description : null,
            });
            milestonesHit.add(mapping.milestone);
        }

        // Compute target internal_status from the *latest* event with a forward-mapping
        const latestTarget = this._computeTargetStatus(events, omsOrder.internal_status);
        let stateTransitioned = false;
        if (latestTarget && latestTarget !== omsOrder.internal_status) {
            stateTransitioned = await OmsOrderModel.transitionInternalStatus(
                omsOrder.id,
                ['label_purchased', 'oms_updated', 'shipped', 'error'],
                latestTarget,
                `tracking event → ${latestTarget}`
            );
        }

        await OmsOrderModel.updateTrackingTimestamps(omsOrder.id, inserted > 0);

        return {
            eventsFetched: events.length,
            eventsInserted: inserted,
            milestones: Array.from(milestonesHit),
            transitionedTo: stateTransitioned ? latestTarget : null,
            itcStatus: response.status,
        };
    }

    /**
     * Pick the latest event whose status maps to a forward transition.
     * Returns null if no upgrade applies.
     */
    _computeTargetStatus(events, currentStatus) {
        const currentRank = STATUS_RANK[currentStatus];
        if (currentRank === undefined) return null; // terminal/orthogonal (cancelled/failed)

        // Iterate latest-first; assume events sorted desc OR pick max by event_time
        const sorted = [...events].sort((a, b) => {
            const ta = a.eventTime ? new Date(a.eventTime).getTime() : 0;
            const tb = b.eventTime ? new Date(b.eventTime).getTime() : 0;
            return tb - ta;
        });

        for (const ev of sorted) {
            const mapping = STATUS_MAPPING[String(ev.status || '').toLowerCase()];
            if (!mapping || !mapping.target) continue;
            const targetRank = STATUS_RANK[mapping.target];
            if (targetRank > currentRank) return mapping.target;
        }
        return null;
    }
}

module.exports = new OmsTrackingService();
