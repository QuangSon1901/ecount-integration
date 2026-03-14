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
            statusUpdated: 0,
            sbttLabelUploaded: 0
        };

        try {
            this.isRunning = true;
            cronLogId = await CronLogModel.start('pod_fetch_tracking');

            logger.info('[POD] Bắt đầu fetch tracking S2BDIY...');

            const orders = await OrderModel.findS2bdiyOrdersNeedCheck(this.batchSize);

            if (orders.length === 0) {
                logger.info('[POD] Không có S2BDIY orders cần check');
            } else {
                logger.info(`[POD] Xử lý ${orders.length} S2BDIY orders`);

                const warehouse = podWarehouseFactory.getWarehouse('S2BDIY');

                for (const order of orders) {
                    stats.processed++;

                    try {
                        const orderDetail = await warehouse.getOrder(order.pod_warehouse_order_id);

                        if (!orderDetail.success) {
                            logger.warn(`[POD] Failed to get S2BDIY order detail for ${order.id}`, {
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

                        // === SBTT: Upload tracking label to S2BDIY if needed ===
                        if (order.pod_shipping_method === 'SBTT') {
                            // S2BDIY chưa có tracking → cần upload label
                            // Kiểm tra bằng tracking trên S2BDIY, nếu chưa có nghĩa là chưa upload
                            if (!orderDetail.data.trackingNumber) {
                                const payStatus = orderDetail.data.payStatus;

                                // pay_status: 1=Pending 2=In progress 3=Completed 4=Failed
                                // Chỉ upload khi đã thanh toán (>=2) và không failed (!=4)
                                if (payStatus && payStatus >= 2 && payStatus !== 4) {
                                    await this.uploadSbttLabel(warehouse, order, orderDetail, stats);
                                } else {
                                    logger.info(`[POD] SBTT order ${order.id} chưa sẵn sàng upload label (pay_status: ${payStatus})`, {
                                        warehouseOrderId: order.pod_warehouse_order_id,
                                        payStatusText: orderDetail.data.payStatusText
                                    });
                                }
                            }
                        }

                        // === Check tracking number change (chủ yếu cho SBSL) ===
                        if (newTrackingNumber && newTrackingNumber !== oldTrackingNumber) {
                            await OrderModel.updatePodStatus(
                                order.id,
                                newPodStatus || oldPodStatus,
                                orderDetail.data.status,
                                newTrackingNumber,
                                newLabelUrl
                            );

                            // Queue job to update tracking on Ecount
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
                                shippingMethod: order.pod_shipping_method
                            });
                        }

                        // === Check status change ===
                        if (newPodStatus && newPodStatus !== oldPodStatus) {
                            if (!hasChanges) {
                                await OrderModel.updatePodStatus(
                                    order.id,
                                    newPodStatus,
                                    orderDetail.data.status
                                );
                            }

                            // Queue job to update status on Ecount
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
                                shippingMethod: order.pod_shipping_method
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
            }

            const executionTime = Date.now() - startTime;
            await CronLogModel.update(cronLogId, {
                status: 'completed',
                ordersProcessed: stats.processed,
                ordersSuccess: stats.success,
                ordersFailed: stats.failed,
                ordersUpdated: stats.trackingUpdated + stats.statusUpdated + stats.sbttLabelUploaded,
                executionTimeMs: executionTime
            });

            logger.info('[POD] Fetch tracking S2BDIY hoàn thành', {
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
     * Upload tracking label lên S2BDIY cho SBTT order
     * Lấy tracking info từ order_data.tracking.linkPrint
     */
    async uploadSbttLabel(warehouse, order, orderDetail, stats) {
        try {
            let orderData;
            try {
                orderData = typeof order.order_data === 'string'
                    ? JSON.parse(order.order_data)
                    : order.order_data;
            } catch (e) {
                logger.error(`[POD] Failed to parse order_data for SBTT order ${order.id}`);
                return;
            }

            const tracking = orderData?.tracking;
            if (!tracking || !tracking.linkPrint) {
                logger.warn(`[POD] SBTT order ${order.id} has no tracking.linkPrint in order_data`);
                return;
            }

            logger.info(`[POD] SBTT order ${order.id} paid (pay_status: ${orderDetail.data.payStatus}) - uploading tracking label`, {
                warehouseOrderId: order.pod_warehouse_order_id,
                trackingNumber: tracking.trackingNumber,
                linkPrint: tracking.linkPrint
            });

            await warehouse.uploadTrackingLabel(
                order.pod_warehouse_order_id,
                tracking.trackingNumber || '',
                tracking.linkPrint
            );

            stats.sbttLabelUploaded++;
            logger.info(`[POD] SBTT tracking label uploaded for order ${order.id}`, {
                warehouseOrderId: order.pod_warehouse_order_id,
                trackingNumber: tracking.trackingNumber
            });

        } catch (error) {
            logger.error(`[POD] SBTT label upload error for order ${order.id}: ${error.message}`);
        }
    }

    /**
     * Map POD status to Ecount display status
     */
    mapPodStatusToEcountStatus(podStatus) {
        const statusMap = {
            'pod_pending': 'New',
            'pod_processing': 'Processing',
            'pod_in_production': 'In production',
            'pod_fulfilled': 'In transit',
            'pod_shipped': 'Delivered',
            'pod_cancelled': 'Cancelled',
            'pod_refunded': 'Refund',
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
