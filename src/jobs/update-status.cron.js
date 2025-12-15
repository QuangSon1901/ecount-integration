// src/jobs/update-status.cron.js
const cron = require('node-cron');
const { chromium } = require('playwright');
const OrderModel = require('../models/order.model');
const CronLogModel = require('../models/cron-log.model');

const jobService = require('../services/queue/job.service');
const trackingCheckpointService = require('../services/tracking-checkpoint.service');

const carrierFactory = require('../services/carriers');
const carriersConfig = require('../config/carriers.config'); // Thêm import này
const logger = require('../utils/logger');
const telegram = require('../utils/telegram');

class UpdateStatusCron {
    constructor() {
        this.isRunning = false;
        this.schedule = '*/5 * * * *';
        this.batchSize = 50;
        this.statusCheckInterval = 6 * 60 * 60;

        // Tạo danh sách tất cả product codes từ carriers config
        this.validProductCodes = this.getAllValidProductCodes();
    }

    /**
     * Lấy tất cả product codes từ carriers config
     */
    getAllValidProductCodes() {
        const productCodes = [];
        
        Object.values(carriersConfig).forEach(carrier => {
            if (carrier.enabled && carrier.productCodes) {
                productCodes.push(...carrier.productCodes);
            }
        });
        
        return productCodes;
    }

    /**
     * Start cron job
     */
    start() {
        logger.info(`Update status cron started - Schedule: ${this.schedule}`);

        cron.schedule(this.schedule, async () => {
            if (this.isRunning) {
                logger.warn('Update status job already running, skipping...');
                return;
            }

            await this.run();
        });

        logger.info('Update status cron job started');
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
            updated: 0,
            warned: 0,
            batches: 0,
            carrierOrders: 0, // Orders có product code trong config
            otherOrders: 0    // Orders khác
        };

