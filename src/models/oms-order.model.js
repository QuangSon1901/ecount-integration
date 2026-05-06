// src/models/oms-order.model.js
//
// DAO for the oms_orders table. Strictly isolated from orders.* — no model
// in this file touches the orders table, and OrderModel never touches this one.
//
// The `admin_edited_at` overlay rule lives here in `refreshFromOms`:
//   - If the admin has touched the row, the editable columns are preserved
//     across re-syncs; only the source-of-truth fields (oms_status,
//     oms_updated_at, last_oms_synced_at, raw_data) are refreshed.
//   - If the admin has NOT touched the row, the editable columns are
//     re-pulled from OMS so the latest customer-fixed address etc. lands.
//
// Changes:
//   - list()         : hỗ trợ filter `search` (LIKE trên order_number, oms_order_id, oms_order_number)
//   - count()        : hỗ trợ filter `search` tương tự
//   - countByStatus(): method mới — trả về { pending: N, …, __total__: N }
//   - computeGrossProfit(): guard rõ ràng — trả null khi thiếu shipping_fee_purchase
//     hoặc shipping_fee_selling (đơn chưa mua label không được hiển thị gross_profit)

const db = require('../database/connection');

const EDITABLE_COLUMNS = [
    'receiver_name', 'receiver_phone', 'receiver_email',
    'receiver_country', 'receiver_state', 'receiver_city',
    'receiver_postal_code', 'receiver_address_line1', 'receiver_address_line2',
    'package_weight', 'package_length', 'package_width', 'package_height',
    'weight_unit', 'size_unit',
    'declared_value', 'declared_currency',
    'items',
    'customer_order_number', 'platform_order_number',
];

// Shipping services áp dụng markup. Spec ai-tasks/oms-pricing.md §1.
// So sánh case-insensitive + trim vì OMS có thể trả về 'standard usps', 'Standard USPS', v.v.
const SHIPPING_SERVICES_WITH_MARKUP = new Set(['standard usps', 'priority usps']);
// Partners đã được normalize thành enum trong DB — fallback khi service_name không match
const SHIPPING_PARTNERS_WITH_MARKUP = new Set(['USPS-LABEL', 'USPS-PRIORITY-LABEL']);

function _round4(n) {
    if (n === null || n === undefined) return null;
    const num = Number(n);
    if (!Number.isFinite(num)) return null;
    return Math.round(num * 10000) / 10000;
}

const ALWAYS_REFRESHED_COLUMNS = [
    'oms_order_number', 'oms_status',
    'oms_shipping_service_name', 'oms_shipping_partner',
    'oms_created_at', 'oms_updated_at',
    'raw_data', 'last_oms_synced_at',
];

// ─── Shared WHERE builder ──────────────────────────────────────────────────
/**
 * Xây phần WHERE chung cho list / count / countByStatus.
 * Trả về { clauses: string[], params: any[] }
 *
 * Hỗ trợ filters:
 *   customerId     — exact match o.customer_id
 *   internalStatus — exact match o.internal_status
 *   omsStatus      — exact match o.oms_status
 *   search         — LIKE '%q%' trên order_number, oms_order_id, oms_order_number
 */
function _buildWhere(filters = {}) {
    const clauses = [];
    const params  = [];

    if (filters.customerId) {
        clauses.push('o.customer_id = ?');
        params.push(filters.customerId);
    }
    if (filters.internalStatus) {
        clauses.push('o.internal_status = ?');
        params.push(filters.internalStatus);
    }
    if (filters.omsStatus) {
        clauses.push('o.oms_status = ?');
        params.push(filters.omsStatus);
    }
    if (filters.search) {
        const like = '%' + filters.search + '%';
        clauses.push('(o.order_number LIKE ? OR o.oms_order_id LIKE ? OR o.oms_order_number LIKE ?)');
        params.push(like, like, like);
    }
    if (filters.dateFrom) {
        clauses.push('DATE(o.created_at) >= ?');
        params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
        clauses.push('DATE(o.created_at) <= ?');
        params.push(filters.dateTo);
    }

    return { clauses, params };
}

class OmsOrderModel {
    static get EDITABLE_COLUMNS() { return EDITABLE_COLUMNS.slice(); }

