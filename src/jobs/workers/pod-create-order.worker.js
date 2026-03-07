// src/jobs/workers/pod-create-order.worker.js
// Tạo order trên POD warehouse + lưu DB giống create-order.worker.js của Express
const BaseWorker = require('./base.worker');
const OrderModel = require('../../models/order.model');
const jobService = require('../../services/queue/job.service');
const podWarehouseFactory = require('../../services/pod');
const telegram = require('../../utils/telegram');
const logger = require('../../utils/logger');

class PodCreateOrderWorker extends BaseWorker {
    constructor() {
        super('pod_create_order', {
            intervalMs: 3000,
            concurrency: 3
        });
    }

    async processJob(job) {
        const { orderData } = job.payload;

        const warehouseCode = (orderData.podWarehouse || orderData.carrier || '').toUpperCase();

        logger.info(`[POD] Creating order on ${warehouseCode}`, {
            erpOrderCode: orderData.erpOrderCode,
            customerOrderNumber: orderData.customerOrderNumber,
            attempt: job.attempts
        });

        const warehouse = podWarehouseFactory.getWarehouse(warehouseCode);

        // Transform API unified format → warehouse-specific format
        const transformedData = warehouse.transformOrderData(orderData);
        warehouse.validateOrderData(transformedData);

        const result = await warehouse.createOrder(transformedData);

        if (!result.success) {
            throw new Error(`[POD] Failed to create order on ${warehouseCode}: ${result.message || 'Unknown error'}`);
        }

        logger.info(`[POD] Order created on ${warehouseCode}`, {
            warehouseOrderId: result.warehouseOrderId,
        });

        // Lưu vào DB giống Express flow
        const orderNumber = this.generateOrderNumber();
        const receiver = orderData.receiver || {};
        const firstPackage = orderData.packages?.[0] || {};
        const totalWeight = orderData.packages?.reduce((sum, pkg) => sum + (pkg.weight || 0), 0) || null;
        const declaredValue = orderData.declarationInfo?.reduce(
            (sum, item) => sum + ((item.unit_price || 0) * (item.quantity || 0)),
            0
        ) || null;

        const orderId = await OrderModel.create({
            orderNumber: orderNumber,
            customerOrderNumber: orderData.customerOrderNumber,
            platformOrderNumber: orderData.platformOrderNumber,
            erpOrderCode: orderData.erpOrderCode,
            partnerID: orderData.partnerID,
            partnerName: orderData.partnerName,
            carrier: warehouseCode, // POD warehouse code thay cho carrier
            productCode: orderData.productCode || warehouseCode, // productCode = warehouse code cho POD
            waybillNumber: null,
            trackingNumber: result?.tracking?.tracking || null, // Một số POD trả tracking ngay
            labelUrl: result?.tracking?.url || null, // URL của label
            packageWeight: totalWeight,
            packageLength: firstPackage.length || null,
            packageWidth: firstPackage.width || null,
            packageHeight: firstPackage.height || null,
            weightUnit: orderData.weightUnit || 'KG',
            sizeUnit: orderData.sizeUnit || 'CM',
            receiverName: receiver.firstName || receiver.lastName
                ? `${receiver.firstName || ''} ${receiver.lastName || ''}`.trim()
                : (receiver.name || null),
            receiverCountry: receiver.countryCode || null,
            receiverState: receiver.province || null,
            receiverCity: receiver.city || null,
            receiverPostalCode: receiver.postalCode || null,
            receiverPhone: receiver.phoneNumber || null,
            receiverEmail: receiver.email || null,
            receiverAddress1: receiver.addressLines?.[0] || receiver.address1 || null,
            receiverAddress2: receiver.addressLines?.[1] || receiver.address2 || null,
            declaredValue: declaredValue,
            declaredCurrency: orderData.declarationInfo?.[0]?.currency || 'USD',
            itemsCount: orderData.declarationInfo?.length || orderData.items?.length || 0,
            declarationItems: orderData.declarationInfo || orderData.items || [],
            status: 'pod_pending',
            erpStatus: orderData.erpStatus || 'Đang xử lý',
            ecountLink: orderData.ecountLink || '#menuType=MENUTREE_000004&menuSeq=MENUTREE_000186&groupSeq=MENUTREE_000030&prgId=C000073&depth=1',
            orderData: orderData,
            carrierResponse: result.rawResponse || {},
        });

        // Update POD-specific fields
        await OrderModel.update(orderId, {
            orderType: 'pod',
            podWarehouse: warehouseCode,
            podWarehouseOrderId: String(result.warehouseOrderId),
            podStatus: 'pod_pending',
            podItems: orderData.items || orderData.podItems || null,
            podShippingMethod: orderData.podShippingMethod || orderData.shippingMethod || null,
            podWarehouseResponse: result.rawResponse || null,
        });

        logger.info(`[POD] Order saved to database`, {
            orderId,
            orderNumber,
            warehouseOrderId: result.warehouseOrderId,
            warehouseCode
        });

        // Push job update status Ecount → Processing
        if (orderData.erpOrderCode && orderData.ecountLink) {
            await jobService.addPodUpdateStatusEcountJob(
                orderId,
                orderData.erpOrderCode,
                result?.tracking?.tracking || '',
                'Processing',
                orderData.ecountLink,
                5
            );
            logger.info(`[POD] Queued Ecount status update → Processing`, {
                orderId,
                erpOrderCode: orderData.erpOrderCode
            });
        }

        return {
            success: true,
            orderId,
            orderNumber,
            warehouseOrderId: result.warehouseOrderId,
            warehouseCode,
            trackingNumber: result?.tracking?.tracking || null
        };
    }

    async onJobMaxAttemptsReached(job, error) {
        const { orderData } = job.payload;
        await telegram.notifyError(error, {
            action: 'pod_create_order',
            jobName: 'pod_create_order',
            erpOrderCode: orderData.erpOrderCode,
            customerOrderNumber: orderData.customerOrderNumber,
            podWarehouse: orderData.podWarehouse || orderData.carrier,
            message: `[POD] Failed to create order after max attempts`
        });
    }

    generateOrderNumber() {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        return `POD${timestamp}${random}`;
    }
}

module.exports = PodCreateOrderWorker;
