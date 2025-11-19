// src/jobs/workers/update-tracking-ecount.worker.js
const BaseWorker = require('../base.worker');
const OrderModel = require('../../models/order.model');
const ecountService = require('../../services/erp/ecount.service');
const logger = require('../../utils/logger');

class UpdateTrackingEcountWorker extends BaseWorker {
    constructor() {
        super('update_tracking_ecount', 4000); // Check mỗi 4 giây
    }

    async handleJob(job) {
        logger.info(`[UPDATE_TRACKING] Processing job ${job.id}`, {
            attempt: job.attempts,
            maxAttempts: job.max_attempts
        });

        try {
            const result = await this.updateTracking(job);
            await this.markCompleted(job.id, result);
        } catch (error) {
            logger.error(`[UPDATE_TRACKING] Job ${job.id} failed:`, error.message);
            await this.markFailed(job.id, error.message, true);
        }
    }

    async updateTracking(job) {
        const { orderId, erpOrderCode, trackingNumber, ecountLink } = job.payload;

        const order = await OrderModel.findById(orderId);
        if (order.erp_tracking_number_updated == true) {
            return { skipped: true };
        }

        const waybillNumber = order?.waybill_number || '';
        
        let labelUrl = null;
        if (order.label_url) {
            if (order.label_access_key && process.env.SHORT_LINK_LABEL == 'true') {
                const baseUrl = process.env.BASE_URL || '';
                labelUrl = `${baseUrl}/api/labels/${order.label_access_key}`;
            } else {
                labelUrl = order.label_url;
            }
        }

        const result = await ecountService.updateInfoEcount(
            'tracking_number',
            orderId,
            erpOrderCode,
            trackingNumber,
            null,
            ecountLink,
            labelUrl,
            waybillNumber
        );

        await OrderModel.update(orderId, {
            erpTrackingNumberUpdated: true,
        });

        logger.info(`[UPDATE_TRACKING] Updated for order ${orderId}`);

        return result;
    }
}

module.exports = UpdateTrackingEcountWorker;