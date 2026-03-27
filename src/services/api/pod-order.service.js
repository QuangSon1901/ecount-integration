const ecountOrderPodService = require('../erp/ecount-order-pod.service');
const OrderModel = require('../../models/order.model');
const logger = require('../../utils/logger');

// Warehouse code → display name mapping
const WH_CODE_TO_NAME = {
    '001': 'US-POD09',
    '002': 'VN-POD08',
    '004': 'US-POD13'
};

class ApiPodOrderService {

    /**
     * Create bulk POD orders on ECount
     * Each order can have multiple items → each item = 1 row in ECount SaleList
     */
    async createBulkOrders(orders, apiCustomer) {
        try {
            // Sandbox: override customer code to 'fortest'
            const isSandbox = apiCustomer.environment === 'sandbox';
            const effectiveCustomerCode = isSandbox ? 'fortest' : apiCustomer.customer_code;
            const effectiveCustomerName = isSandbox ? 'fortest' : apiCustomer.customer_name;

            const ecountRows = [];
            const orderMeta = []; // Track which ecount row belongs to which order

            let globalIndex = 0;

            for (let i = 0; i < orders.length; i++) {
                const order = orders[i];
                const internalOrderNumber = this.generateOrderNumber();
                const warehouseCode = order.warehouseCode || '';
                const receiver = order.receiver || {};
                const tracking = order.tracking || {};
                const items = order.items || [];

                const sharedIndex = items.length > 1 ? globalIndex : null;

                for (let j = 0; j < items.length; j++) {
                    const item = items[j];
                    const itemIndex = sharedIndex !== null ? sharedIndex : globalIndex++;

                    ecountRows.push({
                        index: itemIndex,
                        customerCode: order.customerCode || effectiveCustomerCode,
                        customerName: order.customerName || effectiveCustomerName,
                        warehouseCode: warehouseCode,
                        shippingMethod: order.shippingMethod || '',
                        orderNumber: order.orderNumber,
                        customerOrderNumber: order.orderNumber,
                        internalOrderNumber: internalOrderNumber,

                        // Receiver
                        receiverName: receiver.name || '',
                        receiverCountry: receiver.countryCode || '',
                        receiverAddress1: receiver.addressLine1 || '',
                        receiverAddress2: receiver.addressLine2 || '',
                        receiverCity: receiver.city || '',
                        receiverProvince: receiver.province || '',
                        receiverZipCode: receiver.zipCode || '',
                        receiverPhone: receiver.phone || '',
                        receiverEmail: receiver.email || '',

                        // Tracking
                        trackingNumber: tracking.trackingNumber || '',
                        linkPrint: tracking.linkPrint || '',

                        // Item
                        itemSku: item.sku || '',
                        itemName: item.name || '',
                        itemQuantity: item.quantity || 1,
                        itemPrice: item.price || 0,
                        itemSize: item.productSize || '',
                        itemColor: item.productColor || '',
                        designUrl: item.designUrls?.[0]?.value || '',
                        mockupUrl: item.mockupUrl || '',

                        customFields: order.customFields || {}
                    });

                    orderMeta.push({
                        originalOrderIndex: i,
                        itemIndex: j,
                        internalOrderNumber,
                        orderData: order
                    });
                }

                if (sharedIndex !== null) {
                    globalIndex++;
                }
            }

            // Call ECount POD OAPI
            const ecountResult = await ecountOrderPodService.createBulkSaleOrdersWithDocNo(ecountRows);

            if (!ecountResult.success) {
                throw new Error('Failed to create bulk POD orders on ECount');
            }

            const results = [];
            const errors = [];
            const ordersForLookup = [];
            const ordersForPodCreation = [];
            const resultsByOriginalOrder = new Map();

            for (let i = 0; i < ecountRows.length; i++) {
                const meta = orderMeta[i];
                const resultDetail = ecountResult.resultDetails[i];
                const slipNo = resultDetail?.slipNo;

                if (!slipNo) continue;

                // Only create DB record for first item of each order
                if (meta.itemIndex > 0) continue;

                const order = meta.orderData;
                const receiver = order.receiver || {};
                const tracking = order.tracking || {};

                try {
                    const orderId = await OrderModel.create({
                        orderNumber: meta.internalOrderNumber,
                        customerOrderNumber: order.orderNumber,
                        erpOrderCode: null,
                        partnerID: apiCustomer.customer_code,
                        partnerName: apiCustomer.customer_name,
                        carrier: WH_CODE_TO_NAME[order.warehouseCode] || order.warehouseCode,
                        productCode: order.warehouseCode,
                        receiverName: receiver.name || '',
                        receiverCountry: receiver.countryCode || null,
                        receiverState: receiver.province || null,
                        receiverCity: receiver.city || null,
                        receiverPostalCode: receiver.zipCode || null,
                        receiverPhone: receiver.phone || null,
                        receiverEmail: receiver.email || null,
                        receiverAddress1: receiver.addressLine1 || null,
                        receiverAddress2: receiver.addressLine2 || null,
                        trackingNumber: tracking.trackingNumber || null,
                        labelUrl: tracking.linkPrint || null,
                        itemsCount: order.items?.length || 0,
                        declarationItems: order.items || [],
                        status: 'pod_pending',
                        erpStatus: 'Chờ xác nhận',
                        orderData: order,
                    });

                    // Update POD-specific fields
                    await OrderModel.update(orderId, {
                        orderType: 'pod',
                        podWarehouse: WH_CODE_TO_NAME[order.warehouseCode] || order.warehouseCode,
                        podStatus: 'pod_pending',
                        podItems: order.items || null,
                        podShippingMethod: order.shippingMethod || null,
                    });

                    const savedOrder = await OrderModel.findById(orderId);

                    if (!resultsByOriginalOrder.has(meta.originalOrderIndex)) {
                        resultsByOriginalOrder.set(meta.originalOrderIndex, []);
                    }

                    resultsByOriginalOrder.get(meta.originalOrderIndex).push({
                        order: this.formatPodOrderResponse(savedOrder)
                    });

                    ordersForLookup.push({ orderId, slipNo });

                    // Prepare data for pod_create_order job
                    ordersForPodCreation.push({
                        orderId,
                        orderData: {
                            ...order,
                            erpOrderCode: null, // Will be set after lookup
                            ecountLink: '#menuType=MENUTREE_000004&menuSeq=MENUTREE_000186&groupSeq=MENUTREE_000030&prgId=C000073&depth=1',
                            partnerID: apiCustomer.customer_code,
                            partnerName: apiCustomer.customer_name,
                            podWarehouse: WH_CODE_TO_NAME[order.warehouseCode] || order.warehouseCode,
                        }
                    });

                } catch (error) {
                    errors.push({
                        success: false,
                        error: error.message,
                        order: order,
                    });
                }
            }

            // Format results
            for (const [, orderResults] of resultsByOriginalOrder.entries()) {
                results.push({
                    success: true,
                    status: 'pod_pending',
                    orders: orderResults.length > 1 ? orderResults : orderResults[0].order,
                });
            }

            // Queue lookup DOC_NO job
            if (ordersForLookup.length > 0) {
                const jobService = require('../queue/job.service');

                try {
                    await jobService.addLookupDocNoJob(
                        ordersForLookup.map(o => o.slipNo),
                        ordersForLookup.map(o => o.orderId),
                        30,
                        'pod'  // Dùng Ecount POD account
                    );
                } catch (jobError) {
                    logger.error('[POD API] Failed to add lookup DOC_NO job:', jobError);
                }
            }

            return {
                success: errors.length === 0,
                data: {
                    total: orders.length,
                    successful: results.length,
                    failed: errors.length,
                    results,
                    errors,
                },
                message: `Processed ${orders.length} POD orders: ${results.length} successful, ${errors.length} failed`
            };

        } catch (error) {
            logger.error('[POD API] Failed to create bulk POD orders:', error);
            throw error;
        }
    }

