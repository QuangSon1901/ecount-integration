// src/controllers/oms-warehouse-billing.controller.js

const OmsWarehouseBillingModel = require('../models/oms-warehouse-billing.model');
const { VALID_SECTION_IDS } = require('../constants/warehouse-billing-sections');
const { successResponse, errorResponse } = require('../utils/response');
const db = require('../database/connection');

function computeTotals(rows) {
    let revenue = 0, cost = 0;
    for (const r of rows) {
        if (r.is_free) continue;
        const qty = Number(r.quantity) || 1;
        revenue += (Number(r.selling_price) || 0) * qty;
        cost    += (Number(r.cost_price)    || 0) * qty;
    }
    return {
        total_revenue: Math.round(revenue * 10000) / 10000,
        total_cost:    Math.round(cost    * 10000) / 10000,
        total_profit:  Math.round((revenue - cost) * 10000) / 10000,
    };
}

function _formatRow(r) {
    const qty = Number(r.quantity) || 1;
    const sp  = r.is_free ? 0 : (Number(r.selling_price) || 0);
    const cp  = r.is_free ? 0 : (Number(r.cost_price)    || 0);
    return {
        id:                r.id,
        section_id:        r.section_id,
        section_label:     r.section_label,
        item_id:           r.item_id,
        name:              r.name,
        unit:              r.unit,
        is_free:           Boolean(r.is_free),
        selling_price:     r.selling_price != null ? Number(r.selling_price) : null,
        cost_price:        r.cost_price    != null ? Number(r.cost_price)    : null,
        quantity:          qty,
        subtotal_revenue:  Math.round(sp * qty * 10000) / 10000,
        subtotal_cost:     Math.round(cp * qty * 10000) / 10000,
        subtotal_profit:   Math.round((sp - cp) * qty * 10000) / 10000,
        note:              r.note,
        sort_order:        r.sort_order,
    };
}

function _formatSlip(slip) {
    return {
        id:            slip.id,
        customer_id:   slip.customer_id,
        customer_code: slip.customer_code,
        customer_name: slip.customer_name,
        slip_date:     slip.slip_date,
        note:          slip.note,
        total_revenue: Number(slip.total_revenue),
        total_cost:    Number(slip.total_cost),
        total_profit:  Number(slip.total_profit),
        created_by:    slip.created_by,
        created_at:    slip.created_at,
        updated_at:    slip.updated_at,
        rows:          slip.rows ? slip.rows.map(_formatRow) : undefined,
    };
}

async function _customerExists(customerId) {
    const conn = await db.getConnection();
    try {
        const [rows] = await conn.query(
            'SELECT id FROM api_customers WHERE id = ? LIMIT 1',
            [customerId]
        );
        return rows.length > 0;
    } finally {
        conn.release();
    }
}

class OmsWarehouseBillingController {
    async createSlip(req, res, next) {
        try {
            const { customer_id, slip_date, note, rows } = req.body;

            if (!customer_id) return errorResponse(res, 'customer_id là bắt buộc', 400);
            if (!slip_date)   return errorResponse(res, 'slip_date là bắt buộc', 400);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(slip_date) || isNaN(Date.parse(slip_date))) {
                return errorResponse(res, 'slip_date không hợp lệ (YYYY-MM-DD)', 400);
            }
            if (!Array.isArray(rows) || rows.length === 0) {
                return errorResponse(res, 'rows phải là mảng có ít nhất 1 phần tử', 400);
            }

            const exists = await _customerExists(customer_id);
            if (!exists) return errorResponse(res, 'customer_id không tồn tại', 400);

            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                if (!VALID_SECTION_IDS.has(Number(r.section_id))) {
                    return errorResponse(res, `rows[${i}].section_id không hợp lệ`, 400);
                }
                if (!r.name || !String(r.name).trim()) {
                    return errorResponse(res, `rows[${i}].name là bắt buộc`, 400);
                }
                const qty = r.quantity != null ? Number(r.quantity) : 1;
                if (!Number.isFinite(qty) || qty <= 0) {
                    return errorResponse(res, `rows[${i}].quantity phải là số dương`, 400);
                }
                if (!r.is_free) {
                    if (r.selling_price != null && (isNaN(Number(r.selling_price)) || Number(r.selling_price) < 0)) {
                        return errorResponse(res, `rows[${i}].selling_price không hợp lệ`, 400);
                    }
                    if (r.cost_price != null && (isNaN(Number(r.cost_price)) || Number(r.cost_price) < 0)) {
                        return errorResponse(res, `rows[${i}].cost_price không hợp lệ`, 400);
                    }
                }
            }

            const totals = computeTotals(rows);
            const payload = { customer_id, slip_date, note: note || null, ...totals };
            const createdBy = req.username || null;