        try {
            this.isRunning = true;
            cronLogId = await CronLogModel.start('update_status_job');

            logger.info('Bắt đầu update status job...');

            let hasMoreOrders = true;
            const processedOrderIds = new Set();

            while (hasMoreOrders) {
                const orders = await this.getOrdersNeedStatusUpdate(
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
                        // Kiểm tra product code có trong carriers config không
                        const isCarrierOrder = this.validProductCodes.includes(order.product_code);
                        
                        if (isCarrierOrder) {
                            // Xử lý orders có product code trong carriers config
                            stats.carrierOrders++;
                            await this.processCarrierOrder(order, stats);
                        } else {
                            // Xử lý orders khác (để trống, bạn sẽ implement sau)
                            stats.otherOrders++;
                            await this.processOtherOrder(order, stats);
                        }

                        // Sleep để tránh rate limit
                        await this.sleep(200);

                    } catch (error) {
                        stats.failed++;
                        logger.error(`Lỗi xử lý order ${order.id}: ${error.message}`);
                        
                        try {
                            await OrderModel.updateLastStatusCheck(order.id);
                        } catch (e) {
                            logger.error(`Failed to update last_status_check_at for order ${order.id}`);
                        }
                    }
                }

                if (orders.length < this.batchSize) {
                    hasMoreOrders = false;
                    logger.info('Đã xử lý hết orders');
                }

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

            logger.info('Update status job hoàn thành', {
                ...stats,
                executionTime: `${executionTime}ms`,
                averageTimePerOrder: stats.processed > 0 
                    ? `${(executionTime / stats.processed).toFixed(0)}ms` 
                    : 'N/A'
            });

        } catch (error) {
            logger.error('Update status job thất bại: ', error);

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
     * Xử lý orders có product code trong carriers config
     */
    async processCarrierOrder(order, stats) {
        const carrier = carrierFactory.getCarrier(order.carrier);
        
        logger.info(`[CARRIER] Tracking status for order ${order.id}`, {
            trackingNumber: order.waybill_number,
            productCode: order.product_code,
            currentStatus: order.status
        });

        const trackingResult = await carrier.trackOrder(order.waybill_number);
        const inquiryResult = await carrier.getOrderInfo(order.waybill_number);

        

        const hasChangeStatus = inquiryResult.data.status !== order.order_status;
        const hasChangePkgStatus = trackingResult.status !== order.status;

        await OrderModel.updateLastStatusCheck(order.id);

        const labelStatus = this.mapToLabelStatus(inquiryResult.data.status);

        if (hasChangePkgStatus || hasChangeStatus) {
            logger.info(`Status changed for order ${order.id}: ${order.status} → ${trackingResult.status} + ${order.order_status} → ${inquiryResult.data.status}`);

            const updateData = {
                status: trackingResult.status,
                orderStatus: inquiryResult.data.status,
                trackingInfo: trackingResult.trackingInfo,
                lastTrackedAt: new Date()
            };

            if (trackingResult.status === 'delivered') {
                updateData.deliveredAt = new Date();
            }

            await OrderModel.update(order.id, updateData);

            if (hasChangeStatus && order.erp_order_code && order.ecount_link && labelStatus) {
                await jobService.addUpdateStatusJob(
                    order.id,
                    order.erp_order_code,
                    order.tracking_number,
                    labelStatus,
                    order.ecount_link,
                    5
                );
                stats.updated++;

                logger.info(`Added job to update status to ECount for order ${order.id}`);
            }

            stats.success++;
        } else {
            logger.info(`Status unchanged for order ${order.id}: ${order.status}`);
            stats.success++;
        }

        if (trackingResult.trackingInfo && trackingResult.trackingInfo.track_events && labelStatus !== 'Deleted') {
            await trackingCheckpointService.updateCheckpoints(
                order.id,
                order.tracking_number || order.waybill_number,
                trackingResult.trackingInfo.track_events
            );
        }
    }

    /**
     * Xử lý orders khác (không có product code trong carriers config)
     * Check tracking qua API ordertracker.com sử dụng Playwright
     */
    async processOtherOrder(order, stats) {
        const db = require('../database/connection');
        const connection = await db.getConnection();
        
        try {
            // Check xem đã có job pending/processing cho order này chưa
            const [existingJobs] = await connection.query(
                `SELECT id, status, available_at 
                FROM jobs 
                WHERE job_type = 'track_other_order'
                AND JSON_EXTRACT(payload, '$.orderId') = ?
                AND status IN ('pending', 'processing')
                LIMIT 1`,
                [order.id]
            );

            if (existingJobs.length > 0) {
                logger.info(`[OTHER] Order ${order.id} already has pending/processing job, skip`);
                stats.otherOrders++;
                return;
            }

            // Tính delay dựa trên job track_other_order gần nhất
            const [lastJob] = await connection.query(
                `SELECT available_at 
                FROM jobs 
                WHERE job_type = 'track_other_order'
                ORDER BY available_at DESC 
                LIMIT 1`
            );

            let delaySeconds = 0;
            if (lastJob.length > 0) {
                const lastAvailableAt = new Date(lastJob[0].available_at);
                const nextAvailableAt = new Date(lastAvailableAt.getTime() + 5 * 60 * 1000); // +5 phút
                const now = new Date();
                
                if (nextAvailableAt > now) {
                    delaySeconds = Math.ceil((nextAvailableAt - now) / 1000);
                }
            }

            await OrderModel.updateLastStatusCheck(order.id);

            // Push job vào queue
            await jobService.addTrackOtherOrderJob(
                order.id,
                order.tracking_number,
                delaySeconds
            );

            logger.info(`[OTHER] Added track job for order ${order.id} with delay ${delaySeconds}s`, {
                trackingNumber: order.tracking_number,
                availableAt: new Date(Date.now() + delaySeconds * 1000).toISOString()
            });

            stats.otherOrders++;

        } finally {
            connection.release();
        }
    }

    /**
     * Map order_status sang label status cho ECount
     */
    mapToLabelStatus(orderStatus) {
        const ordStatus = orderStatus?.toUpperCase();
        
        if (!ordStatus) {
            return null;
        }
        
        if (ordStatus === 'V') {
            return 'Have been received';
        }
        
        if (ordStatus === 'F' || ordStatus === 'P') {
            return 'Returned';
        }
        
        if (ordStatus === 'C' || ordStatus === 'Q') {
            return 'Deleted';
        }
        
        if (ordStatus === 'R') {
            return 'Carrier Received';
        }
        
        if (ordStatus === 'D') {
            return 'Shipped';
        }
        
        if (ordStatus === 'S') {
            return 'Scheduled';
        }
        
        if (ordStatus === 'T' || ordStatus === 'DRAFT') {
            return 'New';
        }
        
        return null;
    }

    /**
     * Lấy orders cần check status
     */
    async getOrdersNeedStatusUpdate(limit = 50, excludeIds = []) {
        const db = require('../database/connection');
        const connection = await db.getConnection();
        
        try {
            let query = `
                SELECT o.*
                FROM orders o
                INNER JOIN (
                    SELECT erp_order_code, MAX(created_at) AS latest
                    FROM orders
                    WHERE waybill_number IS NOT NULL
                    AND waybill_number != ''
                    AND status NOT IN ('new', 'deleted', 'delivered', 'received', 'returned', 'deleted', 'cancelled', 'failed', 'pending')
                    AND order_status NOT IN ('V', 'C', 'F')
                    AND erp_order_code IS NOT NULL
                    AND ecount_link IS NOT NULL
                    
                    AND (
                        last_status_check_at IS NULL 
                        OR last_status_check_at < DATE_SUB(NOW(), INTERVAL 6 HOUR)
                    )
                    
                    GROUP BY erp_order_code
                ) latest_orders
                ON o.erp_order_code = latest_orders.erp_order_code
                AND o.created_at = latest_orders.latest
                
                LEFT JOIN jobs j_update_status 
                    ON j_update_status.job_type IN ('update_status_ecount','track_other_order')
                    AND JSON_EXTRACT(j_update_status.payload, '$.orderId') = o.id
                    AND j_update_status.status IN ('pending', 'processing')
                
                WHERE j_update_status.id IS NULL
            `;
            
            const params = [];
            
            if (excludeIds.length > 0) {
                query += ` AND o.id NOT IN (${excludeIds.map(() => '?').join(',')})`;
                params.push(...excludeIds);
            }
            
            query += ` 
                ORDER BY 
                    CASE WHEN o.last_status_check_at IS NULL THEN 0 ELSE 1 END,
                    o.last_status_check_at ASC,
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
        logger.info('Running update status job manually...');
        await this.run();
    }
}

module.exports = new UpdateStatusCron();