// src/jobs/workers/sbtt-label-upload.worker.js
// Upload tracking label lên S2BDIY cho SBTT order (tự vận chuyển)
const BaseWorker = require('./base.worker');
const podWarehouseFactory = require('../../services/pod');
const telegram = require('../../utils/telegram');
const logger = require('../../utils/logger');

class SbttLabelUploadWorker extends BaseWorker {
    constructor() {
        super('sbtt_label_upload', {
            intervalMs: 5000,
            concurrency: 2
        });
    }

    async processJob(job) {
        const { orderId, podWarehouseOrderId, trackingNumber, labelUrl } = job.payload;

        logger.info(`[SBTT] Uploading tracking label to S2BDIY`, {
            orderId,
            podWarehouseOrderId,
            trackingNumber,
            labelUrl,
            attempt: job.attempts
        });

        const warehouse = podWarehouseFactory.getWarehouse('S2BDIY');

        const result = await warehouse.uploadTrackingLabel(
            podWarehouseOrderId,
            trackingNumber || '',
            labelUrl
        );

        logger.info(`[SBTT] Tracking label uploaded successfully`, {
            orderId,
            podWarehouseOrderId,
            trackingNumber
        });

        return {
            success: true,
            orderId,
            podWarehouseOrderId,
            trackingNumber
        };
    }

    async onJobMaxAttemptsReached(job, error) {
        const { erpOrderCode, podWarehouseOrderId, trackingNumber } = job.payload;
        await telegram.notifyError(error, {
            action: 'sbtt_label_upload',
            jobName: 'sbtt_label_upload',
            erpOrderCode,
            podWarehouseOrderId,
            trackingNumber,
            message: `[SBTT] Failed to upload tracking label after max attempts`
        });
    }
}

module.exports = SbttLabelUploadWorker;
