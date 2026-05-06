// src/services/itc/itc.client.js
//
// Low-level HTTP client for the ITC label aggregator. Two responsibilities:
//   - createOrder(body)          → POST /orders, returns { barcode, usd, sid, labelUrl?, raw }
//   - fetchLabelUrl(sid)         → GET /labels/{sid}, returns the original PDF URL
//   - fetchOrderDetail(sid)      → GET /orders/{sid}, returns { sid, status, statusText, raw }
//   - buildOrderBody(omsOrder, options) — pure shaping, no I/O
//
// The ITC response shape is not stamped in stone in this codebase yet — the
// normalizer accepts a few common variants so the orchestrator can rely on
// stable field names.

const axios = require('axios');
const config = require('../../config');
const logger = require('../../utils/logger');

class ItcClient {
    constructor() {
        this.cfg = config.itc;
    }

    isConfigured() {
        return !!(this.cfg.baseUrl && this.cfg.apiKey);
    }

    _baseHeaders() {
        return {
            Authorization: `Bearer ${this.cfg.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        };
    }

    _baseUrl() {
        return (this.cfg.baseUrl || '').replace(/\/+$/, '');
    }

    /**
     * POST /orders — buy a label.
     * @param {object} body — built by buildOrderBody
     * @returns {Promise<{barcode: string, usd: number, sid: string, labelUrl: string|null, raw: object}>}
     */
    async createOrder(body) {
        if (!this.isConfigured()) {
            const err = new Error('ITC not configured (set ITC_BASE_URL and ITC_API_KEY)');
            err.code = 'NOT_CONFIGURED';
            throw err;
        }
        const url = `${this._baseUrl()}/orders`;
        let response;
        try {
            response = await axios.post(url, body, {
                headers: this._baseHeaders(),
                timeout: this.cfg.timeoutMs,
            });
        } catch (err) {
            if (err.response) {
                logger.error('[ITC] createOrder rejected', {
                    status: err.response.status,
                    body: err.response.data,
                    reference: body.reference,
                });                
                const e = new Error(`ITC createOrder rejected (HTTP ${err.response.status}): ${err?.response?.data?.message || err?.response?.data?.msg || 'No message'}`);
                e.code = 'ITC_REJECTED';
                e.status = err.response.status;
                e.responseBody = err.response.data;
                throw e;
            }
            logger.error('[ITC] createOrder network error', {
                error: err.message,
                reference: body.reference,
            });
            const e = new Error(`ITC createOrder network error: ${err.message}`);
            e.code = 'NETWORK_ERROR';
            throw e;
        }

        return this._normalizeCreateResponse(response.data);
    }

    /**
     * GET /labels/{sid} — used as a fallback when createOrder doesn't include
     * the label URL inline.
     * @returns {Promise<string|null>}
     */
    async fetchLabelUrl(sid) {
        if (!this.isConfigured()) {
            const err = new Error('ITC not configured');
            err.code = 'NOT_CONFIGURED';
            throw err;
        }
        const url = `${this._baseUrl()}/orders/labels/${encodeURIComponent(sid)}`;
        const response = await axios.get(url, {
            headers: this._baseHeaders(),
            timeout: this.cfg.timeoutMs,
        });
        const data = response.data || {};
        return data.url || data.labelUrl || data.label_url || data.pdf_url || null;
    }

    getLabelUrl(sid) {
        return `${this._baseUrl()}/orders/labels/${encodeURIComponent(sid)}`;
    }

    /**
     * GET /orders/{sid} — fetch order detail to read current status_text.
     *
     * status_text enum from ITC:
     *   -1=Warning, 0=Generated, 1=Scanned, 2=Processing, 3=Processed,
     *    4=Delivered, 5=Failed, 10=OrderFailed
     *
     * @param {string} sid — ITC shipment UUID (stored as itc_sid on oms_orders)
     * @returns {Promise<{sid: string, status: number, statusText: string, raw: object}>}
     */
    async fetchOrderDetail(sid) {
        if (!this.isConfigured()) {
            const err = new Error('ITC not configured');
            err.code = 'NOT_CONFIGURED';
            throw err;
        }

        const url = `${this._baseUrl()}/orders/${encodeURIComponent(sid)}`;
        let response;
        try {
            response = await axios.get(url, {
                headers: this._baseHeaders(),
                timeout: this.cfg.timeoutMs,
            });
        } catch (err) {
            if (err.response) {
                const e = new Error(`ITC fetchOrderDetail rejected (HTTP ${err.response.status}) for sid=${sid}`);
                e.code = err.response.status === 404 ? 'NOT_FOUND' : 'ITC_REJECTED';
                e.status = err.response.status;
                e.responseBody = err.response.data;
                throw e;
            }
            const e = new Error(`ITC fetchOrderDetail network error: ${err.message}`);
            e.code = 'NETWORK_ERROR';
            throw e;
        }

        const d = response.data || {};
        return {
            sid:        d.sid || null,
            status:     d.status ?? null,
            statusText: d.status_text || null,
            raw:        d,
        };
    }

    /**
     * GET /tracking/{barcode} — pull live tracking events from ITC.
     * Returns { status, events: [...], raw } in a normalized shape.
     * @deprecated Prefer fetchOrderDetail for status-based polling.
     */
    async fetchTracking(barcode) {
        if (!this.isConfigured()) {
            const err = new Error('ITC not configured');
            err.code = 'NOT_CONFIGURED';
            throw err;
        }

        const url = `${this._baseUrl()}/tracking?filter=${encodeURIComponent(barcode)}`;
        let response;
        try {
            response = await axios.get(url, {
                headers: this._baseHeaders(),
                timeout: this.cfg.timeoutMs,
            });
            
        } catch (err) {
            if (err.response) {
                const e = new Error(`ITC tracking rejected (HTTP ${err.response.status}) for ${barcode}`);
                e.code = err.response.status === 404 ? 'NOT_FOUND' : 'ITC_REJECTED';
                e.status = err.response.status;
                e.responseBody = err.response.data;
                throw e;
            }
            const e = new Error(`ITC tracking network error: ${err.message}`);
            e.code = 'NETWORK_ERROR';
            throw e;
        }
        return this._normalizeTrackingResponse(response.data);
    }

    /**
     * Normalize variant tracking-response shapes into:
     *   { status, events: [{eventTime, status, eventCode, location, description, raw}], raw }
     */
    _normalizeTrackingResponse(data) {
        const d = data || {};
        const eventsRaw =
            (Array.isArray(d.events) && d.events) ||
            (Array.isArray(d.trackingEvents) && d.trackingEvents) ||
            (Array.isArray(d.tracking_events) && d.tracking_events) ||
            (Array.isArray(d) && d) ||
            [];

        const events = eventsRaw.map(e => {
            const ev = e || {};
            return {
                eventTime: ev.eventTime || ev.event_time || ev.timestamp || ev.time || null,
                status: ev.status || ev.event_status || ev.eventStatus || null,
                eventCode: ev.eventCode || ev.event_code || ev.code || null,
                location: ev.location || ev.eventLocation || null,
                description: ev.description || ev.message || ev.event_description || null,
                raw: ev,
            };
        });

        const status = d.status || d.trackingStatus || d.tracking_status ||
            (events[0] && events[0].status) || null;

        return { status, events, raw: d };
    }

    /**
     * Tolerant parser for createOrder response.
     */
    _normalizeCreateResponse(data) {
        const d = data || {};
        const barcode = this._extractTrackingNumber(d.barcode || d.tracking_number || d.trackingNumber);

        return {
            barcode: barcode,
            usd: Number(d.usd ?? d.cost ?? d.shipping_cost ?? d.shippingCost ?? 0),
            sid: d.sid || d.shipment_id || d.shipmentId || null,
            labelUrl: d.labelUrl || d.label_url || d.labelPdfUrl || d.label_pdf_url || null,
            raw: d,
        };
    }

    _extractTrackingNumber(barcode) {
        if (!barcode) return null;
        const s = String(barcode).trim();

        // Tìm tracking number USPS: 22 ký tự bắt đầu bằng 92, 93, 94, 95, 96
        const match = s.match(/(9[2-6]\d{20})/);
        if (match) return match[1];

        // Không match pattern USPS → trả về nguyên bản
        return s;
    }

    /**
     * Build the create-order request body from an oms_orders row + options.
     * Pure transform — no I/O. Caller is responsible for ensuring the row
     * has the fields it needs (validate before calling).
     *
     * @param {object} row — oms_orders row
     * @param {object} [options]
     * @param {string} [options.productCode]       — overrides ITC_DEFAULT_SERVICE
     * @param {object} [options.sellerInformation] — seller profile từ system_configs
     */
    buildOrderBody(row, options = {}) {
        const items = this._parseItems(row.items);
        const sellerInformation = options.sellerInformation || null;

        return {
            orderNumber: row.order_number,
            name: row.receiver_name,
            company: row.company || "",
            phone: row.receiver_phone || "",
            address1: row.receiver_address_line1 || "",
            address2: row.receiver_address_line2 || "",
            city: row.receiver_city || "",
            country: row.receiver_country || "",
            state: row.receiver_state || "",
            postalCode: row.receiver_postal_code || "",
            weight: 0,
            order_weight: row.package_weight ?? 0,
            order_width: row.package_width ?? 0,
            order_height: row.package_height ?? 0,
            order_length: row.package_length ?? 0,
            route_shipping_partner: row.oms_shipping_partner || "",
            taxNumber: row.tax_number || "",
            addressIndex: 0,
            ...(sellerInformation ? { sellerInformation } : {}),
            items: items.map((it) => ({
                skuNumber: it.sku || '',
                productName: it.productName || '',
                itemDescription: it.itemDescription || '',
                quantity: Number(it.quantity || 0),
                itemWeight: Number(it.weight || 0),
                itemWidth: Number(it.width || 0),
                itemHeight: Number(it.height || 0),
                itemLength: Number(it.length || 0),
                length: Number(it.length || 0),
                saleUrl: it.saleUrl || ''
            })),
        };
    }

    _parseItems(items) {
        if (!items) return [];
        if (Array.isArray(items)) return items;
        if (typeof items === 'string') {
            try { return JSON.parse(items) || []; } catch { return []; }
        }
        return [];
    }
}

module.exports = new ItcClient();