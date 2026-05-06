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
// Optimization (Step 2.5):
//   Before any detail/dimension API calls, bulk-check DB for existing omsOrderIds.
//   Only NEW orders (not yet in oms_orders table) proceed to enrichment.
//   This avoids N*3 redundant HTTP calls for orders already synced.
//
// The browser is never opened here — auth token comes from the cron's
// Playwright login flow (sync-oms-orders.cron.js).

const axios = require('axios');
const logger = require('../../utils/logger');
const omsProductFetcher = require('./product-fetcher.service');
const OmsOrderModel = require('../../models/oms-order.model');

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
     * Flow:
     *   1. Paginated list fetch from OMS
     *   2. Filter: status = "New" AND no trackingCode
     *   2.5. Bulk DB check → discard orders already in oms_orders (NEW STEP)
     *   3. Enrich ONLY new orders (detail + address API calls)
     *   4. Enrich dimensions + resolve customerId via product API
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

        // ─── Step 2.5: loại bỏ những đơn đã tồn tại trong DB ─────────────────
        // Bulk-check TRƯỚC khi gọi bất kỳ detail API nào.
        // Nếu 90/100 đơn đã có trong DB → tiết kiệm 90 × 3 = 270 HTTP calls.
        const newCandidates = await this._filterExistingOrders(candidates);

        logger.info('[OMS-FETCHER] pre-enrich DB filter', {
            candidateCount: candidates.length,
            alreadyInDb:    candidates.length - newCandidates.length,
            toEnrich:       newCandidates.length,
        });

        if (newCandidates.length === 0) {
            logger.info('[OMS-FETCHER] all candidates already in DB, nothing to enrich');
            return { orders: [], pagesFetched, rawCount: allRaw.length };
        }

        // ─── Step 3: enrich CHỈ những đơn chưa có trong DB ───────────────────
        const orders = await this._enrichBatch(newCandidates, headers);
        
        // ─── Step 4: enrich dimensions + resolve customerId per partner ────────
        // omsProductFetcher groups orders by partnerCode internally, auths once
        // per partner, then fetches SKU dimensions and writes customerId back.
        await omsProductFetcher.enrichDimensions(orders);

        logger.info('[OMS-FETCHER] enrichment complete', {
            candidateCount: candidates.length,
            newCandidates:  newCandidates.length,
            enrichedCount:  orders.length,
        });

        return { orders, pagesFetched, rawCount: allRaw.length };
    }

    // ─── Pre-enrich DB filter ─────────────────────────────────────────────────

    /**
     * Nhận vào list raw orders từ OMS list endpoint,
     * trả về CHỈ những đơn chưa tồn tại trong oms_orders table.
     *
     * Dùng một bulk query IN(...) duy nhất thay vì N lần findByOmsId
     * để tránh N+1 DB round trips.
     *
     * Safe degradation: nếu DB check lỗi → fallback trả về toàn bộ raws
     * (worst case enrich thừa như cũ, không mất data).
     *
     * @param {object[]} raws  - raw list-endpoint rows (cần có .orId)
     * @returns {Promise<object[]>}
     */
    async _filterExistingOrders(raws) {
        if (raws.length === 0) return [];

        const omsIds = raws.map(r => r.orId).filter(id => id != null);
        if (omsIds.length === 0) return raws;

        try {
            const existingIds = await OmsOrderModel.findExistingOmsIds(omsIds);

            // Normalize về string để tránh type mismatch (DB trả string, OMS trả number)
            const existingSet = new Set(existingIds.map(id => String(id)));

            const filtered = raws.filter(r => !existingSet.has(String(r.orId)));

            if (existingIds.length > 0) {
                logger.debug('[OMS-FETCHER] skipped existing orders', {
                    existingCount:  existingIds.length,
                    remainingCount: filtered.length,
                });
            }

            return filtered;
        } catch (err) {
            logger.warn('[OMS-FETCHER] DB pre-filter failed, falling back to enrich all candidates', {
                error: err.message,
            });
            return raws;
        }
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
            shippingPartner:     this._mapShippingPartner(d.shippingServiceName),
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

    /**
     * Đếm tổng số đơn hàng trong tháng hiện tại (tất cả statuses).
     * Dùng PageSize=1 và đọc totalPages/total từ response → chỉ tốn 1 HTTP call.
     *
     * @param {object} options
     * @param {string} options.accessToken
     * @param {string} [options.tokenType]
     * @param {number} [options.utcOffsetMinutes]
     * @returns {Promise<{ total: number, monthKey: string, fromSec: number, toSec: number }>}
     */
    async fetchMonthlyOrderCount(options = {}) {
        const accessToken  = options.accessToken;
        const tokenType    = options.tokenType        || 'Bearer';
        const utcOffsetMin = options.utcOffsetMinutes || DEFAULT_UTC_OFFSET_MIN;

        // Timezone đã pin Asia/Ho_Chi_Minh trên server → new Date() là giờ địa phương
        const now   = new Date();
        const year  = now.getFullYear();
        const month = now.getMonth(); // 0-indexed

        const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
        const firstDay = new Date(year, month, 1, 0, 0, 0);
        const lastDay  = new Date(year, month + 1, 0, 23, 59, 59);
        const fromSec  = Math.floor(firstDay.getTime() / 1000);
        const toSec    = Math.floor(lastDay.getTime() / 1000);

        const headers = this._buildHeaders(tokenType, accessToken);
        const params  = {
            PageSize:       1,
            PageIndex:      0,
            UtcOffsetValue: utcOffsetMin,
            FromDate:       fromSec,
            ToDate:         toSec,
            // Không truyền Statuses → lấy tất cả trạng thái
        };

        const response = await axios.get(ORDERS_ENDPOINT, {
            headers,
            params,
            timeout: FETCH_TIMEOUT_MS,
        });

        const total = this._extractTotalFromResponse(response.data);
        return { total, monthKey, fromSec, toSec };
    }

    /**
     * Trích xuất tổng số item từ các shape response khác nhau.
     * Với PageSize=1: totalPages === total items (nếu có trường totalPages).
     */
    _extractTotalFromResponse(payload) {
        if (!payload || typeof payload !== 'object') return 0;

        // Shape A: { data: [...], pagination: { total, totalPages, ... } }
        if (payload.pagination) {
            const pag = payload.pagination;
            if (pag.total != null)      return Number(pag.total);
            if (pag.totalPages != null) return Number(pag.totalPages); // PageSize=1 → totalPages = total items
        }

        // Shape B: { items: [...], totalPages, hasNextPage }
        if (payload.totalPages != null) return Number(payload.totalPages); // PageSize=1

        // Shape C: { items: [...], total }
        if (payload.total != null) return Number(payload.total);

        // Fallback: đếm items hiện tại (chỉ page 0)
        const items = Array.isArray(payload.items) ? payload.items
                    : Array.isArray(payload.data)  ? payload.data
                    : Array.isArray(payload)        ? payload
                    : [];
        return items.length;
    }

    _mapShippingPartner(serviceName) {
        if (!serviceName) return null;
        const lower = serviceName.toLowerCase().trim();
        const MAP = {
            'standard usps':  'USPS-LABEL',
            'priority usps':  'USPS-PRIORITY-LABEL',
            // 'standard' và 'ups ground' → null (không mua qua ITC)
        };
        return MAP[lower] ?? null;
    }
}

module.exports = new OmsOrderFetcherService();