// src/jobs/workers/tracking-number.worker.js
const BaseWorker = require('./base.worker');
const OrderModel = require('../../models/order.model');
const carrierFactory = require('../../services/carriers');
const telegram = require('../../utils/telegram');
const logger = require('../../utils/logger');

class TrackingNumberWorker extends BaseWorker {
    constructor() {
        super('tracking_number', 5000);
    }

    async processJob(job) {
        const { orderId, orderCode, carrierCode } = job.payload;

        logger.info(`Fetching tracking number for order ${orderId}`, {
            orderCode,
            carrierCode,
            attempt: job.attempts
        });

        const carrier = carrierFactory.getCarrier(carrierCode);
        const orderInfo = await carrier.getOrderInfo(orderCode);
        
        if (!orderInfo.success || !orderInfo.data.trackingNumber) {
            throw new Error('Tracking number not available yet');
        }

        const trackingNumber = orderInfo.data.trackingNumber;
        
        logger.info(`Tracking number found for order ${orderId}:`, {
            trackingNumber,
            attempt: job.attempts
        });

        let labelUrl = null;
        try {
            logger.info(`Fetching label for tracking number: ${trackingNumber}`);
            
            const labelResult = await carrier.getLabel(trackingNumber);
            
            if (labelResult.success && labelResult.data.url) {
                labelUrl = labelResult.data.url;
                logger.info(`Label URL found for order ${orderId}:`, {
                    labelUrl: labelUrl.substring(0, 50) + '...',
                    labelType: labelResult.data.labelType
                });
            } else {
                logger.warn(`No label URL available for order ${orderId}`);
            }
        } catch (labelError) {
            logger.error(`Failed to get label for order ${orderId}: ` + labelError.message);
        }
        
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
                logger.error(`Failed to generate access key for order ${orderId}: ${error.message}`);
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

    async onJobMaxAttemptsReached(job, error) {
        const { orderId, orderCode } = job.payload;
        await telegram.notifyError(error, {
            action: job.job_type,
            jobName: job.job_type,
            orderId: orderId,
            orderCode: orderCode
        });
    }
}

module.exports = TrackingNumberWorker;