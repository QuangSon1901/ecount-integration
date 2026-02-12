const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const { errorResponse } = require('../utils/response');
const { requireAuth, requireAdmin } = require('../middlewares/session-auth.middleware');

// ─── Helper: serve an HTML view ──────────────────────────────────
function serveView(viewFile) {
    return (req, res) => {
        const viewPath = path.join(__dirname, '../../public/views', viewFile);
        if (!fs.existsSync(viewPath)) {
            logger.error('View not found: ' + viewFile);
            return errorResponse(res, 'Page not found', 404);
        }
        res.sendFile(viewPath);
    };
}

// ─── Dashboard ───────────────────────────────────────────────────

/**
 * @route   GET /extensions/dashboard
 * @desc    Main dashboard (admin + customer)
 * @access  Private (requireAuth)
 */
router.get('/dashboard', requireAuth, serveView('dashboard.html'));

/**
 * @route   GET /extensions/api-docs
 * @desc    API documentation page (embedded in dashboard iframe or standalone)
 * @access  Private (requireAuth)
 */
router.get('/api-docs', requireAuth, serveView('api-docs.html'));

/**
 * @route   GET /extensions/customer/:customerId
 * @desc    Customer detail page (admin only)
 * @access  Private (Admin only)
 */
router.get('/customer/:customerId', requireAdmin, serveView('customer-detail.html'));

// ─── Admin Tools ─────────────────────────────────────────────────

/**
 * @route   GET /extensions/bulk-update
 * @desc    Bulk update orders page
 * @access  Private (Admin only)
 */
router.get('/bulk-update', requireAdmin, serveView('bulk-update-orders.html'));

/**
 * @route   GET /extensions/admin-docs
 * @desc    Admin documentation — system overview, roadmap, extensions, services, API
 * @access  Private (Admin only)
 */
router.get('/admin-docs', requireAdmin, serveView('admin-docs.html'));

/**
 * @route   GET /extensions/tool-express
 * @desc    ECount extension guide
 * @access  Private (Admin only)
 */
router.get('/tool-express', requireAdmin, serveView('ecount-extension.html'));

// ─── Public Pages ────────────────────────────────────────────────

/**
 * @route   GET /extensions/tool-label
 * @desc    Label extension guide
 * @access  Public
 */
router.get('/tool-label', serveView('down-label-ecount-extension.html'));

// ─── Downloads ───────────────────────────────────────────────────

/**
 * @route   GET /extensions/download/tool-express
 * @desc    Download ECount extension
 * @access  Private (Admin only)
 */
router.get('/download/tool-express', requireAdmin, (req, res) => {
    const filePath = path.join(__dirname, '../../public/extensions/ecount-extension.zip');
    if (!fs.existsSync(filePath)) {
        logger.error('ECount extension file not found');
        return errorResponse(res, 'File not found', 404);
    }
    logger.info('Downloading ECount Extension', { ip: req.ip });
    res.download(filePath, 'ecount-extension-tool.zip', (err) => {
        if (err) logger.error('Error downloading ECount Extension:', err);
    });
});

/**
 * @route   GET /extensions/download/tool-label
 * @desc    Download label extension
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
        if (err) logger.error('Error downloading Label Extension:', err);
    });
});

module.exports = router;