    formatPodOrderResponse(order) {
        return {
            reference_code: order.order_number,
            order_number: order.customer_order_number,
            code_thg: order.erp_order_code,
            order_type: 'pod',
            status: order.pod_status || order.status,
            tracking_number: order.tracking_number || null,
            waybill_number: order.waybill_number || null,
            label_url: this._resolveLabelUrl(order),
            service_code: order.pod_shipping_method || null,
            warehouse_code: order.product_code || null,
            warehouse_name: WH_CODE_TO_NAME[order.product_code] || null,
            receiver: {
                name: order.receiver_name,
                phone: order.receiver_phone,
                email: order.receiver_email,
                countryCode: order.receiver_country,
                province: order.receiver_state,
                city: order.receiver_city,
                zipCode: order.receiver_postal_code,
                addressLine1: order.receiver_address_line1,
                addressLine2: order.receiver_address_line2,
            },
            created_at: order.created_at,
            updated_at: order.updated_at
        };
    }

    /**
     * Resolve label URL: ưu tiên short link qua access key, fallback label_url gốc
     */
    _resolveLabelUrl(order) {
        if (!order.label_url) return null;

        if (order.label_access_key && process.env.SHORT_LINK_LABEL === 'true') {
            const baseUrl = process.env.BASE_URL || '';
            return `${baseUrl}/api/labels/${order.label_access_key}`;
        }

        return order.label_url;
    }

    generateOrderNumber() {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        return `POD-API${timestamp}${random}`;
    }
}

module.exports = new ApiPodOrderService();
