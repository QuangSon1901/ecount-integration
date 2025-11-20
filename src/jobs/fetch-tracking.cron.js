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
        this.schedule = '*/5 * * * *'; // Chạy mỗi 5 phút
        this.batchSize = 50; // Xử lý 50 orders mỗi batch
        this.maxBatches = 20; // Tối đa 10 batches (500 orders) mỗi lần chạy
        this.processedOrderIds = new Set(); // Track orders đã xử lý trong lần chạy này
    }

    /**
     * Start cron job
     */
    start() {
        logger.info(`Schedule: ${this.schedule}`);

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
            this.processedOrderIds.clear(); // Reset tracking
            cronLogId = await CronLogModel.start('fetch_tracking_job');

            logger.info('Bắt đầu fetch tracking job...');

            // Xử lý multiple batches
            for (let batch = 0; batch < this.maxBatches; batch++) {
                const orders = await this.getOrdersNeedTracking(
                    this.batchSize,
                    Array.from(this.processedOrderIds) // Exclude orders đã xử lý
                );
                
                if (orders.length === 0) {
                    logger.info(`Không còn orders cần xử lý sau ${batch} batches`);
                    break;
                }

                logger.info(`Batch ${batch + 1}/${this.maxBatches}: Xử lý ${orders.length} đơn hàng`);
                stats.batches++;

                for (const order of orders) {
                    stats.processed++;
                    this.processedOrderIds.add(order.id); // Track order đã xử lý

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
                            trackingNumber = orderInfo.success && orderInfo.data.trackingNumber ? orderInfo.data.trackingNumber : trackingNumber;
                        }
                        
                        let labelUrl = oldLabelUrl;
                        if (labelUrl === '') {
                            const labelResult = await carrier.getLabel(order.waybill_number);
                            labelUrl = labelResult.success && labelResult.data.url ? labelResult.data.url : labelUrl;
                        }
                        
                        // Kiểm tra xem có thay đổi không
                        const trackingChanged = trackingNumber !== oldTrackingNumber;
                        const labelChanged = labelUrl !== oldLabelUrl;
                        const hasChanges = trackingChanged || labelChanged;

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

                        // Sleep để tránh rate limit
                        await this.sleep(1000);

                    } catch (error) {
                        stats.failed++;
                        logger.error(`Lỗi xử lý order ${order.id}: ${error.message}`);
                    }
                }

                // Nếu lấy được ít hơn batchSize, nghĩa là hết orders
                if (orders.length < this.batchSize) {
                    logger.info('Đã xử lý hết orders');
                    break;
                }

                // Sleep giữa các batches để tránh overload
                await this.sleep(2000);
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
                averageTimePerOrder: stats.processed > 0 ? `${(executionTime / stats.processed).toFixed(0)}ms` : 'N/A'
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
     * Lấy orders cần fetch tracking (với exclude)
     */
    async getOrdersNeedTracking(limit = 50, excludeIds = []) {
        const db = require('../database/connection');
        const connection = await db.getConnection();
        
        try {
            let query = `
                SELECT o.*
                FROM orders o
                INNER JOIN (
                    SELECT erp_order_code, MAX(created_at) AS latest
                    FROM orders
                    WHERE (tracking_number IS NULL OR tracking_number = '' OR erp_tracking_number_updated = FALSE OR label_url = '' OR label_url IS NULL)
                    AND status IN ('pending', 'created')
                    AND (waybill_number IS NOT NULL OR customer_order_number IS NOT NULL)
                    AND erp_order_code IS NOT NULL
                    AND ecount_link IS NOT NULL
                    GROUP BY erp_order_code
                ) latest_orders
                ON o.erp_order_code = latest_orders.erp_order_code
                AND o.created_at = latest_orders.latest
                
                -- Không có job update_tracking_ecount đang pending/processing cho order này
                LEFT JOIN jobs j_update_tracking 
                    ON j_update_tracking.job_type = 'update_tracking_ecount'
                    AND JSON_EXTRACT(j_update_tracking.payload, '$.orderId') = o.id
                    AND j_update_tracking.status IN ('pending', 'processing')
                
                WHERE j_update_tracking.id IS NULL
            `;
            
            const params = [];
            
            // Thêm điều kiện exclude orders đã xử lý trong batch này
            if (excludeIds.length > 0) {
                query += ` AND o.id NOT IN (${excludeIds.map(() => '?').join(',')})`;
                params.push(...excludeIds);
            }
            
            query += ` ORDER BY o.created_at ASC LIMIT ?`;
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