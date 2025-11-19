// src/jobs/workers/update-status-ecount.worker.js
const BaseWorker = require('./base.worker');
const OrderModel = require('../../models/order.model');
const ecountService = require('../../services/erp/ecount.service');
const telegram = require('../../utils/telegram');
const logger = require('../../utils/logger');

class UpdateStatusEcountWorker extends BaseWorker {
    constructor() {
        super('update_status_ecount', {
            intervalMs: 5000,
            concurrency: 1  // Chạy đồng thời 2 jobs (vì có Puppeteer nặng)
        });
    }

    async processJob(job) {
        const { orderId, erpOrderCode, trackingNumber, status, ecountLink } = job.payload;

        logger.info(`Updating status to ECount for order ${orderId}`, {
            erpOrderCode,
            status
        });

        const result = await ecountService.updateInfoEcount(
            'status',
            orderId,
            erpOrderCode,
            trackingNumber,
            status,
            ecountLink
        );

        await OrderModel.update(orderId, {
            erpUpdated: true,
            erpStatus: status
        });

        logger.info(`Status updated to ECount for order ${orderId}`);

        return result;
    }

    async onJobMaxAttemptsReached(job, error) {
        const { orderId, erpOrderCode, trackingNumber, status } = job.payload;
        await telegram.notifyError(error, {
            action: job.job_type,
            jobName: job.job_type,
            orderId: orderId,
            erpOrderCode: erpOrderCode,
            trackingNumber: trackingNumber,
            status: status
        });
    }
}

module.exports = UpdateStatusEcountWorker;