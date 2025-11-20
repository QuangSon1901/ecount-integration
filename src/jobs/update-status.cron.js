// src/jobs/update-status.cron.js
const cron = require('node-cron');
const OrderModel = require('../models/order.model');
const CronLogModel = require('../models/cron-log.model');
const jobService = require('../services/queue/job.service');
const carrierFactory = require('../services/carriers');
const logger = require('../utils/logger');
const telegram = require('../utils/telegram');

class UpdateStatusCron {
    constructor() {
        this.isRunning = false;
        this.schedule = '*/5 * * * *'; // Chạy mỗi 5 phút
        this.batchSize = 50; // Xử lý 50 orders mỗi batch
        this.maxBatches = 20; // Tối đa 10 batches (500 orders) mỗi lần chạy
        this.processedOrderIds = new Set(); // Track orders đã xử lý trong lần chạy này

        this.warningThresholds = {
            'VN-YTYCPREC': 10, // 5 + 5 ngày
            'YTYCPREC': 10,
            'VN-THZXR': 10,    // 5 + 5 ngày
            'VNTHZXR': 10,
            'THZXR': 10,
            'VNBKZXR': 10,     // 5 + 5 ngày
            'BKZXR': 10,
            'VNMUZXR': 11,     // 5 + 6 ngày
            'MUZXR': 11,
            'default': 10      // Mặc định 10 ngày
        };
    }

    /**
     * Start cron job
     */
    start() {
        logger.info(`Schedule: ${this.schedule}`);

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
            updated: 0, // Số order có status thay đổi và push job
            warned: 0, // Số đơn warning
            batches: 0 // Số batches đã xử lý
        };

