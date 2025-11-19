// src/jobs/workers/create-order.worker.js
const BaseWorker = require('../base.worker');
const OrderModel = require('../../models/order.model');
const carrierFactory = require('../../services/carriers');
const logger = require('../../utils/logger');
const telegram = require('../../utils/telegram');

class CreateOrderWorker extends BaseWorker {
    constructor() {
        super('create_order', 3000); // Check mỗi 3 giây
    }

    async handleJob(job) {
        logger.info(`[CREATE_ORDER] Processing job ${job.id}`, {
            attempt: job.attempts,
            maxAttempts: job.max_attempts
        });

        try {
            const result = await this.createOrder(job);
            await this.markCompleted(job.id, result);
        } catch (error) {
            logger.error(`[CREATE_ORDER] Job ${job.id} failed:`, error.message);
            await this.markFailed(job.id, error.message, true);

            if (job.attempts == job.max_attempts - 1) {
                const { orderData } = job.payload;
                await telegram.notifyError(error, {
                    action: 'create_order',
                    jobName: 'Create Order',
                    orderId: orderData.customerOrderNumber,
                    erpOrderCode: orderData.erpOrderCode,
                });
            }
        }
    }

    async createOrder(job) {
        const { orderData } = job.payload;

        const carrierCode = (orderData.carrier || 'YUNEXPRESS').toUpperCase();
        const carrier = carrierFactory.getCarrier(carrierCode);

        carrier.validateOrderData(orderData);

        const carrierResult = await carrier.createOrder(orderData);

        if (!carrierResult.success) {
            throw new Error('Failed to create order with carrier');
        }

        logger.info('[CREATE_ORDER] Order created with carrier', {
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

        logger.info('[CREATE_ORDER] Order saved to database', { 
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

    generateOrderNumber() {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        return `ORD${timestamp}${random}`;
    }
}

module.exports = CreateOrderWorker;