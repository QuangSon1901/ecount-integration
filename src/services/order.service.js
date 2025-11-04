const carrierFactory = require('./carriers');
const ecountService = require('./erp/ecount.service');
const jobService = require('./queue/job.service');
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
        try {
            logger.info('Đang push job tạo đơn hàng vào queue...', {
                carrier: orderData.carrier,
                customerOrderNumber: orderData.customerOrderNumber,
                erpOrderCode: orderData.erpOrderCode
            });

            // Push job vào queue
            const jobId = await jobService.addCreateOrderJob(orderData, 0);

            logger.info('Đã push job vào queue', { jobId });

            return {
                success: true,
                data: {
                    jobId: jobId,
                    status: 'queued',
                    message: 'Order creation job has been queued'
                },
                message: 'Order will be processed shortly'
            };

        } catch (error) {
            logger.error('Lỗi push job:', error.message);
            throw error;
        }
    }

    /**
     * Sleep helper
     */
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
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
                erpStatus: orderData.erpStatus || 'Đang xử lý',
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
            logger.error('Lỗi tạo đơn hàng:', error.message);
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

            const result = await ecountService.updateInfoEcount(
                'status',
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
            logger.error('Lỗi cập nhật ERP:', error.message);
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
            logger.error('Lỗi lấy thông tin order:', error.message);
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

            logger.info('Tracking by tracking number:', {
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
            logger.error('Lỗi tracking by tracking number:', error.message);
            throw error;
        }
    }

    async getProducts(country_code, carrierCode = 'YUNEXPRESS') {
        try {
            const carrier = carrierFactory.getCarrier(carrierCode);
            const result = await carrier.getProductList(country_code);

            return result;
        } catch (error) {
            logger.error('Lỗi get products by country code:', error.message);
            throw error;
        }
    }

    /**
     * Lấy thông tin chi tiết đơn hàng theo order code
     * @param {string} orderCode - Waybill number, customer order number, hoặc tracking number
     * @param {string} carrierCode - Mã nhà vận chuyển (mặc định YUNEXPRESS)
     * @returns {Promise<Object>}
     */
    async getOrderInfo(orderCode, carrierCode = 'YUNEXPRESS') {
        try {
            const carrier = carrierFactory.getCarrier(carrierCode);
            
            logger.info('Lấy thông tin đơn hàng:', {
                orderCode,
                carrier: carrierCode
            });

            const result = await carrier.getOrderInfo(orderCode);

            return {
                success: true,
                data: result.data,
                message: 'Order information retrieved successfully'
            };

        } catch (error) {
            logger.error('Lỗi lấy thông tin đơn hàng:', error.message);
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
            logger.error('Lỗi lấy thống kê:', error.message);
            throw error;
        }
    }
}

module.exports = new OrderService();