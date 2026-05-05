// src/routes/oms-order.routes.js
//
// Admin-only routes mounted at /api/v1/admin/oms-orders.
// Phase 5: list / detail / buy-label (single + bulk).
// Phase 8 may add admin edit endpoints; OmsOrderModel.applyAdminEdits is ready.

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/oms-order.controller');
const { requireRole } = require('../middlewares/rbac.middleware');

router.get('/',
    requireRole('admin'),
    ctrl.listOrders.bind(ctrl)
);

// Bulk buy must be declared BEFORE /:id/buy-label so :id doesn't match the literal segment
router.post('/buy-labels-bulk',
    requireRole('admin'),
    ctrl.bulkBuyLabels.bind(ctrl)
);

router.get('/:id',
    requireRole('admin'),
    ctrl.getOrder.bind(ctrl)
);

router.post('/:id/buy-label',
    requireRole('admin'),
    ctrl.buyLabel.bind(ctrl)
);

router.post('/:id/retry-oms-update',
    requireRole('admin'),
    ctrl.retryOmsUpdate.bind(ctrl)
);

router.patch('/:id/pricing',
    requireRole('admin'),
    ctrl.updatePricing.bind(ctrl)
);

router.post('/:id/recompute-pricing',
    requireRole('admin'),
    ctrl.recomputePricing.bind(ctrl)
);

router.patch('/:id/internal-status',
    requireRole('admin'),
    ctrl.setInternalStatus.bind(ctrl)
);

// General edit (receiver / package / items / refs)
router.patch('/:id',
    requireRole('admin'),
    ctrl.editOrder.bind(ctrl)
);

module.exports = router;
