// src/services/oms/order-fetcher.service.js
//
// Pulls ALL "New" orders (no tracking) from the admin OMS API, then enriches
// each matched order with three additional calls:
//
//   1. GET /OutboundRequests/{orId}?isFullDetail=true
//      → orDetails (SKUs/items), customerEmail, shippingServiceId/Name, cutOffTime, etc.
//
//   2. GET /OutboundRequests/{orId}/update-attributes?type=0
//      → structured address inside response.addressInfo:
//        shippingCountryCode, shippingPostalCode,
//        shippingStateName, shippingAddressNo, shippingAddressNo2, etc.
//
//   3. Per-customer ext-api: GET /api/v1/Products/{sku}  (via omsProductFetcher)
//      → package dimensions (weight, length, width, height) from units[0]
//      → also resolves customerId / customerCode via partnerCode → api_customers
//
// The browser is never opened here — auth token comes from the cron's
// Playwright login flow (sync-oms-orders.cron.js).

const axios = require('axios');
const logger = require('../../utils/logger');
const omsProductFetcher = require('./product-fetcher.service');

const BASE_URL        = 'https://client-api.vnfai.com';
const ORDERS_ENDPOINT = `${BASE_URL}/OutboundRequests/search`;
const ORIGIN_HEADER   = 'https://admin.thgfulfill.com';

const DEFAULT_PAGE_SIZE      = 50;
const DEFAULT_MAX_PAGES      = 200;
const DEFAULT_LOOKBACK_DAYS  = 30;
const DEFAULT_UTC_OFFSET_MIN = 420;   // GMT+7 (Vietnam)
const FETCH_TIMEOUT_MS       = 30_000;
const DETAIL_TIMEOUT_MS      = 15_000;
const DETAIL_CONCURRENCY     = 5;     // parallel detail calls per batch

const TARGET_STATUS_NAME = 'New';

class OmsOrderFetcherService {
    /**
     * Fetch ALL "New" orders without a tracking code, then enrich each with:
     *   - full detail + structured address (two extra calls per order)
     *   - package dimensions via per-customer product API
     *   - customerId / customerCode resolved from partnerCode → api_customers
     *
     * @param {object} options
     * @param {string}  options.accessToken        - REQUIRED
     * @param {string}  [options.tokenType]
     * @param {number}  [options.lookbackDays]
     * @param {number}  [options.pageSize]
     * @param {number}  [options.maxPages]
     * @param {number}  [options.utcOffsetMinutes]
     * @returns {Promise<{orders, pagesFetched, rawCount}>}
     */
    async fetchNewOrders(options = {}) {
        const accessToken  = options.accessToken;
        const tokenType    = options.tokenType        || 'Bearer';
        const lookbackDays = options.lookbackDays     || DEFAULT_LOOKBACK_DAYS;
        const pageSize     = options.pageSize         || DEFAULT_PAGE_SIZE;
        const maxPages     = options.maxPages         || DEFAULT_MAX_PAGES;
        const utcOffsetMin = options.utcOffsetMinutes || DEFAULT_UTC_OFFSET_MIN;

        if (!accessToken) {
            return { orders: [], pagesFetched: 0, rawCount: 0, skipped: 'NO_ACCESS_TOKEN' };
        }

        const nowSec  = Math.floor(Date.now() / 1000);
        const fromSec = nowSec - lookbackDays * 24 * 3600;

        const headers = this._buildHeaders(tokenType, accessToken);

        // ─── Step 1: paginated list fetch ─────────────────────────────────────
        const allRaw = [];
        let page = 0;
        let pagesFetched = 0;

        while (page < maxPages) {
            const params = {
                PageSize:       pageSize,
                PageIndex:      page,
                UtcOffsetValue: utcOffsetMin,
                FromDate:       fromSec,
                ToDate:         nowSec,
                Statuses:       1,
            };

            let response;
            try {
                response = await axios.get(ORDERS_ENDPOINT, {
                    headers,
                    params,
                    timeout: FETCH_TIMEOUT_MS,
                });
            } catch (err) {
                if (err.response?.status === 401) {
                    logger.warn('[OMS-FETCHER] 401 on list fetch', { page });
                }
                throw err;
            }

            const { items, hasNext } = this._parsePage(response.data, pageSize);
            pagesFetched++;
            allRaw.push(...items);

            if (!hasNext || items.length === 0) break;
            page++;
        }

        if (page >= maxPages) {
            logger.warn('[OMS-FETCHER] hit maxPages cap — possibly truncated', {
                maxPages,
                rawCollected: allRaw.length,
            });
        }

        // ─── Step 2: filter — "New" + no tracking code ────────────────────────
        const candidates = allRaw.filter(r => {
            const status      = String(r.orStatusName || '').trim();
            const hasTracking = r.trackingCode != null
                && String(r.trackingCode).trim() !== '';
            return status === TARGET_STATUS_NAME && !hasTracking;
        });

        logger.info('[OMS-FETCHER] list fetch complete', {
            pagesFetched,
            rawCount:       allRaw.length,
            newCount:       allRaw.filter(r =>
                String(r.orStatusName || '').trim() === TARGET_STATUS_NAME
            ).length,
            candidateCount: candidates.length,
        });

        if (candidates.length === 0) {
            return { orders: [], pagesFetched, rawCount: allRaw.length };
        }

        // ─── Step 3: enrich each candidate with detail + address ──────────────
        const orders = await this._enrichBatch(candidates, headers);

        // ─── Step 4: enrich dimensions + resolve customerId per partner ────────
        // omsProductFetcher groups orders by partnerCode internally, auths once
        // per partner, then fetches SKU dimensions and writes customerId back.
        await omsProductFetcher.enrichDimensions(orders);

        logger.info('[OMS-FETCHER] enrichment complete', {
            candidateCount: candidates.length,
            enrichedCount:  orders.length,
        });

        return { orders, pagesFetched, rawCount: allRaw.length };
    }