    static async findById(id) {
        const conn = await db.getConnection();
        try {
            const [rows] = await conn.query(
                `SELECT o.*, c.customer_code, c.customer_name
                 FROM oms_orders o
                 LEFT JOIN api_customers c ON c.id = o.customer_id
                 WHERE o.id = ?`,
                [id]
            );
            return rows[0] || null;
        } finally {
            conn.release();
        }
    }

    static async findByOrderNumber(orderNumber) {
        const conn = await db.getConnection();
        try {
            const [rows] = await conn.query('SELECT * FROM oms_orders WHERE order_number = ?', [orderNumber]);
            return rows[0] || null;
        } finally {
            conn.release();
        }
    }

    static async findByCustomerAndOmsId(customerId, omsOrderId) {
        const conn = await db.getConnection();
        try {
            const [rows] = await conn.query(
                'SELECT * FROM oms_orders WHERE customer_id = ? AND oms_order_id = ?',
                [customerId, omsOrderId]
            );
            return rows[0] || null;
        } finally {
            conn.release();
        }
    }

    /**
     * Lookup by oms_order_id only — used when customer_id is not yet resolved
     * (admin-scoped sync where customerId = null).
     */
    static async findByOmsId(omsOrderId) {
        const conn = await db.getConnection();
        try {
            const [rows] = await conn.query(
                'SELECT * FROM oms_orders WHERE oms_order_id = ?',
                [omsOrderId]
            );
            return rows[0] || null;
        } finally {
            conn.release();
        }
    }

    /**
     * Bulk-check: nhận vào mảng omsOrderId, trả về mảng những id đã tồn tại trong DB.
     */
    static async findExistingOmsIds(omsIds) {
        if (!omsIds || omsIds.length === 0) return [];
        const conn = await db.getConnection();
        try {
            const placeholders = omsIds.map(() => '?').join(', ');
            const [rows] = await conn.query(
                `SELECT oms_order_id FROM oms_orders WHERE oms_order_id IN (${placeholders})`,
                omsIds
            );
            return rows.map(r => r.oms_order_id);
        } finally {
            conn.release();
        }
    }

