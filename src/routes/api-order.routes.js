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
 * POST /api/v1/orders
 * Create single order on ECount
 */
// router.post('/', validateApiOrder, apiOrderController.createOrder.bind(apiOrderController));

/**
 * POST /api/v1/orders/bulk
 * Create multiple orders on ECount
 */
router.post('/bulk', validateApiBulkOrders, apiOrderController.createBulkOrders.bind(apiOrderController));

/**
 * GET /api/v1/orders/:orderId
 * Get order details
 */
router.get('/:orderId', apiOrderController.getOrder.bind(apiOrderController));

/**
 * GET /api/v1/orders
 * List orders
 */
router.get('/', apiOrderController.listOrders.bind(apiOrderController));

module.exports = router;