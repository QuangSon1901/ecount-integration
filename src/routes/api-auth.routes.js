// src/routes/api-auth.routes.js
const express = require('express');
const router = express.Router();
const apiAuthController = require('../controllers/api-auth.controller');
const apiAuthMiddleware = require('../middlewares/api-auth.middleware');
const apiRateLimitMiddleware = require('../middlewares/api-rate-limit.middleware');

/**
 * Public routes (no authentication required)
 */

/**
 * @route   POST /api/v1/auth/token
 * @desc    Generate access token from client credentials
 * @access  Public
 */
router.post('/token', apiAuthController.generateToken.bind(apiAuthController));

/**
 * @route   POST /api/v1/auth/refresh
 * @desc    Refresh access token using refresh token
 * @access  Public
 */
router.post('/refresh', apiAuthController.refreshToken.bind(apiAuthController));

/**
 * Protected routes (authentication required)
 */

/**
 * @route   GET /api/v1/auth/verify
 * @desc    Verify current access token
 * @access  Protected
 */
router.get('/verify', 
    apiAuthMiddleware,
    apiAuthController.verifyToken.bind(apiAuthController)
);

/**
 * @route   POST /api/v1/auth/revoke
 * @desc    Revoke current access token
 * @access  Protected
 */
router.post('/revoke',
    apiAuthMiddleware,
    apiAuthController.revokeToken.bind(apiAuthController)
);

/**
 * @route   GET /api/v1/auth/me
 * @desc    Get current authenticated customer info
 * @access  Protected
 */
router.get('/me',
    apiAuthMiddleware,
    apiRateLimitMiddleware,
    apiAuthController.getCurrentCustomer.bind(apiAuthController)
);

module.exports = router;