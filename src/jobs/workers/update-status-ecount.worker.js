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
        const { orderId, erpOrderCode, trackingNumber, status, ecountLink } = job.payload;
        
        try {
            // Gửi telegram thông báo
            await telegram.notifyError(error, {
                action: job.job_type,
                jobName: job.job_type,
                orderId: orderId,
                erpOrderCode: erpOrderCode,
                trackingNumber: trackingNumber,
                status: status,
                message: `⚠️ Job failed after max attempts. Will retry in 30 minutes.`
            }, {
                type: 'error'
            });

            // Push lại job với delay 30 phút (1800 giây)
            await jobService.addUpdateStatusJob(
                orderId,
                erpOrderCode,
                trackingNumber,
                status,
                ecountLink,
                1800 // Delay 30 phút = 1800 giây
            );

            logger.warn(`Job ${job.id} failed after max attempts. Rescheduled in 30 minutes`, {
                orderId,
                erpOrderCode,
                status
            });

        } catch (retryError) {
            // Nếu push lại job cũng bị lỗi thì gửi telegram cảnh báo
            logger.error(`Failed to reschedule job ${job.id}:`, retryError);
            
            await telegram.notifyError(
                new Error(`Failed to reschedule job after max attempts: ${retryError.message}`),
                {
                    action: 'Reschedule Job Failed',
                    jobName: job.job_type,
                    originalJobId: job.id,
                    orderId: orderId,
                    erpOrderCode: erpOrderCode,
                    trackingNumber: trackingNumber,
                    status: status
                },
                { type: 'error' }
            );
        }
    }
}

module.exports = UpdateStatusEcountWorker;