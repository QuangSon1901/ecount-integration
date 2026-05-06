// src/services/pricing/fulfillment-cost-calculator.service.js
//
// Tính fulfillment_fee_purchase (cost) theo tier tháng × bracket weight.
// Spec: ai_tasks/cost_pricing.md §2.

const SystemConfigModel = require('../../models/system-config.model');
const logger = require('../../utils/logger');

const GRAMS_PER_LB = 453.592;

// Bảng giá cost: COST_RATES[tier][bracketIndex]
// tier 1..4, bracket index tương ứng với COST_BRACKETS
const COST_BRACKETS = [
    { id: 1, max: 2   },
    { id: 2, max: 4   },
    { id: 3, max: 10  },
    { id: 4, max: 30  },
    { id: 5, max: 50  },
    { id: 6, max: 70  },
    { id: 7, max: 150 },
];

// COST_RATES[tier - 1][bracketIndex] = base_rate USD
const COST_RATES = [
    // Tier 1 (0-1000 đơn/tháng)
    [1.17, 2.07, 2.57, 2.77, 3.07, 3.57, 5.07],
    // Tier 2 (1001-3000)
    [0.97, 1.87, 2.27, 2.47, 2.77, 3.27, 4.87],
    // Tier 3 (3001-5000)
    [0.92, 1.67, 1.97, 2.17, 2.47, 2.97, 4.67],
    // Tier 4 (>5000)
    [0.82, 1.47, 1.77, 1.87, 2.17, 2.67, 4.47],
];

const EXTRA_ITEM_FEE_COST = 0.25; // $0.25/pc (cost), so sánh $0.50 cho selling

function _round4(n) {
    return Math.round(n * 10000) / 10000;
}

/**
 * Đọc config `oms_monthly_order_totals` và trả về tier của tháng `yearMonth`.
 *
 * @param {string} yearMonth — 'YYYY-MM'
 * @returns {Promise<{ monthly_total: number|null, tier: number }>}
 */
async function getMonthlyTier(yearMonth) {
    let configValue = null;
    try {
        configValue = await SystemConfigModel.getValue('oms_monthly_order_totals', null);
    } catch (err) {
        logger.warn('[fulfillment-cost] không đọc được oms_monthly_order_totals', { error: err.message });
    }

    if (!configValue || typeof configValue !== 'object') {
        logger.warn('[fulfillment-cost] oms_monthly_order_totals null hoặc không parse được — dùng tier 1', { yearMonth });
        return { monthly_total: null, tier: 1 };
    }

    const entry = configValue[yearMonth];
    if (!entry || entry.total == null) {
        logger.warn('[fulfillment-cost] không có dữ liệu tháng trong oms_monthly_order_totals — dùng tier 1', { yearMonth });
        return { monthly_total: null, tier: 1 };
    }

    const total = Number(entry.total);
    let tier;
    if (total <= 1000)     tier = 1;
    else if (total <= 3000) tier = 2;
    else if (total <= 5000) tier = 3;
    else                   tier = 4;

    return { monthly_total: total, tier };
}

/**
 * Tính fulfillment_fee_purchase (cost) từ items hiện tại.
 *
 * @param {Array<{ quantity?: number, weight?: number }>} items — weight đơn vị gram
 * @param {string} [orderYearMonth] — 'YYYY-MM' tháng tạo đơn; nếu bỏ qua thì dùng tháng hiện tại
 * @returns {Promise<{
 *   fee_purchase: number|null,
 *   needs_manual_pricing: boolean,
 *   detail: object|null
 * }>}
 */
