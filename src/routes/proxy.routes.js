const express = require('express');
const router = express.Router();
const proxyController = require('../controllers/proxy.controller');

/**
 * @route   GET /api/proxy/:accessKey
 * @desc    Proxy stream file từ URL gốc (mockup/design/label)
 * @access  Public
 */
router.get('/:accessKey', proxyController.getByAccessKey.bind(proxyController));

module.exports = router;
