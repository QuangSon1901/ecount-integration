const carrierFactory = require('./carriers');
const ecountService = require('./erp/ecount.service');
const OrderModel = require('../models/order.model');
const logger = require('../utils/logger');

class OrderService {
    /**
     * Generate unique order number
     */
    generateOrderNumber() {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        return `ORD${timestamp}${random}`;
    }

    /**
     * Xử lý toàn bộ luồng: tạo đơn + lưu DB + cập nhật ERP
     */
    async processOrder(orderData) {
        let orderId = null;
        
        try {
            logger.info('🎯 Bắt đầu xử lý đơn hàng...', {
                carrier: orderData.carrier,
                customerOrderNumber: orderData.customerOrderNumber,
                erpOrderCode: orderData.erpOrderCode,
                hasEcountLink: !!orderData.ecountLink
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

            // Step 4: Save to database
            const orderNumber = this.generateOrderNumber();
            orderId = await OrderModel.create({
                orderNumber: orderNumber,
                customerOrderNumber: orderData.customerOrderNumber,
                platformOrderNumber: orderData.platformOrderNumber,
                erpOrderCode: orderData.erpOrderCode,
                carrier: carrierCode,
                productCode: orderData.productCode,
                trackingNumber: carrierResult.trackingNumber,
                status: 'created',
                erpStatus: orderData.erpStatus || 'Chờ xử lý',
                ecountLink: orderData.ecountLink || null, // Lưu hash link từ request
                orderData: orderData,
                carrierResponse: carrierResult.carrierResponse
            });

            logger.info('✅ Đã lưu đơn hàng vào database', { orderId, orderNumber });

            // Step 5: Update ERP (ECount) if orderCode and ecountLink provided
            let erpResult = null;
            // if (orderData.erpOrderCode && orderData.ecountLink) {
            //     try {
            //         erpResult = await ecountService.updateTrackingNumber(
            //             orderId,
            //             orderData.erpOrderCode,
            //             carrierResult.trackingNumber,
            //             orderData.erpStatus || 'Đã hoàn tất',
            //             orderData.ecountLink // Truyền hash link vào
            //         );
                    
            //         // Update ERP status in DB
            //         await OrderModel.update(orderId, {
            //             erpUpdated: true,
            //             erpStatus: orderData.erpStatus || 'Đã hoàn tất'
            //         });
                    
            //         logger.info('✅ Đã cập nhật ERP thành công');
            //     } catch (erpError) {
            //         logger.error('⚠️ Lỗi khi cập nhật ERP (đơn hàng vẫn được tạo):', erpError.message);
            //         // Không throw error, vì đơn hàng đã tạo thành công
            //     }
            // } else {
            //     logger.info('ℹ️ Bỏ qua cập nhật ERP (thiếu erpOrderCode hoặc ecountLink)');
            // }

            return {
                success: true,
                data: {
                    orderId: orderId,
                    orderNumber: orderNumber,
                    trackingNumber: carrierResult.trackingNumber,
                    carrier: carrierCode,
                    carrierResponse: carrierResult.carrierResponse,
                    erpUpdated: erpResult ? erpResult.success : false,
                    erpResult: erpResult,
                    ecountLink: orderData.ecountLink || null
                },
                message: 'Order processed successfully'
            };

        } catch (error) {
            logger.error('❌ Lỗi xử lý đơn hàng:', error.message);
            
            // Nếu đã tạo record trong DB, cập nhật status thành failed
            if (orderId) {
                await OrderModel.update(orderId, { status: 'failed' });
            }
            
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
            
            // Save to database
            const orderNumber = this.generateOrderNumber();
            const orderId = await OrderModel.create({
                orderNumber: orderNumber,
                customerOrderNumber: orderData.customerOrderNumber,
                platformOrderNumber: orderData.platformOrderNumber,
                erpOrderCode: orderData.erpOrderCode,
                carrier: carrierCode,
                productCode: orderData.productCode,
                trackingNumber: result.trackingNumber,
                status: 'created',
                erpStatus: orderData.erpStatus || 'Chờ xử lý',
                ecountLink: orderData.ecountLink || null,
                orderData: orderData,
                carrierResponse: result.carrierResponse
            });
            
            return {
                success: true,
                data: {
                    orderId: orderId,
                    orderNumber: orderNumber,
                    trackingNumber: result.trackingNumber,
                    carrier: carrierCode,
                    carrierResponse: result.carrierResponse,
                    ecountLink: orderData.ecountLink || null
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
    async updateErpOnly(erpOrderCode, trackingNumber, status = 'Đã hoàn tất', ecountLink = null) {
        try {
            // Tìm order trong DB
            const order = await OrderModel.findByErpOrderCode(erpOrderCode);
            
            if (!order) {
                throw new Error(`Order not found with erpOrderCode: ${erpOrderCode}`);
            }

            // Sử dụng ecountLink từ DB nếu không truyền vào
            const linkToUse = ecountLink || order.ecount_link;
            
            if (!linkToUse) {
                throw new Error('ECount link is required but not found');
            }

            const result = await ecountService.updateTrackingNumber(
                order.id,
                erpOrderCode,
                trackingNumber,
                status,
                linkToUse
            );
            
            // Update DB
            await OrderModel.update(order.id, {
                erpUpdated: true,
                erpStatus: status
            });
            
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

    /**
     * Lấy thông tin order
     */
    async getOrder(orderId) {
        try {
            const order = await OrderModel.findById(orderId);
            
            if (!order) {
                throw new Error('Order not found');
            }
            
            return {
                success: true,
                data: order,
                message: 'Order retrieved successfully'
            };
        } catch (error) {
            logger.error('❌ Lỗi lấy thông tin order:', error.message);
            throw error;
        }
    }

    /**
     * Track đơn hàng theo tracking number
     */
    async trackByTrackingNumber(trackingNumber, carrierCode = null) {
        try {
            // Tìm order trong DB
            const order = await OrderModel.findByTrackingNumber(trackingNumber);

            let carrier;
            if (order) {
                // Nếu có trong DB, dùng carrier từ DB
                carrier = carrierFactory.getCarrier(order.carrier);
            } else if (carrierCode) {
                // Nếu không có trong DB, dùng carrier từ query param
                carrier = carrierFactory.getCarrier(carrierCode);
            } else {
                throw new Error('Carrier code is required for tracking number not in database');
            }

            logger.info('🔍 Tracking by tracking number:', {
                trackingNumber,
                carrier: order ? order.carrier : carrierCode
            });

            const trackingResult = await carrier.trackOrder(trackingNumber);

            return {
                success: true,
                data: {
                    trackingNumber: trackingNumber,
                    carrier: order ? order.carrier : carrierCode,
                    status: trackingResult.status,
                    trackingInfo: trackingResult.trackingInfo,
                    inDatabase: !!order,
                    orderId: order ? order.id : null,
                    updatedAt: new Date().toISOString()
                },
                message: 'Tracking information retrieved successfully'
            };

        } catch (error) {
            logger.error('❌ Lỗi tracking by tracking number:', error.message);
            throw error;
        }
    }

    /**
     * Lấy thống kê orders
     */
    async getStatistics() {
        try {
            const stats = await OrderModel.countByStatus();
            
            return {
                success: true,
                data: stats,
                message: 'Statistics retrieved successfully'
            };
        } catch (error) {
            logger.error('❌ Lỗi lấy thống kê:', error.message);
            throw error;
        }
    }
}

module.exports = new OrderService();