            const slipId = await OmsWarehouseBillingModel.create(payload, rows, createdBy);
            const slip   = await OmsWarehouseBillingModel.findById(slipId);

            return successResponse(res, _formatSlip(slip), 'Tạo phiếu phí thành công', 201);
        } catch (err) {
            next(err);
        }
    }

    async listSlips(req, res, next) {
        try {
            const { customer_id, year_month, date_from, date_to, limit = 50, offset = 0 } = req.query;
            const filters = {
                customer_id: customer_id ? parseInt(customer_id) : undefined,
                year_month,
                date_from,
                date_to,
                limit:  parseInt(limit),
                offset: parseInt(offset),
            };

            const [slips, total] = await Promise.all([
                OmsWarehouseBillingModel.list(filters),
                OmsWarehouseBillingModel.count(filters),
            ]);

            return successResponse(res, {
                slips: slips.map(_formatSlip),
                total,
                limit:  filters.limit,
                offset: filters.offset,
            }, 'OK');
        } catch (err) {
            next(err);
        }
    }

    async getSlip(req, res, next) {
        try {
            const id = parseInt(req.params.id);
            if (!id) return errorResponse(res, 'ID không hợp lệ', 400);

            const slip = await OmsWarehouseBillingModel.findById(id);
            if (!slip) return errorResponse(res, 'Không tìm thấy phiếu phí', 404);

            return successResponse(res, _formatSlip(slip), 'OK');
        } catch (err) {
            next(err);
        }
    }

    async deleteSlip(req, res, next) {
        try {
            const id = parseInt(req.params.id);
            if (!id) return errorResponse(res, 'ID không hợp lệ', 400);

            const deleted = await OmsWarehouseBillingModel.deleteById(id);
            if (!deleted) return errorResponse(res, 'Không tìm thấy phiếu phí', 404);

            return successResponse(res, null, 'Xoá phiếu phí thành công');
        } catch (err) {
            next(err);
        }
    }

    async monthlySummary(req, res, next) {
        try {
            const { year_month } = req.query;
            if (!year_month || !/^\d{4}-\d{2}$/.test(year_month)) {
                return errorResponse(res, 'year_month bắt buộc, định dạng YYYY-MM', 400);
            }

            const rows = await OmsWarehouseBillingModel.monthlySummary(year_month);

            let grandRevenue = 0, grandCost = 0, grandProfit = 0, grandCount = 0;
            const byCustomer = rows.map(r => {
                const rev  = Number(r.total_revenue) || 0;
                const cost = Number(r.total_cost)    || 0;
                const prof = Number(r.total_profit)  || 0;
                const cnt  = Number(r.slip_count)    || 0;
                grandRevenue += rev;
                grandCost    += cost;
                grandProfit  += prof;
                grandCount   += cnt;
                return {
                    customer_id:    r.customer_id,
                    customer_code:  r.customer_code,
                    customer_name:  r.customer_name,
                    slip_count:     cnt,
                    total_revenue:  Math.round(rev  * 10000) / 10000,
                    total_cost:     Math.round(cost * 10000) / 10000,
                    total_profit:   Math.round(prof * 10000) / 10000,
                    margin_percent: rev > 0 ? Math.round((prof / rev) * 10000) / 100 : 0,
                };
            });

            return successResponse(res, {
                year_month,
                grand_total: {
                    total_revenue: Math.round(grandRevenue * 10000) / 10000,
                    total_cost:    Math.round(grandCost    * 10000) / 10000,
                    total_profit:  Math.round(grandProfit  * 10000) / 10000,
                    slip_count:    grandCount,
                },
                by_customer: byCustomer,
            }, 'OK');
        } catch (err) {
            next(err);
        }
    }

    async monthlySummaryBySection(req, res, next) {
        try {
            const { year_month, customer_id } = req.query;
            if (!year_month || !/^\d{4}-\d{2}$/.test(year_month)) {
                return errorResponse(res, 'year_month bắt buộc, định dạng YYYY-MM', 400);
            }

            const rows = await OmsWarehouseBillingModel.monthlySummaryBySection(
                year_month,
                customer_id ? parseInt(customer_id) : undefined
            );

            return successResponse(res, {
                year_month,
                by_section: rows.map(r => ({
                    section_id:    r.section_id,
                    section_label: r.section_label,
                    total_revenue: Math.round((Number(r.total_revenue) || 0) * 10000) / 10000,
                    total_cost:    Math.round((Number(r.total_cost)    || 0) * 10000) / 10000,
                    row_count:     Number(r.row_count) || 0,
                })),
            }, 'OK');
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new OmsWarehouseBillingController();
