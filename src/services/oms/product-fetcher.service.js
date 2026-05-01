// src/services/oms/product-fetcher.service.js
//
// Fetches product details (weight, dimensions) from the customer OMS
// ext-api by SKU. Used during order enrichment to fill package dimensions.
//
// Auth uses the existing per-customer OAuth2 flow (omsAuth.service.js).
// If the customer cannot be resolved or auth fails, returns null — never throws.
//
// API contract (ext-api.vnfai.com):
//   GET /api/v1/Products/{sku}
//   Response: { productId, sku, units: [{ unitCode, length, width, height, weight }], ... }
//
// Dimensions are taken from units[0] (the primary/default unit).
// Weight is in grams (as returned by OMS) — stored as-is; callers may convert.
//
// Dimension assignment strategy:
//   - Each item in order.items[] gets its own { weight, length, width, height, weightUnit, sizeUnit }
//     set from the product API response for that item's SKU.
//   - Package-level dimensions (order.weight / length / width / height) are then
//     AGGREGATED from all items:
//       • weight  → sum of (item.weight × item.quantity) across all items that have weight
//       • length  → max of all item lengths   (longest side drives box size)
//       • width   → max of all item widths
//       • height  → sum of all item heights   (stacked assumption)
//     If NO item has any dimension, package fields stay null.

const axios = require('axios');
const omsAuth = require('./auth.service');
const ApiCustomerModel = require('../../models/api-customer.model');
const logger = require('../../utils/logger');

const PRODUCT_TIMEOUT_MS  = 10_000;
const PRODUCT_CONCURRENCY = 5;   // parallel SKU lookups per order batch

class OmsProductFetcherService {
    /**
     * Resolve a partnerCode → api_customers row.
     * Returns null if not found (no throw).
     *
     * Results are memoized for the lifetime of the process to avoid redundant
     * DB hits when the same partner appears across many orders in one sync run.
     */
    constructor() {
        this._customerCache = new Map(); // partnerCode → customer row | null
    }

    async resolveCustomer(partnerCode) {
        if (!partnerCode) return null;

        if (this._customerCache.has(partnerCode)) {
            return this._customerCache.get(partnerCode);
        }

        try {
            const customer = await ApiCustomerModel.findByCode(partnerCode);
            this._customerCache.set(partnerCode, customer || null);
            return customer || null;
        } catch (err) {
            logger.warn('[OMS-PRODUCT] customer lookup failed', {
                partnerCode,
                error: err.message,
            });
            this._customerCache.set(partnerCode, null);
            return null;
        }
    }

    /**
     * Fetch product details for a single SKU from the customer's OMS.
     * Returns the raw product object or null on any failure.
     *
     * @param {object} customer   - api_customers row (must have id, oms_url_api)
     * @param {string} sku
     * @returns {Promise<object|null>}
     */
    async fetchProductBySku(customer, sku) {
        if (!customer || !customer.id || !customer.oms_url_api || !sku) return null;

        if (!omsAuth.isConfigured(customer)) {
            logger.warn('[OMS-PRODUCT] customer OMS auth not configured', {
                customerId: customer.id,
                partnerCode: customer.partner_code || customer.customer_code,
            });
            return null;
        }

        const baseUrl    = customer.oms_url_api.replace(/\/+$/, '');
        const productUrl = `${baseUrl}/api/v1/Products/${encodeURIComponent(sku)}`;

        try {
            const headers  = await omsAuth.getAuthHeaders(customer.id);
            const response = await axios.get(productUrl, {
                headers,
                timeout: PRODUCT_TIMEOUT_MS,
            });
            return response.data || null;
        } catch (err) {
            logger.warn('[OMS-PRODUCT] product fetch failed', {
                customerId: customer.id,
                sku,
                status: err.response?.status,
                error:  err.message,
            });
            return null;
        }
    }

    /**
     * Extract normalized dimensions from a product API response.
     * Uses units[0] as the primary/default unit.
     *
     * @param {object|null} product  - raw product response
     * @returns {{ weight, length, width, height, weightUnit, sizeUnit } | null}
     */
    extractDimensions(product) {
        if (!product) return null;

        const unit = Array.isArray(product.units) && product.units.length > 0
            ? product.units[0]
            : null;

        if (!unit) return null;

        const weight = unit.weight != null ? Number(unit.weight) : null;
        const length = unit.length != null ? Number(unit.length) : null;
        const width  = unit.width  != null ? Number(unit.width)  : null;
        const height = unit.height != null ? Number(unit.height) : null;

        // All values null → nothing useful
        if (weight == null && length == null && width == null && height == null) {
            return null;
        }

        return {
            weight,
            length,
            width,
            height,
            weightUnit: 'G',    // OMS returns weight in grams
            sizeUnit:   'CM',
        };
    }

