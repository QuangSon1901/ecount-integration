// src/routes/pod-webhook.routes.js
const express = require('express');
const router = express.Router();
const podWebhookController = require('../controllers/pod-webhook.controller');
const { verifyOnosWebhook } = require('../middlewares/pod-webhook-verification.middleware');

// ONOS webhook - verify HMAC signature then handle
router.post('/onos', verifyOnosWebhook, (req, res) => podWebhookController.handleOnosWebhook(req, res));
router.get('/onos', verifyOnosWebhook, (req, res) => podWebhookController.handleOnosWebhook(req, res));

module.exports = router;
