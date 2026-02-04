// src/routes/api-v1.routes.js
const express = require('express');
const router = express.Router();

// Middlewares
const apiAuthMiddleware = require('../middlewares/api-auth.middleware');
const apiRateLimitMiddleware = require('../middlewares/api-rate-limit.middleware');
const apiAuditMiddleware = require('../middlewares/api-audit.middleware');

// Routes
const apiAuthRoutes = require('./api-auth.routes');
const apiCustomerRoutes = require('./api-customer.routes');
const apiOrderRoutes = require('./api-order.routes');

/**
 * Apply audit middleware to all API routes
 */
router.use(apiAuditMiddleware);

/**
 * Auth routes
 */
router.use('/auth', apiAuthRoutes);

/**
 * Admin routes (customer management)
 */
router.use('/admin/customers', apiCustomerRoutes);

/**
 * Health check (no auth required)
 */
router.get('/health', (req, res) => {
    res.json({
        success: true,
        message: 'API is healthy',
        timestamp: new Date().toISOString(),
        version: 'v1'
    });
});

router.use('/orders', apiOrderRoutes);

module.exports = router;