    /**
     * Aggregate item-level dimensions into package-level dimensions.
     *
     * Strategy:
     *   weight → sum of (item.weight × item.quantity) for items that have weight
     *   length → max across all items (longest side)
     *   width  → max across all items
     *   height → sum across all items × quantity (stacked)
     *
     * Returns null for any field where no item has a value.
     *
     * @param {object[]} items  - order.items[] after per-item dims are applied
     * @returns {{ weight, length, width, height, weightUnit, sizeUnit }}
     */
    _aggregatePackageDimensions(items) {
        let totalWeight = null;
        let maxLength   = null;
        let maxWidth    = null;
        let totalHeight = null;

        for (const item of items) {
            if (item.weight == null && item.length == null
                && item.width == null && item.height == null) {
                continue;
            }

            const qty = (item.quantity != null && item.quantity > 0) ? item.quantity : 1;

            if (item.weight != null) {
                totalWeight = (totalWeight ?? 0) + item.weight * qty;
            }
            if (item.length != null) {
                maxLength = Math.max(maxLength ?? 0, item.length);
            }
            if (item.width != null) {
                maxWidth = Math.max(maxWidth ?? 0, item.width);
            }
            if (item.height != null) {
                totalHeight = (totalHeight ?? 0) + item.height * qty;
            }
        }

        return {
            weight:     totalWeight,
            length:     maxLength,
            width:      maxWidth,
            height:     totalHeight,
            weightUnit: 'G',
            sizeUnit:   'CM',
        };
    }

    /**
     * Enrich a batch of normalized orders with product dimensions.
     *
     * Flow:
     *   1. For each partner, fetch product dims for every unique SKU.
     *   2. Write dims onto the matching item objects inside order.items[].
     *   3. Aggregate item dims → package-level fields on the order.
     *
     * Orders without a resolvable customer or matching product keep null dims.
     * Groups orders by partnerCode so we only auth once per partner per batch.
     *
     * @param {object[]} orders  - normalized order objects (post _enrichBatch)
     * @returns {Promise<void>}
     */
    async enrichDimensions(orders) {
        if (!orders || orders.length === 0) return;

        // Group orders by partnerCode — one auth token per partner
        const byPartner = new Map(); // partnerCode → order[]
        for (const order of orders) {
            const code = order.partnerCode || null;
            if (!byPartner.has(code)) byPartner.set(code, []);
            byPartner.get(code).push(order);
        }

        for (const [partnerCode, partnerOrders] of byPartner) {
            const customer = await this.resolveCustomer(partnerCode);

            if (!customer) {
                logger.debug('[OMS-PRODUCT] no customer found for partnerCode, skipping dims', {
                    partnerCode,
                    orderCount: partnerOrders.length,
                });
                continue;
            }

            // Write customerId / customerCode back onto each order now that we
            // have the customer row — this is the earliest point we can do it.
            for (const order of partnerOrders) {
                order.customerId   = customer.id;
                order.customerCode = customer.customer_code || null;
            }

            // Build a flat map: sku → Set<item references> across all orders
            // We need item references (not order references) so we can write
            // dims directly onto each item.
            const skuToItems = new Map(); // sku → item[]
            for (const order of partnerOrders) {
                for (const item of (order.items || [])) {
                    const sku = item.sku || item.partnerSku;
                    if (!sku) continue;
                    if (!skuToItems.has(sku)) skuToItems.set(sku, []);
                    skuToItems.get(sku).push(item);
                }
            }

            const skus = [...skuToItems.keys()];

            // ── Fetch product dims in parallel batches ──────────────────────
            for (let i = 0; i < skus.length; i += PRODUCT_CONCURRENCY) {
                const slice = skus.slice(i, i + PRODUCT_CONCURRENCY);
                await Promise.all(
                    slice.map(async (sku) => {
                        const product    = await this.fetchProductBySku(customer, sku);
                        const dimensions = this.extractDimensions(product);

                        if (!dimensions) return;

                        // ── Apply dims to each item that carries this SKU ──
                        for (const item of skuToItems.get(sku)) {
                            item.weight     = dimensions.weight;
                            item.length     = dimensions.length;
                            item.width      = dimensions.width;
                            item.height     = dimensions.height;
                            item.weightUnit = dimensions.weightUnit;
                            item.sizeUnit   = dimensions.sizeUnit;
                        }
                    })
                );
            }

            // ── Aggregate item dims → package-level dims per order ──────────
            // Runs after ALL SKU fetches for this partner are complete so every
            // item has had a chance to receive its dimensions first.
            for (const order of partnerOrders) {
                const pkg = this._aggregatePackageDimensions(order.items || []);
                order.weight     = pkg.weight;
                order.length     = pkg.length;
                order.width      = pkg.width;
                order.height     = pkg.height;
                order.weightUnit = pkg.weightUnit;
                order.sizeUnit   = pkg.sizeUnit;
            }

            logger.debug('[OMS-PRODUCT] dimensions enriched for partner', {
                partnerCode,
                orderCount: partnerOrders.length,
                skuCount:   skus.length,
            });
        }
    }
}

module.exports = new OmsProductFetcherService();