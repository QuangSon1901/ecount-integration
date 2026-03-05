// src/middlewares/pod-webhook-verification.middleware.js
const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Verify ONOS webhook HMAC-SHA256 signature
 * Skip verification in development nếu chưa config webhook secret
 */
function verifyOnosWebhook(req, res, next) {
    const signature = req.headers['x-onos-hmac-sha256'];
    const secret = config.onos?.webhookSecret;

    // Development: skip HMAC nếu chưa config secret
    if (!secret) {
        logger.warn('[POD Webhook] ONOS_WEBHOOK_SECRET not configured - skipping HMAC verification');
        return next();
    }

    if (!signature) {
        logger.warn('[POD Webhook] Missing X-Onos-Hmac-SHA256 header');
        return res.status(401).json({ error: 'Missing signature' });
    }

    const expectedSignature = crypto
        .createHash('sha256')
        .update(secret, 'utf8')
        .digest('hex');

    try {
        const sigBuffer = Buffer.from(signature);
        const expectedBuffer = Buffer.from(expectedSignature);

        if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
            logger.warn('[POD Webhook] Invalid ONOS webhook signature');
            return res.status(401).json({ error: 'Invalid signature' });
        }
    } catch (error) {
        logger.warn('[POD Webhook] HMAC verification error:', error.message);
        return res.status(401).json({ error: 'Signature verification failed' });
    }

    next();
}

module.exports = { verifyOnosWebhook };
