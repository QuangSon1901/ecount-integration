// src/controllers/oms-order.controller.js
//
// Admin-facing endpoints for OMS orders (the "Outbound Request" view).
// Phase 5 surface:
//   GET  /api/v1/admin/oms-orders                — list with basic filters
//   GET  /api/v1/admin/oms-orders/:id            — single order detail
//   POST /api/v1/admin/oms-orders/:id/buy-label  — buy single
//   POST /api/v1/admin/oms-orders/buy-labels-bulk — buy many

const OmsOrderModel = require('../models/oms-order.model');
const labelPurchase = require('../services/itc/label-purchase.service');
const jobService = require('../services/queue/job.service');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

const STATUS_TO_HTTP = {
    NOT_FOUND: 404,
    INVALID_STATE: 409,
    INCOMPLETE_DATA: 422,
    NOT_CONFIGURED: 503,
    ITC_REJECTED: 502,
    NETWORK_ERROR: 502,
    PERSIST_FAILED: 500,
    NO_PURCHASE_COST: 422,
    INVALID_VALUE: 400,
};

class OmsOrderController {
    async listOrders(req, res, next) {
        try {
            const {
                customer_id, internal_status, oms_status,
                limit = 50, offset = 0,
            } = req.query;

            const rows = await OmsOrderModel.list({
                customerId: customer_id,
                internalStatus: internal_status,
                omsStatus: oms_status,
                limit: parseInt(limit),
                offset: parseInt(offset),
            });

            return successResponse(res, {
                orders: rows.map(r => this._formatOrder(r)),
                total: rows.length,
                limit: parseInt(limit),
                offset: parseInt(offset),
            }, 'OMS orders retrieved');
        } catch (err) {
            next(err);
        }
    }

    async getOrder(req, res, next) {
        try {
            const id = parseInt(req.params.id);
            if (!Number.isFinite(id)) return errorResponse(res, 'Invalid id', 400);

            const row = await OmsOrderModel.findById(id);
            if (!row) return errorResponse(res, 'OMS order not found', 404);

            return successResponse(res, this._formatOrder(row), 'OMS order retrieved');
        } catch (err) {
            next(err);
        }
    }

    async buyLabel(req, res, next) {
        try {
            const id = parseInt(req.params.id);
            if (!Number.isFinite(id)) return errorResponse(res, 'Invalid id', 400);
            const { productCode } = req.body || {};

            const updated = await labelPurchase.purchaseFor(id, { productCode });
            return successResponse(res, this._formatOrder(updated), 'Label purchased successfully');
        } catch (err) {
            return this._handleError(res, err, next);
        }
    }

    /**
     * POST /api/v1/admin/oms-orders/:id/retry-oms-update
     * Re-queue the logistic-info push to OMS. Allowed only when the order has
     * a label (label_purchased) or previously failed (error). Already-pushed
     * orders return 409.
     */
    async retryOmsUpdate(req, res, next) {
        try {
            const id = parseInt(req.params.id);
            if (!Number.isFinite(id)) return errorResponse(res, 'Invalid id', 400);

            const row = await OmsOrderModel.findById(id);
            if (!row) return errorResponse(res, 'OMS order not found', 404);

            if (!['label_purchased', 'error'].includes(row.internal_status)) {
                return errorResponse(
                    res,
                    `Cannot retry OMS update from state '${row.internal_status}' (need label_purchased or error)`,
                    409,
                    { error_code: 'INVALID_STATE' }
                );
            }

            const { tplCode } = req.body || {};
            const jobId = await jobService.addOmsUpdateLogisticJob(id, { tplCode });

            return successResponse(res, {
                jobId,
                omsOrderId: id,
                internalStatus: row.internal_status,
            }, 'OMS update job queued', 202);
        } catch (err) {
            next(err);
        }
    }

    /**
     * PATCH /api/v1/admin/oms-orders/:id
     * Admin edit of receiver / package / items / customer-ref fields.
     * Stamps admin_edited_at so future syncs preserve these columns.
     */
    async editOrder(req, res, next) {
        try {
            const id = parseInt(req.params.id);
            if (!Number.isFinite(id)) return errorResponse(res, 'Invalid id', 400);

            const FIELD_MAP = {
                receiverName: 'receiver_name',
                receiverPhone: 'receiver_phone',
                receiverEmail: 'receiver_email',
                receiverCountry: 'receiver_country',
                receiverState: 'receiver_state',
                receiverCity: 'receiver_city',
                receiverPostalCode: 'receiver_postal_code',
                receiverAddressLine1: 'receiver_address_line1',
                receiverAddressLine2: 'receiver_address_line2',
                packageWeight: 'package_weight',
                packageLength: 'package_length',
                packageWidth: 'package_width',
                packageHeight: 'package_height',
                weightUnit: 'weight_unit',
                sizeUnit: 'size_unit',
                declaredValue: 'declared_value',
                declaredCurrency: 'declared_currency',
                items: 'items',
                customerOrderNumber: 'customer_order_number',
                platformOrderNumber: 'platform_order_number',
            };

            const edits = {};
            for (const [apiKey, col] of Object.entries(FIELD_MAP)) {
                if (req.body && req.body[apiKey] !== undefined) {
                    edits[col] = req.body[apiKey];
                }
            }

            if (Object.keys(edits).length === 0) {
                return errorResponse(res, 'No editable fields supplied', 400);
            }

            const order = await OmsOrderModel.findById(id);
            if (!order) return errorResponse(res, 'OMS order not found', 404);

            const editor = req.session?.username || null;
            await OmsOrderModel.applyAdminEdits(id, edits, editor);
            const updated = await OmsOrderModel.findById(id);

            logger.info('[OMS-ORDER] admin edit applied', {
                omsOrderId: id,
                editor,
                fields: Object.keys(edits),
            });

            return successResponse(res, this._formatOrder(updated), 'OMS order updated');
        } catch (err) {
            return this._handleError(res, err, next);
        }
    }

