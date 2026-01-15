const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const { errorResponse } = require('../utils/response');
const basicAuthMiddleware = require('../middlewares/basic-auth.middleware');

/**
 * @route   GET /extensions/dashboard
 * @desc    Main unified dashboard
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
 * @route   GET /extensions/bulk-update
 * @desc    Bulk update orders page
 * @access  Private (Basic Auth)
 */
router.get('/bulk-update', basicAuthMiddleware, (req, res) => {
    const viewPath = path.join(__dirname, '../../public/views/bulk-update-orders.html');
    
    if (!fs.existsSync(viewPath)) {
        logger.error('Bulk update view not found');
        return errorResponse(res, 'Page not found', 404);
    }
    
    res.sendFile(viewPath);
});

/**
 * @route   GET /extensions/tool-express
 * @desc    ECount extension guide
 * @access  Private (Basic Auth)
 */
router.get('/tool-express', basicAuthMiddleware, (req, res) => {
    const viewPath = path.join(__dirname, '../../public/views/ecount-extension.html');
    
    if (!fs.existsSync(viewPath)) {
        logger.error('ECount extension view not found');
        return errorResponse(res, 'Page not found', 404);
    }
    
    res.sendFile(viewPath);
});

/**
 * @route   GET /extensions/tool-label
 * @desc    Label extension guide (Public)
 * @access  Public
 */
router.get('/tool-label', (req, res) => {
    const viewPath = path.join(__dirname, '../../public/views/down-label-ecount-extension.html');
    
    if (!fs.existsSync(viewPath)) {
        logger.error('Label extension view not found');
        return errorResponse(res, 'Page not found', 404);
    }
    
    res.sendFile(viewPath);
});

/**
 * @route   GET /extensions/download/tool-express
 * @desc    Download ECount extension
 * @access  Private (Basic Auth)
 */
router.get('/download/tool-express', basicAuthMiddleware, (req, res) => {
    const filePath = path.join(__dirname, '../../public/extensions/ecount-extension.zip');
    
    if (!fs.existsSync(filePath)) {
        logger.error('ECount extension file not found');
        return errorResponse(res, 'File not found', 404);
    }
    
    logger.info('Downloading ECount Extension', { ip: req.ip });
    
    res.download(filePath, 'ecount-extension-tool.zip', (err) => {
        if (err) {
            logger.error('Error downloading ECount Extension:', err);
        }
    });
});

/**
 * @route   GET /extensions/download/tool-label
 * @desc    Download label extension (Public)
 * @access  Public
 */
router.get('/download/tool-label', (req, res) => {
    const filePath = path.join(__dirname, '../../public/extensions/down-label-ecount-extension.zip');
    
    if (!fs.existsSync(filePath)) {
        logger.error('Label extension file not found');
        return errorResponse(res, 'File not found', 404);
    }
    
    logger.info('Downloading Label Extension', { ip: req.ip });
    
    res.download(filePath, 'down-label-ecount-extension-tool.zip', (err) => {
        if (err) {
            logger.error('Error downloading Label Extension:', err);
        }
    });
});

module.exports = router;