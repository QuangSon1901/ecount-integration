const express = require('express');
const router = express.Router();
const labelController = require('../controllers/label.controller');

/**
 * @route   GET /api/labels/:accessKey
 * @desc    Redirect to original label URL (permanent key)
 * @access  Public
 */
router.get('/:accessKey', labelController.getLabelByAccessKey.bind(labelController));
router.post('/test', (req, res) => {
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

/**
 * @route   GET /api/labels/:accessKey/info
 * @desc    Get label information without redirect
 * @access  Public
 */
// router.get('/:accessKey/info', labelController.getLabelInfo.bind(labelController));

module.exports = router;