// src/jobs/workers/webhook-delivery.worker.js
const BaseWorker = require('./base.worker');
const WebhookModel = require('../../models/webhook.model');
const ApiCustomerModel = require('../../models/api-customer.model');
const webhookService = require('../../services/api/webhook.service');
const logger = require('../../utils/logger');

class WebhookDeliveryWorker extends BaseWorker {
    constructor() {
        super('webhook_delivery', {
            intervalMs: 3000,     // poll mỗi 3s — latency gửi webhook thấp
            concurrency: 5        // 5 deliveries song song (HTTP-bound, không CPU-heavy)
        });
    }

    /**
     * job.payload = { webhookId, event, orderId, payload }
     */
    async processJob(job) {
        const { webhookId, event, orderId, payload } = job.payload;

        // Lấy webhook record (url + secret)
        // findById không có customerId scope ở đây → cần method riêng
        const webhook = await WebhookModel.findByIdOnly(webhookId);

        if (!webhook) {
            // Webhook đã bị xóa → không retry, mark done
            logger.warn(`WebhookDeliveryWorker: webhook ${webhookId} not found, skipping`);
            return { skipped: true, reason: 'webhook_deleted' };
        }

        if (webhook.status !== 'active') {
            logger.warn(`WebhookDeliveryWorker: webhook ${webhookId} is ${webhook.status}, skipping`);
            return { skipped: true, reason: `webhook_${webhook.status}` };
        }

        // Check customer webhook_enabled flag
        const customer = await ApiCustomerModel.findById(webhook.customer_id);
        if (!customer || !customer.webhook_enabled) {
            logger.warn(`WebhookDeliveryWorker: customer ${webhook.customer_id} webhook disabled, skipping`);
            return { skipped: true, reason: 'customer_webhook_disabled' };
        }

        // Gửi — throws on failure → base.worker retry
        const result = await webhookService.deliver(webhook, event, orderId, payload);

        logger.info(`WebhookDeliveryWorker: delivered [webhook=${webhookId}, event=${event}, order=${orderId}]`);

        return result;
    }

    /**
     * Hết số attempts → webhook fail_count đã được increment trong deliver(),
     * chỉ cần log thôi.
     */
    async onJobMaxAttemptsReached(job, error) {
        const { webhookId, event, orderId } = job.payload;
        logger.error(`WebhookDeliveryWorker: max attempts reached [webhook=${webhookId}, event=${event}, order=${orderId}]`, {
            error: error.message
        });
    }
}

module.exports = WebhookDeliveryWorker;
