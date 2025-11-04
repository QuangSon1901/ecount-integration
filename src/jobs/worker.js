const JobModel = require('../models/job.model');
const OrderModel = require('../models/order.model');
const carrierFactory = require('../services/carriers');
const ecountService = require('../services/erp/ecount.service');
const logger = require('../utils/logger');

class JobWorker {
    constructor() {
        this.isRunning = false;
        this.intervalMs = 10000; // Check mỗi 5 giây
        this.intervalId = null;
    }

    /**
     * Start worker
     */
    start() {
        if (this.isRunning) {
            logger.warn('Worker already running');
            return;
        }

        this.isRunning = true;
        logger.info('Job worker started');

        // Process jobs ngay lập tức
        this.processJobs();

        // Setup interval
        this.intervalId = setInterval(() => {
            this.processJobs();
        }, this.intervalMs);
    }

    /**
     * Stop worker
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        logger.info('Job worker stopped');
    }

    /**
     * Process jobs
     */
    async processJobs() {
        try {
            await JobModel.resetStuckJobs(30);

            while (true) {
                const job = await JobModel.getNextJob();
                
                if (!job) {
                    break;
                }

                await this.handleJob(job);
            }
        } catch (error) {
            logger.error('Error in processJobs:', error);
        }
    }

    /**
     * Handle single job
     */
    async handleJob(job) {
        logger.info(`Processing job ${job.id}`, {
            jobType: job.job_type,
            attempt: job.attempts,
            maxAttempts: job.max_attempts
        });

        try {
            let result;

            switch (job.job_type) {
                case 'tracking_number':
                    result = await this.handleTrackingNumber(job);
                    await this.handleUpdateTrackingNumberErp(job.id);
                    break;
                
                default:
                    throw new Error(`Unknown job type: ${job.job_type}`);
            }

            await JobModel.markCompleted(job.id, result);
            
        } catch (error) {
            logger.error(`Job ${job.id} failed:`, error.message);
            await JobModel.markFailed(job.id, error.message, true);
        }
    }

    /**
     * Handle tracking number job
     */
    async handleTrackingNumber(job) {
        const { orderId, orderCode, carrierCode } = job.payload;

        logger.info(`Fetching tracking number for order ${orderId}`, {
            orderCode,
            carrierCode,
            attempt: job.attempts
        });

        // Lấy carrier service
        const carrier = carrierFactory.getCarrier(carrierCode);
        
        // Gọi API để lấy thông tin đơn hàng
        const orderInfo = await carrier.getOrderInfo(orderCode);
        
        // Kiểm tra có tracking number chưa
        if (!orderInfo.success || !orderInfo.data.trackingNumber) {
            throw new Error('Tracking number not available yet');
        }

        const trackingNumber = orderInfo.data.trackingNumber;
        
        logger.info(`Tracking number found for order ${orderId}:`, {
            trackingNumber,
            attempt: job.attempts
        });
        
        // Cập nhật vào database
        await OrderModel.update(orderId, {
            trackingNumber: trackingNumber,
            status: 'created',
            carrierResponse: orderInfo.data
        });
        
        return {
            success: true,
            orderId,
            trackingNumber,
            attempts: job.attempts
        };
    }

    /**
     * Handle update ERP job
     */
    async handleUpdateTrackingNumberErp(orderId) {
        const orderDetails = await OrderModel.findById(orderId);
        logger.info(`Updating ERP for order ${orderId}`, {
            erp_order_code: orderDetails.erp_order_code,
            tracking_number: orderDetails.tracking_number
        });

        const result = await ecountService.updateInfoEcount(
            'tracking_number',
            orderId,
            orderDetails.erp_order_code,
            orderDetails.tracking_number,
            orderDetails.status,
            orderDetails.ecount_link
        );

        // Cập nhật database
        await OrderModel.update(orderId, {
            erpTrackingNumberUpdated: true,
        });

        logger.info(`ERP updated for order ${orderId}`);

        return result;
    }
}

module.exports = new JobWorker();