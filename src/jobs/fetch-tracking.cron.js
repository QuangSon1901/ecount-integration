// src/jobs/fetch-tracking.cron.js
const cron = require('node-cron');
const OrderModel = require('../models/order.model');
const CronLogModel = require('../models/cron-log.model');
const jobService = require('../services/queue/job.service');
const carrierFactory = require('../services/carriers');
const logger = require('../utils/logger');

class FetchTrackingCron {
    constructor() {
        this.isRunning = false;
        this.schedule = '*/1 * * * *'; // Chạy mỗi 1 phút
        this.batchSize = 10; // Xử lý 10 orders mỗi batch
        this.trackingInterval = 6 * 60 * 60; // 6 giờ (tính bằng giây)
    }

    /**
     * Start cron job
     */
    start() {
        logger.info(`Fetch tracking cron started - Schedule: ${this.schedule}`);

        cron.schedule(this.schedule, async () => {
            if (this.isRunning) {
                logger.warn('Fetch tracking job already running, skipping...');
                return;
            }

            await this.run();
        });

        logger.info('Fetch tracking cron job started');
    }

    /**
     * Run job
     */
    async run() {
        const startTime = Date.now();
        let cronLogId = null;
        let stats = {
            processed: 0,
            success: 0,
            failed: 0,
            updated: 0, // Số order đã tìm thấy tracking và push job
            batches: 0 // Số batches đã xử lý
        };

        try {
            this.isRunning = true;
            cronLogId = await CronLogModel.start('fetch_tracking_job');

            logger.info('Bắt đầu fetch tracking job...');

            // Dùng while loop thay vì for với maxBatches
            let hasMoreOrders = true;
            const processedOrderIds = new Set(); // Track orders đã xử lý

            while (hasMoreOrders) {
                const orders = await this.getOrdersNeedTracking(
                    this.batchSize,
                    Array.from(processedOrderIds)
                );
                
                if (orders.length === 0) {
                    hasMoreOrders = false;
                    logger.info(`Không còn orders cần xử lý sau ${stats.batches} batches`);
                    break;
                }

                stats.batches++;
                logger.info(`Batch ${stats.batches}: Xử lý ${orders.length} đơn hàng`);

                for (const order of orders) {
                    stats.processed++;
                    processedOrderIds.add(order.id);

                    try {
                        // Gọi API để lấy thông tin đơn hàng
                        const carrier = carrierFactory.getCarrier(order.carrier);
                        const orderCode = order.waybill_number || order.customer_order_number;
                        
                        logger.info(`Checking tracking for order ${order.id}`, {
                            orderCode,
                            carrier: order.carrier
                        });

                        // Lưu giá trị cũ để so sánh
                        const oldTrackingNumber = order.tracking_number || '';
                        const oldLabelUrl = order.label_url || '';

                        let trackingNumber = oldTrackingNumber;
                        if (trackingNumber === '') {
                            const orderInfo = await carrier.getOrderInfo(orderCode);
                            trackingNumber = orderInfo.success && orderInfo.data.trackingNumber 
                                ? orderInfo.data.trackingNumber 
                                : trackingNumber;
                        }
                        
                        let labelUrl = oldLabelUrl;
                        if (labelUrl === '') {
                            const labelResult = await carrier.getLabel(order.waybill_number);
                            labelUrl = labelResult.success && labelResult.data.url 
                                ? labelResult.data.url 
                                : labelUrl;
                        }
                        
                        // Kiểm tra xem có thay đổi không
                        const trackingChanged = trackingNumber !== oldTrackingNumber;
                        const labelChanged = labelUrl !== oldLabelUrl;
                        const hasChanges = trackingChanged || labelChanged;

                        // Update last_tracking_check_at dù có thay đổi hay không
                        await OrderModel.updateLastTrackingCheck(order.id);

                        // Chỉ update khi có thay đổi
                        if (hasChanges) {
                            // Kiểm tra phải có ít nhất 1 trong 2 giá trị
                            if (trackingNumber === '' && labelUrl === '') {
                                throw new Error(`No tracking number or label URL available for order ${order.id}`);
                            }

                            await OrderModel.update(order.id, {
                                trackingNumber: trackingNumber,
                                status: 'created',
                                labelUrl: labelUrl
                            });

                            logger.info(`Updated order ${order.id}`, {
                                trackingChanged,
                                labelChanged,
                                trackingNumber,
                                labelUrl
                            });

                            // Generate access key nếu có label URL mới
                            if (labelUrl !== '' && labelChanged) {
                                try {
                                    await OrderModel.generateLabelAccessKey(order.id);
                                } catch (error) {
                                    logger.error(`Failed to generate access key for order ${order.id}: ${error.message}`);
                                }
                            }

                            // Push job update lên ECount nếu có thay đổi tracking number
                            if (order.erp_order_code && order.ecount_link) {
                                await jobService.addUpdateTrackingNumberJob(
                                    order.id,
                                    order.erp_order_code,
                                    trackingNumber,
                                    order.ecount_link,
                                    5 // Delay 5 giây
                                );
                                stats.updated++;

                                logger.info(`Added job to update tracking to ECount for order ${order.id}`);
                            }

                            stats.success++;
                        } else {
                            logger.info(`No changes for order ${order.id}, skipping update`);
                        }
                    } catch (error) {
                        stats.failed++;
                        logger.error(`Lỗi xử lý order ${order.id}: ${error.message}`);
                        
                        // Vẫn update last_tracking_check_at để không bị stuck
                        try {
                            await OrderModel.updateLastTrackingCheck(order.id);
                        } catch (e) {
                            logger.error(`Failed to update last_tracking_check_at for order ${order.id}`);
                        }
                    }
                }

                // Nếu lấy được ít hơn batchSize, nghĩa là hết orders
                if (orders.length < this.batchSize) {
                    hasMoreOrders = false;
                    logger.info('Đã xử lý hết orders');
                }

                // Sleep ngắn giữa các batch để tránh quá tải
                await this.sleep(100);
            }

            // Update cron log thành công
            const executionTime = Date.now() - startTime;
            await CronLogModel.update(cronLogId, {
                status: 'completed',
                ordersProcessed: stats.processed,
                ordersSuccess: stats.success,
                ordersFailed: stats.failed,
                ordersUpdated: stats.updated,
                executionTimeMs: executionTime
            });

            logger.info('Fetch tracking job hoàn thành', {
                ...stats,
                executionTime: `${executionTime}ms`,
                averageTimePerOrder: stats.processed > 0 
                    ? `${(executionTime / stats.processed).toFixed(0)}ms` 
                    : 'N/A'
            });

        } catch (error) {
            logger.error('Fetch tracking job thất bại: ' + error);

            // Update cron log thất bại
            if (cronLogId) {
                const executionTime = Date.now() - startTime;
                await CronLogModel.update(cronLogId, {
                    status: 'failed',
                    ordersProcessed: stats.processed,
                    ordersSuccess: stats.success,
                    ordersFailed: stats.failed,
                    ordersUpdated: stats.updated,
                    errorMessage: error.message,
                    executionTimeMs: executionTime
                });
            }
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Lấy orders cần fetch tracking
     * Điều kiện:
     * - last_tracking_check_at IS NULL (chưa check lần nào)
     * - HOẶC last_tracking_check_at < NOW() - INTERVAL 6 HOUR (đã qua 6 giờ)
     */
    async getOrdersNeedTracking(limit = 50, excludeIds = []) {
        const db = require('../database/connection');
        const connection = await db.getConnection();
        
        try {
            let query = `
                SELECT o.*
                FROM orders o
                INNER JOIN (
                    SELECT t.erp_order_code, t.created_at AS latest
                    FROM orders t
                    JOIN (
                        SELECT erp_order_code, MAX(created_at) AS max_created
                        FROM orders
                        WHERE erp_order_code IS NOT NULL
                        GROUP BY erp_order_code
                    ) latest
                    ON t.erp_order_code = latest.erp_order_code
                    AND t.created_at = latest.max_created
                    WHERE
                        -- Chỉ check tracking nếu:
                        -- 1. Chưa có tracking number HOẶC chưa update lên ERP
                        -- 2. Chưa có label URL
                        (t.tracking_number IS NULL OR t.tracking_number = '' 
                        OR t.erp_tracking_number_updated = FALSE 
                        OR t.label_url IS NULL OR t.label_url = '')
                        
                        -- 3. Chưa check lần nào HOẶC đã qua 6 giờ kể từ lần check cuối
                        AND (
                            t.last_tracking_check_at IS NULL 
                            OR t.last_tracking_check_at < DATE_SUB(NOW(), INTERVAL 6 HOUR)
                        )

                        AND t.status IN ('pending', 'created')
                        AND t.order_status NOT IN ('V', 'C', 'F')
                        AND (t.waybill_number IS NOT NULL OR t.customer_order_number IS NOT NULL)
                        AND t.ecount_link IS NOT NULL
                ) latest_orders
                ON o.erp_order_code = latest_orders.erp_order_code
                AND o.created_at = latest_orders.latest
                
                -- Không có job update_tracking_ecount đang pending/processing
                LEFT JOIN jobs j_update_tracking 
                    ON j_update_tracking.job_type = 'update_tracking_ecount'
                    AND JSON_EXTRACT(j_update_tracking.payload, '$.orderId') = o.id
                    AND j_update_tracking.status IN ('pending', 'processing')
                
                WHERE j_update_tracking.id IS NULL
            `;
            
            const params = [];
            
            // Thêm điều kiện exclude orders đã xử lý trong lần chạy này
            if (excludeIds.length > 0) {
                query += ` AND o.id NOT IN (${excludeIds.map(() => '?').join(',')})`;
                params.push(...excludeIds);
            }
            
            // Ưu tiên orders chưa check lần nào, sau đó đến orders cũ nhất
            query += ` 
                ORDER BY 
                    CASE WHEN o.last_tracking_check_at IS NULL THEN 0 ELSE 1 END,
                    o.last_tracking_check_at ASC,
                    o.created_at ASC
                LIMIT ?
            `;
            params.push(limit);
            
            const [rows] = await connection.query(query, params);
            return rows;
            
        } finally {
            connection.release();
        }
    }

    /**
     * Sleep helper
     */
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Run manually (for testing)
     */
    async runManually() {
        logger.info('Running fetch tracking job manually...');
        await this.run();
    }
}

module.exports = new FetchTrackingCron();