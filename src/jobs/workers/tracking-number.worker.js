// src/jobs/workers/tracking-number.worker.js
const BaseWorker = require('../base.worker');
const OrderModel = require('../../models/order.model');
const carrierFactory = require('../../services/carriers');
const logger = require('../../utils/logger');

class TrackingNumberWorker extends BaseWorker {
    constructor() {
        super('tracking_number', 5000); // Check mỗi 5 giây
    }

    async handleJob(job) {
        logger.info(`[TRACKING_NUMBER] Processing job ${job.id}`, {
            attempt: job.attempts,
            maxAttempts: job.max_attempts
        });

        try {
            const result = await this.fetchTrackingNumber(job);
            await this.markCompleted(job.id, result);
        } catch (error) {
            logger.error(`[TRACKING_NUMBER] Job ${job.id} failed:`, error.message);
            await this.markFailed(job.id, error.message, true);
        }
    }

    async fetchTrackingNumber(job) {
        const { orderId, orderCode, carrierCode } = job.payload;

        const carrier = carrierFactory.getCarrier(carrierCode);
        const orderInfo = await carrier.getOrderInfo(orderCode);
        
        if (!orderInfo.success || !orderInfo.data.trackingNumber) {
            throw new Error('Tracking number not available yet');
        }

        const trackingNumber = orderInfo.data.trackingNumber;
        
        logger.info(`[TRACKING_NUMBER] Found for order ${orderId}:`, {
            trackingNumber,
            attempt: job.attempts
        });

        // Lấy label URL
        let labelUrl = null;
        try {
            const labelResult = await carrier.getLabel(trackingNumber);
            
            if (labelResult.success && labelResult.data.url) {
                labelUrl = labelResult.data.url;
            }
        } catch (labelError) {
            logger.error(`[TRACKING_NUMBER] Failed to get label for order ${orderId}:`, labelError.message);
        }
        
        // Cập nhật database
        await OrderModel.update(orderId, {
            trackingNumber: trackingNumber,
            labelUrl: labelUrl,
            status: 'created',
            carrierResponse: orderInfo.data
        });

        if (labelUrl) {
            try {
                await OrderModel.generateLabelAccessKey(orderId);
            } catch (error) {
                logger.error(`[TRACKING_NUMBER] Failed to generate access key:`, error.message);
            }
        }
        
        return {
            success: true,
            orderId,
            trackingNumber,
            labelUrl,
            attempts: job.attempts
        };
    }
}

module.exports = TrackingNumberWorker;