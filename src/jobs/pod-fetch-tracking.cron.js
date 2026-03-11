// src/jobs/pod-fetch-tracking.cron.js
const cron = require('node-cron');
const OrderModel = require('../models/order.model');
const CronLogModel = require('../models/cron-log.model');
const jobService = require('../services/queue/job.service');
const podWarehouseFactory = require('../services/pod');
const logger = require('../utils/logger');

class PodFetchTrackingCron {
    constructor() {
        this.isRunning = false;
        this.schedule = '*/5 * * * *'; // Mỗi 5 phút
        this.batchSize = 20;
    }

    start() {
        logger.info(`[POD] Fetch tracking cron started - Schedule: ${this.schedule}`);

        cron.schedule(this.schedule, async () => {
            if (this.isRunning) {
                logger.warn('[POD] Fetch tracking job already running, skipping...');
                return;
            }

            await this.run();
        });
    }

    async run() {
        const startTime = Date.now();
        let cronLogId = null;
        let stats = {
            processed: 0,
            success: 0,
            failed: 0,
            trackingUpdated: 0,
            statusUpdated: 0
        };

        try {
            this.isRunning = true;
            cronLogId = await CronLogModel.start('pod_fetch_tracking');

            logger.info('[POD] Bắt đầu fetch tracking...');

            const orders = await OrderModel.findPodOrdersNeedTracking(this.batchSize);

            if (orders.length === 0) {
                logger.info('[POD] Không có orders cần fetch tracking');
                await CronLogModel.update(cronLogId, {
                    status: 'completed',
                    ordersProcessed: 0,
                    executionTimeMs: Date.now() - startTime
                });
                return;
            }

            logger.info(`[POD] Xử lý ${orders.length} orders`);

            for (const order of orders) {
                stats.processed++;

                try {
                    const warehouse = podWarehouseFactory.getWarehouse(order.pod_warehouse);
                    const orderDetail = await warehouse.getOrder(order.pod_warehouse_order_id);

                    if (!orderDetail.success) {
                        logger.warn(`[POD] Failed to get order detail for ${order.id}`, {
                            warehouseOrderId: order.pod_warehouse_order_id
                        });
                        await OrderModel.updateLastTrackingCheck(order.id);
                        stats.failed++;
                        continue;
                    }

                    const newPodStatus = warehouse.mapStatus(orderDetail.data.status);
                    const oldPodStatus = order.pod_status;
                    const newTrackingNumber = orderDetail.data.trackingNumber || null;
                    const newLabelUrl = orderDetail.data.labelUrl || null;
                    const oldTrackingNumber = order.tracking_number || '';

                    // Update last check time
                    await OrderModel.updateLastTrackingCheck(order.id);

                    let hasChanges = false;

                    // Check tracking number change
                    if (newTrackingNumber && newTrackingNumber !== oldTrackingNumber) {
                        await OrderModel.updatePodStatus(
                            order.id,
                            newPodStatus || oldPodStatus,
                            orderDetail.data.status,
                            newTrackingNumber,
                            newLabelUrl
                        );

                        // Queue job to update tracking on Ecount POD
                        if (order.erp_order_code && order.ecount_link) {
                            await jobService.addPodUpdateTrackingEcountJob(
                                order.id,
                                order.erp_order_code,
                                newTrackingNumber,
                                order.ecount_link,
                                5
                            );
                            stats.trackingUpdated++;
                        }

                        hasChanges = true;
                        logger.info(`[POD] Tracking updated for order ${order.id}`, {
                            trackingNumber: newTrackingNumber,
                            warehouse: order.pod_warehouse
                        });
                    }

                    // Check status change
                    if (newPodStatus && newPodStatus !== oldPodStatus) {
                        if (!hasChanges) {
                            // Only update status if tracking wasn't already updated above
                            await OrderModel.updatePodStatus(
                                order.id,
                                newPodStatus,
                                orderDetail.data.status
                            );
                        }

                        // Queue job to update status on Ecount POD
                        if (order.erp_order_code && order.ecount_link) {
                            const ecountStatus = this.mapPodStatusToEcountStatus(newPodStatus);
                            if (ecountStatus) {
                                await jobService.addPodUpdateStatusEcountJob(
                                    order.id,
                                    order.erp_order_code,
                                    newTrackingNumber || oldTrackingNumber,
                                    ecountStatus,
                                    order.ecount_link,
                                    5
                                );
                                stats.statusUpdated++;
                            }
                        }

                        hasChanges = true;
                        logger.info(`[POD] Status changed for order ${order.id}`, {
                            from: oldPodStatus,
                            to: newPodStatus,
                            warehouse: order.pod_warehouse
                        });
                    }

                    if (!hasChanges) {
                        logger.debug(`[POD] No changes for order ${order.id}`);
                    }

                    stats.success++;

                } catch (error) {
                    stats.failed++;
                    logger.error(`[POD] Error processing order ${order.id}: ${error.message}`);

                    try {
                        await OrderModel.updateLastTrackingCheck(order.id);
                    } catch (e) {
                        logger.error(`[POD] Failed to update last_tracking_check_at for order ${order.id}`);
                    }
                }

                // Small delay between requests
                await this.sleep(200);
            }

            const executionTime = Date.now() - startTime;
            await CronLogModel.update(cronLogId, {
                status: 'completed',
                ordersProcessed: stats.processed,
                ordersSuccess: stats.success,
                ordersFailed: stats.failed,
                ordersUpdated: stats.trackingUpdated + stats.statusUpdated,
                executionTimeMs: executionTime
            });

            logger.info('[POD] Fetch tracking hoàn thành', {
                ...stats,
                executionTime: `${executionTime}ms`
            });

        } catch (error) {
            logger.error('[POD] Fetch tracking thất bại: ' + error.message);

            if (cronLogId) {
                await CronLogModel.update(cronLogId, {
                    status: 'failed',
                    ordersProcessed: stats.processed,
                    ordersSuccess: stats.success,
                    ordersFailed: stats.failed,
                    errorMessage: error.message,
                    executionTimeMs: Date.now() - startTime
                });
            }
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Map POD status to Ecount display status
     */
    mapPodStatusToEcountStatus(podStatus) {
        const statusMap = {
            'pod_pending': 'Đang xử lý',
            'pod_in_production': 'Đang sản xuất',
            'pod_tracking_received': 'Đã có tracking',
            'pod_shipped': 'Đã giao hàng',
            'pod_delivered': 'Đã hoàn tất',
            'pod_cancelled': 'Đã hủy',
            'pod_on_hold': 'Tạm giữ',
            'pod_error': 'Lỗi'
        };
        return statusMap[podStatus] || null;
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async runManually() {
        logger.info('[POD] Running fetch tracking job manually...');
        await this.run();
    }
}

module.exports = new PodFetchTrackingCron();
