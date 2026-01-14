// src/routes/api-customer.routes.js
const express = require('express');
const router = express.Router();
const apiCustomerController = require('../controllers/api-customer.controller');
const basicAuthMiddleware = require('../middlewares/basic-auth.middleware');

/**
 * Admin routes (Basic Auth required)
 * These routes are for THG staff to manage API customers
 */

/**
 * @route   POST /api/v1/admin/customers
 * @desc    Create new API customer
 * @access  Admin
 */
router.post('/',
    basicAuthMiddleware,
    apiCustomerController.createCustomer.bind(apiCustomerController)
);

/**
 * @route   GET /api/v1/admin/customers
 * @desc    List all customers
 * @access  Admin
 */
router.get('/',
    basicAuthMiddleware,
    apiCustomerController.listCustomers.bind(apiCustomerController)
);

/**
 * @route   GET /api/v1/admin/customers/:customerId
 * @desc    Get customer details
 * @access  Admin
 */
router.get('/:customerId',
    basicAuthMiddleware,
    apiCustomerController.getCustomer.bind(apiCustomerController)
);

/**
 * @route   PATCH /api/v1/admin/customers/:customerId
 * @desc    Update customer
 * @access  Admin
 */
router.patch('/:customerId',
    basicAuthMiddleware,
    apiCustomerController.updateCustomer.bind(apiCustomerController)
);

/**
 * @route   POST /api/v1/admin/customers/:customerId/credentials
 * @desc    Generate new credentials for customer
 * @access  Admin
 */
router.post('/:customerId/credentials',
    basicAuthMiddleware,
    apiCustomerController.generateCredentials.bind(apiCustomerController)
);

/**
 * @route   GET /api/v1/admin/customers/:customerId/rate-limits
 * @desc    Get rate limit statistics
 * @access  Admin
 */
router.get('/:customerId/rate-limits',
    basicAuthMiddleware,
    apiCustomerController.getRateLimitStats.bind(apiCustomerController)
);

module.exports = router;