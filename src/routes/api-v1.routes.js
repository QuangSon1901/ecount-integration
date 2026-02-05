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

router.get('/services', apiAuthMiddleware, (req, res) => {
    res.json({
        success: true,
        data: [
            { code: 'VN-YTYCPREC', name: 'VN-YTYCPREC' },
            { code: 'VNTHZXR', name: 'VNTHZXR' },
            { code: 'VNBKZXR', name: 'VNBKZXR' },
            { code: 'VNMUZXR', name: 'VNMUZXR' },
            { code: 'YTYCPREG', name: 'YTYCPREG' },
            { code: 'YTYCPREC', name: 'YTYCPREC' },
            { code: 'FZZXR', name: 'FZZXR' },
            { code: 'BKPHR', name: 'BKPHR' },
            { code: 'THPHR', name: 'THPHR' },
            { code: 'THZXR', name: 'THZXR' },
            { code: 'BKZXR', name: 'BKZXR' },
            { code: 'MUZXR', name: 'MUZXR' },
            { code: 'ZBZXRPH', name: 'ZBZXRPH' },
        ],
        timestamp: new Date().toISOString(),
    });
});

router.get('/add-services', apiAuthMiddleware, (req, res) => {
    res.json({
        success: true,
        data: [
            { code: 'G0', name: 'G0' },
            { code: 'G1', name: 'G1' },
            { code: 'V0', name: 'V0' },
            { code: 'V1', name: 'V1' },
        ],
        timestamp: new Date().toISOString(),
    });
});


router.get('/warehouses', apiAuthMiddleware, (req, res) => {
    res.json({
        success: true,
        data: [
            {
                'code': 'CNEXP',
                'name': 'CN-THG-EXP',
            },
            {
                'code': 'CNFFM',
                'name': 'CN-THG-FFM',
            },
            {
                'code': 'USDRO',
                'name': 'US-THG-DROP',
            },
            {
                'code': 'VNHCM',
                'name': 'VN-HCM-THG',
            },
            {
                'code': 'VNHN',
                'name': 'VN-HN-THG',
            }
        ],
        timestamp: new Date().toISOString(),
    });
});

router.use('/orders', apiOrderRoutes);

module.exports = router;