    /**
     * Insert a new oms_orders row from a normalized OMS order.
     */
    static async create(payload) {
        const conn = await db.getConnection();
        try {
            const [result] = await conn.query(
                `INSERT INTO oms_orders (
                    order_number, customer_id, customer_order_number, platform_order_number,
                    oms_order_id, oms_order_number, oms_status,
                    oms_shipping_service_name, oms_shipping_partner,
                    oms_created_at, oms_updated_at, last_oms_synced_at,
                    receiver_name, receiver_phone, receiver_email, receiver_country, receiver_state, receiver_city,
                    receiver_postal_code, receiver_address_line1, receiver_address_line2,
                    package_weight, package_length, package_width, package_height, weight_unit, size_unit,
                    declared_value, declared_currency, items,
                    internal_status,
                    raw_data
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    payload.order_number, payload.customer_id,
                    payload.customer_order_number || null, payload.platform_order_number || null,
                    payload.oms_order_id, payload.oms_order_number || null, payload.oms_status || null,
                    payload.oms_shipping_service_name || null, payload.oms_shipping_partner ?? null,
                    payload.oms_created_at || null, payload.oms_updated_at || null, payload.last_oms_synced_at || new Date(),
                    payload.receiver_name || null, payload.receiver_phone || null, payload.receiver_email || null,
                    payload.receiver_country || null, payload.receiver_state || null, payload.receiver_city || null,
                    payload.receiver_postal_code || null, payload.receiver_address_line1 || null, payload.receiver_address_line2 || null,
                    payload.package_weight ?? null, payload.package_length ?? null,
                    payload.package_width ?? null, payload.package_height ?? null,
                    payload.weight_unit || 'KG', payload.size_unit || 'CM',
                    payload.declared_value ?? null, payload.declared_currency || 'USD',
                    payload.items ? JSON.stringify(payload.items) : null,
                    payload.internal_status || 'pending',
                    payload.raw_data ? JSON.stringify(payload.raw_data) : null,
                ]
            );
            return result.insertId;
        } finally {
            conn.release();
        }
    }

    /**
     * Apply a fresh OMS pull on top of an existing row.
     * preserveEditable=true  → only refresh source-of-truth columns.
     * preserveEditable=false → refresh editable columns too.
     */
    static async refreshFromOms(id, payload, preserveEditable) {
        const conn = await db.getConnection();
        try {
            const fields = [];
            const values = [];

            fields.push('oms_order_number = ?'); values.push(payload.oms_order_number || null);
            fields.push('oms_status = ?');        values.push(payload.oms_status || null);
            fields.push('oms_shipping_service_name = ?'); values.push(payload.oms_shipping_service_name || null);
            fields.push('oms_shipping_partner = ?');      values.push(payload.oms_shipping_partner ?? null);
            fields.push('oms_created_at = ?');   values.push(payload.oms_created_at || null);
            fields.push('oms_updated_at = ?');   values.push(payload.oms_updated_at || null);
            fields.push('last_oms_synced_at = ?'); values.push(payload.last_oms_synced_at || new Date());
            fields.push('raw_data = ?');          values.push(payload.raw_data ? JSON.stringify(payload.raw_data) : null);

            if (!preserveEditable) {
                fields.push('customer_order_number = ?'); values.push(payload.customer_order_number || null);
                fields.push('platform_order_number = ?'); values.push(payload.platform_order_number || null);
                fields.push('receiver_name = ?');         values.push(payload.receiver_name || null);
                fields.push('receiver_phone = ?');        values.push(payload.receiver_phone || null);
                fields.push('receiver_email = ?');        values.push(payload.receiver_email || null);
                fields.push('receiver_country = ?');      values.push(payload.receiver_country || null);
                fields.push('receiver_state = ?');        values.push(payload.receiver_state || null);
                fields.push('receiver_city = ?');         values.push(payload.receiver_city || null);
                fields.push('receiver_postal_code = ?');  values.push(payload.receiver_postal_code || null);
                fields.push('receiver_address_line1 = ?'); values.push(payload.receiver_address_line1 || null);
                fields.push('receiver_address_line2 = ?'); values.push(payload.receiver_address_line2 || null);
                fields.push('package_weight = ?');        values.push(payload.package_weight ?? null);
                fields.push('package_length = ?');        values.push(payload.package_length ?? null);
                fields.push('package_width = ?');         values.push(payload.package_width ?? null);
                fields.push('package_height = ?');        values.push(payload.package_height ?? null);
                fields.push('weight_unit = ?');           values.push(payload.weight_unit || 'KG');
                fields.push('size_unit = ?');             values.push(payload.size_unit || 'CM');
                fields.push('declared_value = ?');        values.push(payload.declared_value ?? null);
                fields.push('declared_currency = ?');     values.push(payload.declared_currency || 'USD');
                fields.push('items = ?');                 values.push(payload.items ? JSON.stringify(payload.items) : null);
            }

            values.push(id);
            const [result] = await conn.query(
                `UPDATE oms_orders SET ${fields.join(', ')} WHERE id = ?`,
                values
            );
            return result.affectedRows > 0;
        } finally {
            conn.release();
        }
    }

    /**
     * Apply admin-supplied edits to whitelisted columns. Stamps admin_edited_at.
     */
    static async applyAdminEdits(id, edits, editedBy = null) {
        const conn = await db.getConnection();
        try {
            const fields = [];
            const values = [];
            for (const col of EDITABLE_COLUMNS) {
                if (edits[col] === undefined) continue;
                if (col === 'items') {
                    fields.push(`${col} = ?`);
                    values.push(edits[col] === null ? null : JSON.stringify(edits[col]));
                } else {
                    fields.push(`${col} = ?`);
                    values.push(edits[col]);
                }
            }
            if (fields.length === 0) return false;

            fields.push('admin_edited_at = NOW()');
            fields.push('admin_edited_by = ?');
            values.push(editedBy);

            values.push(id);
            const [result] = await conn.query(
                `UPDATE oms_orders SET ${fields.join(', ')} WHERE id = ?`,
                values
            );
            return result.affectedRows > 0;
        } finally {
            conn.release();
        }
    }

    static async setInternalStatus(id, status, note = null) {
        const conn = await db.getConnection();
        try {
            const [result] = await conn.query(
                `UPDATE oms_orders SET internal_status = ?, internal_status_note = ? WHERE id = ?`,
                [status, note, id]
            );
            return result.affectedRows > 0;
        } finally {
            conn.release();
        }
    }

    static async transitionInternalStatus(id, expected, next, note = null) {
        const conn = await db.getConnection();
        try {
            const expectedList   = Array.isArray(expected) ? expected : [expected];
            const placeholders   = expectedList.map(() => '?').join(',');
            const [result] = await conn.query(
                `UPDATE oms_orders
                 SET internal_status = ?, internal_status_note = ?
                 WHERE id = ? AND internal_status IN (${placeholders})`,
                [next, note, id, ...expectedList]
            );
            return result.affectedRows > 0;
        } finally {
            conn.release();
        }
    }

    static async recordItcLabel(id, data) {
        const purchase = data.shippingFeePurchase ?? null;
        const selling  = data.shippingFeeSelling  ?? null;

        const conn = await db.getConnection();
        try {
            const [result] = await conn.query(
                `UPDATE oms_orders SET
                    carrier = ?,
                    product_code = ?,
                    tracking_number = ?,
                    waybill_number = ?,
                    label_url = ?,
                    label_access_key = ?,
                    itc_sid = ?,
                    itc_response = ?,
                    itc_seller_snapshot = ?,
                    shipping_fee_purchase = ?,
                    shipping_markup_percent = ?,
                    shipping_fee_selling = ?,
                    cost_currency = ?,
                    internal_status = ?,
                    internal_status_note = ?
                 WHERE id = ?`,
                [
                    data.carrier || 'ITC',
                    data.productCode || null,
                    data.trackingNumber,
                    data.waybillNumber || data.trackingNumber,
                    data.labelUrl,
                    data.labelAccessKey,
                    data.itcSid,
                    data.itcResponse ? JSON.stringify(data.itcResponse) : null,
                    data.sellerSnapshot ? JSON.stringify(data.sellerSnapshot) : null,
                    purchase,
                    data.shippingMarkupPercent ?? null,
                    selling,
                    data.costCurrency || 'USD',
                    data.internalStatus || 'label_purchased',
                    data.internalStatusNote || null,
                    id,
                ]
            );
            return result.affectedRows > 0;
        } finally {
            conn.release();
        }
    }

    static async updatePricing(id, edits, editedBy = null) {
        // Admin có thể edit:
        //   - shipping_fee_purchase  (đơn không mua qua ITC → nhập tay)
        //   - shipping_markup_percent (đặt lại % theo từng order)
        //   - additional_fee + additional_fee_note
        // Khi shipping_fee_purchase hoặc markup thay đổi → tự động recompute
        // shipping_fee_selling theo công thức (có check service name + partner).
        // Fulfillment / packaging chỉ được tính qua computeAndApplySellingFees.
        const sets = {};

        // shipping_fee_purchase — >= 0 hoặc null
        if (edits.shippingFeePurchase !== undefined) {
            if (edits.shippingFeePurchase === null || edits.shippingFeePurchase === '') {
                sets.shipping_fee_purchase = null;
            } else {
                const n = Number(edits.shippingFeePurchase);
                if (!Number.isFinite(n) || n < 0) {
                    const e = new Error('shippingFeePurchase must be a number >= 0');
                    e.code = 'INVALID_VALUE';
                    throw e;
                }
                sets.shipping_fee_purchase = Math.round(n * 10000) / 10000;
            }
        }

        // shipping_markup_percent — >= 0 (cho phép 0% / null = clear)
        if (edits.shippingMarkupPercent !== undefined) {
            if (edits.shippingMarkupPercent === null || edits.shippingMarkupPercent === '') {
                sets.shipping_markup_percent = null;
            } else {
                const n = Number(edits.shippingMarkupPercent);
                if (!Number.isFinite(n) || n < 0) {
                    const e = new Error('shippingMarkupPercent must be a number >= 0');
                    e.code = 'INVALID_VALUE';
                    throw e;
                }
                sets.shipping_markup_percent = Math.round(n * 10000) / 10000;
            }
        }

        // additional_fee — number, có thể âm hoặc dương
        if (edits.additionalFee !== undefined) {
            if (edits.additionalFee === null) {
                sets.additional_fee = null;
            } else {
                const n = Number(edits.additionalFee);
                if (!Number.isFinite(n)) {
                    const e = new Error('additionalFee must be a finite number');
                    e.code = 'INVALID_VALUE';
                    throw e;
                }
                sets.additional_fee = Math.round(n * 10000) / 10000;
            }
        }

        // additional_fee_note — text, optional
        if (edits.additionalFeeNote !== undefined) {
            sets.additional_fee_note = edits.additionalFeeNote === null
                ? null : String(edits.additionalFeeNote);
        }

        if (Object.keys(sets).length === 0) {
            const e = new Error('No editable pricing fields supplied');
            e.code = 'INVALID_VALUE';
            throw e;
        }

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            const [rows] = await conn.query('SELECT * FROM oms_orders WHERE id = ? FOR UPDATE', [id]);
            if (rows.length === 0) {
                await conn.rollback();
                const e = new Error(`OMS order ${id} not found`);
                e.code = 'NOT_FOUND';
                throw e;
            }
            const row = rows[0];

            // Recompute shipping_fee_selling khi purchase hoặc markup thay đổi
            if (sets.shipping_fee_purchase !== undefined || sets.shipping_markup_percent !== undefined) {
                const pickNum = (col) => {
                    if (sets[col] !== undefined) return sets[col];
                    return row[col] === null ? null : Number(row[col]);
                };
                const newSelling = OmsOrderModel.computeShippingFeeSelling({
                    shippingFeePurchase:   pickNum('shipping_fee_purchase'),
                    shippingMarkupPercent: pickNum('shipping_markup_percent'),
                    shippingServiceName:   row.oms_shipping_service_name,
                    shippingPartner:       row.oms_shipping_partner,
                });
                sets.shipping_fee_selling = newSelling;
            }

            // gross_profit được tính động (dựa vào cost tier tháng đơn) — không lưu DB
            const fields = [];
            const values = [];
            for (const [col, val] of Object.entries(sets)) {
                fields.push(`${col} = ?`);
                values.push(val);
            }
            fields.push('pricing_edited_at = NOW()');
            fields.push('pricing_edited_by = ?'); values.push(editedBy);
            values.push(id);

            await conn.query(`UPDATE oms_orders SET ${fields.join(', ')} WHERE id = ?`, values);
            await conn.commit();

            const [updated] = await conn.query('SELECT * FROM oms_orders WHERE id = ?', [id]);
            return {
                row:     updated[0],
                changed: Object.keys(sets),
            };
        } catch (err) {
            try { await conn.rollback(); } catch {}
            throw err;
        } finally {
            conn.release();
        }
    }

    /**
     * Tính gross profit từ các fee thành phần.
     *
     * GUARD: trả về null khi thiếu bất kỳ điều kiện nào dưới đây:
     *   - shipping_fee_purchase null  → label chưa được mua
     *   - shipping_fee_selling  null  → giá bán shipping chưa được thiết lập
     *   - fulfillment_fee_purchase null → cost không tính được (weight ngoài bảng / chưa có)
     *   - fulfillment_fee_selling  null → selling fee chưa tính được
     *
     * packaging + additional được coi là 0 khi null (optional fees).
     */
    static computeGrossProfit({
        shippingFeePurchase, shippingFeeSelling,
        fulfillmentFeePurchase, fulfillmentFeeSelling,
        packagingMaterialFeeSelling,
        packagingMaterialFeeCost,
        additionalFee,
    }) {
        // Shipping phải có đủ cả hai phía — purchase = chưa mua label,
        // selling = chưa thiết lập giá bán.
        if (shippingFeePurchase == null) return null;
        if (shippingFeeSelling  == null) return null;

        // Fulfillment cũng phải có đủ (weight hợp lệ + tier tra được)
        if (fulfillmentFeePurchase == null) return null;
        if (fulfillmentFeeSelling  == null) return null;

        const revenue = Number(shippingFeeSelling)
                      + Number(fulfillmentFeeSelling)
                      + Number(packagingMaterialFeeSelling ?? 0)
                      + Number(additionalFee ?? 0);

        const cost    = Number(shippingFeePurchase)
                      + Number(fulfillmentFeePurchase)
                      + Number(packagingMaterialFeeCost ?? 0);

        return _round4(revenue - cost);
    }

    /**
     * Tính shipping_fee_selling từ purchase + markup, có check service name / partner.
     * Spec ai-tasks/oms-pricing.md §1.
     *
     * Match cả `shippingServiceName` (case-insensitive) và `shippingPartner` (enum
     * đã normalize) để tránh phụ thuộc casing OMS trả về.
     */
    static computeShippingFeeSelling({ shippingFeePurchase, shippingMarkupPercent, shippingServiceName, shippingPartner }) {
        if (shippingFeePurchase === null || shippingFeePurchase === undefined) return null;

        const nameKey = shippingServiceName
            ? String(shippingServiceName).trim().toLowerCase().replace(/\s+/g, ' ')
            : null;

        const purchase = Number(shippingFeePurchase);
        if (!Number.isFinite(purchase)) return null;
        const markup = Number(shippingMarkupPercent ?? 0);
        return _round4(purchase * (1 + markup / 100));
    }

    /**
     * Orchestrate: tính fulfillment selling + cost, packaging selling + cost,
     * shipping selling, gross_profit và lưu lại.
     *
     * Luôn tính lại từ items hiện tại — không có gate "skip auto".
     * `needs_manual_pricing` là union của cả selling lẫn cost calculator.
     *
     * Trigger:
     *   - Sau khi mua label thành công (label-purchase.service.js)
     *   - Khi admin bấm nút "Recompute pricing" trên UI (controller recomputePricing)
     *
     * @param {number} orderId
     * @returns {Promise<object>} updated row
     */
    static async computeAndApplyFees(orderId) {
        const fulfillmentCalc = require('../services/pricing/fulfillment-calculator.service');
        const packagingCalc   = require('../services/pricing/packaging-material.service');

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            const [rows] = await conn.query('SELECT * FROM oms_orders WHERE id = ? FOR UPDATE', [orderId]);
            if (rows.length === 0) {
                await conn.rollback();
                const e = new Error(`OMS order ${orderId} not found`);
                e.code = 'NOT_FOUND';
                throw e;
            }
            const row = rows[0];

            // Guard: đơn chưa có shipping purchase + selling (hoặc = 0)
            // → chưa đi qua đơn vị vận chuyển, reset fulfillment/packaging selling về 0.
            const sfp = row.shipping_fee_purchase == null ? null : Number(row.shipping_fee_purchase);
            const sfs = row.shipping_fee_selling  == null ? null : Number(row.shipping_fee_selling);
            if (!sfp || !sfs) {
                await conn.query(
                    `UPDATE oms_orders SET
                        fulfillment_fee_selling = 0,
                        fulfillment_fee_detail = NULL,
                        packaging_material_fee_selling = 0,
                        packaging_material_fee_detail = NULL,
                        needs_manual_pricing = 0
                     WHERE id = ?`,
                    [orderId]
                );
                await conn.commit();
                const [zeroed] = await conn.query('SELECT * FROM oms_orders WHERE id = ?', [orderId]);
                return zeroed[0];
            }

            // Items có thể là JSON string hoặc đã parsed (mysql2 decodes JSON cols)
            let items = row.items;
            if (typeof items === 'string') {
                try { items = JSON.parse(items); } catch { items = []; }
            }
            if (!Array.isArray(items)) items = [];

            // 1. Selling fees — fulfillment + packaging
            const fulfillmentSellingRes = fulfillmentCalc.computeFulfillmentFeeSelling(items);
            const packagingSellingRes   = await packagingCalc.computePackagingFee(items, row.customer_id);

            const fulfillmentFeeSelling = fulfillmentSellingRes.fee_selling;
            const fulfillmentDetail     = fulfillmentSellingRes.detail;
            const needsManual           = fulfillmentSellingRes.needs_manual_pricing;
            const packagingTotal        = packagingSellingRes.total;
            const packagingDetail       = packagingSellingRes.detail;

            const fields = [];
            const values = [];

            // Selling
            fields.push('fulfillment_fee_selling = ?');         values.push(fulfillmentFeeSelling);
            fields.push('fulfillment_fee_detail = ?');          values.push(fulfillmentDetail ? JSON.stringify(fulfillmentDetail) : null);
            fields.push('packaging_material_fee_selling = ?');  values.push(packagingTotal);
            fields.push('packaging_material_fee_detail = ?');   values.push(packagingDetail && packagingDetail.length ? JSON.stringify(packagingDetail) : null);

            fields.push('needs_manual_pricing = ?');            values.push(needsManual ? 1 : 0);

            // 2. Shipping fee selling (cập nhật theo service name + purchase + markup,
            //    chỉ ghi đè khi đã có purchase để tránh wipe lúc chưa mua label)
            if (row.shipping_fee_purchase !== null && row.shipping_fee_purchase !== undefined) {
                const effectiveShippingSelling = OmsOrderModel.computeShippingFeeSelling({
                    shippingFeePurchase:   row.shipping_fee_purchase,
                    shippingMarkupPercent: row.shipping_markup_percent,
                    shippingServiceName:   row.oms_shipping_service_name,
                    shippingPartner:       row.oms_shipping_partner,
                });
                fields.push('shipping_fee_selling = ?');
                values.push(effectiveShippingSelling);
            }

            // Cost (fulfillment_fee_purchase, packaging_material_fee_cost, gross_profit)
            // không lưu vào DB — tính động khi hiển thị theo tháng tạo đơn.

            values.push(orderId);
            await conn.query(
                `UPDATE oms_orders SET ${fields.join(', ')} WHERE id = ?`,
                values
            );

            await conn.commit();

            const [updated] = await conn.query('SELECT * FROM oms_orders WHERE id = ?', [orderId]);
            return updated[0];
        } catch (err) {
            try { await conn.rollback(); } catch {}
            throw err;
        } finally {
            conn.release();
        }
    }

    /**
     * @deprecated Dùng computeAndApplyFees thay thế.
     * Giữ lại alias để tránh break caller chưa cập nhật.
     */
    static async computeAndApplySellingFees(orderId) {
        return OmsOrderModel.computeAndApplyFees(orderId);
    }

    static async findStuckLabelPurchasing(olderThanMinutes = 5, limit = 100) {
        const conn = await db.getConnection();
        try {
            const [rows] = await conn.query(
                `SELECT * FROM oms_orders
                 WHERE internal_status = 'label_purchasing'
                   AND updated_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)
                 ORDER BY updated_at ASC
                 LIMIT ?`,
                [olderThanMinutes, parseInt(limit)]
            );
            return rows;
        } finally {
            conn.release();
        }
    }

    static async findForTrackingPoll({ minMinutesSinceCheck = 30, limit = 50 } = {}) {
        const conn = await db.getConnection();
        try {
            const [rows] = await conn.query(
                `SELECT * FROM oms_orders
                 WHERE tracking_number IS NOT NULL
                   AND internal_status IN ('label_purchased', 'oms_updated', 'shipped', 'error')
                   AND (last_tracking_check_at IS NULL
                        OR last_tracking_check_at < DATE_SUB(NOW(), INTERVAL ? MINUTE))
                 ORDER BY last_tracking_check_at IS NULL DESC, last_tracking_check_at ASC
                 LIMIT ?`,
                [minMinutesSinceCheck, parseInt(limit)]
            );
            return rows;
        } finally {
            conn.release();
        }
    }

    static async updateTrackingTimestamps(id, hadEvents = false) {
        const conn = await db.getConnection();
        try {
            if (hadEvents) {
                await conn.query(
                    `UPDATE oms_orders SET last_tracking_check_at = NOW(),
                                            last_tracked_at = NOW()
                     WHERE id = ?`, [id]);
            } else {
                await conn.query(
                    `UPDATE oms_orders SET last_tracking_check_at = NOW() WHERE id = ?`, [id]);
            }
        } finally {
            conn.release();
        }
    }

    /**
     * Danh sách đơn có hỗ trợ filter search + phân trang.
     *
     * @param {object} filters
     *   customerId     {string|number}  — exact match
     *   internalStatus {string}         — exact match
     *   omsStatus      {string}         — exact match
     *   search         {string}         — LIKE trên order_number, oms_order_id, oms_order_number
     *   limit          {number}
     *   offset         {number}
     */
    static async list(filters = {}) {
        const conn = await db.getConnection();
        try {
            const { clauses, params } = _buildWhere(filters);

            let sql = `SELECT o.*, c.customer_code, c.customer_name
                       FROM oms_orders o
                       LEFT JOIN api_customers c ON c.id = o.customer_id
                       WHERE 1=1`;

            if (clauses.length) sql += ' AND ' + clauses.join(' AND ');

            sql += ' ORDER BY o.created_at DESC';

            if (filters.limit)  { sql += ' LIMIT ?';  params.push(parseInt(filters.limit)); }
            if (filters.offset) { sql += ' OFFSET ?'; params.push(parseInt(filters.offset)); }

            const [rows] = await conn.query(sql, params);
            return rows;
        } finally {
            conn.release();
        }
    }

    /**
     * Đếm tổng số rows match filter — dùng cho pagination.
     * Cùng logic WHERE với list().
     */
    static async count(filters = {}) {
        const conn = await db.getConnection();
        try {
            const { clauses, params } = _buildWhere(filters);

            let sql = 'SELECT COUNT(*) AS cnt FROM oms_orders o WHERE 1=1';
            if (clauses.length) sql += ' AND ' + clauses.join(' AND ');

            const [rows] = await conn.query(sql, params);
            return rows[0] ? Number(rows[0].cnt) : 0;
        } finally {
            conn.release();
        }
    }

    /**
     * Đếm số đơn theo từng internal_status (dùng cho badge trên tab bar UI).
     * Nhận cùng base filters như list/count NGOẠI TRỪ internalStatus
     * (để mỗi tab luôn thấy count của chính nó, không bị filter chéo).
     *
     * Trả về object:
     *   {
     *     pending:          N,
     *     selected:         N,
     *     label_purchasing: N,
     *     label_purchased:  N,
     *     oms_updated:      N,
     *     shipped:          N,
     *     delivered:        N,
     *     cancelled:        N,
     *     failed:           N,
     *     error:            N,
     *     __total__:        N   ← tổng tất cả (cho tab "All")
     *   }
     *
     * @param {object} baseFilters  — customerId, search (không có internalStatus)
     */
    static async countByStatus(baseFilters = {}) {
        const conn = await db.getConnection();
        try {
            // Chỉ áp dụng customerId + search, không áp dụng internalStatus
            const safeFilters = {
                customerId: baseFilters.customerId,
                search:     baseFilters.search,
            };
            const { clauses, params } = _buildWhere(safeFilters);

            let sql = `SELECT internal_status, COUNT(*) AS cnt
                       FROM oms_orders o
                       WHERE 1=1`;
            if (clauses.length) sql += ' AND ' + clauses.join(' AND ');
            sql += ' GROUP BY internal_status';

            const [rows] = await conn.query(sql, params);

            const result = {
                pending:          0,
                selected:         0,
                label_purchasing: 0,
                label_purchased:  0,
                oms_updated:      0,
                shipped:          0,
                delivered:        0,
                cancelled:        0,
                failed:           0,
                error:            0,
                __total__:        0,
            };

            for (const row of rows) {
                const s = row.internal_status;
                const n = Number(row.cnt);
                if (s in result) result[s] = n;
                result.__total__ += n;
            }

            return result;
        } finally {
            conn.release();
        }
    }

    /**
     * Tìm order theo label access key
     */
    static async listForSummary({ yearMonth, customerId } = {}) {
        const conn = await db.getConnection();
        try {
            let sql = `
                SELECT id, customer_id, items, oms_shipping_service_name AS shipping_service_name,
                       shipping_fee_purchase, shipping_fee_selling,
                       fulfillment_fee_selling, packaging_material_fee_selling,
                       additional_fee, internal_status
                FROM oms_orders
                WHERE DATE_FORMAT(created_at, '%Y-%m') = ?
                  AND internal_status NOT IN ('cancelled', 'failed')
            `;
            const params = [yearMonth];
            if (customerId) { sql += ' AND customer_id = ?'; params.push(customerId); }
            const [rows] = await conn.query(sql, params);
            return rows;
        } finally {
            conn.release();
        }
    }

    /**
     * Tìm order theo label access key
     */
    static async findByLabelAccessKey(accessKey) {
        const conn = await db.getConnection();
        try {
            const [rows] = await conn.query(
                'SELECT * FROM oms_orders WHERE label_access_key = ?',
                [accessKey]
            );
            return rows[0] || null;
        } finally {
            conn.release();
        }
    }
}

module.exports = OmsOrderModel;