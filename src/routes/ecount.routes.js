// src/routes/ecount.routes.js
const express = require('express');
const router = express.Router();
const ecountService = require('../services/erp/ecount.service');
const sessionManager = require('../services/erp/ecount-session.manager');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * @route   POST /api/ecount/auth
 * @desc    Tạo session ECount mới
 * @access  Private
 */
router.post('/auth', async (req, res, next) => {
    try {
        logger.info('Nhận request tạo ECount session');
        
        const result = await ecountService.createSession();
        
        return successResponse(res, {
            ...result,
            sessionTTL: sessionManager.getSessionTTL()
        }, 'ECount session created successfully');
        
    } catch (error) {
        logger.error('Lỗi tạo session:', error.message);
        next(error);
    }
});

/**
 * @route   DELETE /api/ecount/session
 * @desc    Xóa session hiện tại
 * @access  Private
 */
router.delete('/session', async (req, res, next) => {
    try {
        await sessionManager.clearSession();
        
        return successResponse(res, null, 'Session cleared successfully');
        
    } catch (error) {
        next(error);
    }
});

module.exports = router;