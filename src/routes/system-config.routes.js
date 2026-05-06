// src/routes/system-config.routes.js
//
// Routes cho quản lý system configs (seller profiles, ...).
// Mounted tại /api/v1/admin/system-configs

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/system-config.controller');
const { requireRole } = require('../middlewares/rbac.middleware');

// Seller profiles
router.get('/seller-profiles',                requireRole('admin'), ctrl.listSellerProfiles.bind(ctrl));
router.post('/seller-profiles',               requireRole('admin'), ctrl.createSellerProfile.bind(ctrl));
router.put('/seller-profiles/:id',            requireRole('admin'), ctrl.updateSellerProfile.bind(ctrl));
router.patch('/seller-profiles/:id/default',  requireRole('admin'), ctrl.setDefaultSellerProfile.bind(ctrl));
router.delete('/seller-profiles/:id',         requireRole('admin'), ctrl.deleteSellerProfile.bind(ctrl));

// Generic key-value (dùng để đọc/ghi config khác tuỳ ý)
router.get('/:key',  requireRole('admin'), ctrl.getConfig.bind(ctrl));
router.put('/:key',  requireRole('admin'), ctrl.setConfig.bind(ctrl));

module.exports = router;
