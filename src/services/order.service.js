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
        let orderId = null;
        
        try {
            logger.info('🎯 Bắt đầu xử lý đơn hàng...', {
                carrier: orderData.carrier,
                customerOrderNumber: orderData.customerOrderNumber,
                erpOrderCode: orderData.erpOrderCode,
                hasEcountLink: !!orderData.ecountLink
            });

            // Step 1-3: Validate và tạo đơn với carrier (giữ nguyên)
            const carrierCode = (orderData.carrier || 'YUNEXPRESS').toUpperCase();
            const carrier = carrierFactory.getCarrier(carrierCode);
            carrier.validateOrderData(orderData);
            const carrierResult = await carrier.createOrder(orderData);

            if (!carrierResult.success) {
                throw new Error('Failed to create order with carrier');
            }

            logger.info('✅ Đã tạo đơn hàng với carrier', {
                waybillNumber: carrierResult.waybillNumber,
                customerOrderNumber: carrierResult.customerOrderNumber,
                trackingNumber: carrierResult.trackingNumber || 'Chưa có'
            });

            // Step 4: Save to database (giữ nguyên phần này)
            const orderNumber = this.generateOrderNumber();
            const firstPackage = orderData.packages?.[0] || {};
            const totalWeight = orderData.packages?.reduce((sum, pkg) => sum + (pkg.weight || 0), 0) || null;
            const declaredValue = orderData.declarationInfo?.reduce(
                (sum, item) => sum + ((item.unit_price || 0) * (item.quantity || 0)), 
                0
            ) || null;
            
            orderId = await OrderModel.create({
                orderNumber: orderNumber,
                customerOrderNumber: carrierResult.customerOrderNumber || orderData.customerOrderNumber,
                platformOrderNumber: orderData.platformOrderNumber,
                erpOrderCode: orderData.erpOrderCode,
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
                declaredValue: declaredValue,
                declaredCurrency: orderData.declarationInfo?.[0]?.currency || 'USD',
                itemsCount: orderData.declarationInfo?.length || 0,
                status: carrierResult.trackingNumber ? 'created' : 'pending',
                trackType: carrierResult.trackType || null,
                remoteArea: carrierResult.remoteArea || null,
                erpStatus: orderData.erpStatus || 'Chờ xử lý',
                ecountLink: orderData.ecountLink || null,
                extraServices: orderData.extraServices || [],
                sensitiveType: orderData.sensitiveType || null,
                goodsType: orderData.goodsType || null,
                vatNumber: orderData.customsNumber?.vat_code || null,
                iossCode: orderData.customsNumber?.ioss_code || null,
                eoriNumber: orderData.customsNumber?.eori_number || null,
                orderData: orderData,
                carrierResponse: carrierResult.carrierResponse
            });

            logger.info('✅ Đã lưu đơn hàng vào database', { 
                orderId, 
                orderNumber,
                trackingNumber: carrierResult.trackingNumber || 'Chưa có'
            });

            // Step 5: Xử lý tracking number
            let trackingNumber = carrierResult.trackingNumber;
            let jobInfo = null;
            
            if (!trackingNumber || trackingNumber === '') {
                logger.info('⏳ Tracking number chưa có, thêm vào queue để lấy sau...');
                
                const orderCode = carrierResult.waybillNumber || carrierResult.customerOrderNumber;
                
                try {
                    const jobId = await jobService.addTrackingNumberJob(
                        orderId,
                        orderCode,
                        carrierCode,
                        5 // Delay 5 giây
                    );
                    
                    jobInfo = {
                        jobId: jobId,
                        status: 'queued',
                        message: 'Tracking number will be fetched automatically'
                    };
                    
                    logger.info('✅ Đã thêm job vào queue', {
                        jobId,
                        orderId,
                        orderCode
                    });
                    
                } catch (queueError) {
                    logger.error('⚠️ Không thể thêm job vào queue:', queueError.message);
                    
                    jobInfo = {
                        status: 'queue_failed',
                        error: queueError.message,
                        message: 'Failed to queue tracking number job, please check manually'
                    };
                }
            }

            return {
                success: true,
                data: {
                    orderId: orderId,
                    orderNumber: orderNumber,
                    waybillNumber: carrierResult.waybillNumber,
                    customerOrderNumber: carrierResult.customerOrderNumber,
                    trackingNumber: trackingNumber || null,
                    trackType: carrierResult.trackType,
                    remoteArea: carrierResult.remoteArea,
                    carrier: carrierCode,
                    carrierResponse: carrierResult.carrierResponse,
                    ecountLink: orderData.ecountLink || null,
                    hasTrackingNumber: !!trackingNumber,
                    trackingNumberJob: jobInfo
                },
                message: trackingNumber ? 
                    'Order processed successfully' : 
                    'Order created successfully, tracking number will be fetched automatically'
            };

        } catch (error) {
            logger.error('❌ Lỗi xử lý đơn hàng:', error.message);
            
            if (orderId) {
                await OrderModel.update(orderId, { 
                    status: 'failed',
                    errorInfo: {
                        message: error.message,
                        timestamp: new Date().toISOString()
                    }
                });
            }
            
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

    async getProducts(country_code, carrierCode = 'YUNEXPRESS') {
        try {
            const carrier = carrierFactory.getCarrier(carrierCode);
            const result = await carrier.getProductList(country_code);

            return result;
        } catch (error) {
            logger.error('❌ Lỗi get products by country code:', error.message);
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
            
            logger.info('📋 Lấy thông tin đơn hàng:', {
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
            logger.error('❌ Lỗi lấy thông tin đơn hàng:', error.message);
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