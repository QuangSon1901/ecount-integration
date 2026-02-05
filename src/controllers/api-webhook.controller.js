const webhookService = require('../services/api/webhook.service');
const { successResponse, errorResponse } = require('../utils/response');

class ApiWebhookController {
    /**
     * POST /api/v1/webhooks
     * Đăng ký webhook mới
     */
    async create(req, res, next) {
        try {
            const { url, secret, events } = req.body;
            const customerId = req.auth.customer_code;

            const webhook = await webhookService.register({
                customerId,
                url,
                secret,
                events
            });

            return successResponse(res, webhookService.formatWebhook(webhook), 'Webhook registered successfully', 201);

        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/v1/webhooks
     * Liệt kê webhooks của customer đang đăng nhập
     */
    async list(req, res, next) {
        try {
            const webhooks = await webhookService.listByCustomer(req.auth.customer_code);
            return successResponse(res, webhooks);

        } catch (error) {
            next(error);
        }
    }

    /**
     * DELETE /api/v1/webhooks/:webhook_id
     * Xóa webhook
     */
    async remove(req, res, next) {
        try {
            const webhookId = parseInt(req.params.webhook_id, 10);

            if (isNaN(webhookId)) {
                return errorResponse(res, 'Invalid webhook_id', 400);
            }

            const deleted = await webhookService.deleteById(webhookId, req.auth.customer_code);

            if (deleted === null) {
                return errorResponse(res, 'Webhook not found', 404);
            }

            return successResponse(res, null, 'Webhook deleted successfully');

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new ApiWebhookController();
