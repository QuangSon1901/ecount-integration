const express = require('express');
const router = express.Router();
const telegram = require('../utils/telegram');
const logger = require('../utils/logger');

/**
 * POST /api/telegram/webhook
 * Telegram Bot webhook endpoint - nhận updates từ Telegram
 */
router.post('/webhook', async (req, res) => {
    try {
        await telegram.handleUpdate(req.body);
        res.sendStatus(200);
    } catch (error) {
        logger.error('Telegram webhook error:', { error: error.message });
        res.sendStatus(200); // Luôn trả 200 để Telegram không retry
    }
});

/**
 * POST /api/telegram/set-webhook
 * Đăng ký webhook URL với Telegram (gọi 1 lần khi setup)
 */
router.post('/set-webhook', async (req, res) => {
    const baseUrl = process.env.BASE_URL;
    if (!baseUrl) {
        return res.status(400).json({ success: false, message: 'BASE_URL not configured' });
    }

    const webhookUrl = `${baseUrl}/api/telegram/webhook`;
    const result = await telegram.setWebhook(webhookUrl);
    res.json(result);
});

/**
 * POST /api/telegram/delete-webhook
 * Xóa webhook (reset)
 */
router.post('/delete-webhook', async (req, res) => {
    const result = await telegram.deleteWebhook();
    res.json(result);
});

module.exports = router;
