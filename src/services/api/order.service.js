const ecountOrderService = require('../erp/ecount-order.service');
const OrderModel = require('../../models/order.model');
// const webhookService = require('./webhook.service');
const logger = require('../../utils/logger');

class ApiOrderService {
    /**
     * Tạo nhiều orders trong 1 lần gọi API ECount
     */
    async createBulkOrders(orders, apiCustomer) {
        try {
            logger.info('Creating bulk orders via API', {
                customerId: apiCustomer.customer_id,
                customerCode: apiCustomer.customer_code,
                orderCount: orders.length
            });

            // Chuẩn bị data cho tất cả orders
            const ordersToCreate = [];
            
            for (let i = 0; i < orders.length; i++) {
                const orderData = orders[i];
                const orderNumber = this.generateOrderNumber();

                // Extract receiver info
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

                const decl = orderData.declarationInfo && orderData.declarationInfo[0] ? orderData.declarationInfo[0] : {};
                const productENName = decl.nameEn || '';
                const productCNName = decl.nameCN || '';
                const quantity = decl.quantity || 1;
                const length = decl.length || 0;
                const width = decl.width || 0;
                const height = decl.height || 0;
                const unitWeight = decl.unitWeight || 0;
                const unitPrice = decl.unitPrice || 0;
                const sellingPrice = decl.sellingPrice || 0;

                const customs = orderData.customsNumber || {};
                const IOSSCode = customs.IOSSCode || '';
                const VATCode = customs.VATCode || '';
                const EORINumber = customs.EORINumber || '';

                ordersToCreate.push({
                    index: i,
                    orderNumber: orderNumber,
                    orderData: orderData,
                    ecountData: {
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
                        quantity: quantity,
                        
                        // Custom fields with proper mapping
                        customFields: {
                            length: length,
                            width: width,
                            height: height,
                            weight: unitWeight,
                            declaredValue: unitPrice,
                            sellingPrice: sellingPrice,
                            productENName: productENName,
                            productCNName: productCNName,
                            ...orderData.customFields
                        }
                    }
                });
            }

            const ecountResult = await ecountOrderService.createBulkSaleOrdersWithDocNo(
                ordersToCreate.map(o => o.ecountData)
            );

            if (!ecountResult.success) {
                throw new Error('Failed to create bulk orders on ECount');
            }

            // Lưu từng order vào database
            const results = [];
            const errors = [];
            const ordersForLookup = [];

            for (let i = 0; i < ordersToCreate.length; i++) {
                const orderToCreate = ordersToCreate[i];
                const resultDetail = ecountResult.resultDetails[i];
                const slipNo = resultDetail?.slipNo;
                const docNo = resultDetail?.docNo;
                
                if (!slipNo) {
                    errors.push({
                        index: i,
                        success: false,
                        error: 'No SlipNo returned',
                        order: orderToCreate.orderData
                    });
                    continue;
                }

                try {
                    const orderId = await OrderModel.createFromAPI({
                        orderNumber: orderToCreate.orderNumber,
                        customerOrderNumber: orderToCreate.ecountData.orderNumber,
                        platformOrderNumber: orderToCreate.platformOrderNumber || null,
                        erpOrderCode: null,
                        ecountOrderId: ecountResult.ecountOrderId,

                        carrier: orderToCreate.serviceType || null,

                        receiverName: orderToCreate.receiverName,
                        receiverCountry: orderToCreate.receiverCountry,
                        receiverState: orderToCreate.receiverState,
                        receiverCity: orderToCreate.receiverCity,
                        receiverPostalCode: orderToCreate.receiverZipCode,
                        receiverPhone: orderToCreate.receiverPhone,
                        receiverEmail: orderToCreate.receiverEmail,

                        apiCustomerId: apiCustomer.customer_id,
                        partnerID: apiCustomer.customer_code,
                        partnerName: apiCustomer.customer_name,

                        orderData: orderToCreate,
                        ecountResponse: ecountResult.rawResponse,
                    });

                    const order = await OrderModel.findById(orderId);

                    results.push({
                        index: i,
                        success: true,
                        status: 'new',
                        order: this.formatOrderResponse(order)
                    });

                    ordersForLookup.push({
                        orderId: orderId,
                        slipNo: slipNo
                    });

                } catch (error) {
                    errors.push({
                        index: i,
                        success: false,
                        error: error.message,
                        order: orderToCreate.orderData,
                        doc_no: docNo,
                    });
                }
            }

            if (ordersForLookup.length > 0) {
                const jobService = require('../queue/job.service');
                
                try {
                    await jobService.addLookupDocNoJob(
                        ordersForLookup.map(o => o.slipNo),
                        ordersForLookup.map(o => o.orderId),
                        30
                    );
                    
                    logger.info(`Added lookup DOC_NO job for ${ordersForLookup.length} orders`);
                } catch (jobError) {
                    logger.error('Failed to add lookup DOC_NO job:', jobError);
                }
            }

            logger.info('Bulk orders created', {
                total: orders.length,
                successful: results.length,
                failed: errors.length,
                customerId: apiCustomer.customer_id
            });

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
     * Format order response
     */
    formatOrderResponse(order) {
        return {
            order_id: order.id,
            reference_code: order.order_number,
            order_number: order.customer_order_number,
            platform_order_number: order.platform_order_number,
            code_thg: order.erp_order_code,

            status: order.status,
            order_status: order.order_status,

            carrier: order.carrier,
            product_code: order.product_code,
            tracking_number: order.tracking_number,
            waybill_number: order.waybill_number,

            receiver: {
                name: order.receiver_name,
                country: order.receiver_country,
                state: order.receiver_state,
                city: order.receiver_city,
                postal_code: order.receiver_postal_code,
                phone: order.receiver_phone,
                email: order.receiver_email
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