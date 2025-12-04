const OrderModel = require('../models/order.model');
const carrierFactory = require('../services/carriers');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

class ImportController {
    /**
     * POST /api/orders/import
     * Import danh sách orders từ ERP codes
     */
    async importOrders(req, res, next) {
        try {
            const { orders, carrierRequest } = req.body;
            
            // Validate
            if (!orders || !Array.isArray(orders) || orders.length === 0) {
                return errorResponse(res, 'orders array is required and must not be empty', 400);
            }

            if (orders.length > 100) {
                return errorResponse(res, 'Maximum 100 orders per request', 400);
            }

            logger.info(`Nhận yêu cầu import ${orders.length} đơn hàng từ ERP codes`);
            
            const results = [];
            const errors = [];
            
            for (let i = 0; i < orders.length; i++) {
                const orderInput = orders[i];
                
                try {
                    // Validate required fields
                    if (!orderInput.CodeTHG || !orderInput.CustomerOrderNumber) {
                        throw new Error('CodeTHG and CustomerOrderNumber are required');
                    }

                    // Bước 1: Kiểm tra xem order đã tồn tại chưa
                    const existingOrder = await OrderModel.findByErpOrderCode(orderInput.CodeTHG);
                    
                    if (existingOrder) {
                        logger.warn(`Order already exists: ${orderInput.CodeTHG}`);
                        errors.push({
                            index: i,
                            CodeTHG: orderInput.CodeTHG,
                            CustomerOrderNumber: orderInput.CustomerOrderNumber,
                            error: 'Order already exists in database',
                            existingOrderId: existingOrder.id
                        });
                        continue;
                    }

                    // Bước 2: Gọi API inquiry để lấy thông tin order
                    const carrier = carrierFactory.getCarrier(carrierRequest);
                    const inquiryResult = await carrier.getOrderInfo(orderInput.CustomerOrderNumber);

                    if (!inquiryResult.success) {
                        throw new Error('Failed to get order info from carrier');
                    }

                    const orderInfo = inquiryResult.data;

                    // Bước 3: Tạo order trong database
                    const orderNumber = this.generateOrderNumber();
                    
                    const orderId = await OrderModel.create({
                        orderNumber: orderNumber,
                        customerOrderNumber: orderInput.CustomerOrderNumber,
                        platformOrderNumber: orderInfo.platform_account_code || null,
                        erpOrderCode: orderInput.CodeTHG,
                        carrier: carrierRequest,
                        productCode: orderInfo.product_code,
                        waybillNumber: orderInfo.waybill_number,
                        trackingNumber: null,
                        labelUrl: null,
                        labelAccessKey: null,
                        packageWeight: orderInfo.packages?.[0]?.weight || null,
                        packageLength: orderInfo.packages?.[0]?.length || null,
                        packageWidth: orderInfo.packages?.[0]?.width || null,
                        packageHeight: orderInfo.packages?.[0]?.height || null,
                        weightUnit: orderInfo.weight_unit || 'KG',
                        sizeUnit: orderInfo.size_unit || 'CM',
                        receiverName: orderInfo.receiver?.first_name 
                            ? `${orderInfo.receiver.first_name} ${orderInfo.receiver.last_name || ''}`.trim() 
                            : null,
                        receiverCountry: orderInfo.receiver?.country_code || null,
                        receiverState: orderInfo.receiver?.province || null,
                        receiverCity: orderInfo.receiver?.city || null,
                        receiverPostalCode: orderInfo.receiver?.postal_code || null,
                        receiverPhone: orderInfo.receiver?.phone_number || null,
                        receiverEmail: orderInfo.receiver?.email || null,
                        declaredValue: orderInfo.declaration_info?.reduce(
                            (sum, item) => sum + (item.unit_price * item.quantity), 0
                        ) || null,
                        declaredCurrency: orderInfo.declaration_info?.[0]?.currency || 'USD',
                        itemsCount: orderInfo.declaration_info?.length || 0,
                        status: 'created',
                        orderStatus: 'T', // S = Scheduled
                        erpStatus: 'Đang xử lý',
                        erpUpdated: false,
                        erpTrackingNumberUpdated: false,
                        ecountLink: '#menuType=MENUTREE_000004&menuSeq=MENUTREE_000004&groupSeq=MENUTREE_000030&prgId=C000004&depth=1',
                        orderData: {
                            carrier: carrierRequest,
                            imported: true,
                            importedAt: new Date().toISOString()
                        },
                        carrierResponse: {
                            success: true,
                            source: 'inquiry_api',
                            data: orderInfo
                        }
                    });

                    results.push({
                        index: i,
                        success: true,
                        orderId: orderId,
                        orderNumber: orderNumber,
                        CodeTHG: orderInput.CodeTHG,
                        CustomerOrderNumber: orderInput.CustomerOrderNumber,
                        waybillNumber: orderInfo.waybill_number,
                        trackingNumber: '',
                        productCode: orderInfo.product_code,
                        status: 'T',
                        labelUrl: null,
                        hasLabel: false
                    });

                    // Delay giữa các requests để tránh rate limit
                    if (i < orders.length - 1) {
                        await this.sleep(1000); // 1 second delay
                    }

                } catch (error) {
                    logger.error(`✗ [${i + 1}/${orders.length}] Failed to import order:`, {
                        CodeTHG: orderInput.CodeTHG,
                        CustomerOrderNumber: orderInput.CustomerOrderNumber,
                        error: error.message
                    });

                    errors.push({
                        index: i,
                        CodeTHG: orderInput.CodeTHG,
                        CustomerOrderNumber: orderInput.CustomerOrderNumber,
                        error: error.message
                    });
                }
            }

            const summary = {
                total: orders.length,
                success: results.length,
                failed: errors.length,
                successRate: orders.length > 0 
                    ? ((results.length / orders.length) * 100).toFixed(1) + '%' 
                    : '0%'
            };

            logger.info('Import completed:', summary);

            return successResponse(res, {
                summary,
                results,
                errors: errors.length > 0 ? errors : undefined
            }, `Successfully imported ${results.length}/${orders.length} orders`, 201);

        } catch (error) {
            next(error);
        }
    }

    /**
     * Generate unique order number
     */
    generateOrderNumber() {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        return `ORD${timestamp}${random}`;
    }

    /**
     * Sleep helper
     */
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = new ImportController();