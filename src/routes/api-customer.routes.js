/**
 * api-customer.routes.js
 *
 * Admin routes to manage API customers.
 * Uses clean RBAC middleware.
 */

const express = require('express');
const router = express.Router();
const apiCustomerController = require('../controllers/api-customer.controller');
const { requireRole, requireAdminOrOwner } = require('../middlewares/rbac.middleware');
const { validateWebhookCreate } = require('../middlewares/api-webhook-validation.middleware');

// ════════════════════════════════════════════
// ADMIN-ONLY ROUTES
// ════════════════════════════════════════════

/** POST /api/v1/admin/customers — Create new customer */
router.post('/',
    requireRole('admin'),
    apiCustomerController.createCustomer.bind(apiCustomerController)
);

/** GET /api/v1/admin/customers — List all customers */
router.get('/',
    requireRole('admin'),
    apiCustomerController.listCustomers.bind(apiCustomerController)
);

/** GET /api/v1/admin/customers/:customerId — Customer details (admin or owner) */
router.get('/:customerId',
    requireAdminOrOwner('customerId'),
    apiCustomerController.getCustomer.bind(apiCustomerController)
);

/** PATCH /api/v1/admin/customers/:customerId — Update customer */
router.patch('/:customerId',
    requireRole('admin'),
    apiCustomerController.updateCustomer.bind(apiCustomerController)
);

/** POST /api/v1/admin/customers/:customerId/credentials — Generate credentials */
router.post('/:customerId/credentials',
    requireRole('admin'),
    apiCustomerController.generateCredentials.bind(apiCustomerController)
);

/** GET /api/v1/admin/customers/:customerId/rate-limits — Rate limit stats */
router.get('/:customerId/rate-limits',
    requireRole('admin'),
    apiCustomerController.getRateLimitStats.bind(apiCustomerController)
);

/** POST /api/v1/admin/customers/:customerId/portal-password — Set portal password */
router.post('/:customerId/portal-password',
    requireRole('admin'),
    apiCustomerController.setPortalPassword.bind(apiCustomerController)
);

/** POST /api/v1/admin/customers/:customerId/change-password — Customer changes own password */
router.post('/:customerId/change-password',
    requireAdminOrOwner('customerId'),
    apiCustomerController.changePortalPassword.bind(apiCustomerController)
);

// ════════════════════════════════════════════
// ADMIN + CUSTOMER (own data only) ROUTES
// ════════════════════════════════════════════

/** GET /api/v1/admin/customers/:customerId/credentials — Get credentials (client_id only) */
router.get('/:customerId/credentials',
    requireAdminOrOwner('customerId'),
    apiCustomerController.getCredentials.bind(apiCustomerController)
);

/** POST /api/v1/admin/customers/:customerId/credentials/refresh — Refresh credentials */
router.post('/:customerId/credentials/refresh',
    requireAdminOrOwner('customerId'),
    apiCustomerController.refreshCredentials.bind(apiCustomerController)
);

/** POST /api/v1/admin/customers/:customerId/credentials/:credentialId/revoke — Revoke credential (Admin only) */
router.post('/:customerId/credentials/:credentialId/revoke',
    requireRole('admin'),
    apiCustomerController.revokeCredential.bind(apiCustomerController)
);

/** GET /api/v1/admin/customers/:customerId/webhooks — List webhooks */
router.get('/:customerId/webhooks',
    requireAdminOrOwner('customerId'),
    apiCustomerController.getWebhooks.bind(apiCustomerController)
);

/** POST /api/v1/admin/customers/:customerId/webhooks — Register webhook */
router.post('/:customerId/webhooks',
    requireAdminOrOwner('customerId'),
    validateWebhookCreate,
    apiCustomerController.createWebhook.bind(apiCustomerController)
);

/** DELETE /api/v1/admin/customers/:customerId/webhooks/:webhookId — Delete webhook */
router.delete('/:customerId/webhooks/:webhookId',
    requireAdminOrOwner('customerId'),
    apiCustomerController.deleteWebhook.bind(apiCustomerController)
);

/** POST /api/v1/admin/customers/:customerId/webhooks/:webhookId/test — Send test webhook */
router.post('/:customerId/webhooks/:webhookId/test',
    requireAdminOrOwner('customerId'),
    apiCustomerController.testWebhook.bind(apiCustomerController)
);

/** GET /api/v1/admin/customers/:customerId/webhook-logs — Webhook delivery logs */
router.get('/:customerId/webhook-logs',
    requireAdminOrOwner('customerId'),
    apiCustomerController.getWebhookLogs.bind(apiCustomerController)
);

module.exports = router;