        try {
            this.isRunning = true;
            this.processedOrderIds.clear(); // Reset tracking
            cronLogId = await CronLogModel.start('update_status_job');

            logger.info('Bắt đầu update status job...');

            // Xử lý multiple batches
            for (let batch = 0; batch < this.maxBatches; batch++) {
                const orders = await this.getOrdersNeedStatusUpdate(
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
                        // Track order để lấy status mới nhất
                        const carrier = carrierFactory.getCarrier(order.carrier);
                        
                        logger.info(`Tracking status for order ${order.id}`, {
                            trackingNumber: order.waybill_number,
                            currentStatus: order.status
                        });

                        const trackingResult = await carrier.trackOrder(order.waybill_number);
                        const inquiryResult = await carrier.getOrderInfo(order.waybill_number);

                        // So sánh status mới với status hiện tại
                        if (trackingResult.status !== order.status || inquiryResult.data.status !== order.order_status) {
                            logger.info(`Status changed for order ${order.id}: ${order.status} → ${trackingResult.status} + ${order.order_status} → ${inquiryResult.data.status}`);

                            // Cập nhật status trong DB
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

                            const labelStatus = this.mapToLabelStatus(trackingResult.packageStatus, inquiryResult.data.status);

                            if (order.erp_order_code && order.ecount_link && labelStatus) {
                                await jobService.addUpdateStatusJob(
                                    order.id,
                                    order.erp_order_code,
                                    order.tracking_number,
                                    labelStatus,
                                    order.ecount_link,
                                    5 // Delay 5 giây
                                );
                                stats.updated++;

                                logger.info(`Added job to update status to ECount for order ${order.id}`);
                            } 
                                
                            if (labelStatus === 'Returned' || labelStatus === 'Deleted' || labelStatus === 'Abnormal') {
                                await telegram.notifyError(
                                    new Error(`Order status changed to ${labelStatus}`), 
                                    {
                                        action: 'Track Express Status',
                                        jobName: 'Track Express Status',
                                        orderId: order.customer_order_number,
                                        waybillNumber: order.waybill_number || null,
                                        trackingNumber: order.tracking_number || null,
                                        erpOrderCode: order.erp_order_code,
                                        packageStatus: trackingResult.packageStatus,
                                        orderStatus: inquiryResult.data.status,
                                        trackingStatus: trackingResult.status,
                                        labelStatus: labelStatus
                                    }, 
                                    {type: 'error'}
                                );
                            }

                            stats.success++;
                        } else {
                            logger.info(`Status unchanged for order ${order.id}: ${order.status}`);

                            if (this.shouldWarnOverdue(order)) {
                                const daysOverdue = this.calculateDaysOverdue(order);
                                const threshold = this.getWarningThreshold(order.product_code);
                                
                                logger.warn(`Order ${order.id} overdue: ${daysOverdue} days (threshold: ${threshold})`);

                                // Push job update status "Warning" lên ERP
                                await jobService.addUpdateStatusJob(
                                    order.id,
                                    order.erp_order_code,
                                    order.tracking_number,
                                    'Warning',
                                    order.ecount_link,
                                    5
                                );

                                // Gửi telegram warning
                                await telegram.notifyError(
                                    new Error(`Order overdue: ${daysOverdue} days without update`),
                                    {
                                        action: 'Overdue Order Warning',
                                        jobName: 'Update Status Job',
                                        orderId: order.customer_order_number,
                                        erpOrderCode: order.erp_order_code,
                                        waybillNumber: order.waybill_number,
                                        trackingNumber: order.tracking_number,
                                        productCode: order.product_code,
                                        status: order.status,
                                        daysOverdue: daysOverdue,
                                        warningThreshold: threshold,
                                        lastTrackedAt: order.last_tracked_at || order.created_at,
                                        message: `⚠️ Đơn hàng ${daysOverdue} ngày không cập nhật (ngưỡng: ${threshold} ngày)`
                                    },
                                    { type: 'error' }
                                );

                                stats.warned++;
                            }

                            stats.success++; // Vẫn tính là success
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

            logger.info('Update status job hoàn thành', {
                ...stats,
                executionTime: `${executionTime}ms`,
                averageTimePerOrder: stats.processed > 0 ? `${(executionTime / stats.processed).toFixed(0)}ms` : 'N/A'
            });

        } catch (error) {
            logger.error('Update status job thất bại: ', + error);

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
     * Check xem có nên warning không
     */
    shouldWarnOverdue(order) {
        // Không warning nếu chưa có last_tracked_at
        const lastUpdate = order.last_tracked_at || order.created_at;
        if (!lastUpdate) return false;

        // Tính số ngày từ lần update cuối
        const daysOverdue = this.calculateDaysOverdue(order);
        const threshold = this.getWarningThreshold(order.product_code);

        // Chỉ warning nếu >= threshold VÀ chưa warning hôm nay
        if (daysOverdue >= threshold) {
            // Check xem đã warning chưa
            if (order.updated_at) {
                if (order.erp_status == 'Warning') {
                    return false;
                }
            }
            return true;
        }

        return false;
    }

    /**
     * Tính số ngày kể từ lần update cuối
     */
    calculateDaysOverdue(order) {
        const lastUpdate = order.last_tracked_at ? new Date(order.last_tracked_at) : new Date(order.created_at);
        const now = new Date();
        const diffTime = Math.abs(now - lastUpdate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
    }

    /**
     * Lấy ngưỡng warning theo product code
     */
    getWarningThreshold(productCode) {
        const normalized = productCode?.toUpperCase().trim();
        return this.warningThresholds[normalized] || this.warningThresholds['default'];
    }

    /**
     * Map package_status và order_status sang label status cho ECount
     * 
     * Package Status:
     * - N: Order not found
     * - F: Electronic forecast information reception
     * - T: In transit
     * - D: Successful delivery
     * - E: May be abnormal
     * - R: Package returned
     * - C: Order Cancellation
     * 
     * Order Status:
     * - Draft: Nháp
     * - T: Đã xử lý
     * - C: Đã xóa
     * - S: Đã lên lịch
     * - R: Đã nhận
     * - D: Hết hàng
     * - F: Đã trả lại
     * - Q: Đã hủy bỏ
     * - P: Đã nhận bồi thường
     * - V: Đã ký nhận
     */
    mapToLabelStatus(packageStatus, orderStatus) {
        // Normalize to uppercase
        const pkgStatus = packageStatus?.toUpperCase();
        const ordStatus = orderStatus?.toUpperCase();
        
        // Priority 1: Package delivered
        if (pkgStatus === 'D') {
            return 'Have been received';
        }
        
        // Priority 2: Package returned
        if (pkgStatus === 'R') {
            return 'Returned';
        }
        
        // Priority 3: Order cancelled/deleted
        if (pkgStatus === 'C' || ordStatus === 'C' || ordStatus === 'Q') {
            return 'Deleted';
        }
        
        // Priority 4: Abnormal cases
        if (pkgStatus === 'E') {
            return 'Warning';
        }
        
        // Priority 5: Order returned/claimed
        if (ordStatus === 'F' || ordStatus === 'P') {
            return 'Returned';
        }
        
        // Priority 6: Order signed (delivered by order status)
        if (ordStatus === 'V') {
            return 'Have been received';
        }
        
        // Priority 7: In transit combinations
        if (pkgStatus === 'T') {
            if (ordStatus === 'R') {
                return 'Received';
            } else if (ordStatus === 'D') {
                return 'Shipped';
            }
            return 'Received'; // Default for T package status
        }
        
        // Priority 8: Forecasted/Scheduled
        if (pkgStatus === 'F') {
            if (ordStatus === 'S') {
                return 'Scheduled';
            } else if (ordStatus === 'T') {
                return 'New';
            }
            return 'New'; // Default for F package status
        }
        
        // Priority 9: Order not found
        if (pkgStatus === 'N') {
            return 'Not Found';
        }
        
        // Priority 10: Draft/New orders
        if (ordStatus === 'DRAFT') {
            return 'New';
        }
        
        return 'New'; // Hoặc null nếu không muốn push job cho case này
    }

    /**
     * Lấy orders cần check status (với exclude)
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
                    AND status NOT IN ('received', 'returned', 'deleted', 'cancelled', 'failed', 'pending')
                    AND erp_order_code IS NOT NULL
                    AND ecount_link IS NOT NULL
                    GROUP BY erp_order_code
                ) latest_orders
                ON o.erp_order_code = latest_orders.erp_order_code
                AND o.created_at = latest_orders.latest
                
                -- Không có job update_status_ecount đang pending/processing cho order này
                LEFT JOIN jobs j_update_status 
                    ON j_update_status.job_type = 'update_status_ecount'
                    AND JSON_EXTRACT(j_update_status.payload, '$.orderId') = o.id
                    AND j_update_status.status IN ('pending', 'processing')
                
                WHERE j_update_status.id IS NULL
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
        logger.info('Running update status job manually...');
        await this.run();
    }
}

module.exports = new UpdateStatusCron();