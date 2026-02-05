const express = require('express');
const router = express.Router();
const apiWebhookController = require('../controllers/api-webhook.controller');
const apiAuthMiddleware = require('../middlewares/api-auth.middleware');
const apiRateLimitMiddleware = require('../middlewares/api-rate-limit.middleware');
const { validateWebhookCreate } = require('../middlewares/api-webhook-validation.middleware');

// All routes require auth + rate limit
router.use(apiAuthMiddleware);
router.use(apiRateLimitMiddleware);

/**
 * POST /api/v1/webhooks
 * Đăng ký webhook mới
 */
router.post('/', validateWebhookCreate, apiWebhookController.create.bind(apiWebhookController));

/**
 * GET /api/v1/webhooks
 * Liệt kê webhooks của customer
 */
router.get('/', apiWebhookController.list.bind(apiWebhookController));

/**
 * DELETE /api/v1/webhooks/:webhook_id
 * Xóa webhook
 */
router.delete('/:webhook_id', apiWebhookController.remove.bind(apiWebhookController));

module.exports = router;
