// src/jobs/workers/update-tracking-ecount.worker.js
const BaseWorker = require('./base.worker');
const OrderModel = require('../../models/order.model');
const ecountService = require('../../services/erp/ecount.service');
const telegram = require('../../utils/telegram');
const logger = require('../../utils/logger');

class UpdateTrackingEcountWorker extends BaseWorker {
    constructor() {
        super('update_tracking_ecount', {
            intervalMs: 5000,
            concurrency: 1  // Chạy đồng thời 1 jobs (vì có Puppeteer nặng)
        });
    }

    async processJob(job) {
        const { orderId, erpOrderCode, trackingNumber, ecountLink } = job.payload;

        logger.info(`Updating tracking number to ECount for order ${orderId}`, {
            erpOrderCode,
            trackingNumber
        });

        const order = await OrderModel.findById(orderId);
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

        logger.info(`Tracking number updated to ECount for order ${orderId}`);

        return result;
    }

    async onJobMaxAttemptsReached(job, error) {
        const { orderId, erpOrderCode, trackingNumber } = job.payload;
        await telegram.notifyError(error, {
            action: job.job_type,
            jobName: job.job_type,
            orderId: orderId,
            erpOrderCode: erpOrderCode,
            trackingNumber: trackingNumber
        });
    }
}

module.exports = UpdateTrackingEcountWorker;