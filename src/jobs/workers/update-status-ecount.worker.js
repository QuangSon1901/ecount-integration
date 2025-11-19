// src/jobs/workers/update-status-ecount.worker.js
const BaseWorker = require('../base.worker');
const OrderModel = require('../../models/order.model');
const ecountService = require('../../services/erp/ecount.service');
const logger = require('../../utils/logger');

class UpdateStatusEcountWorker extends BaseWorker {
    constructor() {
        super('update_status_ecount', 4000); // Check mỗi 4 giây
    }

    async handleJob(job) {
        logger.info(`[UPDATE_STATUS] Processing job ${job.id}`, {
            attempt: job.attempts,
            maxAttempts: job.max_attempts
        });

        try {
            const result = await this.updateStatus(job);
            await this.markCompleted(job.id, result);
        } catch (error) {
            logger.error(`[UPDATE_STATUS] Job ${job.id} failed:`, error.message);
            await this.markFailed(job.id, error.message, true);
        }
    }

    async updateStatus(job) {
        const { orderId, erpOrderCode, trackingNumber, status, ecountLink } = job.payload;

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

        logger.info(`[UPDATE_STATUS] Updated for order ${orderId}`);

        return result;
    }
}

module.exports = UpdateStatusEcountWorker;