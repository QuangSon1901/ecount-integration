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
     * Xử lý nhiều đơn hàng cùng lúc
     */
    async processOrderMulti(ordersData) {
        try {
            logger.info(`Đang push ${ordersData.length} jobs tạo đơn hàng vào queue...`);

            const results = [];
            const errors = [];

            // Push từng order vào queue
            for (let i = 0; i < ordersData.length; i++) {
                const orderData = ordersData[i];
                
                try {
                    // Validate cơ bản
                    if (!orderData.receiver || !orderData.packages || !orderData.declarationInfo) {
                        throw new Error('Missing required fields: receiver, packages, or declarationInfo');
                    }

                    // Push job với delay tăng dần để tránh overload
                    const delaySeconds = i * 2; // Mỗi job cách nhau 2 giây
                    const jobId = await jobService.addCreateOrderJob(orderData, delaySeconds);

                    results.push({
                        index: i,
                        customerOrderNumber: orderData.customerOrderNumber,
                        erpOrderCode: orderData.erpOrderCode,
                        jobId: jobId,
                        status: 'queued',
                        delaySeconds: delaySeconds
                    });

                    logger.info(`✓ Đã push job ${i + 1}/${ordersData.length}`, {
                        jobId,
                        customerOrderNumber: orderData.customerOrderNumber,
                        delaySeconds
                    });

                } catch (error) {
                    logger.error(`✗ Lỗi push job ${i + 1}/${ordersData.length}:`, error.message);
                    
                    errors.push({
                        index: i,
                        customerOrderNumber: orderData.customerOrderNumber,
                        error: error.message
                    });
                }
            }

            const summary = {
                total: ordersData.length,
                queued: results.length,
                failed: errors.length
            };

            logger.info('Hoàn tất push jobs:', summary);

            return {
                success: true,
                data: {
                    summary: summary,
                    results: results,
                    errors: errors.length > 0 ? errors : undefined
                },
                message: `Successfully queued ${results.length}/${ordersData.length} orders`
            };

        } catch (error) {
            logger.error('Lỗi processOrderMulti:', error.message);
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
    async getOrderInfo(orderCode, carrierCode = 'YUNEXPRESS', type = 'carrier', pathDetail = '') {
        try {
            logger.info('Lấy thông tin đơn hàng:', {
                orderCode,
                carrier: carrierCode,
                type
            });

            let result = null;
            switch (type) {
                case 'erp':
                    result = await ecountService.getInfoEcount(orderCode, pathDetail);
                    break;
                default:
                    const carrier = carrierFactory.getCarrier(carrierCode);
                    result = await carrier.getOrderInfo(orderCode);
                    break;
            }

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

    /**
     * Lấy orders đang chờ theo các trạng thái
     */
    async getPendingOrders(filters = {}) {
        try {
            const { status, limit = 50, offset = 0 } = filters;

            let query = '';
            let params = [];
            let label = '';

            switch (status) {
                case 'waiting_creation':
                    // Orders đang chờ tạo (có job pending)
                    query = `
                        SELECT 
                            o.id,
                            o.order_number,
                            o.erp_order_code,
                            o.customer_order_number,
                            o.carrier,
                            o.product_code,
                            o.status,
                            o.created_at,
                            j.id as job_id,
                            j.status as job_status,
                            j.attempts,
                            j.available_at,
                            j.error_message
                        FROM orders o
                        INNER JOIN jobs j ON JSON_EXTRACT(j.payload, '$.orderData.erpOrderCode') = o.erp_order_code
                        WHERE j.job_type = 'create_order'
                        AND j.status IN ('pending', 'processing')
                        ORDER BY o.created_at DESC
                        LIMIT ? OFFSET ?
                    `;
                    params = [limit, offset];
                    label = 'Đang chờ tạo đơn';
                    break;

                case 'waiting_tracking_number':
                    // Orders đã tạo nhưng chưa có tracking number
                    query = `
                        SELECT 
                            o.id,
                            o.order_number,
                            o.erp_order_code,
                            o.customer_order_number,
                            o.waybill_number,
                            o.carrier,
                            o.status,
                            o.created_at,
                            COALESCE(j.id, 0) as job_id,
                            COALESCE(j.status, 'none') as job_status,
                            j.attempts,
                            j.error_message
                        FROM orders o
                        LEFT JOIN jobs j ON j.job_type = 'tracking_number' 
                            AND JSON_EXTRACT(j.payload, '$.orderId') = o.id
                            AND j.status IN ('pending', 'processing')
                        WHERE (o.tracking_number IS NULL OR o.tracking_number = '')
                        AND o.status IN ('pending', 'created')
                        AND o.waybill_number IS NOT NULL
                        ORDER BY o.created_at ASC
                        LIMIT ? OFFSET ?
                    `;
                    params = [limit, offset];
                    label = 'Đang chờ tracking number';
                    break;

                case 'waiting_tracking_update':
                    // Orders có tracking nhưng chưa update lên ECount
                    query = `
                        SELECT 
                            o.id,
                            o.order_number,
                            o.erp_order_code,
                            o.customer_order_number,
                            o.tracking_number,
                            o.carrier,
                            o.status,
                            o.erp_tracking_number_updated,
                            o.created_at,
                            COALESCE(j.id, 0) as job_id,
                            COALESCE(j.status, 'none') as job_status,
                            j.attempts,
                            j.error_message
                        FROM orders o
                        LEFT JOIN jobs j ON j.job_type = 'update_tracking_ecount'
                            AND JSON_EXTRACT(j.payload, '$.orderId') = o.id
                            AND j.status IN ('pending', 'processing')
                        WHERE o.tracking_number IS NOT NULL 
                        AND o.tracking_number != ''
                        AND o.erp_tracking_number_updated = FALSE
                        AND o.erp_order_code IS NOT NULL
                        AND o.ecount_link IS NOT NULL
                        ORDER BY o.created_at ASC
                        LIMIT ? OFFSET ?
                    `;
                    params = [limit, offset];
                    label = 'Đang chờ update tracking lên ECount';
                    break;

                case 'waiting_status_update':
                    // Orders delivered nhưng chưa update status lên ECount
                    query = `
                        SELECT 
                            o.id,
                            o.order_number,
                            o.erp_order_code,
                            o.customer_order_number,
                            o.tracking_number,
                            o.carrier,
                            o.status,
                            o.erp_status,
                            o.erp_updated,
                            o.delivered_at,
                            o.created_at,
                            COALESCE(j.id, 0) as job_id,
                            COALESCE(j.status, 'none') as job_status,
                            j.attempts,
                            j.error_message
                        FROM orders o
                        LEFT JOIN jobs j ON j.job_type = 'update_status_ecount'
                            AND JSON_EXTRACT(j.payload, '$.orderId') = o.id
                            AND j.status IN ('pending', 'processing')
                        WHERE o.status = 'delivered'
                        AND o.erp_updated = FALSE
                        AND o.erp_order_code IS NOT NULL
                        AND o.ecount_link IS NOT NULL
                        ORDER BY o.delivered_at ASC
                        LIMIT ? OFFSET ?
                    `;
                    params = [limit, offset];
                    label = 'Đang chờ update trạng thái lên ECount';
                    break;

                case 'in_transit':
                    // Orders đang vận chuyển
                    query = `
                        SELECT 
                            o.id,
                            o.order_number,
                            o.erp_order_code,
                            o.customer_order_number,
                            o.tracking_number,
                            o.carrier,
                            o.status,
                            o.last_tracked_at,
                            o.created_at
                        FROM orders o
                        WHERE o.status IN ('created', 'in_transit', 'out_for_delivery')
                        AND o.tracking_number IS NOT NULL
                        ORDER BY o.created_at DESC
                        LIMIT ? OFFSET ?
                    `;
                    params = [limit, offset];
                    label = 'Đang vận chuyển';
                    break;

                case 'failed':
                    // Orders có lỗi
                    query = `
                        SELECT 
                            o.id,
                            o.order_number,
                            o.erp_order_code,
                            o.customer_order_number,
                            o.tracking_number,
                            o.carrier,
                            o.status,
                            o.error_info,
                            o.created_at,
                            j.id as job_id,
                            j.job_type,
                            j.status as job_status,
                            j.attempts,
                            j.max_attempts,
                            j.error_message
                        FROM orders o
                        LEFT JOIN jobs j ON (
                            (j.job_type = 'create_order' AND JSON_EXTRACT(j.payload, '$.orderData.erpOrderCode') = o.erp_order_code)
                            OR (j.job_type IN ('tracking_number', 'update_tracking_ecount', 'update_status_ecount') 
                                AND JSON_EXTRACT(j.payload, '$.orderId') = o.id)
                        )
                        AND j.status = 'failed'
                        WHERE o.status IN ('failed', 'exception')
                        OR j.id IS NOT NULL
                        ORDER BY o.created_at DESC
                        LIMIT ? OFFSET ?
                    `;
                    params = [limit, offset];
                    label = 'Có lỗi';
                    break;

                default:
                    throw new Error('Invalid status parameter');
            }

            const db = require('../database/connection');
            const connection = await db.getConnection();

            try {
                const [orders] = await connection.query(query, params);

                // Parse JSON fields
                const parsedOrders = orders.map(order => {
                    if (order.error_info && typeof order.error_info === 'string') {
                        try {
                            order.error_info = JSON.parse(order.error_info);
                        } catch (e) {
                            // Keep as string
                        }
                    }
                    return order;
                });

                return {
                    label: label,
                    status: status,
                    total: parsedOrders.length,
                    limit: limit,
                    offset: offset,
                    orders: parsedOrders
                };

            } finally {
                connection.release();
            }

        } catch (error) {
            logger.error('Lỗi lấy pending orders:', error.message);
            throw error;
        }
    }

    /**
     * Lấy tổng quan orders đang chờ
     */
    async getPendingSummary() {
        try {
            const db = require('../database/connection');
            const connection = await db.getConnection();

            try {
                const queries = {
                    waiting_creation: `
                        SELECT COUNT(DISTINCT o.id) as count
                        FROM orders o
                        INNER JOIN jobs j ON JSON_EXTRACT(j.payload, '$.orderData.erpOrderCode') = o.erp_order_code
                        WHERE j.job_type = 'create_order'
                        AND j.status IN ('pending', 'processing')
                    `,
                    waiting_tracking_number: `
                        SELECT COUNT(*) as count
                        FROM orders o
                        WHERE (o.tracking_number IS NULL OR o.tracking_number = '')
                        AND o.status IN ('pending', 'created')
                        AND o.waybill_number IS NOT NULL
                    `,
                    waiting_tracking_update: `
                        SELECT COUNT(*) as count
                        FROM orders o
                        WHERE o.tracking_number IS NOT NULL 
                        AND o.tracking_number != ''
                        AND o.erp_tracking_number_updated = FALSE
                        AND o.erp_order_code IS NOT NULL
                        AND o.ecount_link IS NOT NULL
                    `,
                    waiting_status_update: `
                        SELECT COUNT(*) as count
                        FROM orders o
                        WHERE o.status = 'delivered'
                        AND o.erp_updated = FALSE
                        AND o.erp_order_code IS NOT NULL
                        AND o.ecount_link IS NOT NULL
                    `,
                    in_transit: `
                        SELECT COUNT(*) as count
                        FROM orders o
                        WHERE o.status IN ('created', 'in_transit', 'out_for_delivery')
                        AND o.tracking_number IS NOT NULL
                    `,
                    failed: `
                        SELECT COUNT(DISTINCT o.id) as count
                        FROM orders o
                        LEFT JOIN jobs j ON (
                            (j.job_type = 'create_order' AND JSON_EXTRACT(j.payload, '$.orderData.erpOrderCode') = o.erp_order_code)
                            OR (j.job_type IN ('tracking_number', 'update_tracking_ecount', 'update_status_ecount') 
                                AND JSON_EXTRACT(j.payload, '$.orderId') = o.id)
                        )
                        AND j.status = 'failed'
                        WHERE o.status IN ('failed', 'exception')
                        OR j.id IS NOT NULL
                    `
                };

                const summary = {};

                for (const [key, query] of Object.entries(queries)) {
                    const [rows] = await connection.query(query);
                    summary[key] = rows[0].count;
                }

                // Thêm tổng số orders
                const [totalRows] = await connection.query('SELECT COUNT(*) as count FROM orders');
                summary.total_orders = totalRows[0].count;

                // Thêm jobs stats
                const [jobStats] = await connection.query(`
                    SELECT status, COUNT(*) as count
                    FROM jobs
                    GROUP BY status
                `);

                summary.jobs = {};
                jobStats.forEach(row => {
                    summary.jobs[row.status] = row.count;
                });

                return summary;

            } finally {
                connection.release();
            }

        } catch (error) {
            logger.error('Lỗi lấy pending summary:', error.message);
            throw error;
        }
    }

    /**
     * Lấy trạng thái nhiều đơn hàng theo erp_order_code
     */
    async getStatusBatch(erpOrderCodes) {
        try {
            const db = require('../database/connection');
            const connection = await db.getConnection();

            try {
                // Query để lấy thông tin orders và jobs (chỉ lấy order mới nhất cho mỗi erp_order_code)
                const placeholders = erpOrderCodes.map(() => '?').join(',');
                
                const query = `
                    SELECT 
                        o.erp_order_code,
                        o.order_number,
                        o.tracking_number,
                        o.status as order_status,
                        o.erp_tracking_number_updated,
                        o.erp_updated,
                        o.created_at,
                        
                        -- Job tạo đơn
                        j_create.id as create_job_id,
                        j_create.status as create_job_status,
                        
                        -- Job lấy tracking
                        j_tracking.id as tracking_job_id,
                        j_tracking.status as tracking_job_status,
                        
                        -- Job update tracking lên ECount
                        j_update_tracking.id as update_tracking_job_id,
                        j_update_tracking.status as update_tracking_job_status,
                        
                        -- Job update status lên ECount
                        j_update_status.id as update_status_job_id,
                        j_update_status.status as update_status_job_status
                        
                    FROM (
                        -- Subquery để lấy order mới nhất cho mỗi erp_order_code
                        SELECT erp_order_code, MAX(id) as max_id
                        FROM orders
                        WHERE erp_order_code IN (${placeholders})
                        GROUP BY erp_order_code
                    ) latest
                    
                    INNER JOIN orders o ON o.id = latest.max_id
                    
                    LEFT JOIN jobs j_create ON j_create.job_type = 'create_order' 
                        AND JSON_EXTRACT(j_create.payload, '$.orderData.erpOrderCode') = o.erp_order_code
                        AND j_create.status IN ('pending', 'processing')
                        
                    LEFT JOIN jobs j_tracking ON j_tracking.job_type = 'tracking_number'
                        AND JSON_EXTRACT(j_tracking.payload, '$.orderId') = o.id
                        AND j_tracking.status IN ('pending', 'processing')
                        
                    LEFT JOIN jobs j_update_tracking ON j_update_tracking.job_type = 'update_tracking_ecount'
                        AND JSON_EXTRACT(j_update_tracking.payload, '$.orderId') = o.id
                        AND j_update_tracking.status IN ('pending', 'processing')
                        
                    LEFT JOIN jobs j_update_status ON j_update_status.job_type = 'update_status_ecount'
                        AND JSON_EXTRACT(j_update_status.payload, '$.orderId') = o.id
                        AND j_update_status.status IN ('pending', 'processing')
                `;

                const [orders] = await connection.query(query, erpOrderCodes);

                // Map kết quả
                const result = erpOrderCodes.map(erpCode => {
                    const order = orders.find(o => o.erp_order_code === erpCode);
                    
                    if (!order) {
                        return {
                            erp_order_code: erpCode,
                            status: 'not_found',
                            label: 'Không tìm thấy'
                        };
                    }

                    return {
                        erp_order_code: erpCode,
                        status: this.determineOrderStatus(order),
                        label: this.getStatusLabel(this.determineOrderStatus(order)),
                        tracking_number: order.tracking_number || null,
                        order_number: order.order_number || null,
                        created_at: order.created_at
                    };
                });

                return result;

            } finally {
                connection.release();
            }

        } catch (error) {
            logger.error('Lỗi getStatusBatch:', error.message);
            throw error;
        }
    }

    /**
     * Xác định trạng thái của order
     */
    determineOrderStatus(order) {
        // Đang chờ tạo đơn
        if (order.create_job_status) {
            return 'waiting_creation';
        }
        
        // Đang chờ lấy tracking number
        if (!order.tracking_number && order.order_status === 'pending') {
            if (order.tracking_job_status) {
                return 'fetching_tracking';
            }
            return 'waiting_tracking';
        }
        
        // Đang chờ update tracking lên ECount
        if (order.tracking_number && !order.erp_tracking_number_updated) {
            if (order.update_tracking_job_status) {
                return 'updating_tracking';
            }
            return 'waiting_tracking_update';
        }
        
        // Đang chờ update status lên ECount
        if (order.order_status === 'delivered' && !order.erp_updated) {
            if (order.update_status_job_status) {
                return 'updating_status';
            }
            return 'waiting_status_update';
        }
        
        // Đang vận chuyển
        if (['created', 'in_transit', 'out_for_delivery'].includes(order.order_status)) {
            return 'in_transit';
        }
        
        // Đã hoàn tất
        if (order.order_status === 'delivered' && order.erp_updated) {
            return 'completed';
        }
        
        // Có lỗi
        if (['failed', 'exception'].includes(order.order_status)) {
            return 'failed';
        }
        
        return 'unknown';
    }

    /**
     * Lấy label tiếng Việt cho status
     */
    getStatusLabel(status) {
        const labels = {
            'not_found': 'Không tìm thấy',
            'waiting_creation': 'Đang chờ tạo đơn',
            'fetching_tracking': 'Đang lấy tracking number',
            'waiting_tracking': 'Đang chờ tracking number',
            'updating_tracking': 'Đang cập nhật tracking lên ERP',
            'waiting_tracking_update': 'Đang chờ cập nhật tracking lên ERP',
            'updating_status': 'Đang cập nhật trạng thái lên ERP',
            'waiting_status_update': 'Đang chờ cập nhật trạng thái lên ERP',
            'in_transit': 'Đang vận chuyển',
            'completed': 'Đã hoàn tất',
            'failed': 'Có lỗi',
            'unknown': 'Không xác định'
        };
        
        return labels[status] || status;
    }
}

module.exports = new OrderService();