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

const ALWAYS_REFRESHED_COLUMNS = [
    'oms_order_number', 'oms_status',
    'oms_shipping_service_name', 'oms_shipping_partner',
    'oms_created_at', 'oms_updated_at',
    'raw_data', 'last_oms_synced_at',
];

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
     *
     * Dùng một câu IN(...) duy nhất thay vì N lần findByOmsId — O(1) DB round trip
     * thay vì O(N). Được gọi ở order-fetcher trước khi enrich để tránh HTTP calls thừa.
     *
     * @param {(string|number)[]} omsIds  - mảng oms_order_id cần kiểm tra
     * @returns {Promise<(string|number)[]>}  - mảng những id ĐÃ tồn tại
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
     * @param {object} payload — column-shaped row (caller pre-maps from normalized form)
     * @returns {Promise<number>} insertId
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
     *
     * Internal lifecycle (internal_status, ITC fields, pricing) is NEVER touched here.
     */
    static async refreshFromOms(id, payload, preserveEditable) {
        const conn = await db.getConnection();
        try {
            const fields = [];
            const values = [];

            fields.push('oms_order_number = ?'); values.push(payload.oms_order_number || null);
            fields.push('oms_status = ?');       values.push(payload.oms_status || null);
            fields.push('oms_shipping_service_name = ?'); values.push(payload.oms_shipping_service_name || null);
            fields.push('oms_shipping_partner = ?');      values.push(payload.oms_shipping_partner ?? null);
            fields.push('oms_created_at = ?');   values.push(payload.oms_created_at || null);
            fields.push('oms_updated_at = ?');   values.push(payload.oms_updated_at || null);
            fields.push('last_oms_synced_at = ?'); values.push(payload.last_oms_synced_at || new Date());
            fields.push('raw_data = ?');         values.push(payload.raw_data ? JSON.stringify(payload.raw_data) : null);

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
            const expectedList = Array.isArray(expected) ? expected : [expected];
            const placeholders = expectedList.map(() => '?').join(',');
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
        const selling = data.shippingFeeSelling ?? null;
        const initialProfit = OmsOrderModel.computeGrossProfit({
            shippingFeePurchase: purchase,
            shippingFeeSelling: selling,
            fulfillmentFeePurchase: null,
            fulfillmentFeeSelling: null,
        });

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
                    shipping_fee_purchase = ?,
                    shipping_markup_percent = ?,
                    shipping_fee_selling = ?,
                    gross_profit = ?,
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
                    purchase,
                    data.shippingMarkupPercent ?? null,
                    selling,
                    initialProfit,
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
        const validators = {
            shippingFeeSelling: 'shipping_fee_selling',
            fulfillmentFeePurchase: 'fulfillment_fee_purchase',
            fulfillmentFeeSelling: 'fulfillment_fee_selling',
        };

        const sets = {};
        for (const [k, col] of Object.entries(validators)) {
            if (edits[k] === undefined) continue;
            if (edits[k] === null) { sets[col] = null; continue; }
            const n = Number(edits[k]);
            if (!Number.isFinite(n) || n < 0) {
                const e = new Error(`${k} must be a number >= 0`);
                e.code = 'INVALID_VALUE';
                throw e;
            }
            sets[col] = Math.round(n * 10000) / 10000;
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

            if (row.shipping_fee_purchase === null) {
                await conn.rollback();
                const e = new Error('Cannot edit pricing: shipping_fee_purchase not set yet (no label purchased)');
                e.code = 'NO_PURCHASE_COST';
                throw e;
            }

            const merged = {
                shipping_fee_purchase: Number(row.shipping_fee_purchase),
                shipping_fee_selling: sets.shipping_fee_selling !== undefined
                    ? sets.shipping_fee_selling
                    : (row.shipping_fee_selling === null ? null : Number(row.shipping_fee_selling)),
                fulfillment_fee_purchase: sets.fulfillment_fee_purchase !== undefined
                    ? sets.fulfillment_fee_purchase
                    : (row.fulfillment_fee_purchase === null ? null : Number(row.fulfillment_fee_purchase)),
                fulfillment_fee_selling: sets.fulfillment_fee_selling !== undefined
                    ? sets.fulfillment_fee_selling
                    : (row.fulfillment_fee_selling === null ? null : Number(row.fulfillment_fee_selling)),
            };

            const newProfit = OmsOrderModel.computeGrossProfit({
                shippingFeePurchase: merged.shipping_fee_purchase,
                shippingFeeSelling: merged.shipping_fee_selling,
                fulfillmentFeePurchase: merged.fulfillment_fee_purchase,
                fulfillmentFeeSelling: merged.fulfillment_fee_selling,
            });

            const fields = [];
            const values = [];
            for (const [col, val] of Object.entries(sets)) {
                fields.push(`${col} = ?`);
                values.push(val);
            }
            fields.push('gross_profit = ?');       values.push(newProfit);
            fields.push('pricing_edited_at = NOW()');
            fields.push('pricing_edited_by = ?');  values.push(editedBy);
            values.push(id);

            await conn.query(`UPDATE oms_orders SET ${fields.join(', ')} WHERE id = ?`, values);
            await conn.commit();

            const [updated] = await conn.query('SELECT * FROM oms_orders WHERE id = ?', [id]);
            return {
                row: updated[0],
                changed: Object.keys(sets).concat(['gross_profit']),
            };
        } catch (err) {
            try { await conn.rollback(); } catch {}
            throw err;
        } finally {
            conn.release();
        }
    }

    static computeGrossProfit({
        shippingFeePurchase, shippingFeeSelling,
        fulfillmentFeePurchase, fulfillmentFeeSelling,
    }) {
        const sp = shippingFeePurchase;
        const ss = shippingFeeSelling;
        if (sp === null || sp === undefined || ss === null || ss === undefined) return null;
        const fp = Number(fulfillmentFeePurchase ?? 0);
        const fs = Number(fulfillmentFeeSelling ?? 0);
        const profit = (Number(ss) + fs) - (Number(sp) + fp);
        return Math.round(profit * 10000) / 10000;
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

    static async list(filters = {}) {
        const conn = await db.getConnection();
        try {
            let sql = `SELECT o.*, c.customer_code, c.customer_name
                    FROM oms_orders o
                    LEFT JOIN api_customers c ON c.id = o.customer_id
                    WHERE 1=1`;
            const params = [];
            if (filters.customerId)     { sql += ' AND o.customer_id = ?';      params.push(filters.customerId); }
            if (filters.internalStatus) { sql += ' AND o.internal_status = ?';  params.push(filters.internalStatus); }
            if (filters.omsStatus)      { sql += ' AND o.oms_status = ?';       params.push(filters.omsStatus); }
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
     * Đếm tổng số oms_orders match filter (giống list nhưng không LIMIT/OFFSET).
     * Dùng cho pagination phía dashboard.
     */
    static async count(filters = {}) {
        const conn = await db.getConnection();
        try {
            let sql = 'SELECT COUNT(*) AS cnt FROM oms_orders o WHERE 1=1';
            const params = [];
            if (filters.customerId)     { sql += ' AND o.customer_id = ?';      params.push(filters.customerId); }
            if (filters.internalStatus) { sql += ' AND o.internal_status = ?';  params.push(filters.internalStatus); }
            if (filters.omsStatus)      { sql += ' AND o.oms_status = ?';       params.push(filters.omsStatus); }
            const [rows] = await conn.query(sql, params);
            return rows[0] ? Number(rows[0].cnt) : 0;
        } finally {
            conn.release();
        }
    }

    /**
     * Tìm order theo label access key
     */
    static async findByLabelAccessKey(accessKey) {
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query(
                'SELECT * FROM oms_orders WHERE label_access_key = ?',
                [accessKey]
            );
            
            return rows[0] || null;
        } finally {
            connection.release();
        }
    }
}

module.exports = OmsOrderModel;