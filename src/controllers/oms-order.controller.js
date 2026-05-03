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

            // Claim atomically NGAY tại enqueue: chuyển pending|selected|error|failed
            // → label_purchasing trước khi tạo job. Nếu transition fail nghĩa là row
            // đã được claim ở đợt trước (hoặc đang chạy) → skip để chặn duplicate.
            // Worker sẽ chạy purchaseFor với skipClaim=true vì đã claim ở đây rồi.
            const CLAIMABLE_STATES = ['pending', 'selected', 'error', 'failed'];
            const queued = [];
            const skipped = [];
            const errors = [];

            for (let i = 0; i < numericIds.length; i++) {
                const id = numericIds[i];

                let claimed = false;
                try {
                    claimed = await OmsOrderModel.transitionInternalStatus(
                        id,
                        CLAIMABLE_STATES,
                        'label_purchasing',
                        'Đã đẩy vào queue mua label (bulk)'
                    );
                } catch (err) {
                    logger.error('[OMS-ORDER] claim transition failed', {
                        omsOrderId: id, error: err.message,
                    });
                    errors.push({ id, error: err.message, stage: 'claim' });
                    continue;
                }

                if (!claimed) {
                    // Row không còn ở trạng thái claim được — đang in-flight hoặc đã mua xong
                    skipped.push({ id, reason: 'already_in_progress_or_finalized' });
                    continue;
                }

                try {
                    const delaySeconds = Math.min(i, 30); // stagger 1s, cap 30s
                    const jobId = await jobService.addOmsBuyLabelJob(id, { productCode }, delaySeconds);
                    queued.push({ id, jobId, delaySeconds });
                } catch (err) {
                    // Đã claim mà không tạo được job → revert sang 'error' để không
                    // stuck ở label_purchasing (cleanup cron có 30 phút mới quét).
                    logger.error('[OMS-ORDER] enqueue buy-label job failed after claim', {
                        omsOrderId: id, error: err.message,
                    });
                    try {
                        await OmsOrderModel.setInternalStatus(
                            id,
                            'error',
                            `Enqueue job failed: ${err.message}`
                        );
                    } catch (e) {
                        logger.error('[OMS-ORDER] revert state failed', {
                            omsOrderId: id, error: e.message,
                        });
                    }
                    errors.push({ id, error: err.message, stage: 'enqueue' });
                }
            }

            return successResponse(res, {
                queued,
                skipped,
                errors,
                total: numericIds.length,
                queuedCount: queued.length,
                skippedCount: skipped.length,
                failedToQueue: errors.length,
            }, `Đã đẩy ${queued.length}/${numericIds.length} đơn vào queue (skip ${skipped.length}, lỗi ${errors.length})`, 202);
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
            // ─── Identity ───────────────────────────────────────────
            id:                   row.id,
            order_number:         row.order_number,
            oms_order_number:     row.oms_order_number,   // sOrCode
            oms_order_id:         row.oms_order_id,

            // ─── Status ─────────────────────────────────────────────
            internal_status:      row.internal_status,
            internal_status_note: row.internal_status_note || null,
            // Surface khi lifecycle đang ở error/failed để dashboard hiển thị.
            // Reuse internal_status_note (đã được service/worker set khi lỗi)
            // thay vì thêm cột mới — tránh migrate dữ liệu cũ.
            error_message:        (row.internal_status === 'error' || row.internal_status === 'failed')
                                    ? (row.internal_status_note || null)
                                    : null,
            oms_status:           row.oms_status,

            // ─── Receiver ───────────────────────────────────────────
            receiver_name:        row.receiver_name,
            receiver_company:     row.receiver_company,
            receiver_phone:       row.receiver_phone,
            receiver_tax_number:  row.receiver_tax_number,
            receiver_address_line1: row.receiver_address_line1,
            receiver_address_line2: row.receiver_address_line2,
            receiver_city:        row.receiver_city,
            receiver_state:       row.receiver_state,
            receiver_postal_code: row.receiver_postal_code,
            receiver_country:     row.receiver_country,

            // ─── Package ────────────────────────────────────────────
            package_weight:       row.package_weight,
            package_length:       row.package_length,
            package_width:        row.package_width,
            package_height:       row.package_height,
            route_shipping_partner: row.route_shipping_partner,
            address_index:        row.address_index,
            warehouse_code:       row.warehouse_code,

            // ─── Items ──────────────────────────────────────────────
            items:                this._parseJson(row.items),

            // ─── Pricing ────────────────────────────────────────────
            declared_currency:       row.declared_currency,
            shipping_fee_purchase:   row.shipping_fee_purchase,
            shipping_markup_percent: row.shipping_markup_percent,
            shipping_fee_selling:    row.shipping_fee_selling,
            gross_profit:            row.gross_profit,
            fulfillment_fee_purchase: row.fulfillment_fee_purchase,
            fulfillment_fee_selling:  row.fulfillment_fee_selling,
            total_value:             row.total_value,
            total_discount:          row.total_discount,
            paid_amount:             row.paid_amount,
            remaining_amount:        row.remaining_amount,

            // ─── ITC Label ──────────────────────────────────────────
            carrier:         row.carrier,
            tracking_number: row.tracking_number,
            itc_sid:         row.itc_sid,
            label_url:       row.label_access_key ? `${process.env.BASE_URL}/api/labels/${row.label_access_key}` : null,

            // ─── Timestamps ─────────────────────────────────────────
            created_at:      row.created_at,
            updated_at:      row.updated_at,
            oms_created_at:  row.oms_created_at,
            oms_updated_at:  row.oms_updated_at,
            synced_at:       row.synced_at,

            // ─── Customer ref (dashboard list dùng) ─────────────────
            customer_id:     row.customer_id,
            customer_code:   row.customer_code || null,
            customer_name:   row.customer_name || null,
        };
    }

    _parseJson(v) {
        if (v === null || v === undefined) return null;
        if (typeof v !== 'string') return v;
        try { return JSON.parse(v); } catch { return v; }
    }
}

module.exports = new OmsOrderController();
