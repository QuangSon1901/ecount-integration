const express = require('express');
const router = express.Router();
const labelController = require('../controllers/label.controller');

/**
 * @route   GET /api/labels/:accessKey
 * @desc    Redirect to original label URL (permanent key)
 * @access  Public
 */
router.get('/:accessKey', labelController.getLabelByAccessKey.bind(labelController));

/**
 * @route   GET /api/labels/:accessKey/info
 * @desc    Get label information without redirect
 * @access  Public
 */
router.get('/:accessKey/info', labelController.getLabelInfo.bind(labelController));

module.exports = router;