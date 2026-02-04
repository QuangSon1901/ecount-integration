const ecountOrderService = require('../erp/ecount-order.service');
const OrderModel = require('../../models/order.model');
// const webhookService = require('./webhook.service');
const logger = require('../../utils/logger');

class ApiOrderService {
    /**
     * Tạo order qua API (không mua label)
     */
    async createOrder(orderData, apiCustomer) {
        try {
            logger.info('Creating order via API', {
                customerId: apiCustomer.customer_id,
                customerCode: apiCustomer.customer_code
            });

            // Generate internal order number
            const orderNumber = this.generateOrderNumber();

            // Extract receiver info from new structure or legacy fields
            const receiver = orderData.receiver || {};
            const receiverName = receiver.name || orderData.receiverName || orderData.orderMemo2 || '';
            const receiverCountry = receiver.countryCode || orderData.receiverCountry || '';
            const receiverAddress = receiver.addressLine1 || orderData.receiverAddress || '';
            const receiverCity = receiver.city || orderData.receiverCity || '';
            const receiverState = receiver.province || orderData.receiverState || '';
            const receiverPostalCode = receiver.postalCode || orderData.receiverPostalCode || '';
            const receiverPhone = receiver.phone || orderData.receiverPhone || '';
            const receiverEmail = receiver.email || orderData.receiverEmail || '';

            // Extract package dimensions
            const pkg = orderData.packages && orderData.packages[0] ? orderData.packages[0] : {};
            const length = pkg.length || orderData.customFields?.length || 0;
            const width = pkg.width || orderData.customFields?.width || 0;
            const height = pkg.height || orderData.customFields?.height || 0;
            const weight = pkg.weight || orderData.customFields?.weight || 0;

            // Extract declaration info
            const decl = orderData.declarationInfo && orderData.declarationInfo[0] ? orderData.declarationInfo[0] : {};
            const productDescription = decl.nameEn || orderData.customFields?.productDescription || orderData.productName || '';
            const declaredValue = decl.unitPrice || orderData.customFields?.declaredValue || orderData.price || 0;

            // Prepare data for ECount
            const ecountData = {
                ioDate: orderData.ioDate,
                customerCode: orderData.customerCode || apiCustomer.customer_code,
                customerName: orderData.customerName || apiCustomer.customer_name,
                warehouseCode: orderData.warehouseCode || 'HCM',
                employeeCode: orderData.employeeCode || '',

                orderNumber: orderData.orderNumber || orderNumber,
                orderMemo1: orderData.orderMemo1 || orderData.orderNumber,
                orderMemo2: orderData.orderMemo2 || receiverName,
                orderMemo3: orderData.orderMemo3 || '',
                orderMemo4: orderData.orderMemo4 || '',
                orderMemo5: orderData.orderMemo5 || '',

                // Receiver info - now properly mapped
                receiverName: receiverName,
                receiverCountry: receiverCountry,
                receiverAddress: receiverAddress,
                receiverCity: receiverCity,
                receiverState: receiverState,
                receiverPostalCode: receiverPostalCode,

                // Additional service field
                additionalService: orderData.additionalService || '',

                productCode: orderData.productCode,
                productName: orderData.productName,
                productSize: orderData.productSize || '',
                quantity: orderData.quantity || 1,
                price: orderData.price || declaredValue || 0,

                serviceType: orderData.serviceType || '',
                trackingNumber: orderData.trackingNumber || '',

                // Custom fields with proper mapping
                customFields: {
                    length: length,
                    width: width,
                    height: height,
                    weight: weight,
                    declaredValue: declaredValue,
                    productDescription: productDescription,
                    ...orderData.customFields
                }
            };

            // Call ECount API
            const ecountResult = await ecountOrderService.createSaleOrder(ecountData);

            if (!ecountResult.success) {
                throw new Error('Failed to create order on ECount');
            }

            // Save to database
            const orderId = await OrderModel.createFromAPI({
                orderNumber: orderNumber,
                customerOrderNumber: orderData.orderNumber,
                platformOrderNumber: orderData.platformOrderNumber || null,
                erpOrderCode: orderData.orderNumber,
                ecountOrderId: ecountResult.ecountOrderId,

                carrier: orderData.serviceType || null,
                productCode: orderData.productCode,

                receiverName: receiverName,
                receiverCountry: receiverCountry,
                receiverState: receiverState,
                receiverCity: receiverCity,
                receiverPostalCode: receiverPostalCode,
                receiverPhone: receiverPhone,
                receiverEmail: receiverEmail,

                apiCustomerId: apiCustomer.customer_id,
                partnerID: apiCustomer.customer_code,
                partnerName: apiCustomer.customer_name,

                orderData: orderData,
                ecountResponse: ecountResult.rawResponse,
                ecountLink: process.env.ECOUNT_HASH_LINK
            });

            logger.info('Order created successfully via API', {
                orderId,
                ecountOrderId: ecountResult.ecountOrderId,
                customerId: apiCustomer.customer_id
            });

            // Trigger webhook
            // webhookService.trigger('order.created', {
            //     order_id: orderId,
            //     order_number: orderNumber,
            //     customer_order_number: orderData.orderNumber,
            //     ecount_order_id: ecountResult.ecountOrderId,
            //     status: 'new',
            //     is_label_purchased: false,
            //     created_at: new Date().toISOString()
            // }).catch(err => logger.error('Webhook trigger failed:', err));

            // Get full order data
            const order = await OrderModel.findById(orderId);

            return {
                success: true,
                data: {
                    order_id: orderId,
                    order_number: orderNumber,
                    customer_order_number: orderData.orderNumber,
                    ecount_order_id: ecountResult.ecountOrderId,
                    status: 'new',
                    is_label_purchased: false,
                    ecount_data: ecountResult.ecountData,
                    order: this.formatOrderResponse(order)
                },
                message: 'Order created successfully on ECount'
            };

        } catch (error) {
            logger.error('Failed to create order via API:', error);
            throw error;
        }
    }

    /**
     * Tạo nhiều orders
     */
    async createBulkOrders(orders, apiCustomer) {
        const results = [];
        const errors = [];

        for (let i = 0; i < orders.length; i++) {
            try {
                const result = await this.createOrder(orders[i], apiCustomer);
                results.push({
                    index: i,
                    success: true,
                    ...result.data
                });
            } catch (error) {
                errors.push({
                    index: i,
                    success: false,
                    error: error.message,
                    order: orders[i]
                });
            }
        }

        return {
            success: errors.length === 0,
            data: {
                total: orders.length,
                successful: results.length,
                failed: errors.length,
                results,
                errors
            },
            message: `Processed ${orders.length} orders: ${results.length} successful, ${errors.length} failed`
        };
    }

    /**
     * Format order response
     */
    formatOrderResponse(order) {
        return {
            order_id: order.id,
            order_number: order.order_number,
            customer_order_number: order.customer_order_number,
            platform_order_number: order.platform_order_number,
            ecount_order_id: order.ecount_order_id,
            erp_order_code: order.erp_order_code,

            status: order.status,
            order_status: order.order_status,
            erp_status: order.erp_status,
            is_label_purchased: order.is_label_purchased,

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
