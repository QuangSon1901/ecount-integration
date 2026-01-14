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

/**
 * Protected routes placeholder
 * Will be implemented in Module 5.2
 */
router.use('/orders', 
    apiAuthMiddleware,
    apiRateLimitMiddleware,
    (req, res) => {
        res.json({
            success: false,
            message: 'Orders endpoints will be implemented in Module 5.2'
        });
    }
);

module.exports = router;