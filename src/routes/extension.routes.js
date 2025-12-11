const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const { errorResponse } = require('../utils/response');

const basicAuthMiddleware = require('../middlewares/basic-auth.middleware');

/**
 * @route   GET /extensions/dashboard
 * @desc    Dashboard tổng hợp các tools
 * @access  Private (Basic Auth)
 */
router.get('/dashboard', basicAuthMiddleware, (req, res) => {
    const viewPath = path.join(__dirname, '../../public/views/dashboard.html');
    
    if (!fs.existsSync(viewPath)) {
        logger.error('Dashboard view not found');
        return errorResponse(res, 'Page not found', 404);
    }
    
    res.sendFile(viewPath);
});


/**
 * @route   GET /extensions/tool1
 * @desc    Trang hướng dẫn cài đặt Extension 1
 * @access  Public
 */
router.get('/tool-express', basicAuthMiddleware, (req, res) => {
    const viewPath = path.join(__dirname, '../../public/views/ecount-extension.html');
    
    if (!fs.existsSync(viewPath)) {
        logger.error('Extension 1 view not found');
        return errorResponse(res, 'Page not found', 404);
    }
    
    res.sendFile(viewPath);
});

/**
 * @route   GET /extensions/tool2
 * @desc    Trang hướng dẫn cài đặt Extension 2
 * @access  Public
 */
router.get('/tool-label', (req, res) => {
    const viewPath = path.join(__dirname, '../../public/views/down-label-ecount-extension.html');
    
    if (!fs.existsSync(viewPath)) {
        logger.error('Extension 2 view not found');
        return errorResponse(res, 'Page not found', 404);
    }
    
    res.sendFile(viewPath);
});

router.get('/bulk-update', basicAuthMiddleware, (req, res) => {
    const viewPath = path.join(__dirname, '../../public/views/bulk-update-orders.html');
    
    if (!fs.existsSync(viewPath)) {
        logger.error('Bulk update view not found');
        return errorResponse(res, 'Page not found', 404);
    }
    
    res.sendFile(viewPath);
});

/**
 * @route   GET /extensions/download/tool1
 * @desc    Tải xuống Extension 1
 * @access  Public
 */
router.get('/download/tool-express', basicAuthMiddleware, (req, res) => {
    const filePath = path.join(__dirname, '../../public/extensions/ecount-extension.zip');
    
    if (!fs.existsSync(filePath)) {
        logger.error('Extension 1 file not found');
        return errorResponse(res, 'File not found', 404);
    }
    
    logger.info('Downloading Extension 1', { ip: req.ip });
    
    res.download(filePath, 'ecount-extension-tool.zip', (err) => {
        if (err) {
            logger.error('Error downloading Extension 1:', err);
        }
    });
});

/**
 * @route   GET /extensions/download/tool2
 * @desc    Tải xuống Extension 2
 * @access  Public
 */
router.get('/download/tool-label', (req, res) => {
    const filePath = path.join(__dirname, '../../public/extensions/down-label-ecount-extension.zip');
    
    if (!fs.existsSync(filePath)) {
        logger.error('Extension 2 file not found');
        return errorResponse(res, 'File not found', 404);
    }
    
    logger.info('Downloading Extension 2', { ip: req.ip });
    
    res.download(filePath, 'down-label-ecount-extension-tool.zip', (err) => {
        if (err) {
            logger.error('Error downloading Extension 2:', err);
        }
    });
});

module.exports = router;