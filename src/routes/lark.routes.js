const express = require('express');
const router = express.Router();
const lark = require('../utils/lark');
const logger = require('../utils/logger');

/**
 * POST /api/lark/webhook
 * Lark Bot event callback endpoint
 *
 * Handles:
 * 1. URL Verification (Lark gửi challenge khi đăng ký event URL)
 * 2. Bot added to group event → gửi welcome message với chat_id
 */
router.post('/webhook', async (req, res) => {
    try {
        // Verify token nếu có cấu hình
        const verificationToken = process.env.LARK_VERIFICATION_TOKEN;
        if (verificationToken) {
            const headerToken = req.body?.header?.token || req.body?.token;
            if (headerToken && headerToken !== verificationToken) {
                logger.warn('[Lark] Webhook verification token mismatch');
                return res.status(401).json({ error: 'Invalid verification token' });
            }
        }

        const result = await lark.handleEventCallback(req.body);

        // URL Verification: phải trả về challenge
        if (result.challenge) {
            return res.json({ challenge: result.challenge });
        }

        res.json({ success: true });
    } catch (error) {
        logger.error('[Lark] Webhook error:', { error: error.message });
        res.json({ success: true }); // Luôn trả 200 để Lark không retry liên tục
    }
});

module.exports = router;
