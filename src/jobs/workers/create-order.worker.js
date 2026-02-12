// src/jobs/workers/create-order.worker.js
const BaseWorker = require('./base.worker');
const OrderModel = require('../../models/order.model');
const carrierFactory = require('../../services/carriers');
const telegram = require('../../utils/telegram');
const logger = require('../../utils/logger');

class CreateOrderWorker extends BaseWorker {
    constructor() {
        super('create_order', {
            intervalMs: 3000,    // Check mỗi 3s
            concurrency: 5       // Chạy đồng thời 5 jobs
        });
    }

    async processJob(job) {
        const { orderData } = job.payload;

        logger.info(`Creating order`, {
            customerOrderNumber: orderData.customerOrderNumber,
            attempt: job.attempts
        });

        const carrierCode = (orderData.carrier || 'YUNEXPRESS').toUpperCase();
        const carrier = carrierFactory.getCarrier(carrierCode);

        carrier.validateOrderData(orderData);

        const carrierResult = await carrier.createOrder(orderData);

        if (!carrierResult.success) {
            throw new Error('Failed to create order with carrier');
        }

        logger.info('Order created with carrier', {
            waybillNumber: carrierResult.waybillNumber,
            customerOrderNumber: carrierResult.customerOrderNumber,
            trackingNumber: carrierResult.trackingNumber || ''
        });

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
            partnerID: orderData.partnerID,
            partnerName: orderData.partnerName,
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
            receiverAddress1: orderData.receiver?.addressLines[0] || null,
            receiverAddress2: orderData.receiver?.addressLines[1] || null,
            declaredValue: declaredValue,
            declaredCurrency: orderData.declarationInfo?.[0]?.currency || 'USD',
            itemsCount: orderData.declarationInfo?.length || 0,
            declarationItems: null,
            status: carrierResult.trackingNumber ? 'created' : 'pending',
            trackType: carrierResult.trackType || null,
            remoteArea: carrierResult.remoteArea || null,
            erpStatus: orderData.erpStatus || 'Đang xử lý',
            ecountLink: '#menuType=MENUTREE_000004&menuSeq=MENUTREE_000186&groupSeq=MENUTREE_000030&prgId=C000073&depth=1',
            extraServices: orderData.extraServices || [],
            warehouseCode: orderData.warehouseCode || null,
            additionalService: orderData.extraServices[0]?.extra_code ?? null,
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

    async onJobMaxAttemptsReached(job, error) {
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

    generateOrderNumber() {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        return `ORD${timestamp}${random}`;
    }
}

module.exports = CreateOrderWorker;