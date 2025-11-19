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
        this.schedule = '*/30 * * * *'; // Chạy mỗi 30 phút
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
            updated: 0 // Số order có status thay đổi và push job
        };

        try {
            this.isRunning = true;
            cronLogId = await CronLogModel.start('update_status_job');

            logger.info('Bắt đầu update status job...');

            // Lấy orders có tracking nhưng chưa update status lên ECount
            const orders = await this.getOrdersNeedStatusUpdate(50);
            
            logger.info(`Tìm thấy ${orders.length} đơn hàng cần check status`);

            for (const order of orders) {
                stats.processed++;

                try {
                    // Track order để lấy status mới nhất
                    const carrier = carrierFactory.getCarrier(order.carrier);
                    
                    logger.info(`Tracking status for order ${order.id}`, {
                        trackingNumber: order.tracking_number,
                        currentStatus: order.status
                    });

                    const trackingResult = await carrier.trackOrder(order.tracking_number);
                    const inquiryResult = await carrier.getOrderInfo(order.waybill_number);

                    // So sánh status mới với status hiện tại
                    if (trackingResult.status !== order.status || inquiryResult.data.status !== order.orderStatus) {
                        logger.info(`Status changed for order ${order.id}: ${order.status} → ${trackingResult.status}`);

                        // Cập nhật status trong DB
                        const updateData = {
                            status: trackingResult.status,
                            orderStatus: inquiryResult.data.status,
                            trackingInfo: trackingResult.trackingInfo
                        };

                        if (trackingResult.status === 'delivered') {
                            updateData.deliveredAt = new Date();
                        }

                        await OrderModel.update(order.id, updateData);

                        const labelStatus = this.mapToLabelStatus(newPackageStatus, newOrderStatus);

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
                                    packageStatus: newPackageStatus,
                                    orderStatus: newOrderStatus,
                                    trackingStatus: trackingResult.status,
                                    labelStatus: labelStatus
                                }, 
                                {type: 'warning'}
                            );
                        }

                        stats.success++;
                    } else {
                        logger.info(`Status unchanged for order ${order.id}: ${order.status}`);
                        stats.success++; // Vẫn tính là success
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

            logger.info('Update status job hoàn thành', {
                ...stats,
                executionTime: `${executionTime}ms`
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
            return 'Abnormal';
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
            return 'In Transit'; // Default for T package status
        }
        
        // Priority 8: Forecasted/Scheduled
        if (pkgStatus === 'F') {
            if (ordStatus === 'S') {
                return 'Scheduled';
            } else if (ordStatus === 'T') {
                return 'Processed';
            }
            return 'Forecasted'; // Default for F package status
        }
        
        // Priority 9: Order not found
        if (pkgStatus === 'N') {
            return 'Not Found';
        }
        
        // Priority 10: Draft/New orders
        if (ordStatus === 'DRAFT') {
            return 'New';
        }
        
        return 'Unknown'; // Hoặc null nếu không muốn push job cho case này
    }

    /**
     * Lấy orders cần check status
     */
    async getOrdersNeedStatusUpdate(limit = 50) {
        const db = require('../database/connection');
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query(
                `SELECT o.*
                FROM orders o
                INNER JOIN (
                    SELECT erp_order_code, MAX(created_at) AS latest
                    FROM orders
                    WHERE tracking_number IS NOT NULL
                    AND tracking_number != ''
                    AND status NOT IN ('received', 'returned', 'deleted', 'cancelled', 'failed')
                    AND erp_order_code IS NOT NULL
                    AND ecount_link IS NOT NULL
                    GROUP BY erp_order_code
                ) latest_orders
                ON o.erp_order_code = latest_orders.erp_order_code
                AND o.created_at = latest_orders.latest
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
        logger.info('Running update status job manually...');
        await this.run();
    }
}

module.exports = new UpdateStatusCron();