    /**
     * PATCH /api/v1/admin/oms-orders/:id/internal-status
     * Body: { status, note? }
     * Disallows the system-only intermediate state 'label_purchasing'.
     */
    async setInternalStatus(req, res, next) {
        try {
            const id = parseInt(req.params.id);
            if (!Number.isFinite(id)) return errorResponse(res, 'Invalid id', 400);

            const { status, note } = req.body || {};
            const ALLOWED = [
                'pending', 'selected',
                'label_purchased', 'oms_updated',
                'shipped', 'delivered',
                'cancelled', 'failed', 'error',
            ];
            if (!status || !ALLOWED.includes(status)) {
                return errorResponse(res,
                    `status must be one of: ${ALLOWED.join(', ')}`, 400,
                    { error_code: 'INVALID_VALUE' });
            }

            const row = await OmsOrderModel.findById(id);
            if (!row) return errorResponse(res, 'OMS order not found', 404);

            await OmsOrderModel.setInternalStatus(id, status, note || null);
            const updated = await OmsOrderModel.findById(id);

            logger.info('[OMS-ORDER] internal status changed', {
                omsOrderId: id,
                from: row.internal_status,
                to: status,
                editor: req.session?.username || null,
            });

            return successResponse(res, this._formatOrder(updated), 'Internal status updated');
        } catch (err) {
            return this._handleError(res, err, next);
        }
    }

    /**
     * PATCH /api/v1/admin/oms-orders/:id/pricing
     * Edit selling fees + fulfillment fees. Recomputes gross_profit.
     * shipping_fee_purchase is rejected (readonly).
     */
    async updatePricing(req, res, next) {
        try {
            const id = parseInt(req.params.id);
            if (!Number.isFinite(id)) return errorResponse(res, 'Invalid id', 400);

            const {
                shippingFeeSelling,
                fulfillmentFeePurchase,
                fulfillmentFeeSelling,
                shippingFeePurchase,    // not allowed — guard below
            } = req.body || {};

            if (shippingFeePurchase !== undefined) {
                return errorResponse(res, 'shippingFeePurchase is readonly (set by ITC purchase)', 400, {
                    error_code: 'READONLY_FIELD',
                });
            }

            const editor = req.session?.username || null;
            const result = await OmsOrderModel.updatePricing(id, {
                shippingFeeSelling,
                fulfillmentFeePurchase,
                fulfillmentFeeSelling,
            }, editor);

            return successResponse(res, {
                ...this._formatOrder(result.row),
                changed_columns: result.changed,
            }, 'Pricing updated');
        } catch (err) {
            return this._handleError(res, err, next);
        }
    }

    async bulkBuyLabels(req, res, next) {
        try {
            const { ids, productCode } = req.body || {};
            if (!Array.isArray(ids) || ids.length === 0) {
                return errorResponse(res, 'ids must be a non-empty array', 400);
            }
            if (ids.length > 100) {
                return errorResponse(res, 'Bulk size cannot exceed 100 orders per request', 400);
            }
            const numericIds = ids.map(n => parseInt(n)).filter(Number.isFinite);

            const results = await labelPurchase.purchaseBatch(numericIds, { productCode });
            const succeeded = results.filter(r => r.success).length;

            return successResponse(res, {
                results,
                total: numericIds.length,
                succeeded,
                failed: numericIds.length - succeeded,
            }, `Bulk purchase: ${succeeded}/${numericIds.length} succeeded`);
        } catch (err) {
            next(err);
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────

    _handleError(res, err, next) {
        if (err.code && STATUS_TO_HTTP[err.code]) {
            const status = STATUS_TO_HTTP[err.code];
            logger.warn('[OMS-ORDER] request failed', {
                code: err.code,
                message: err.message,
            });
            return errorResponse(res, err.message, status, { error_code: err.code });
        }
        return next(err);
    }

    /**
     * Stable JSON shape for admin/dashboard consumption.
     * - Parse JSON columns
     * - Drop large `raw_data` from list responses (kept on detail by caller using getOrder)
     */
    _formatOrder(row) {
        if (!row) return null;
        return {
            ...row,
            items: this._parseJson(row.items),
            raw_data: this._parseJson(row.raw_data),
            editable_data: this._parseJson(row.editable_data),
            itc_response: this._parseJson(row.itc_response),
        };
    }

    _parseJson(v) {
        if (v === null || v === undefined) return null;
        if (typeof v !== 'string') return v;
        try { return JSON.parse(v); } catch { return v; }
    }
}

module.exports = new OmsOrderController();