    // ─── Detail enrichment ────────────────────────────────────────────────────

    /**
     * Enrich a list of raw list-endpoint rows in parallel batches of DETAIL_CONCURRENCY.
     * Orders that fail enrichment are still returned with partial data.
     */
    async _enrichBatch(raws, headers) {
        const results = [];

        for (let i = 0; i < raws.length; i += DETAIL_CONCURRENCY) {
            const slice    = raws.slice(i, i + DETAIL_CONCURRENCY);
            const enriched = await Promise.all(
                slice.map(raw => this._enrichOne(raw, headers))
            );
            results.push(...enriched);
        }

        return results;
    }

    /**
     * Fetch full detail + structured address for one order, then normalize.
     * Never throws — logs errors and falls back to list-level data.
     */
    async _enrichOne(raw, headers) {
        const orId = raw.orId;
        let detail  = null;
        let address = null;

        // ── Full detail (items, email, shipping service, etc.) ───────────────
        try {
            const res = await axios.get(
                `${BASE_URL}/OutboundRequests/${orId}`,
                {
                    headers,
                    params:  { isFullDetail: true },
                    timeout: DETAIL_TIMEOUT_MS,
                }
            );
            detail = res.data || null;
        } catch (err) {
            logger.warn('[OMS-FETCHER] detail fetch failed', {
                orId,
                status: err.response?.status,
                error:  err.message,
            });
        }

        // ── Structured address (country code, postal code, state, etc.) ──────
        try {
            const res = await axios.get(
                `${BASE_URL}/OutboundRequests/${orId}/update-attributes`,
                {
                    headers,
                    params:  { type: 0 },
                    timeout: DETAIL_TIMEOUT_MS,
                }
            );
            address = res.data || null;
        } catch (err) {
            logger.warn('[OMS-FETCHER] address fetch failed', {
                orId,
                status: err.response?.status,
                error:  err.message,
            });
        }

        return this.normalize(raw, detail, address);
    }

    // ─── Normalize ────────────────────────────────────────────────────────────

