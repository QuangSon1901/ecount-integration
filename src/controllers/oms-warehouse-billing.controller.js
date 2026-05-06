// src/controllers/oms-warehouse-billing.controller.js

const OmsWarehouseBillingModel  = require('../models/oms-warehouse-billing.model');
const OmsOrderModel              = require('../models/oms-order.model');
const OmsPackagingMaterialModel  = require('../models/oms-packaging-material.model');
const { VALID_SECTION_IDS }      = require('../constants/warehouse-billing-sections');
const { successResponse, errorResponse } = require('../utils/response');
const db = require('../database/connection');
const {
    getMonthlyTier,
    computeFulfillmentFeeCostFromTier,
    TIER_LABELS,
} = require('../services/pricing/fulfillment-cost-calculator.service');

function _r4(n) { return Math.round(Number(n || 0) * 10000) / 10000; }

function _parseItems(raw) {
    if (!raw) return [];
    if (typeof raw === 'string') {
        try { return JSON.parse(raw); } catch { return []; }
    }
    return Array.isArray(raw) ? raw : [];
}

function _emptyCustomerAgg() {
    return {
        order_count:    0,
        has_incomplete: false,
        revenue: { shipping: 0, fulfillment: 0, packaging: 0, additional: 0 },
        cost:    { shipping: 0, fulfillment: 0, packaging: 0 },
    };
}

const USPS_SERVICES = new Set(['standard usps', 'priority usps']);

