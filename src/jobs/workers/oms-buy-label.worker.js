// src/jobs/workers/oms-buy-label.worker.js
//
// Consumer for `oms_buy_label` jobs.
// Payload: { omsOrderId, productCode? }
//
// Wraps labelPurchase.purchaseFor — that service already handles atomic state
// transitions and writes internal_status='error' + internal_status_note when
// ITC fails or a row can't be persisted. This worker:
//   - Retries transient failures via BaseWorker (5s/10s/20s/40s/80s backoff)
//   - On max attempts, sends a Telegram alert AND ensures the row ends in
//     'error' with a stable error message (re-stamped here as a safety net
//     because some failure paths in the service throw before flipping state).

const BaseWorker = require('./base.worker');
const labelPurchase = require('../../services/itc/label-purchase.service');
const OmsOrderModel = require('../../models/oms-order.model');
const telegram = require('../../utils/telegram');
const logger = require('../../utils/logger');

class OmsBuyLabelWorker extends BaseWorker {
    constructor() {
        super('oms_buy_label', {
            intervalMs: 5000,
            concurrency: 3,
        });
    }

    async processJob(job) {
        const { omsOrderId, productCode, sellerProfileId } = job.payload || {};
        if (!omsOrderId) {
            throw new Error('oms_buy_label job missing omsOrderId');
        }

        // Bulk controller đã transition pending|selected → label_purchasing tại enqueue
        // để chặn duplicate. Truyền skipClaim để service không tự claim lại (sẽ fail
        // vì state hiện tại đã là label_purchasing, không nằm trong VALID_PRE_STATES).
        const updated = await labelPurchase.purchaseFor(omsOrderId, { productCode, sellerProfileId, skipClaim: true });
        return {
            success: true,
            omsOrderId,
            trackingNumber: updated.tracking_number,
            shippingFeePurchase: updated.shipping_fee_purchase,
            shippingFeeSelling: updated.shipping_fee_selling,
        };
    }

    async onJobMaxAttemptsReached(job, error) {
        const { omsOrderId } = job.payload || {};
        if (!omsOrderId) return;

        let row = null;
        try {
            row = await OmsOrderModel.findById(omsOrderId);
        } catch (e) {
            logger.warn('[OMS-BUY-LABEL] could not reload row for telegram context', {
                omsOrderId, error: e.message,
            });
        }

        // Ensure terminal error state — the service flips to 'error' on most
        // failure paths, but if we get here via INVALID_STATE / NOT_FOUND etc.
        // and the row exists in a non-error state, stamp it as a safety net.
        try {
            if (row && row.internal_status === 'label_purchasing') {
                await OmsOrderModel.setInternalStatus(
                    omsOrderId,
                    'error',
                    `Bulk buy-label failed after ${job.attempts} attempts: ${error.message}`
                );
            }
        } catch (e) {
            logger.error('[OMS-BUY-LABEL] failed to stamp terminal error state', {
                omsOrderId, error: e.message,
            });
        }

        try {
            await telegram.notifyError(error, {
                action: 'oms_buy_label',
                jobName: 'oms_buy_label',
                jobId: job.id,
                orderId: row?.order_number || omsOrderId,
                erpOrderCode: row?.customer_order_number || null,
                trackingNumber: row?.tracking_number || null,
                message: `OMS bulk buy-label failed after ${job.attempts} attempts (oms_order_id=${omsOrderId})`,
            });
        } catch (e) {
            logger.error('[OMS-BUY-LABEL] telegram notify failed', {
                omsOrderId, error: e.message,
            });
        }

        logger.error('[OMS-BUY-LABEL] giving up after max attempts', {
            omsOrderId,
            attempts: job.attempts,
            error: error.message,
            critical: true,
        });
    }
}

module.exports = OmsBuyLabelWorker;
