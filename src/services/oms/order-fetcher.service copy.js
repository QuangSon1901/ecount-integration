// src/services/oms/order-fetcher.service.old.js (old)
//
// Pulls "New" orders from a customer's OMS over OAuth2-protected HTTP.
// PURE fetch + transform — no database writes. Phase 4 will add persistence.
//
// Endpoint contract (verified against ext-api.vnfai.com):
//   GET {oms_url_api}/api/v1/ors
//   Query: Statuses=New&FromDate=YYYY-MM-DD&ToDate=YYYY-MM-DD
//          &PageIndex=<n>&PageSize=<n>&WithProduct=true
//   Pagination: 0-based PageIndex; response includes hasNextPage / totalPages.
//
// _parsePage tolerates a few common pagination shapes so the fetcher works
// against more than one OMS variant without code changes.

const axios = require('axios');
const omsAuth = require('./auth.service');
const logger = require('../../utils/logger');

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 50;          // safety cap (≤5000 orders/customer/run)
const DEFAULT_LOOKBACK_DAYS = 7;
const FETCH_TIMEOUT_MS = 30_000;

class OmsOrderFetcherService {
    /**
     * Fetch all OMS orders matching status=New within the lookback window
     * for a single customer. Walks pagination until exhausted or capped.
     *
     * @param {object} customer - api_customers row
     * @param {object} [options]
     * @param {number} [options.lookbackDays=7]
     * @param {number} [options.pageSize=100]
     * @param {number} [options.maxPages=50]
     * @returns {Promise<{orders: object[], pagesFetched: number, skipped?: string}>}
     */
    async fetchNewOrders(customer, options = {}) {
        const lookbackDays = options.lookbackDays || DEFAULT_LOOKBACK_DAYS;
        const pageSize = options.pageSize || DEFAULT_PAGE_SIZE;
        const maxPages = options.maxPages || DEFAULT_MAX_PAGES;

        if (!omsAuth.isConfigured(customer)) {
            return { orders: [], pagesFetched: 0, skipped: 'NOT_CONFIGURED' };
        }
        if (!customer.oms_url_api) {
            return { orders: [], pagesFetched: 0, skipped: 'NO_API_URL' };
        }

        const now = new Date();
        const from = new Date(now.getTime() - lookbackDays * 24 * 3600 * 1000);
        // OMS expects date-only (YYYY-MM-DD), not full ISO timestamp
        const fromStr = from.toISOString().slice(0, 10);
        const toStr = now.toISOString().slice(0, 10);

        const baseUrl = customer.oms_url_api.replace(/\/+$/, '');
        const ordersUrl = `${baseUrl}/api/v1/ors`;

        const allOrders = [];
        let page = 0;                    // OMS uses 0-based pageIndex
        let pagesFetched = 0;

        while (page < maxPages) {
            const params = {
                Statuses: 'New',
                FromDate: fromStr,
                ToDate: toStr,
                PageIndex: page,
                PageSize: pageSize,
                WithProduct: true,
            };

            let response;
            try {
                const headers = await omsAuth.getAuthHeaders(customer.id);
                response = await axios.get(ordersUrl, {
                    headers,
                    params,
                    timeout: FETCH_TIMEOUT_MS,
                });
            } catch (err) {
                // 401 from OMS API → cached token may have been revoked server-side
                // even though we still consider it fresh. Force refresh once.
                if (err.response?.status === 401) {
                    logger.warn('[OMS-SYNC] 401 from OMS, invalidating cached token', {
                        customerId: customer.id,
                        customerCode: customer.customer_code,
                        page,
                    });
                    await omsAuth.invalidate(customer.id);
                    const freshHeaders = await omsAuth.getAuthHeaders(customer.id);
                    response = await axios.get(ordersUrl, {
                        headers: freshHeaders,
                        params,
                        timeout: FETCH_TIMEOUT_MS,
                    });
                } else {
                    throw err;
                }
            }

            const { items, hasNext } = this._parsePage(response.data, pageSize);
            pagesFetched++;

            for (const raw of items) {
                allOrders.push(this.normalize(raw, customer));
            }

            if (!hasNext || items.length === 0) break;
            page++;
        }

        if (page >= maxPages) {
            logger.warn('[OMS-SYNC] hit maxPages cap — possibly truncated', {
                customerCode: customer.customer_code,
                maxPages,
                ordersCollected: allOrders.length,
            });
        }

        return { orders: allOrders, pagesFetched };
    }

