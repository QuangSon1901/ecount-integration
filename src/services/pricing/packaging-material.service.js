// src/services/pricing/packaging-material.service.js
//
// Tính packaging_material_fee_selling từ items + customer.
// Spec: ai-tasks/oms-pricing.md §3.

const OmsSkuPackagingMappingModel = require('../../models/oms-sku-packaging-mapping.model');

function _round(n) {
    return Math.round(n * 10000) / 10000;
}

/**
 * @param {Array<{ sku?: string, skuNumber?: string, quantity?: number }>} items
 * @param {number|null} customerId
 * @returns {Promise<{ total: number, detail: Array<object> }>}
 */
async function computePackagingFee(items, customerId) {
    if (!Array.isArray(items) || items.length === 0) {
        return { total: 0, detail: [] };
    }

    const skus = [];
    for (const it of items) {
        const sku = (it?.sku || it?.skuNumber || '').toString().trim();
        if (sku && !skus.includes(sku)) skus.push(sku);
    }
    if (skus.length === 0) return { total: 0, detail: [] };

    const mappingMap = await OmsSkuPackagingMappingModel.lookupBySkus(skus, customerId || null);

    const detail = [];
    let total = 0;

    for (const it of items) {
        const sku = (it?.sku || it?.skuNumber || '').toString().trim();
        if (!sku) continue;
        const map = mappingMap.get(sku);
        if (!map) continue;

        const qty       = Math.max(0, Number(it?.quantity) || 0);
        if (qty <= 0) continue;
        const sellPrice = Number(map.material_sell_price) || 0;
        const subtotal  = _round(sellPrice * qty);
        total += subtotal;

        detail.push({
            sku,
            material_id:   map.material_id,
            material_name: map.material_name,
            sell_price:    sellPrice,
            quantity:      qty,
            subtotal,
        });
    }

    return { total: _round(total), detail };
}

/**
 * Tính packaging_material_fee_cost từ items + customer.
 * Giống computePackagingFee nhưng dùng cost_price thay vì sell_price.
 * Bỏ qua items có cost_price = NULL.
 *
 * @param {Array<{ sku?: string, skuNumber?: string, quantity?: number }>} items
 * @param {number|null} customerId
 * @returns {Promise<{ total: number, detail: Array<object> }>}
 */
async function computePackagingFeeCost(items, customerId) {
    if (!Array.isArray(items) || items.length === 0) {
        return { total: 0, detail: [] };
    }

    const skus = [];
    for (const it of items) {
        const sku = (it?.sku || it?.skuNumber || '').toString().trim();
        if (sku && !skus.includes(sku)) skus.push(sku);
    }
    if (skus.length === 0) return { total: 0, detail: [] };

    const mappingMap = await OmsSkuPackagingMappingModel.lookupBySkus(skus, customerId || null);

    const detail = [];
    let total = 0;

    for (const it of items) {
        const sku = (it?.sku || it?.skuNumber || '').toString().trim();
        if (!sku) continue;
        const map = mappingMap.get(sku);
        if (!map) continue;

        // Bỏ qua nếu cost_price = NULL
        if (map.material_cost_price === null || map.material_cost_price === undefined) continue;

        const qty       = Math.max(0, Number(it?.quantity) || 0);
        if (qty <= 0) continue;
        const costPrice = Number(map.material_cost_price);
        if (!Number.isFinite(costPrice)) continue;
        const subtotal  = _round(costPrice * qty);
        total += subtotal;

        detail.push({
            sku,
            material_id:   map.material_id,
            material_name: map.material_name,
            cost_price:    costPrice,
            quantity:      qty,
            subtotal,
        });
    }

    return { total: _round(total), detail };
}

module.exports = { computePackagingFee, computePackagingFeeCost };
