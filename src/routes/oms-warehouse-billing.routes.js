// src/routes/oms-warehouse-billing.routes.js

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/oms-warehouse-billing.controller');
const { requireAdmin } = require('../middlewares/session-auth.middleware');

// Summary routes must be registered BEFORE /:id to avoid route shadowing
router.get('/summary/monthly',            requireAdmin, ctrl.monthlySummary.bind(ctrl));
router.get('/summary/monthly-by-section', requireAdmin, ctrl.monthlySummaryBySection.bind(ctrl));

router.post('/',    requireAdmin, ctrl.createSlip.bind(ctrl));
router.get('/',     requireAdmin, ctrl.listSlips.bind(ctrl));
router.get('/:id',  requireAdmin, ctrl.getSlip.bind(ctrl));
router.delete('/:id', requireAdmin, ctrl.deleteSlip.bind(ctrl));

module.exports = router;
