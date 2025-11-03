const carrierFactory = require('./carriers');
const ecountService = require('./erp/ecount.service');
const logger = require('../utils/logger');

class OrderService {
    /**
     * Xử lý toàn bộ luồng: tạo đơn + cập nhật ERP
     */
    async processOrder(orderData) {
        try {
            logger.info('🎯 Bắt đầu xử lý đơn hàng...', {
                carrier: orderData.carrier,
                customerOrderNumber: orderData.customerOrderNumber
            });

            // Step 1: Validate carrier
            const carrierCode = (orderData.carrier || 'YUNEXPRESS').toUpperCase();
            const carrier = carrierFactory.getCarrier(carrierCode);

            // Step 2: Validate order data
            carrier.validateOrderData(orderData);

            // Step 3: Create order with carrier
            const carrierResult = await carrier.createOrder(orderData);

            if (!carrierResult.success || !carrierResult.trackingNumber) {
                throw new Error('Failed to get tracking number from carrier');
            }

            logger.info('✅ Đã tạo đơn hàng thành công', {
                trackingNumber: carrierResult.trackingNumber
            });

            // Step 4: Update ERP (ECount) if orderCode provided
            let erpResult = null;
            if (orderData.erpOrderCode) {
                try {
                    erpResult = await ecountService.updateTrackingNumber(
                        orderData.erpOrderCode,
                        carrierResult.trackingNumber,
                        orderData.erpStatus || 'Đã hoàn tất'
                    );
                    logger.info('✅ Đã cập nhật ERP thành công');
                } catch (erpError) {
                    logger.error('⚠️ Lỗi khi cập nhật ERP (đơn hàng vẫn được tạo):', erpError.message);
                    // Không throw error, vì đơn hàng đã tạo thành công
                }
            }

            return {
                success: true,
                data: {
                    trackingNumber: carrierResult.trackingNumber,
                    carrier: carrierCode,
                    carrierResponse: carrierResult.carrierResponse,
                    erpUpdated: erpResult ? erpResult.success : false,
                    erpResult: erpResult
                },
                message: 'Order processed successfully'
            };

        } catch (error) {
            logger.error('❌ Lỗi xử lý đơn hàng:', error.message);
            throw error;
        }
    }

    /**
     * Lấy danh sách carriers khả dụng
     */
    getAvailableCarriers() {
        return carrierFactory.getAvailableCarriers();
    }

    /**
     * Chỉ tạo đơn hàng, không cập nhật ERP
     */
    async createOrderOnly(orderData) {
        try {
            const carrierCode = (orderData.carrier || 'YUNEXPRESS').toUpperCase();
            const carrier = carrierFactory.getCarrier(carrierCode);
            
            carrier.validateOrderData(orderData);
            
            const result = await carrier.createOrder(orderData);
            
            return {
                success: true,
                data: {
                    trackingNumber: result.trackingNumber,
                    carrier: carrierCode,
                    carrierResponse: result.carrierResponse
                },
                message: 'Order created successfully'
            };
        } catch (error) {
            logger.error('❌ Lỗi tạo đơn hàng:', error.message);
            throw error;
        }
    }

    /**
     * Chỉ cập nhật ERP với tracking number có sẵn
     */
    async updateErpOnly(erpOrderCode, trackingNumber, status = 'Đã hoàn tất') {
        try {
            const result = await ecountService.updateTrackingNumber(
                erpOrderCode,
                trackingNumber,
                status
            );
            
            return {
                success: true,
                data: result,
                message: 'ERP updated successfully'
            };
        } catch (error) {
            logger.error('❌ Lỗi cập nhật ERP:', error.message);
            throw error;
        }
    }
}

module.exports = new OrderService();