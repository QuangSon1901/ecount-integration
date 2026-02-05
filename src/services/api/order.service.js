const ecountOrderService = require('../erp/ecount-order.service');
const OrderModel = require('../../models/order.model');
const webhookService = require('./webhook.service');
const logger = require('../../utils/logger');

class ApiOrderService {
    
    async createBulkOrders(orders, apiCustomer) {
        try {
            const ordersToCreate = [];
            let globalIndex = 0; // Index toàn cục cho các đơn riêng lẻ
            
            for (let i = 0; i < orders.length; i++) {
                const orderData = orders[i];
                const orderNumber = this.generateOrderNumber();

                const receiver = orderData.receiver || {};
                const receiverName = receiver.name || '';
                const receiverCountry = receiver.countryCode || '';
                const receiverAddress1 = receiver.addressLine1 || '';
                const receiverAddress2 = receiver.addressLine2 || '';
                const receiverCity = receiver.city || '';
                const receiverState = receiver.province || '';
                const receiverZipCode = receiver.zipCode || '';
                const receiverPhone = receiver.phone || '';
                const receiverEmail = receiver.email || '';

                const customs = orderData.customsNumber || {};
                const IOSSCode = customs.IOSSCode || '';
                const VATCode = customs.VATCode || '';
                const EORINumber = customs.EORINumber || '';

                const declarationInfo = orderData.declarationInfo || [];

                if (declarationInfo.length === 0) {
                    throw new Error('At least one declaration item is required');
                }

                const packages = orderData.packages || [];

                if (packages.length === 0) {
                    throw new Error('At least one declaration item is required');
                }

                const sharedIndex = declarationInfo.length > 1 ? globalIndex : null;
                
                for (let j = 0; j < declarationInfo.length; j++) {
                    const decl = declarationInfo[j];
                    
                    const itemIndex = sharedIndex !== null ? sharedIndex : globalIndex++;

                    ordersToCreate.push({
                        index: itemIndex,
                        orderNumber: orderNumber,
                        originalOrderIndex: i,
                        declarationIndex: j,
                        orderData: orderData,
                        ecountData: this.buildECountData({
                            index: itemIndex,
                            orderNumber,
                            orderData,
                            apiCustomer,
                            receiver,
                            customs,
                            declaration: decl,
                            packages,
                            receiverName,
                            receiverCountry,
                            receiverAddress1,
                            receiverAddress2,
                            receiverCity,
                            receiverState,
                            receiverZipCode,
                            receiverPhone,
                            receiverEmail,
                            IOSSCode,
                            VATCode,
                            EORINumber
                        })
                    });
                }

                if (sharedIndex !== null) {
                    globalIndex++;
                }
            }

            const ecountResult = await ecountOrderService.createBulkSaleOrdersWithDocNo(
                ordersToCreate.map(o => o.ecountData)
            );

            if (!ecountResult.success) {
                throw new Error('Failed to create bulk orders on ECount');
            }

            const results = [];
            const errors = [];
            const ordersForLookup = [];

            const resultsByOriginalOrder = new Map();

            for (let i = 0; i < ordersToCreate.length; i++) {
                const orderToCreate = ordersToCreate[i];
                const resultDetail = ecountResult.resultDetails[i];
                const slipNo = resultDetail?.slipNo;
                
                if (!slipNo) continue;
                
                try {
                    const orderId = await OrderModel.create({
                        orderNumber: orderToCreate.orderNumber,
                        customerOrderNumber: orderToCreate.ecountData.orderNumber,
                        platformOrderNumber: null,
                        erpOrderCode: null,

                        partnerID: apiCustomer.customer_code,
                        partnerName: apiCustomer.customer_name,

                        productCode: orderToCreate.ecountData.serviceType || null,
                        warehouseCode: orderToCreate.ecountData.warehouseCode || null,
                        additionalService: orderToCreate.ecountData.additionalService || null,
                        extraServices: [{"extra_code": orderToCreate.ecountData.additionalService || ""}],

                        receiverName: orderToCreate.ecountData.receiverName,
                        receiverCountry: orderToCreate.ecountData.receiverCountry,
                        receiverState: orderToCreate.ecountData.receiverState,
                        receiverCity: orderToCreate.ecountData.receiverCity,
                        receiverPostalCode: orderToCreate.ecountData.receiverZipCode,
                        receiverPhone: orderToCreate.ecountData.receiverPhone,
                        receiverEmail: orderToCreate.ecountData.receiverEmail,
                        receiverAddress1: orderToCreate.ecountData.receiverAddress1,
                        receiverAddress2: orderToCreate.ecountData.receiverAddress2,

                        declaredValue: orderToCreate.ecountData.customFields.declaredValue,
                        itemsCount: orderToCreate.orderData.declarationInfo?.length || 0,
                        declarationItems: orderToCreate.orderData.declarationInfo,

                        vatNumber: orderToCreate.orderData.customsNumber?.VATCode || null,
                        iossCode: orderToCreate.orderData.customsNumber?.IOSSCode || null,
                        eoriNumber: orderToCreate.orderData.customsNumber?.EORINumber || null,
                        orderData: orderToCreate.orderData,
                    });

                    const order = await OrderModel.findById(orderId);

                    if (!resultsByOriginalOrder.has(orderToCreate.originalOrderIndex)) {
                        resultsByOriginalOrder.set(orderToCreate.originalOrderIndex, []);
                    }

                    resultsByOriginalOrder.get(orderToCreate.originalOrderIndex).push({
                        declarationIndex: orderToCreate.declarationIndex,
                        order: this.formatOrderResponse(order)
                    });

                    ordersForLookup.push({
                        orderId: orderId,
                        slipNo: slipNo
                    });

                } catch (error) {
                    errors.push({
                        success: false,
                        error: error.message,
                        order: orderToCreate.orderData,
                    });
                }
            }

            // Format kết quả theo originalOrderIndex
            for (const [originalIndex, orderResults] of resultsByOriginalOrder.entries()) {
                results.push({
                    success: true,
                    status: 'new',
                    orders: orderResults.length > 1 ? orderResults : orderResults[0].order,
                });
            }

            if (ordersForLookup.length > 0) {
                const jobService = require('../queue/job.service');
                
                try {
                    await jobService.addLookupDocNoJob(
                        ordersForLookup.map(o => o.slipNo),
                        ordersForLookup.map(o => o.orderId),
                        30
                    );
                    
                } catch (jobError) {
                    logger.error('Failed to add lookup DOC_NO job:', jobError);
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
                message: `Processed ${orders.length} orders: ${results.length} successful, ${errors.length} failed`
            };

        } catch (error) {
            logger.error('Failed to create bulk orders:', error);
            throw error;
        }
    }

    /**
     * Build ECount data helper
     */
    buildECountData(params) {
        const {
            index,
            orderNumber,
            orderData,
            apiCustomer,
            receiver,
            customs,
            declaration,
            packages,
            receiverName,
            receiverCountry,
            receiverAddress1,
            receiverAddress2,
            receiverCity,
            receiverState,
            receiverZipCode,
            receiverPhone,
            receiverEmail,
            IOSSCode,
            VATCode,
            EORINumber
        } = params;

        const productENName = declaration.nameEn || '';
        const productCNName = declaration.nameCN || '';
        const quantity = declaration.quantity || 1;
        const length = packages[0]?.length || 0;
        const width = packages[0]?.width || 0;
        const height = packages[0]?.height || 0;
        const unitWeight = declaration.unitWeight || 0;
        const unitPrice = declaration.unitPrice || 0;
        const sellingPrice = declaration.sellingPrice || 0;

        return {
            index: index,
            ioDate: orderData.ioDate,
            customerCode: orderData.customerCode || apiCustomer.customer_code,
            customerName: orderData.customerName || apiCustomer.customer_name,
            warehouseCode: orderData.warehouseCode || '',
            employeeCode: orderData.employeeCode || '',

            orderNumber: orderData.orderNumber || orderNumber,
            orderMemo1: orderData.orderMemo1 || receiverZipCode,
            orderMemo2: orderData.orderMemo2 || receiverName,
            orderMemo3: orderData.orderMemo3 || '',
            orderMemo4: orderData.orderMemo4 || receiverEmail,
            orderMemo5: orderData.orderMemo5 || receiverAddress2,

            // Receiver info
            receiverName: receiverName,
            receiverCountry: receiverCountry,
            receiverAddress1: receiverAddress1,
            receiverAddress2: receiverAddress2,
            receiverCity: receiverCity,
            receiverState: receiverState,
            receiverZipCode: receiverZipCode,
            receiverPhone: receiverPhone,
            receiverEmail: receiverEmail,

            // Customs info
            customsIOSSCode: IOSSCode,
            customsVAT: VATCode,
            customsEORINumber: EORINumber,

            // Service info
            additionalService: orderData.additionalService || '',
            serviceType: orderData.serviceType || '',
            trackingNumber: orderData.trackingNumber || '',

            // Product info
            productSize: orderData.productSize || '',
            
            // Custom fields with proper mapping
            customFields: {
                quantity: quantity,
                length: length,
                width: width,
                height: height,
                weight: unitWeight,
                declaredValue: unitPrice,
                sellingPrice: sellingPrice,
                productENName: productENName,
                productCNName: productCNName
            }
        };
    }

    /**
     * Format order response
     */
    formatOrderResponse(order) {
        return {
            reference_code: order.order_number,
            order_number: order.customer_order_number,
            code_thg: order.erp_order_code,

            status: order.status,
            product_code: order.product_code,

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
     * Generate order number
     */
    generateOrderNumber() {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        return `API${timestamp}${random}`;
    }
}

module.exports = new ApiOrderService();