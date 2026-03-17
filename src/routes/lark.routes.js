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

/**
 * POST /api/lark/test
 * Gửi test message vào Lark group để kiểm tra kết nối
 *
 * Body: { chatId: "oc_xxx" } (optional, mặc định dùng chatId trong log lỗi)
 */
router.post('/test', async (req, res) => {
    try {
        const chatId = req.body.chatId || 'oc_7a230ac2a08afd6fe5ebfc3ad7ac26f3';

        // Test 1: Text message đơn giản
        const textResult = await lark.sendTextMessage(chatId, '✅ Lark Test - Text message hoạt động!');

        // Test 2: Rich text (post) format - giống format cảnh báo thật
        const richContent = [
            [{ tag: 'text', text: '📋 Đây là tin nhắn test rich text' }],
            [{ tag: 'text', text: `Thời gian: ${new Date().toLocaleString('vi-VN')}` }],
            [{ tag: 'text', text: '\n' }],
            [{ tag: 'text', text: 'Thông tin test:' }],
            [{ tag: 'text', text: '└ ERP Code: TEST-001' }],
            [{ tag: 'text', text: '└ Tracking: TEST123456789' }],
            [{ tag: 'text', text: '└ Status: OK' }]
        ];
        const richResult = await lark.sendMessage(chatId, '🔔 Test Lark Notification', richContent);

        res.json({
            success: true,
            chatId,
            textMessage: textResult,
            richMessage: richResult
        });
    } catch (error) {
        logger.error('[Lark] Test failed:', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
