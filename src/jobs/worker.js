const JobModel = require('../models/job.model');
const OrderModel = require('../models/order.model');
const carrierFactory = require('../services/carriers');
const ecountService = require('../services/erp/ecount.service');
const logger = require('../utils/logger');
const telegram = require('../utils/telegram');

class JobWorker {
    constructor() {
        this.isRunning = false;
        this.intervalMs = 5000; // Check mỗi 5 giây
        this.intervalId = null;
        this.isProcessing = false;
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
        if (this.isProcessing) {
            return;
        }

        try {
            this.isProcessing = true;
            await JobModel.resetStuckJobs(30);

            const job = await JobModel.getNextJob();
            
            if (job) {
                await this.handleJob(job);
            }
        } catch (error) {
            logger.error('Error in processJobs:' + error);
        } finally {
            this.isProcessing = false;
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
                case 'create_order':
                    result = await this.handleCreateOrder(job);
                    break;

                case 'tracking_number':
                    result = await this.handleTrackingNumber(job);
                    break;

                case 'update_tracking_ecount':
                    result = await this.handleUpdateTrackingEcount(job);
                    break;

                case 'update_status_ecount':
                    result = await this.handleUpdateStatusEcount(job);
                    break;
                
                default:
                    throw new Error(`Unknown job type: ${job.job_type}`);
            }

            await JobModel.markCompleted(job.id, result);
            
        } catch (error) {
            logger.error(`Job ${job.id} failed:`, error.message);
            await JobModel.markFailed(job.id, error.message, true);

            if (job.attempts == job.max_attempts - 1) {
                const { orderData } = job.payload;
                await telegram.notifyError(error, {
                    action: job.job_type,
                    jobName: job.job_type,
                    orderId: orderData.customerOrderNumber,
                    waybillNumber: orderData.waybillNumber || null,
                    trackingNumber: orderData.trackingNumber || null,
                    erpOrderCode: orderData.erpOrderCode,
                });
            }
        }
    }

    /**
     * Handle create order job
     */
    async handleCreateOrder(job) {
        const { orderData } = job.payload;

        logger.info(`Creating order`, {
            customerOrderNumber: orderData.customerOrderNumber,
            attempt: job.attempts
        });

        const carrierCode = (orderData.carrier || 'YUNEXPRESS').toUpperCase();
        const carrier = carrierFactory.getCarrier(carrierCode);

        // Validate
        carrier.validateOrderData(orderData);

        // Tạo đơn với carrier
        const carrierResult = await carrier.createOrder(orderData);

        if (!carrierResult.success) {
            throw new Error('Failed to create order with carrier');
        }

        logger.info('Order created with carrier', {
            waybillNumber: carrierResult.waybillNumber,
            customerOrderNumber: carrierResult.customerOrderNumber,
            trackingNumber: carrierResult.trackingNumber || ''
        });

        // Lưu vào database
        const orderNumber = this.generateOrderNumber();
        const firstPackage = orderData.packages?.[0] || {};
        const totalWeight = orderData.packages?.reduce((sum, pkg) => sum + (pkg.weight || 0), 0) || null;
        const declaredValue = orderData.declarationInfo?.reduce(
            (sum, item) => sum + ((item.unit_price || 0) * (item.quantity || 0)), 
            0
        ) || null;
        
        const orderId = await OrderModel.create({
            orderNumber: orderNumber,
            customerOrderNumber: carrierResult.customerOrderNumber || orderData.customerOrderNumber,
            platformOrderNumber: orderData.platformOrderNumber,
            erpOrderCode: orderData.erpOrderCode,
            carrier: carrierCode,
            productCode: orderData.productCode,
            waybillNumber: carrierResult.waybillNumber || null,
            trackingNumber: carrierResult.trackingNumber || null,
            barCodes: carrierResult.barCodes || null,
            packageWeight: totalWeight,
            packageLength: firstPackage.length || null,
            packageWidth: firstPackage.width || null,
            packageHeight: firstPackage.height || null,
            weightUnit: orderData.weightUnit || 'KG',
            sizeUnit: orderData.sizeUnit || 'CM',
            receiverName: orderData.receiver ? 
                `${orderData.receiver.firstName} ${orderData.receiver.lastName}`.trim() : null,
            receiverCountry: orderData.receiver?.countryCode || null,
            receiverState: orderData.receiver?.province || null,
            receiverCity: orderData.receiver?.city || null,
            receiverPostalCode: orderData.receiver?.postalCode || null,
            receiverPhone: orderData.receiver?.phoneNumber || null,
            receiverEmail: orderData.receiver?.email || null,
            declaredValue: declaredValue,
            declaredCurrency: orderData.declarationInfo?.[0]?.currency || 'USD',
            itemsCount: orderData.declarationInfo?.length || 0,
            status: carrierResult.trackingNumber ? 'created' : 'pending',
            trackType: carrierResult.trackType || null,
            remoteArea: carrierResult.remoteArea || null,
            erpStatus: orderData.erpStatus || 'Đang xử lý',
            ecountLink: orderData.ecountLink || null,
            extraServices: orderData.extraServices || [],
            sensitiveType: orderData.sensitiveType || null,
            goodsType: orderData.goodsType || null,
            vatNumber: orderData.customsNumber?.vat_code || null,
            iossCode: orderData.customsNumber?.ioss_code || null,
            eoriNumber: orderData.customsNumber?.eori_number || null,
            orderData: orderData,
            carrierResponse: carrierResult.carrierResponse
        });

        logger.info('Order saved to database', { 
            orderId, 
            orderNumber,
            trackingNumber: carrierResult.trackingNumber || ''
        });

        return {
            success: true,
            orderId,
            orderNumber,
            waybillNumber: carrierResult.waybillNumber,
            trackingNumber: carrierResult.trackingNumber,
            hasTrackingNumber: !!carrierResult.trackingNumber
        };
    }

    // src/jobs/worker.js

    /**
     * Handle tracking number job - CẬP NHẬT
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

        // Lấy label URL
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
        
        // Cập nhật vào database
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

    /**
     * Handle update tracking number lên ECount
     */
    async handleUpdateTrackingEcount(job) {
        const { orderId, erpOrderCode, trackingNumber, ecountLink } = job.payload;

        logger.info(`Updating tracking number to ECount for order ${orderId}`, {
            erpOrderCode,
            trackingNumber
        });

        const order = await OrderModel.findById(orderId);
        const waybillNumber = order?.waybill_number || '';
        
        let labelUrl = null;
        if (order.label_url) {
            if (order.label_access_key && process.env.SHORT_LINK_LABEL=='true') {
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
            null, // status không cần
            ecountLink,
            labelUrl,
            waybillNumber
        );

        // Cập nhật database
        await OrderModel.update(orderId, {
            erpTrackingNumberUpdated: true,
        });

        logger.info(`Tracking number updated to ECount for order ${orderId}`);

        return result;
    }

    /**
     * Handle update status lên ECount
     */
    async handleUpdateStatusEcount(job) {
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

        // Cập nhật database
        await OrderModel.update(orderId, {
            erpUpdated: true,
            erpStatus: status
        });

        logger.info(`Status updated to ECount for order ${orderId}`);

        return result;
    }

    /**
     * Generate unique order number
     */
    generateOrderNumber() {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        return `ORD${timestamp}${random}`;
    }
}

module.exports = new JobWorker();