    /**
     * Tolerant page parser. Recognized shapes:
     *
     *   A) { data: [...], pagination: { page, pageSize, total, totalPages } }
     *   B) { items: [...], pageIndex, totalPages, hasNextPage }   ← vnfai OMS
     *   C) { items: [...], total }                                 ← generic
     *   D) [...] (top-level array)
     *
     * Returns { items, hasNext }. Prefers explicit server hints
     * (hasNextPage / totalPages) and falls back to the
     * "items.length >= pageSize" heuristic only when nothing else is available.
     */
    _parsePage(payload, pageSize) {
        if (!payload || typeof payload !== 'object') {
            return { items: [], hasNext: false };
        }

        // Shape A — { data, pagination }
        if (Array.isArray(payload.data)) {
            const items = payload.data;
            const pag = payload.pagination || {};
            const totalPages = Number(pag.totalPages || pag.total_pages || 0);
            const currentPage = Number(pag.page || pag.current_page || 1);
            let hasNext;
            if (totalPages > 0) {
                hasNext = currentPage < totalPages;
            } else {
                hasNext = items.length >= pageSize;
            }
            return { items, hasNext };
        }

        // Shape B / C — { items, ... }
        if (Array.isArray(payload.items)) {
            const items = payload.items;

            // Prefer explicit server hint (vnfai OMS provides this)
            if (typeof payload.hasNextPage === 'boolean') {
                return { items, hasNext: payload.hasNextPage };
            }

            // Fall back to totalPages + pageIndex (0-based)
            const totalPages = Number(payload.totalPages || 0);
            if (totalPages > 0) {
                const currentPage = Number(payload.pageIndex ?? payload.page ?? 0);
                return { items, hasNext: currentPage < totalPages - 1 };
            }

            // Last resort heuristic
            return { items, hasNext: items.length >= pageSize };
        }

        // Shape D — bare array
        if (Array.isArray(payload)) {
            return { items: payload, hasNext: payload.length >= pageSize };
        }

        return { items: [], hasNext: false };
    }

    /**
     * Map raw OMS order → internal normalized shape that Phase 4 storage
     * will consume. Defensive against missing fields.
     *
     * Field mapping verified against vnfai OMS response:
     *   orId, orCode, partnerORCode, refCode, status,
     *   customerName, customerPhoneNumber, shippingFullAddress,
     *   codAmount, expectedDeliveryTime, createdDate, updatedDate,
     *   details[] with: sku, partnerSKU, orderQty, price, unitCode, ...
     */
    normalize(raw, customer) {
        const r = raw || {};
        const items = Array.isArray(r.details)
            ? r.details
            : (Array.isArray(r.items)
                ? r.items
                : (Array.isArray(r.lineItems) ? r.lineItems : []));

        return {
            // Identity / source mapping
            customerId: customer.id,
            customerCode: customer.customer_code,
            omsOrderId: r.orId ?? r.id ?? r.order_id ?? r.orderId ?? null,
            omsOrderNumber: r.orCode || r.orderNumber || r.order_number || r.code || null,
            customerOrderNumber:
                r.partnerORCode
                || r.customerOrderNumber
                || r.customer_order_number
                || null,
            platformOrderNumber:
                r.refCode
                || r.platformOrderNumber
                || r.platform_order_number
                || null,

            // OMS-side state
            omsStatus: r.status || null,
            omsType: r.orType ?? null,
            omsTypeName: r.orTypeName || null,
            warehouseCode: r.warehouseCode || null,
            shippingType: r.shippingType ?? null,
            priorityType: r.priorityType ?? null,
            packType: r.packType ?? null,
            bizType: r.bizType ?? null,
            note: r.note || null,
            omsCreatedAt: r.createdDate || r.createdAt || r.created_at || null,
            omsUpdatedAt: r.updatedDate || r.updatedAt || r.updated_at || null,
            expectedDeliveryAt: r.expectedDeliveryTime || null,

            // Receiver — vnfai OMS returns these as flat top-level fields
            // plus a single concatenated `shippingFullAddress` string.
            // Phase 4 can parse the address string further if needed.
            receiver: {
                name: r.customerName || null,
                phone: r.customerPhoneNumber || null,
                email: r.customerEmail || null,
                fullAddress: r.shippingFullAddress || null,
                // Structured fields kept for compatibility with other OMS variants
                country: null,
                state: null,
                city: null,
                postalCode: null,
                addressLine1: null,
                addressLine2: null,
            },

            // Financials
            codAmount: r.codAmount != null ? Number(r.codAmount) : null,
            codCurrency: r.codCurrency || r.currency || null,

            // Package / declaration (kept for non-vnfai OMS variants)
            weight: r.weight ?? null,
            weightUnit: r.weightUnit || r.weight_unit || 'KG',
            length: r.length ?? null,
            width: r.width ?? null,
            height: r.height ?? null,
            sizeUnit: r.sizeUnit || r.size_unit || 'CM',
            declaredValue: r.declaredValue ?? r.declared_value ?? null,
            declaredCurrency: r.declaredCurrency || r.currency || 'USD',

            // Line items
            items: items.map(it => ({
                sku: it.sku || it.SKU || null,
                partnerSku: it.partnerSKU || it.partner_sku || null,
                name: it.name || it.title || it.categoryName || null,
                categoryCode: it.categoryCode || null,
                categoryName: it.categoryName || null,
                unitCode: it.unitCode || null,
                conditionTypeCode: it.conditionTypeCode || null,
                quantity: Number(it.orderQty ?? it.quantity ?? it.qty ?? 1),
                packedQty: it.packedQty != null ? Number(it.packedQty) : null,
                unitPrice: Number(it.price ?? it.unitPrice ?? it.unit_price ?? 0),
                discountValue: it.discountValue != null ? Number(it.discountValue) : 0,
                paymentAmount: it.paymentAmount != null ? Number(it.paymentAmount) : null,
                weight: it.weight ?? null,
                serials: it.serials || null,
                note: it.note || null,
            })),

            holdInfo: r.holdInfo || null,

            // Raw payload preserved so Phase 4 can do customer-specific
            // re-mapping or store the original for audit.
            raw: r,
        };
    }
}

module.exports = new OmsOrderFetcherService();