// src/jobs/workers/oms-update-logistic.worker.js
//
// Consumer for `oms_update_logistic` jobs.
// Payload: { omsOrderId, tplCode? }
//
// Retries on transient OMS failures via BaseWorker.markFailed (5s/10s/20s/40s/80s).
// On final failure, sets oms_orders.internal_status = 'error' with the last error
// message so admin can hit the manual retry endpoint or investigate.

const BaseWorker = require('./base.worker');
const omsLogisticUpdate = require('../../services/oms/logistic-update.service');
const OmsOrderModel = require('../../models/oms-order.model');
const logger = require('../../utils/logger');

class OmsUpdateLogisticWorker extends BaseWorker {
    constructor() {
        super('oms_update_logistic', {
            intervalMs: 5000,
            concurrency: 3,
        });
    }

    async processJob(job) {
        const { omsOrderId, tplCode } = job.payload || {};
        if (!omsOrderId) {
            // Malformed job — don't keep retrying
            throw new Error('oms_update_logistic job missing omsOrderId');
        }

        const result = await omsLogisticUpdate.pushFor(omsOrderId, { tplCode });
        return result; // saved into jobs.result
    }

    async onJobMaxAttemptsReached(job, error) {
        const { omsOrderId } = job.payload || {};
        if (!omsOrderId) return;
        try {
            await OmsOrderModel.setInternalStatus(
                omsOrderId,
                'error',
                `OMS logistic-info push failed after ${job.attempts} attempts: ${error.message}`
            );
            logger.error('[OMS-UPDATE] giving up after max attempts — marking order as error', {
                omsOrderId,
                attempts: job.attempts,
                error: error.message,
                critical: true,
            });
        } catch (e) {
            logger.error('[OMS-UPDATE] failed to set error state on max-attempts handler', {
                omsOrderId, error: e.message,
            });
        }
    }
}

module.exports = OmsUpdateLogisticWorker;
