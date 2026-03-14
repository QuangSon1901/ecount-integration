// src/middlewares/pod-webhook-verification.middleware.js
const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Verify ONOS webhook HMAC-SHA256 signature
 * ONOS signs: HMAC-SHA256(secret, rawBody) → base64
 * Header: X-Onos-Hmac-SHA256
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
        return res.status(200).json({ status: 401, error: 'Missing signature' });
    }

    try {
        // rawBody từ express.json({ verify }) hoặc stringify lại
        const rawBody = req.rawBody || JSON.stringify(req.body);

        const expectedSignature = crypto
            .createHmac('sha256', secret)
            .update(rawBody, 'utf8')
            .digest('base64');

        const sigBuffer = Buffer.from(signature, 'base64');
        const expectedBuffer = Buffer.from(expectedSignature, 'base64');

        if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
            logger.warn('[POD Webhook] Invalid ONOS webhook signature', {
                received: signature,
                expected: expectedSignature
            });
            return res.status(200).json({ status: 401, error: 'Invalid signature' });
        }
    } catch (error) {
        logger.warn('[POD Webhook] HMAC verification error:', error.message);
        return res.status(200).json({ status: 500, error: 'Signature verification failed' });
    }

    next();
}

/**
 * Verify PrintPoss webhook via secret key header
 * PrintPoss sends: X-PrintPoss-Hmac-SHA256 header with plain secret (not HMAC encoded)
 */
function verifyPrintpossWebhook(req, res, next) {
    const signature = req.headers['x-printposs-hmac-sha256'];
    const secret = config.printposs?.webhookSecret;

    if (!secret) {
        logger.warn('[POD Webhook] PRINTPOSS_WEBHOOK_SECRET not configured - skipping verification');
        return next();
    }

    if (!signature) {
        logger.warn('[POD Webhook] Missing X-PrintPoss-Hmac-SHA256 header');
        return res.status(200).json({ status: 401, error: 'Missing signature' });
    }

    if (signature !== secret) {
        logger.warn('[POD Webhook] Invalid PrintPoss webhook signature');
        return res.status(200).json({ status: 401, error: 'Invalid signature' });
    }

    next();
}

module.exports = { verifyOnosWebhook, verifyPrintpossWebhook };
