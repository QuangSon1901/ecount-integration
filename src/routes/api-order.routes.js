const express = require('express');
const router = express.Router();
const apiOrderController = require('../controllers/api-order.controller');
const apiAuthMiddleware = require('../middlewares/api-auth.middleware');
const apiRateLimitMiddleware = require('../middlewares/api-rate-limit.middleware');
const { validateApiOrder, validateApiBulkOrders } = require('../middlewares/api-order-validation.middleware');

// All routes require authentication
router.use(apiAuthMiddleware);
router.use(apiRateLimitMiddleware);

/**
 * POST /api/v1/orders/bulk
 * Create multiple orders on ECount
 */
router.post('/bulk', validateApiBulkOrders, apiOrderController.createBulkOrders.bind(apiOrderController));

/**
 * GET /api/v1/orders/:referenceCode
 * Get order details
 */
router.get('/:referenceCode', apiOrderController.getOrder.bind(apiOrderController));

module.exports = router;