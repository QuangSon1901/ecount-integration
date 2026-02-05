const crypto = require('crypto');
const axios = require('axios');
const WebhookModel = require('../../models/webhook.model');
const logger = require('../../utils/logger');

const VALID_EVENTS = ['tracking.updated', 'order.status', 'order.exception'];
const REQUEST_TIMEOUT_MS = 5000;

class WebhookService {

    // ─── Registration ──────────────────────────────────────────────

    /**
     * Đăng ký webhook mới cho customer
     */
    async register({ customerId, url, secret, events }) {
        // Validate events
        const invalidEvents = events.filter(e => !VALID_EVENTS.includes(e));
        if (invalidEvents.length > 0) {
            throw new Error(`Invalid events: ${invalidEvents.join(', ')}. Allowed: ${VALID_EVENTS.join(', ')}`);
        }

        // Hash secret bằng SHA-256 (customer giữ plaintext secret để sign verify)
        const secretHash = crypto.createHash('sha256').update(secret).digest('hex');

        const webhookId = await WebhookModel.create({
            customerId,
            url,
            secretHash,
            events: [...new Set(events)] // dedupe
        });

        return await WebhookModel.findById(webhookId, customerId);
    }

    /**
     * List webhooks của customer
     */
    async listByCustomer(customerId) {
        const webhooks = await WebhookModel.listByCustomer(customerId);
        return webhooks.map(this.formatWebhook);
    }

    /**
     * Xóa webhook
     */
    async deleteById(webhookId, customerId) {
        const webhook = await WebhookModel.findById(webhookId, customerId);
        if (!webhook) {
            return null; // not found / not owner
        }
        return await WebhookModel.deleteById(webhookId, customerId);
    }

    // ─── Dispatch ──────────────────────────────────────────────────

    /**
     * Push webhook delivery jobs vào queue cho tất cả webhooks active
     * của customer đang subscribe event đó.
     * Được gọi từ workers/crons khi có status/tracking change.
     * NON-BLOCKING: chỉ insert jobs, không gửi HTTP ở đây.
     *
     * @param {string} event        - 'tracking.updated' | 'order.status' | 'order.exception'
     * @param {number} customerId   - api_customers.id
     * @param {number} orderId      - orders.id
     * @param {object} payload      - Nội dung event (order data)
     */
    async dispatch(event, customerId, orderId, payload) {
        const webhooks = await WebhookModel.findActiveByCustomerAndEvent(customerId, event);
        
        if (webhooks.length === 0) return;

        const jobService = require('../queue/job.service');

        for (const webhook of webhooks) {
            try {
                await jobService.addWebhookDeliveryJob(webhook.id, event, orderId, payload);
            } catch (err) {
                logger.error(`webhook.dispatch: failed to enqueue job for webhook ${webhook.id}:`, err);
            }
        }
    }

    /**
     * Gửi HTTP POST thực tế + ghi delivery log.
     * Được gọi BỐI WebhookDeliveryWorker, không gọi trực tiếp.
     * Throws on failure → base.worker tự retry theo backoff.
     *
     * @param {object} webhook  - row từ webhook_registrations
     * @param {string} event
     * @param {number} orderId
     * @param {object} payload
     */
    async deliver(webhook, event, orderId, payload) {
        const body = {
            event,
            data: payload,
            timestamp: new Date().toISOString()
        };

        const signature = this.sign(webhook.secret, JSON.stringify(body));

        let response;
        try {
            response = await axios.post(webhook.url, body, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Webhook-Event': event,
                    'X-Webhook-Signature': signature
                },
                timeout: REQUEST_TIMEOUT_MS
            });
            
        } catch (err) {
            const httpStatus = err.response?.status || null;

            // Ghi delivery log (failed)
            await WebhookModel.createDeliveryLog({
                webhookId: webhook.id,
                customerId: webhook.customer_id,
                event,
                orderId,
                payload,
                status: 'failed',
                httpStatus,
                errorMessage: err.message
            });

            await WebhookModel.incrementFailCount(webhook.id);

            // Throw → base.worker catch → retry nếu còn attempts
            throw err;
        }

        // Ghi delivery log (success)
        await WebhookModel.createDeliveryLog({
            webhookId: webhook.id,
            customerId: webhook.customer_id,
            event,
            orderId,
            payload,
            status: 'success',
            httpStatus: response.status,
            responseBody: JSON.stringify(response.data) || ''
        });

        await WebhookModel.resetFailCount(webhook.id);

        return { httpStatus: response.status };
    }

    // ─── Helpers ───────────────────────────────────────────────────

    /**
     * HMAC-SHA256 signature
     */
    sign(secret, body) {
        return crypto.createHmac('sha256', secret).update(body).digest('hex');
    }

    /**
     * Format webhook record cho API response (không expose secret)
     */
    formatWebhook(webhook) {
        return {
            id: webhook.id,
            url: webhook.url,
            events: typeof webhook.events === 'string' ? JSON.parse(webhook.events) : webhook.events,
            status: webhook.status,
            fail_count: webhook.fail_count,
            created_at: webhook.created_at,
            updated_at: webhook.updated_at
        };
    }
}

module.exports = new WebhookService();
