const cron = require('node-cron');
const config = require('../config');
const OrderModel = require('../models/order.model');
const TrackingLogModel = require('../models/tracking-log.model');
const CronLogModel = require('../models/cron-log.model');
const carrierFactory = require('../services/carriers');
const ecountService = require('../services/erp/ecount.service');
const logger = require('../utils/logger');

class TrackingCron {
    constructor() {
        this.isRunning = false;
    }

    /**
     * Start cron jobs
     */
    start() {
        if (!config.cron.trackingEnabled) {
            logger.info('⏸️  Cron tracking disabled');
            return;
        }

        logger.info('🚀 Starting tracking cron job...');
        logger.info(`📅 Schedule: ${config.cron.trackingSchedule}`);

        // Schedule tracking job
        cron.schedule(config.cron.trackingSchedule, async () => {
            if (this.isRunning) {
                logger.warn('⚠️ Tracking job already running, skipping...');
                return;
            }

            await this.runTrackingJob();
        });

        logger.info('✅ Tracking cron job started');
    }

    /**
     * Run tracking job
     */
    async runTrackingJob() {
        const startTime = Date.now();
        let cronLogId = null;
        let stats = {
            processed: 0,
            success: 0,
            failed: 0
        };

        try {
            this.isRunning = true;
            cronLogId = await CronLogModel.start('tracking_job');

            logger.info('🔄 Bắt đầu tracking job...');

            // Lấy orders chưa hoàn tất
            const orders = await OrderModel.findPendingOrders(50);
            
            logger.info(`📦 Tìm thấy ${orders.length} đơn hàng cần tracking`);

            for (const order of orders) {
                stats.processed++;

                try {
                    await this.trackSingleOrder(order);
                    stats.success++;
                } catch (error) {
                    stats.failed++;
                    logger.error(`❌ Lỗi tracking order ${order.id}:`, error.message);
                }

                // Sleep để tránh rate limit
                await this.sleep(1000);
            }

            // Update cron log
            const executionTime = Date.now() - startTime;
            await CronLogModel.update(cronLogId, {
                status: 'completed',
                ordersProcessed: stats.processed,
                ordersSuccess: stats.success,
                ordersFailed: stats.failed,
                executionTimeMs: executionTime
            });

            logger.info('✅ Tracking job hoàn thành', {
                ...stats,
                executionTime: `${executionTime}ms`
            });

        } catch (error) {
            logger.error('❌ Tracking job thất bại:', error);

            if (cronLogId) {
                const executionTime = Date.now() - startTime;
                await CronLogModel.update(cronLogId, {
                    status: 'failed',
                    ordersProcessed: stats.processed,
                    ordersSuccess: stats.success,
                    ordersFailed: stats.failed,
                    errorMessage: error.message,
                    executionTimeMs: executionTime
                });
            }
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Track single order
     */
    async trackSingleOrder(order) {
        try {
            logger.info(`🔍 Tracking order ${order.id}:`, {
                trackingNumber: order.tracking_number,
                carrier: order.carrier
            });

            // Get carrier service
            const carrier = carrierFactory.getCarrier(order.carrier);

            // Track order
            const trackingResult = await carrier.trackOrder(order.tracking_number);

            // Save tracking log
            await TrackingLogModel.create({
                orderId: order.id,
                trackingNumber: order.tracking_number,
                carrier: order.carrier,
                status: trackingResult.status,
                trackingData: trackingResult.trackingInfo,
                eventTime: new Date()
            });

            // Update order status nếu thay đổi
            if (trackingResult.status !== order.status) {
                const updateData = {
                    status: trackingResult.status,
                    trackingInfo: trackingResult.trackingInfo
                };

                // Nếu đã delivered, cập nhật delivered_at
                if (trackingResult.status === 'delivered') {
                    updateData.deliveredAt = new Date();
                }

                await OrderModel.update(order.id, updateData);

                logger.info(`✅ Cập nhật status order ${order.id}: ${order.status} → ${trackingResult.status}`);

                // Nếu delivered và chưa update ERP, thực hiện update ERP
                if (
                    config.cron.updateErpEnabled && 
                    trackingResult.status === 'delivered' &&
                    !order.erp_updated &&
                    order.erp_order_code &&
                    order.ecount_link
                ) {
                    await this.updateErpForDeliveredOrder(order);
                }
            }

        } catch (error) {
            logger.error(`❌ Lỗi tracking order ${order.id}:`, error.message);
            throw error;
        }
    }

    /**
     * Update ERP cho order đã delivered
     */
    async updateErpForDeliveredOrder(order) {
        try {
            logger.info(`📝 Cập nhật ERP cho order delivered ${order.id}`);

            await ecountService.updateTrackingNumber(
                order.id,
                order.erp_order_code,
                order.tracking_number,
                'Đã hoàn tất',
                order.ecount_link
            );

            // Update DB
            await OrderModel.update(order.id, {
                erpUpdated: true,
                erpStatus: 'Đã hoàn tất'
            });

            logger.info(`✅ Đã cập nhật ERP cho order ${order.id}`);

        } catch (error) {
            logger.error(`⚠️ Lỗi cập nhật ERP cho order ${order.id}:`, error.message);
            // Không throw error, để tiếp tục tracking các order khác
        }
    }

    /**
     * Sleep helper
     */
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Run job manually (for testing)
     */
    async runManually() {
        logger.info('▶️ Running tracking job manually...');
        await this.runTrackingJob();
    }
}

// Export singleton instance
const trackingCron = new TrackingCron();

// Start if called directly
if (require.main === module) {
    const db = require('../database/connection');
    
    // Test connection first
    db.testConnection()
        .then(() => {
            trackingCron.start();
            logger.info('✅ Cron service started. Press Ctrl+C to stop.');
        })
        .catch(error => {
            logger.error('❌ Failed to start cron service:', error);
            process.exit(1);
        });
}

module.exports = trackingCron;