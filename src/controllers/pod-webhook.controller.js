// src/controllers/pod-webhook.controller.js
const OrderModel = require('../models/order.model');
const WebhookLogModel = require('../models/webhook-log.model');
const jobService = require('../services/queue/job.service');
const podWarehouseFactory = require('../services/pod');
const logger = require('../utils/logger');

class PodWebhookController {
    /**
     * Handle ONOS webhook — xử lý chung tất cả event
     * Kiểm tra status thay đổi → push job cập nhật status
     * Kiểm tra tracking mới → push job tracking + lưu label_url
     */
    async handleOnosWebhook(req, res) {
        const { event, order } = req.body || {};
        const warehouseOrderId = order?.order_id || order?.id || null;

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

            const result = await this.processOnosWebhook(order);

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
     * Xử lý chung webhook ONOS — không chia theo event
     * 1) Tìm đơn theo warehouse order ID
     * 2) Nếu có status thay đổi → update status + push job Ecount
     * 3) Nếu có tracking mới → update tracking + label_url + push job Ecount
     */
    async processOnosWebhook(data) {
        const warehouseOrderId = data?.id;
        if (!warehouseOrderId) {
            logger.warn('[POD Webhook] No order_id in ONOS webhook data');
            return { processingResult: 'skipped', reason: 'no_order_id' };
        }

        const order = await OrderModel.findByPodWarehouseOrderId(String(warehouseOrderId));
        if (!order) {
            logger.warn(`[POD Webhook] Order not found for ONOS order_id: ${warehouseOrderId}`);
            return { processingResult: 'not_found', reason: `order not found: ${warehouseOrderId}` };
        }

        const actions = [];

        // ── 1. Kiểm tra status thay đổi ──
        const warehouse = podWarehouseFactory.getWarehouse('ONOS');
        const newPodStatus = warehouse.mapStatus(data.status);
        const oldPodStatus = order.pod_status;
        let statusChanged = false;

        if (newPodStatus && newPodStatus !== oldPodStatus) {
            statusChanged = true;
            actions.push(`status: ${oldPodStatus} → ${newPodStatus}`);

            logger.info(`[POD Webhook] Order ${order.id} status changed`, {
                from: oldPodStatus,
                to: newPodStatus,
                onosStatus: data.status
            });
        }

        // ── 2. Kiểm tra tracking mới ──
        const trackingNumber = data?.tracking?.tracking || null;
        const labelUrl = data?.tracking?.url || null;
        const oldTrackingNumber = order.tracking_number || '';
        let trackingChanged = false;

        if (trackingNumber && trackingNumber !== oldTrackingNumber) {
            trackingChanged = true;
            actions.push(`tracking: ${oldTrackingNumber || '(none)'} → ${trackingNumber}`);
            if (labelUrl) {
                actions.push(`label_url: ${labelUrl}`);
            }

            logger.info(`[POD Webhook] Order ${order.id} tracking received`, {
                trackingNumber,
                labelUrl: labelUrl || '(none)',
                warehouse: 'ONOS'
            });
        }

        // ── Không có gì thay đổi → skip ──
        if (!statusChanged && !trackingChanged) {
            logger.info(`[POD Webhook] Order ${order.id} no changes`, {
                onosStatus: data.status,
                currentPodStatus: oldPodStatus
            });
            return { orderId: order.id, processingResult: 'skipped', reason: 'no_changes' };
        }

        // ── 3. Update DB ──
        // Nếu có tracking → status pod_fulfilled, ngược lại dùng newPodStatus
        const finalStatus = trackingChanged ? 'pod_fulfilled' : newPodStatus;
        const finalProductionStatus = data.status || null;

        await OrderModel.updatePodStatus(
            order.id,
            finalStatus,
            finalProductionStatus,
            trackingChanged ? trackingNumber : null,
            trackingChanged ? labelUrl : null
        );

        // ── 4. Push jobs Ecount ──
        if (order.erp_order_code && order.ecount_link) {
            // Push job cập nhật status
            if (statusChanged || trackingChanged) {
                const ecountStatus = this.mapPodStatusToEcountStatus(finalStatus);
                if (ecountStatus) {
                    await jobService.addPodUpdateStatusEcountJob(
                        order.id,
                        order.erp_order_code,
                        trackingChanged ? trackingNumber : (order.tracking_number || ''),
                        ecountStatus,
                        order.ecount_link,
                        5
                    );
                }
            }

            // Push job tracking riêng nếu có tracking mới
            if (trackingChanged) {
                await jobService.addPodUpdateTrackingEcountJob(
                    order.id,
                    order.erp_order_code,
                    trackingNumber,
                    order.ecount_link,
                    5
                );
            }
        }

        logger.info(`[POD Webhook] Order ${order.id} processed`, { actions });

        return { orderId: order.id, processingResult: 'success', actions };
    }

    mapPodStatusToEcountStatus(podStatus) {
        const statusMap = {
            'pod_pending': 'New',
            'pod_processing': 'New',
            'pod_in_production': 'In production',
            'pod_fulfilled': 'In transit',
            'pod_completed': 'Delivered',
            'pod_cancelled': 'Cancelled',
            'pod_refunded': 'Refund',
        };
        return statusMap[podStatus] || null;
    }
}

module.exports = new PodWebhookController();
