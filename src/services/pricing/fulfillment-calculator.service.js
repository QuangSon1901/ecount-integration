// src/services/pricing/fulfillment-calculator.service.js
//
// Tính fulfillment_fee_selling theo bracket weight + extra item fee.
// Spec: ai-tasks/oms-pricing.md §2.

const GRAMS_PER_LB = 453.592;

// Bracket lookup theo weight bracket (lbs).
// `max` là cận trên inclusive; cận dưới luôn là `> max của bracket trước`.
// Bracket cuối (>10) không có rate — admin nhập tay.
const BRACKETS = [
    { id: 1, max: 2,  rate: 1.20 },
    { id: 2, max: 4,  rate: 1.70 },
    { id: 3, max: 6,  rate: 2.20 },
    { id: 4, max: 8,  rate: 2.70 },
    { id: 5, max: 10, rate: 3.20 },
];

const EXTRA_ITEM_FEE = 0.50;

function _roundCents(n) {
    return Math.round(n * 10000) / 10000;
}

/**
 * Tính fulfillment_fee_selling từ items array.
 *
 * @param {Array<{ quantity?: number, weight?: number }>} items — weight đơn vị gram
 * @returns {{
 *   fee_selling: number|null,
 *   needs_manual_pricing: boolean,
 *   detail: object|null
 * }}
 */
function computeFulfillmentFeeSelling(items) {
    // Edge case 1: rỗng / null
    if (!Array.isArray(items) || items.length === 0) {
        return { fee_selling: null, needs_manual_pricing: false, detail: null };
    }

    // Tìm heaviest weight (gram). Coi 0 / null như chưa có dữ liệu.
    let heaviestGram = 0;
    for (const it of items) {
        const w = Number(it?.weight);
        if (Number.isFinite(w) && w > heaviestGram) heaviestGram = w;
    }

    if (heaviestGram <= 0) {
        // Edge case: tất cả weight = 0 hoặc NULL → chưa đủ dữ liệu, không quote được
        return { fee_selling: null, needs_manual_pricing: false, detail: null };
    }

    const heaviestLbs = heaviestGram / GRAMS_PER_LB;
    const lbsRounded  = Math.round(heaviestLbs * 1000) / 1000;

    // Lookup bracket
    let bracket = null;
    for (const b of BRACKETS) {
        if (heaviestLbs <= b.max) { bracket = b; break; }
    }

    // Tổng quantity
    let totalItems = 0;
    for (const it of items) {
        const q = Number(it?.quantity);
        if (Number.isFinite(q) && q > 0) totalItems += q;
    }
    if (totalItems < 1) totalItems = 1;
    const extraItems = Math.max(0, totalItems - 1);
    const extraFee   = _roundCents(extraItems * EXTRA_ITEM_FEE);

    // Bracket 6 (>10 lbs): admin quote tay
    if (!bracket) {
        return {
            fee_selling: null,
            needs_manual_pricing: true,
            detail: {
                heaviest_weight_gram: heaviestGram,
                heaviest_weight_lbs:  lbsRounded,
                bracket:    6,
                base_rate:  null,
                total_items: totalItems,
                extra_items: extraItems,
                extra_fee:   extraFee,
            },
        };
    }

    const fee = _roundCents(bracket.rate + extraFee);

    return {
        fee_selling: fee,
        needs_manual_pricing: false,
        detail: {
            heaviest_weight_gram: heaviestGram,
            heaviest_weight_lbs:  lbsRounded,
            bracket:    bracket.id,
            base_rate:  bracket.rate,
            total_items: totalItems,
            extra_items: extraItems,
            extra_fee:   extraFee,
        },
    };
}

module.exports = {
    computeFulfillmentFeeSelling,
    BRACKETS,
    GRAMS_PER_LB,
    EXTRA_ITEM_FEE,
};