    /**
     * Merge list-row + full-detail + address-attributes → internal shape.
     *
     * Sources:
     *   raw     — /OutboundRequests/search                        (always present)
     *   detail  — /OutboundRequests/{id}?isFullDetail=true        (may be null)
     *   address — /OutboundRequests/{id}/update-attributes?type=0 (may be null)
     *             ↳ structured fields live inside address.addressInfo
     *
     * Note: customerId / customerCode start as null here and are filled in
     * later by omsProductFetcher.enrichDimensions() via partnerCode lookup.
     */
    normalize(raw, detail = null, address = null) {
        const r  = raw    || {};
        const d  = detail || {};
        const wh = (d.warehouse || r.warehouse) || {};

        // The update-attributes endpoint wraps structured fields inside
        // response.addressInfo — fall back to the root object for resilience
        // in case the shape ever changes.
        const a = (address && address.addressInfo)
            ? address.addressInfo
            : (address || {});

        const labels = Array.isArray(r.orShippingLabels) ? r.orShippingLabels : [];
        const primaryLabelUri = labels[0]?.shippingLabelUri || null;

        // ── Items from orDetails (detail endpoint only) ────────────────────────
        const items = Array.isArray(d.orDetails)
            ? d.orDetails.map(item => ({
                productId:         item.productId         ?? null,
                sku:               item.sku               || item.partnerSKU || null,
                partnerSku:        item.partnerSKU        || null,
                productName:       item.productName       || null,
                quantity:          item.orderQty          ?? null,
                packedQty:         item.packedQty         ?? null,
                unitId:            item.unitId            ?? null,
                unitName:          item.unitName          || null,
                conditionTypeId:   item.conditionTypeId   ?? null,
                conditionTypeName: item.conditionTypeName || null,
                price:             item.price             ?? null,
                discountAmount:    item.discountAmount    ?? null,
                totalAmount:       item.totalAmount       ?? null,
                avatarUrl:         item.avatarURL         || null,
            }))
            : [];

        // ── Receiver — addressInfo has the richest structured fields ───────────
        //
        // Field mapping from address.addressInfo:
        //   shippingAddressNo      → addressLine1
        //   shippingAddressNo2     → addressLine2
        //   shippingDistrictName   → city
        //   shippingStateName      → state
        //   shippingPostalCode     → postalCode
        //   shippingCountryCode    → country
        const receiver = {
            name:         a.customerName        || r.customerName        || null,
            phone:        a.customerPhoneNumber || d.customerPhoneNumber || r.customerPhoneNumber || null,
            email:        a.customerEmail       || d.customerEmail       || null,
            fullAddress:  a.shippingFullAddress || r.shippingFullAddress || null,

            // Structured fields — populated from addressInfo
            addressLine1: a.shippingAddressNo    || null,
            addressLine2: a.shippingAddressNo2   || null,
            city:         a.shippingDistrictName || null,
            state:        a.shippingStateName    || null,
            postalCode:   a.shippingPostalCode   || null,
            country:      a.shippingCountryCode  || null,

            // IDs for potential re-validation
            provinceId:  a.shippingProvinceId  ?? null,
            districtId:  a.shippingDistrictId  ?? null,
            wardId:      a.shippingWardId      ?? null,
            stateId:     a.shippingStateId     ?? null,
            stateCode:   a.shippingStateCode   || null,

            // Extra from list endpoint
            provinceName:    r.provinceName                || null,
            twoLevelAddress: r.twoLevelShippingFullAddress || null,
        };

        return {
            // Identity
            // customerId / customerCode are null here — resolved in Step 4
            // (omsProductFetcher.enrichDimensions) via partnerCode → api_customers.
            customerId:               null,
            customerCode:             null,
            omsOrderId:               r.orId  ?? null,
            omsOrderNumber:           r.orCode || null,
            customerOrderNumber:      r.partnerORCode || r.originalPartnerOrCode || null,
            originalPartnerOrderCode: r.originalPartnerOrCode || null,
            platformOrderNumber:      null,

            // Partner
            partnerId:   r.partnerId   ?? null,
            partnerCode: r.partnerCode || null,
            partnerName: r.partnerName || null,

            // OMS state
            omsStatus:     r.orStatusName  || null,
            omsStatusCode: r.orStatus      ?? null,
            omsType:       r.orType        ?? null,
            omsTypeName:   r.orTypeName    || null,
            tplOrderState: r.tplOrderState ?? null,
            errorMessage:  d.errorMessage  || r.errorMessage || null,
            numOfTicket:   r.numOfTicket   ?? 0,

            // Shipping service (detail only)
            shippingServiceId:   d.shippingServiceId   ?? null,
            shippingServiceName: d.shippingServiceName || null,
            shippingType:        d.shippingType        ?? a.shippingType ?? null,
            cutOffTime:          d.cutOffTime          || null,

            // Warehouse
            warehouseId:   r.warehouseId   ?? wh.warehouseId  ?? null,
            warehouseCode: wh.warehouseCode || null,
            warehouseName: wh.warehouseName || null,

            // Sales channel
            saleChannelId:       r.saleChannelId      ?? null,
            saleChannelCode:     r.saleChannelCode     || null,
            saleChannelName:     r.saleChannelName     || null,
            saleChannelShopName: r.saleChannelShopName || null,
            saleChannelShopCode: r.saleChannelShopCode || null,

            // Dates
            omsCreatedAt:         r.createdDate          || null,
            omsOriginalCreatedAt: r.originalCreatedDate  || null,
            omsUpdatedAt:         r.updatedDate          || null,
            expectedDeliveryAt:   r.expectedDeliveryTime || null,

            // Receiver (enriched)
            receiver,

            // Financials
            codAmount:      r.codAmount != null ? Number(r.codAmount) : null,
            codCurrency:    null,
            totalAmount:    d.totalAmount    ?? null,
            discountAmount: d.discountAmount ?? null,
            paymentAmount:  d.paymentAmount  ?? null,

            // Package dimensions — null here, filled by omsProductFetcher.enrichDimensions()
            weight:           null,
            weightUnit:       'G',
            length:           null,
            width:            null,
            height:           null,
            sizeUnit:         'CM',
            declaredValue:    null,
            declaredCurrency: 'USD',

            // Tracking / labels
            trackingCode:    r.trackingCode || null,
            primaryLabelUri,
            labels: labels.map(l => ({
                caption: l.caption          || null,
                uri:     l.shippingLabelUri || null,
            })),

            // Line items (enriched from detail)
            items,

            // Misc
            note:              d.note              || null,
            packingNote:       d.packingNote       || null,
            holdInfo:          null,
            conditionTypeId:   r.conditionTypeId   ?? null,
            conditionTypeName: r.conditionTypeName || null,

            // Raw payloads preserved for audit / re-mapping
            raw: { list: r, detail: d, address: address || {} },
        };
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    _buildHeaders(tokenType, accessToken) {
        return {
            Authorization:     `${tokenType} ${accessToken}`,
            Accept:            'application/json, text/plain, */*',
            'Accept-Language': 'en-US',
            Origin:            ORIGIN_HEADER,
            Referer:           ORIGIN_HEADER + '/',
        };
    }

    /**
     * Tolerant page parser. Recognized shapes:
     *   A) { data: [...], pagination: { page, pageSize, total, totalPages } }
     *   B) { items: [...], pageIndex, totalPages, hasNextPage }  ← vnfai admin API
     *   C) { items: [...], total }
     *   D) [...] (bare array)
     */
    _parsePage(payload, pageSize) {
        if (!payload || typeof payload !== 'object') {
            return { items: [], hasNext: false };
        }

        if (Array.isArray(payload.data)) {
            const items = payload.data;
            const pag = payload.pagination || {};
            const totalPages  = Number(pag.totalPages || pag.total_pages || 0);
            const currentPage = Number(pag.page || pag.current_page || 1);
            const hasNext = totalPages > 0
                ? currentPage < totalPages
                : items.length >= pageSize;
            return { items, hasNext };
        }

        if (Array.isArray(payload.items)) {
            const items = payload.items;

            if (typeof payload.hasNextPage === 'boolean') {
                return { items, hasNext: payload.hasNextPage };
            }

            const totalPages = Number(payload.totalPages || 0);
            if (totalPages > 0) {
                const currentPage = Number(payload.pageIndex ?? payload.page ?? 0);
                return { items, hasNext: currentPage < totalPages - 1 };
            }

            return { items, hasNext: items.length >= pageSize };
        }

        if (Array.isArray(payload)) {
            return { items: payload, hasNext: payload.length >= pageSize };
        }

        return { items: [], hasNext: false };
    }
}

module.exports = new OmsOrderFetcherService();