async function _fetchCustomerInfo(customerIds) {
    if (!customerIds.length) return new Map();
    const conn = await db.getConnection();
    try {
        const ph = customerIds.map(() => '?').join(',');
        const [rows] = await conn.query(
            `SELECT id, customer_code, customer_name FROM api_customers WHERE id IN (${ph})`,
            customerIds
        );
        const map = new Map();
        for (const r of rows) map.set(r.id, { customer_code: r.customer_code, customer_name: r.customer_name });
        return map;
    } finally {
        conn.release();
    }
}

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
            const { year_month, customer_id } = req.query;
            if (!year_month || !/^\d{4}-\d{2}$/.test(year_month)) {
                return errorResponse(res, 'year_month bắt buộc, định dạng YYYY-MM', 400);
            }
            const custIdFilter = customer_id ? parseInt(customer_id) : undefined;

            // 1. Tier
            const { monthly_total, tier } = await getMonthlyTier(year_month);
            const tierResult = { tier, monthly_total: monthly_total ?? 0 };

            // 2. OMS orders
            const orders = await OmsOrderModel.listForSummary({ yearMonth: year_month, customerId: custIdFilter });

            // 3. Bulk SKU lookup
            const allSkus = [...new Set(
                orders.flatMap(o => _parseItems(o.items).map(it => (it.sku || it.skuNumber || '').trim()).filter(Boolean))
            )];
            const materialMappings = await OmsPackagingMaterialModel.findMappingsBySkus(allSkus);

            // 4. Aggregate per customer
            const customerMap = {};
            let incompleteCount = 0;

            for (const order of orders) {
                const items  = _parseItems(order.items);
                const custId = order.customer_id;
                if (!custId) continue;
                if (!customerMap[custId]) customerMap[custId] = _emptyCustomerAgg();

                const svcName = (order.shipping_service_name || '').trim().toLowerCase().replace(/\s+/g, ' ');
                const shippingCost = USPS_SERVICES.has(svcName)
                    ? _r4(order.shipping_fee_purchase || 0) : 0;

                const fulfillResult = computeFulfillmentFeeCostFromTier(items, tierResult, year_month);
                const fulfillmentCost = fulfillResult.fee_purchase ?? 0;

                let packagingCost = 0;
                for (const item of items) {
                    const sku = (item.sku || item.skuNumber || '').trim();
                    if (!sku) continue;
                    const mapping = materialMappings.get(sku);
                    if (mapping?.cost_price != null) {
                        packagingCost += Number(mapping.cost_price) * Number(item.quantity || 1);
                    }
                }

                const isIncomplete = order.fulfillment_fee_selling === null || order.shipping_fee_selling === null;
                if (isIncomplete) incompleteCount++;

                customerMap[custId].revenue.shipping    += _r4(order.shipping_fee_selling || 0);
                customerMap[custId].revenue.fulfillment += _r4(order.fulfillment_fee_selling || 0);
                customerMap[custId].revenue.packaging   += _r4(order.packaging_material_fee_selling || 0);
                customerMap[custId].revenue.additional  += _r4(order.additional_fee || 0);

                customerMap[custId].cost.shipping    += shippingCost;
                customerMap[custId].cost.fulfillment += fulfillmentCost;
                customerMap[custId].cost.packaging   += _r4(packagingCost);

                customerMap[custId].order_count++;
                if (isIncomplete) customerMap[custId].has_incomplete = true;
            }

            // 5. Customer info for OMS order customers
            const custIds = Object.keys(customerMap).map(Number).filter(n => Number.isFinite(n) && n > 0);
            const customerInfo = await _fetchCustomerInfo(custIds);

            // 6. Billing
            const [billingAgg, billingSection] = await Promise.all([
                OmsWarehouseBillingModel.monthlyAggregate(year_month, custIdFilter),
                OmsWarehouseBillingModel.monthlyBillingSectionBreakdown(year_month, custIdFilter),
            ]);

            const billingByCustomer = new Map();
            for (const r of billingAgg) {
                billingByCustomer.set(r.customer_id, {
                    customer_code: r.customer_code,
                    customer_name: r.customer_name,
                    slip_count:    Number(r.slip_count) || 0,
                    total_revenue: _r4(r.total_revenue),
                    total_cost:    _r4(r.total_cost),
                    total_profit:  _r4(r.total_profit),
                });
            }

            const billingSectionByCustomer = new Map();
            for (const r of billingSection) {
                if (!billingSectionByCustomer.has(r.customer_id)) billingSectionByCustomer.set(r.customer_id, []);
                billingSectionByCustomer.get(r.customer_id).push({
                    section_id:    r.section_id,
                    section_label: r.section_label,
                    total_revenue: _r4(r.total_revenue),
                    total_cost:    _r4(r.total_cost),
                });
            }

            // 7. Merge all customer_ids
            const allCustIds = new Set([...custIds, ...billingByCustomer.keys()]);

            let grandOmsOrderCount = 0;
            let grandOmsRev = { shipping: 0, fulfillment: 0, packaging: 0, additional: 0 };
            let grandOmsCost = { shipping: 0, fulfillment: 0, packaging: 0 };
            let grandWhSlip = 0, grandWhRev = 0, grandWhCost = 0, grandWhProfit = 0;

            const byCustomer = [];
            for (const cid of allCustIds) {
                const oms     = customerMap[cid] || null;
                const billing = billingByCustomer.get(cid) || null;
                const info    = customerInfo.get(cid)
                             || (billing ? { customer_code: billing.customer_code, customer_name: billing.customer_name } : null)
                             || {};

                let omsRevTotal = 0, omsCostTotal = 0;
                let omsBlock = null;
                if (oms) {
                    omsRevTotal  = _r4(oms.revenue.shipping + oms.revenue.fulfillment + oms.revenue.packaging + oms.revenue.additional);
                    omsCostTotal = _r4(oms.cost.shipping + oms.cost.fulfillment + oms.cost.packaging);
                    omsBlock = {
                        order_count:          oms.order_count,
                        has_incomplete_pricing: oms.has_incomplete,
                        revenue: {
                            shipping:            _r4(oms.revenue.shipping),
                            fulfillment:         _r4(oms.revenue.fulfillment),
                            packaging_material:  _r4(oms.revenue.packaging),
                            additional:          _r4(oms.revenue.additional),
                            total:               omsRevTotal,
                        },
                        cost: {
                            shipping:           _r4(oms.cost.shipping),
                            fulfillment:        _r4(oms.cost.fulfillment),
                            packaging_material: _r4(oms.cost.packaging),
                            total:              omsCostTotal,
                        },
                        profit: _r4(omsRevTotal - omsCostTotal),
                    };

                    grandOmsOrderCount += oms.order_count;
                    grandOmsRev.shipping    += oms.revenue.shipping;
                    grandOmsRev.fulfillment += oms.revenue.fulfillment;
                    grandOmsRev.packaging   += oms.revenue.packaging;
                    grandOmsRev.additional  += oms.revenue.additional;
                    grandOmsCost.shipping    += oms.cost.shipping;
                    grandOmsCost.fulfillment += oms.cost.fulfillment;
                    grandOmsCost.packaging   += oms.cost.packaging;
                }

                let whRevTotal = 0, whCostTotal = 0, whProfitTotal = 0;
                let whBlock = null;
                if (billing) {
                    whRevTotal    = billing.total_revenue;
                    whCostTotal   = billing.total_cost;
                    whProfitTotal = billing.total_profit;
                    whBlock = {
                        slip_count:           billing.slip_count,
                        total_revenue:        whRevTotal,
                        total_cost:           whCostTotal,
                        total_profit:         whProfitTotal,
                        breakdown_by_section: billingSectionByCustomer.get(cid) || [],
                    };

                    grandWhSlip   += billing.slip_count;
                    grandWhRev    += whRevTotal;
                    grandWhCost   += whCostTotal;
                    grandWhProfit += whProfitTotal;
                }

                const combinedRev    = _r4(omsRevTotal + whRevTotal);
                const combinedCost   = _r4(omsCostTotal + whCostTotal);
                const combinedProfit = _r4(combinedRev - combinedCost);

                byCustomer.push({
                    customer_id:   cid,
                    customer_code: info.customer_code || null,
                    customer_name: info.customer_name || null,
                    oms_orders:    omsBlock,
                    warehouse_billing: whBlock,
                    combined: {
                        total_revenue:  combinedRev,
                        total_cost:     combinedCost,
                        total_profit:   combinedProfit,
                        margin_percent: combinedRev > 0 ? Math.round((combinedProfit / combinedRev) * 10000) / 100 : 0,
                    },
                });
            }

            byCustomer.sort((a, b) => {
                const ra = (a.combined?.total_revenue || 0);
                const rb = (b.combined?.total_revenue || 0);
                return rb - ra;
            });

            const grandOmsRevTotal  = _r4(grandOmsRev.shipping + grandOmsRev.fulfillment + grandOmsRev.packaging + grandOmsRev.additional);
            const grandOmsCostTotal = _r4(grandOmsCost.shipping + grandOmsCost.fulfillment + grandOmsCost.packaging);
            const grandWhRevR4      = _r4(grandWhRev);
            const grandWhCostR4     = _r4(grandWhCost);
            const grandCombRev      = _r4(grandOmsRevTotal + grandWhRevR4);
            const grandCombCost     = _r4(grandOmsCostTotal + grandWhCostR4);
            const grandCombProfit   = _r4(grandCombRev - grandCombCost);

            return successResponse(res, {
                year_month,
                oms_context: {
                    monthly_total:           monthly_total ?? null,
                    tier,
                    tier_label:              TIER_LABELS[tier - 1],
                    has_incomplete_pricing:  incompleteCount > 0,
                    incomplete_order_count:  incompleteCount,
                },
                grand_total: {
                    oms_orders: {
                        order_count: grandOmsOrderCount,
                        revenue: {
                            shipping:           _r4(grandOmsRev.shipping),
                            fulfillment:        _r4(grandOmsRev.fulfillment),
                            packaging_material: _r4(grandOmsRev.packaging),
                            additional:         _r4(grandOmsRev.additional),
                            total:              grandOmsRevTotal,
                        },
                        cost: {
                            shipping:           _r4(grandOmsCost.shipping),
                            fulfillment:        _r4(grandOmsCost.fulfillment),
                            packaging_material: _r4(grandOmsCost.packaging),
                            total:              grandOmsCostTotal,
                        },
                        profit: _r4(grandOmsRevTotal - grandOmsCostTotal),
                    },
                    warehouse_billing: {
                        slip_count:    grandWhSlip,
                        total_revenue: grandWhRevR4,
                        total_cost:    grandWhCostR4,
                        total_profit:  _r4(grandWhProfit),
                    },
                    combined: {
                        total_revenue:  grandCombRev,
                        total_cost:     grandCombCost,
                        total_profit:   grandCombProfit,
                        margin_percent: grandCombRev > 0 ? Math.round((grandCombProfit / grandCombRev) * 10000) / 100 : 0,
                    },
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
