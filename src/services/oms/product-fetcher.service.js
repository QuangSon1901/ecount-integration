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
     * Enrich a batch of normalized orders with product dimensions.
     * Mutates each order in-place (weight, length, width, height, weightUnit).
     * Orders without a resolvable customer or matching product keep null dims.
     *
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
                // Attach resolved customerId = null (already null, nothing to do)
                continue;
            }

            // Write customerId / customerCode back onto each order now that we
            // have the customer row — this is the earliest point we can do it.
            for (const order of partnerOrders) {
                order.customerId   = customer.id;
                order.customerCode = customer.customer_code || null;
            }

            // Collect unique SKUs across all orders for this partner
            const skuToOrders = new Map(); // sku → order[]
            for (const order of partnerOrders) {
                for (const item of (order.items || [])) {
                    const sku = item.sku || item.partnerSku;
                    if (!sku) continue;
                    if (!skuToOrders.has(sku)) skuToOrders.set(sku, []);
                    skuToOrders.get(sku).push(order);
                }
            }

            const skus = [...skuToOrders.keys()];

            // Fetch product details in parallel batches of PRODUCT_CONCURRENCY
            for (let i = 0; i < skus.length; i += PRODUCT_CONCURRENCY) {
                const slice = skus.slice(i, i + PRODUCT_CONCURRENCY);
                await Promise.all(
                    slice.map(async (sku) => {
                        const product    = await this.fetchProductBySku(customer, sku);
                        const dimensions = this.extractDimensions(product);

                        if (!dimensions) return;

                        // Apply dimensions to all orders that carry this SKU.
                        // If an order has multiple SKUs, the last one wins —
                        // acceptable for now; a multi-SKU aggregation strategy
                        // can be added later.
                        for (const order of skuToOrders.get(sku)) {
                            order.weight     = dimensions.weight;
                            order.length     = dimensions.length;
                            order.width      = dimensions.width;
                            order.height     = dimensions.height;
                            order.weightUnit = dimensions.weightUnit;
                            order.sizeUnit   = dimensions.sizeUnit;
                        }
                    })
                );
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