async function computeFulfillmentFeeCost(items, orderYearMonth) {
    // Edge case: rỗng / null
    if (!Array.isArray(items) || items.length === 0) {
        return { fee_purchase: null, needs_manual_pricing: false, detail: null };
    }

    // Dùng tháng của đơn (để tính đúng tier khi xem đơn tháng trước)
    let yearMonth = orderYearMonth;
    if (!yearMonth) {
        const now = new Date();
        yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    const { monthly_total, tier } = await getMonthlyTier(yearMonth);

    // Tìm heaviest weight (gram). Coi 0 / null như chưa có dữ liệu.
    let heaviestGram = 0;
    for (const it of items) {
        const w = Number(it?.weight);
        if (Number.isFinite(w) && w > heaviestGram) heaviestGram = w;
    }

    if (heaviestGram <= 0) {
        // Edge case: tất cả weight = 0 hoặc NULL
        return { fee_purchase: null, needs_manual_pricing: true, detail: null };
    }

    const heaviestLbs = heaviestGram / GRAMS_PER_LB;
    const lbsRounded  = Math.round(heaviestLbs * 1000) / 1000;

    // Lookup bracket
    let bracketIdx = -1;
    for (let i = 0; i < COST_BRACKETS.length; i++) {
        if (heaviestLbs <= COST_BRACKETS[i].max) { bracketIdx = i; break; }
    }

    // Tổng quantity
    let totalItems = 0;
    for (const it of items) {
        const q = Number(it?.quantity);
        if (Number.isFinite(q) && q > 0) totalItems += q;
    }
    if (totalItems < 1) totalItems = 1;
    const extraItems = Math.max(0, totalItems - 1);
    const extraFee   = _round4(extraItems * EXTRA_ITEM_FEE_COST);

    // > 150 lbs: ngoài bảng, cần nhập tay
    if (bracketIdx === -1) {
        return {
            fee_purchase: null,
            needs_manual_pricing: true,
            detail: {
                year_month:             yearMonth,
                monthly_total:          monthly_total,
                tier:                   tier,
                heaviest_weight_gram:   heaviestGram,
                heaviest_weight_lbs:    lbsRounded,
                weight_bracket:         null,
                base_rate:              null,
                total_items:            totalItems,
                extra_items:            extraItems,
                extra_fee:              extraFee,
                computed_at:            new Date().toISOString(),
            },
        };
    }

    const bracket  = COST_BRACKETS[bracketIdx];
    const baseRate = COST_RATES[tier - 1][bracketIdx];
    const feePurchase = _round4(baseRate + extraFee);

    return {
        fee_purchase: feePurchase,
        needs_manual_pricing: false,
        detail: {
            year_month:             yearMonth,
            monthly_total:          monthly_total,
            tier:                   tier,
            heaviest_weight_gram:   heaviestGram,
            heaviest_weight_lbs:    lbsRounded,
            weight_bracket:         bracket.id,
            base_rate:              baseRate,
            total_items:            totalItems,
            extra_items:            extraItems,
            extra_fee:              extraFee,
            computed_at:            new Date().toISOString(),
        },
    };
}

/**
 * Tính fulfillment cost khi đã có sẵn tier (tránh re-fetch config).
 * Dùng khi cần batch compute nhiều orders cùng tháng.
 */
function computeFulfillmentFeeCostFromTier(items, tierResult, orderYearMonth) {
    const { tier, monthly_total } = tierResult;
    const _round4 = n => Math.round(n * 10000) / 10000;

    if (!Array.isArray(items) || items.length === 0) {
        return { fee_purchase: null, needs_manual_pricing: false, detail: null };
    }

    let heaviestGram = 0;
    for (const it of items) {
        const w = Number(it?.weight);
        if (Number.isFinite(w) && w > heaviestGram) heaviestGram = w;
    }

    if (heaviestGram <= 0) {
        return { fee_purchase: null, needs_manual_pricing: true, detail: null };
    }

    const heaviestLbs = heaviestGram / GRAMS_PER_LB;
    const lbsRounded  = Math.round(heaviestLbs * 1000) / 1000;

    let bracketIdx = -1;
    for (let i = 0; i < COST_BRACKETS.length; i++) {
        if (heaviestLbs <= COST_BRACKETS[i].max) { bracketIdx = i; break; }
    }

    let totalItems = 0;
    for (const it of items) {
        const q = Number(it?.quantity);
        if (Number.isFinite(q) && q > 0) totalItems += q;
    }
    if (totalItems < 1) totalItems = 1;
    const extraItems = Math.max(0, totalItems - 1);
    const extraFee   = _round4(extraItems * EXTRA_ITEM_FEE_COST);

    if (bracketIdx === -1) {
        return {
            fee_purchase: null,
            needs_manual_pricing: true,
            detail: { year_month: orderYearMonth, monthly_total, tier, heaviest_weight_gram: heaviestGram, heaviest_weight_lbs: lbsRounded, weight_bracket: null, base_rate: null, total_items: totalItems, extra_items: extraItems, extra_fee: extraFee, computed_at: new Date().toISOString() },
        };
    }

    const bracket  = COST_BRACKETS[bracketIdx];
    const baseRate = COST_RATES[tier - 1][bracketIdx];
    return {
        fee_purchase: _round4(baseRate + extraFee),
        needs_manual_pricing: false,
        detail: { year_month: orderYearMonth, monthly_total, tier, heaviest_weight_gram: heaviestGram, heaviest_weight_lbs: lbsRounded, weight_bracket: bracket.id, base_rate: baseRate, total_items: totalItems, extra_items: extraItems, extra_fee: extraFee, computed_at: new Date().toISOString() },
    };
}

module.exports = {
    computeFulfillmentFeeCost,
    computeFulfillmentFeeCostFromTier,
    getMonthlyTier,
    COST_BRACKETS,
    COST_RATES,
    EXTRA_ITEM_FEE_COST,
};
