// src/controllers/pod-webhook.controller.js
const OrderModel = require('../models/order.model');
const WebhookLogModel = require('../models/webhook-log.model');
const jobService = require('../services/queue/job.service');
const podWarehouseFactory = require('../services/pod');
const logger = require('../utils/logger');

class PodWebhookController {
    /**
     * Handle ONOS webhook events
     * Events: order.updated, shipment.events
     */
    async handleOnosWebhook(req, res) {
        const { event, data } = req.body || {};
        const warehouseOrderId = data?.order_id || data?.id || null;

        // Lưu webhook log vào DB ngay lập tức
        const logId = await WebhookLogModel.create({
            source: 'ONOS',
            event: event || 'unknown',
            method: req.method,
            url: req.originalUrl,
            headers: {
                'content-type': req.headers['content-type'],
                'x-onos-hmac-sha256': req.headers['x-onos-hmac-sha256'],
                'user-agent': req.headers['user-agent'],
                'x-forwarded-for': req.headers['x-forwarded-for']
            },
            body: req.body,
            podWarehouseOrderId: warehouseOrderId ? String(warehouseOrderId) : null,
            ipAddress: req.ip || req.headers['x-forwarded-for'] || null
        });

        try {
            logger.info('[POD Webhook] ONOS event received', { event, logId });

            let result = { action: 'none' };

            switch (event) {
                case 'order.updated':
                    result = await this.handleOnosOrderUpdated(data);
                    break;

                case 'shipment.events':
                    result = await this.handleOnosShipmentEvents(data);
                    break;

                default:
                    result = { action: 'skipped', reason: `Unhandled event: ${event}` };
                    logger.info(`[POD Webhook] Unhandled ONOS event: ${event}`);
            }

            const responseBody = { received: true, logId };
            res.status(200).json(responseBody);

            // Update log với kết quả xử lý
            if (logId) {
                await WebhookLogModel.updateResult(logId, {
                    orderId: result.orderId || null,
                    processingResult: result.processingResult || 'success',
                    response: responseBody
                });
            }

        } catch (error) {
            logger.error('[POD Webhook] Error handling ONOS webhook:', error.message);

            const responseBody = { received: true, error: error.message, logId };
            res.status(200).json(responseBody);

            // Update log với lỗi
            if (logId) {
                await WebhookLogModel.updateResult(logId, {
                    processingResult: 'error',
                    processingError: error.message,
                    response: responseBody
                });
            }
        }
    }

    /**
     * Handle order.updated - status change from ONOS
     */
    async handleOnosOrderUpdated(data) {
        const warehouseOrderId = data.order_id || data.id;
        if (!warehouseOrderId) {
            logger.warn('[POD Webhook] No order_id in order.updated event');
            return { processingResult: 'skipped', reason: 'no_order_id' };
        }

        const order = await OrderModel.findByPodWarehouseOrderId(String(warehouseOrderId));
        if (!order) {
            logger.warn(`[POD Webhook] Order not found for ONOS order_id: ${warehouseOrderId}`);
            return { processingResult: 'not_found', reason: `order not found: ${warehouseOrderId}` };
        }

        const warehouse = podWarehouseFactory.getWarehouse('ONOS');
        const newPodStatus = warehouse.mapStatus(data.status);
        const oldPodStatus = order.pod_status;

        if (newPodStatus && newPodStatus !== oldPodStatus) {
            await OrderModel.updatePodStatus(
                order.id,
                newPodStatus,
                data.status
            );

            // Queue Ecount status update
            if (order.erp_order_code && order.ecount_link) {
                const ecountStatus = this.mapPodStatusToEcountStatus(newPodStatus);
                if (ecountStatus) {
                    await jobService.addPodUpdateStatusEcountJob(
                        order.id,
                        order.erp_order_code,
                        order.tracking_number || '',
                        ecountStatus,
                        order.ecount_link,
                        5
                    );
                }
            }

            logger.info(`[POD Webhook] Order ${order.id} status updated`, {
                from: oldPodStatus,
                to: newPodStatus,
                onosStatus: data.status
            });

            return { orderId: order.id, processingResult: 'success' };
        }

        return { orderId: order.id, processingResult: 'skipped', reason: 'status_unchanged' };
    }

    /**
     * Handle shipment.events - tracking info from ONOS
     */
    async handleOnosShipmentEvents(data) {
        const warehouseOrderId = data.order_id || data.id;
        if (!warehouseOrderId) {
            logger.warn('[POD Webhook] No order_id in shipment.events');
            return { processingResult: 'skipped', reason: 'no_order_id' };
        }

        const order = await OrderModel.findByPodWarehouseOrderId(String(warehouseOrderId));
        if (!order) {
            logger.warn(`[POD Webhook] Order not found for ONOS order_id: ${warehouseOrderId}`);
            return { processingResult: 'not_found', reason: `order not found: ${warehouseOrderId}` };
        }

        const trackingNumber = data.tracking_number || data.trackingNumber;
        if (!trackingNumber) {
            logger.warn(`[POD Webhook] No tracking number in shipment.events for order ${order.id}`);
            return { orderId: order.id, processingResult: 'skipped', reason: 'no_tracking_number' };
        }

        const oldTrackingNumber = order.tracking_number || '';

        if (trackingNumber !== oldTrackingNumber) {
            await OrderModel.updatePodStatus(
                order.id,
                'pod_shipped',
                data.status || 'Fulfilled',
                trackingNumber
            );

            // Queue Ecount tracking update
            if (order.erp_order_code && order.ecount_link) {
                await jobService.addPodUpdateTrackingEcountJob(
                    order.id,
                    order.erp_order_code,
                    trackingNumber,
                    order.ecount_link,
                    5
                );
            }

            logger.info(`[POD Webhook] Tracking updated for order ${order.id}`, {
                trackingNumber,
                warehouse: 'ONOS'
            });

            return { orderId: order.id, processingResult: 'success' };
        }

        return { orderId: order.id, processingResult: 'skipped', reason: 'tracking_unchanged' };
    }

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
}

module.exports = new PodWebhookController();
