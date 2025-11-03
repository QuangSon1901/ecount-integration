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

            if (!carrierResult.success) {
                throw new Error('Failed to create order with carrier');
            }

            logger.info('✅ Đã tạo đơn hàng với carrier', {
                waybillNumber: carrierResult.waybillNumber,
                customerOrderNumber: carrierResult.customerOrderNumber,
                trackingNumber: carrierResult.trackingNumber || 'Chưa có'
            });

            // Step 4: Get tracking number if not available immediately
            let trackingNumber = carrierResult.trackingNumber;
            let finalOrderInfo = carrierResult.carrierResponse;
            
            if (!trackingNumber || trackingNumber === '') {
                logger.info('⏳ Tracking number chưa có, đang lấy từ order info...');
                
                // Retry logic: thử lấy tracking number trong 30s
                const maxRetries = 6;
                const retryDelay = 5000; // 5s
                
                for (let i = 0; i < maxRetries; i++) {
                    try {
                        // Đợi một chút trước khi retry
                        if (i > 0) {
                            await this.sleep(retryDelay);
                        }
                        
                        // Lấy thông tin đơn hàng bằng waybill_number hoặc customer_order_number
                        const orderCode = carrierResult.waybillNumber || carrierResult.customerOrderNumber;
                        const orderInfo = await carrier.getOrderInfo(orderCode);
                        
                        if (orderInfo.success && orderInfo.data.trackingNumber) {
                            trackingNumber = orderInfo.data.trackingNumber;
                            finalOrderInfo = orderInfo.data;
                            
                            logger.info('✅ Đã lấy được tracking number:', {
                                trackingNumber,
                                attempt: i + 1
                            });
                            break;
                        }
                        
                        logger.info(`⏳ Tracking number chưa có, thử lại lần ${i + 1}/${maxRetries}...`);
                        
                    } catch (error) {
                        logger.warn(`⚠️ Lỗi khi lấy order info (lần ${i + 1}):`, error.message);
                        
                        // Nếu đã hết retry, tiếp tục xử lý với tracking number rỗng
                        if (i === maxRetries - 1) {
                            logger.warn('⚠️ Không thể lấy tracking number sau nhiều lần thử, tiếp tục lưu đơn hàng');
                        }
                    }
                }
            }

            // Step 5: Save to database
            const orderNumber = this.generateOrderNumber();
            
            // Lấy thông tin từ packages để tính toán
            const firstPackage = orderData.packages?.[0] || {};
            const totalWeight = orderData.packages?.reduce((sum, pkg) => sum + (pkg.weight || 0), 0) || null;
            
            // Lấy thông tin từ declaration để tính tổng giá trị
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
                trackingNumber: trackingNumber || null,
                barCodes: carrierResult.barCodes || null,
                
                // Package info
                packageWeight: totalWeight,
                packageLength: firstPackage.length || null,
                packageWidth: firstPackage.width || null,
                packageHeight: firstPackage.height || null,
                weightUnit: orderData.weightUnit || 'KG',
                sizeUnit: orderData.sizeUnit || 'CM',
                
                // Receiver info
                receiverName: orderData.receiver ? 
                    `${orderData.receiver.firstName} ${orderData.receiver.lastName}`.trim() : null,
                receiverCountry: orderData.receiver?.countryCode || null,
                receiverState: orderData.receiver?.province || null,
                receiverCity: orderData.receiver?.city || null,
                receiverPostalCode: orderData.receiver?.postalCode || null,
                receiverPhone: orderData.receiver?.phoneNumber || null,
                receiverEmail: orderData.receiver?.email || null,
                
                // Declaration info
                declaredValue: declaredValue,
                declaredCurrency: orderData.declarationInfo?.[0]?.currency || 'USD',
                itemsCount: orderData.declarationInfo?.length || 0,
                
                // Status
                status: trackingNumber ? 'created' : 'pending',
                trackType: carrierResult.trackType || null,
                remoteArea: carrierResult.remoteArea || null,
                
                // ERP
                erpStatus: orderData.erpStatus || 'Chờ xử lý',
                ecountLink: orderData.ecountLink || null,
                
                // Additional
                extraServices: orderData.extraServices || [],
                sensitiveType: orderData.sensitiveType || null,
                goodsType: orderData.goodsType || null,
                vatNumber: orderData.customsNumber?.vat_code || null,
                iossCode: orderData.customsNumber?.ioss_code || null,
                eoriNumber: orderData.customsNumber?.eori_number || null,
                
                // Full data
                orderData: orderData,
                carrierResponse: finalOrderInfo
            });

            logger.info('✅ Đã lưu đơn hàng vào database', { 
                orderId, 
                orderNumber,
                trackingNumber: trackingNumber || 'Chưa có'
            });

            // Step 6: Update ERP (ECount) if conditions met
            let erpResult = null;
            // if (orderData.erpOrderCode && orderData.ecountLink && trackingNumber) {
            //     try {
            //         erpResult = await ecountService.updateTrackingNumber(
            //             orderId,
            //             orderData.erpOrderCode,
            //             trackingNumber,
            //             orderData.erpStatus || 'Đã hoàn tất',
            //             orderData.ecountLink
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
            //     if (!trackingNumber) {
            //         logger.info('ℹ️ Bỏ qua cập nhật ERP (tracking number chưa có)');
            //     } else if (!orderData.erpOrderCode || !orderData.ecountLink) {
            //         logger.info('ℹ️ Bỏ qua cập nhật ERP (thiếu erpOrderCode hoặc ecountLink)');
            //     }
            // }

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
                    carrierResponse: finalOrderInfo,
                    erpUpdated: erpResult ? erpResult.success : false,
                    erpResult: erpResult,
                    ecountLink: orderData.ecountLink || null,
                    hasTrackingNumber: !!trackingNumber
                },
                message: trackingNumber ? 
                    'Order processed successfully' : 
                    'Order created successfully, tracking number will be generated later'
            };

        } catch (error) {
            logger.error('❌ Lỗi xử lý đơn hàng:', error.message);
            
            // Nếu đã tạo record trong DB, cập nhật status thành failed
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