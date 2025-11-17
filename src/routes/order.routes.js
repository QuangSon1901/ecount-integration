const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');
const { validateOrder, validateErpUpdate, validateOrderMulti } = require('../middlewares/validation.middleware');
const jobService = require('../services/queue/job.service');

/**
 * @route   GET /api/orders/health
 * @desc    Health check
 * @access  Public
 */
// router.get('/health', orderController.healthCheck.bind(orderController));

/**
 * @route   GET /api/orders/carriers
 * @desc    Get available carriers
 * @access  Public
 */
// router.get('/carriers', orderController.getCarriers.bind(orderController));

/**
 * @route   GET /api/orders/tracking/:trackingNumber
 * @desc    Track order by tracking number
 * @access  Public
 * @query   carrier - Optional carrier code (YUNEXPRESS, DHL, etc.)
 */
router.get('/tracking/:trackingNumber', orderController.trackByTrackingNumber.bind(orderController));
router.get('/inquiry/:orderNumber', orderController.inquiryByOrderNumber.bind(orderController));

/**
 * @route   GET /api/orders/products
 * @desc    Get list of available shipping products
 * @access  Public
 * @query   country_code - Optional 2-letter country code (US, GB, etc.)
 */
// router.get('/products', orderController.getProducts.bind(orderController));

/**
 * @route   GET /api/orders/info/:orderCode
 * @desc    Get order details by order code (waybill number, customer order number, or tracking number)
 * @access  Public
 * @query   carrier - Optional carrier code (default: YUNEXPRESS)
 */
// router.get('/info/:orderCode', orderController.getOrderInfo.bind(orderController));

/**
 * @route   POST /api/orders/status/batch
 * @desc    Get status of multiple orders by ERP order codes
 * @access  Public
 */
router.post('/status/batch', orderController.getStatusBatch.bind(orderController));

/**
 * @route   GET /api/orders/pending/summary
 * @desc    Get summary of pending orders
 * @access  Public
 */
router.get('/pending/summary', orderController.getPendingSummary.bind(orderController));

/**
 * @route   GET /api/orders/pending
 * @desc    Get pending orders by status
 * @access  Public
 * @query   status - waiting_creation | waiting_tracking_number | waiting_tracking_update | waiting_status_update | in_transit | failed
 * @query   limit - Number of records (default: 50)
 * @query   offset - Offset for pagination (default: 0)
 */
router.get('/pending', orderController.getPendingOrders.bind(orderController));

/**
 * @route   POST /api/orders
 * @desc    Create order and update ERP (main flow)
 * @access  Private
 */
router.post('/labels/purchase', validateOrderMulti, orderController.createOrderMulti.bind(orderController));
router.post('/', validateOrder, orderController.createOrder.bind(orderController));

/**
 * @route   POST /api/orders/create-only
 * @desc    Create order only, skip ERP update
 * @access  Private
 */
// router.post('/create-only', validateOrder, orderController.createOrderOnly.bind(orderController));

/**
 * @route   POST /api/orders/update-erp
 * @desc    Update ERP with existing tracking number
 * @access  Private
 */
// router.post('/update-erp', validateErpUpdate, orderController.updateErpOnly.bind(orderController));

module.exports = router;