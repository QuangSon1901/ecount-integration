// src/services/itc/itc.client.js
//
// Low-level HTTP client for the ITC label aggregator. Two responsibilities:
//   - createOrder(body)          → POST /orders, returns { barcode, usd, sid, labelUrl?, raw }
//   - fetchLabelUrl(sid)         → GET /labels/{sid}, returns the original PDF URL
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
                const e = new Error(`ITC createOrder rejected (HTTP ${err.response.status})`);
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
        const url = `${this._baseUrl()}/labels/${encodeURIComponent(sid)}`;
        const response = await axios.get(url, {
            headers: this._baseHeaders(),
            timeout: this.cfg.timeoutMs,
        });
        const data = response.data || {};
        return data.url || data.labelUrl || data.label_url || data.pdf_url || null;
    }

    /**
     * GET /tracking/{barcode} — Phase 9: pull live tracking events from ITC.
     * Returns { status, events: [...], raw } in a normalized shape.
     */
    async fetchTracking(barcode) {
        if (!this.isConfigured()) {
            const err = new Error('ITC not configured');
            err.code = 'NOT_CONFIGURED';
            throw err;
        }

        const url = `${this._baseUrl()}/tracking/${encodeURIComponent(barcode)}`;
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
     *
     * Recognized shapes:
     *   A) { status, events: [{event_time | eventTime, ...}, ...] }
     *   B) { trackingStatus, trackingEvents: [...] }
     *   C) Bare event array → status derived from latest event
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
        return {
            barcode: d.barcode || d.tracking_number || d.trackingNumber || null,
            usd: Number(d.usd ?? d.cost ?? d.shipping_cost ?? d.shippingCost ?? 0),
            sid: d.sid || d.shipment_id || d.shipmentId || null,
            labelUrl: d.labelUrl || d.label_url || d.labelPdfUrl || d.label_pdf_url || null,
            raw: d,
        };
    }

    /**
     * Build the create-order request body from an oms_orders row + options.
     * Pure transform — no I/O. Caller is responsible for ensuring the row
     * has the fields it needs (validate before calling).
     *
     * @param {object} row — oms_orders row
     * @param {object} [options]
     * @param {string} [options.productCode] — overrides ITC_DEFAULT_SERVICE
     */
    buildOrderBody(row, options = {}) {
        const items = this._parseItems(row.items);
        return {
            reference: row.order_number,
            service: options.productCode || row.product_code || this.cfg.defaultService,
            shipper: { ...this.cfg.shipper },
            recipient: {
                name: row.receiver_name,
                phone: row.receiver_phone,
                email: row.receiver_email,
                country: row.receiver_country,
                state: row.receiver_state,
                city: row.receiver_city,
                postalCode: row.receiver_postal_code,
                addressLine1: row.receiver_address_line1,
                addressLine2: row.receiver_address_line2,
            },
            parcel: {
                weight: row.package_weight,
                length: row.package_length,
                width: row.package_width,
                height: row.package_height,
                weightUnit: row.weight_unit || 'KG',
                sizeUnit: row.size_unit || 'CM',
            },
            items,
            declaredValue: row.declared_value,
            currency: row.declared_currency || 'USD',
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
