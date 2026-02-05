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
const apiWebhookRoutes = require('./api-webhook.routes');

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
            { code: 'VN-YTYCPREC', name: 'E-VN YunChoice Premium' },
            { code: 'VNTHZXR', name: 'E-VN Yunexpress Registered Standard' },
            { code: 'VNBKZXR', name: 'E-VN Yunexpress Priority' },
            { code: 'VNMUZXR', name: 'E-VN Yun Cosmetics Economy-Restricted' },
            { code: 'YTYCPREG', name: 'E-CN Yun Pre-Choice Priority-Unrestricted' },
            { code: 'YTYCPREC', name: 'E-CN Yun Pre-Choice Priority-with Battery' },
            { code: 'FZZXR', name: 'E-CN Yun Clothing Economy' },
            { code: 'BKPHR', name: 'E-CN Yun Standard-Unrestricted' },
            { code: 'THPHR', name: 'E-CN Yun Economy-Unrestricted' },
            { code: 'THZXR', name: 'E-CN Yun Economy-with Battery' },
            { code: 'BKZXR', name: 'E-CN Yun Standard-with Battery' },
            { code: 'MUZXR', name: 'E-CN Yun Cosmetics Economy-Restricted' },
            { code: 'ZBZXRPH', name: 'E-CN Yun Medium Economy-Unrestricted' },
        ],
        timestamp: new Date().toISOString(),
    });
});

router.get('/add-services', apiAuthMiddleware, (req, res) => {
    res.json({
        success: true,
        data: [
            { code: 'G0', name: 'G0', desc: 'Với các đơn hàng không đi EU, không yêu cầu IOSS/EORI' },
            { code: 'G1', name: 'G1' },
            { code: 'V0', name: 'V0', desc: 'Đối với các đơn hàng không đi EU' },
            { code: 'V1', name: 'V1', desc: 'Đối với các đơn hàng đi EU' },
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

router.use('/webhooks', apiWebhookRoutes);

router.use('/orders', apiOrderRoutes);

module.exports = router;