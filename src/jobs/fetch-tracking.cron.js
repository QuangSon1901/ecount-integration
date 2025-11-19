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
            updated: 0 // Số order đã tìm thấy tracking và push job
        };

        try {
            this.isRunning = true;
            cronLogId = await CronLogModel.start('fetch_tracking_job');

            logger.info('Bắt đầu fetch tracking job...');

            // Lấy orders chưa có tracking number
            const orders = await this.getOrdersNeedTracking(50);
            
            logger.info(`Tìm thấy ${orders.length} đơn hàng cần lấy tracking`);

            for (const order of orders) {
                stats.processed++;

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
                executionTime: `${executionTime}ms`
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
     */
    async getOrdersNeedTracking(limit = 50) {
        const db = require('../database/connection');
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query(
                `SELECT o.*
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
            
            ORDER BY o.created_at ASC
            LIMIT ?`,
                [limit]
            );
            
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