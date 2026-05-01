// src/services/oms/logistic-update.service.js
//
// Pushes label info (tracking + proxy URL + tplCode) back to a customer's OMS.
//
// Endpoint contract (Phase 6):
//   POST {customer.oms_url_api}/ors/{oms_order_id}/logistic-info
//   Body: { trackingCode, shippingLabel, tplCode }
//   Auth: Bearer token from omsAuthService (Phase 2)
//
// Designed to be called from a queue worker — the public method is
// synchronous w.r.t. the caller; the worker handles retry/backoff via
// JobModel.markFailed (5s, 10s, 20s, 40s, 80s).

const axios = require('axios');
const omsAuth = require('./auth.service');
const ApiCustomerModel = require('../../models/api-customer.model');
const OmsOrderModel = require('../../models/oms-order.model');
const logger = require('../../utils/logger');

const REQUEST_TIMEOUT_MS = 20_000;

class OmsLogisticUpdateError extends Error {
    constructor(code, message, cause) {
        super(message);
        this.name = 'OmsLogisticUpdateError';
        this.code = code;
        // 'NOT_FOUND' | 'INVALID_STATE' | 'INCOMPLETE_DATA'
        // | 'OMS_REJECTED' | 'NETWORK_ERROR' | 'NOT_CONFIGURED'
        if (cause) this.cause = cause;
    }
}

class OmsLogisticUpdateService {
    /**
     * Push the label for one OMS order. Idempotent w.r.t. internal_status:
     *   - already 'oms_updated' or beyond → returns {alreadyUpdated: true}
     *   - 'label_purchased' or 'error'    → attempts the push
     *   - any other state                 → throws INVALID_STATE
     *
     * On success: transitions internal_status → 'oms_updated'.
     * On OMS rejection or network error: throws (worker will retry).
     *
     * @param {number} omsOrderId
     * @param {object} [options]
     * @param {string} [options.tplCode] — override; defaults to row.product_code, then row.carrier
     * @returns {Promise<{success: boolean, alreadyUpdated?: boolean, omsResponse?: object}>}
     */
    async pushFor(omsOrderId, options = {}) {
        const row = await OmsOrderModel.findById(omsOrderId);
        if (!row) {
            throw new OmsLogisticUpdateError('NOT_FOUND', `OMS order ${omsOrderId} not found`);
        }

        // Idempotency: already pushed → no-op
        if (['oms_updated', 'shipped', 'delivered'].includes(row.internal_status)) {
            return { success: true, alreadyUpdated: true };
        }

        // Only allow push from these states
        if (!['label_purchased', 'error'].includes(row.internal_status)) {
            throw new OmsLogisticUpdateError(
                'INVALID_STATE',
                `Cannot push to OMS in state '${row.internal_status}' (need label_purchased or error)`
            );
        }

        // Validate we have what to send
        if (!row.tracking_number || !row.label_url || !row.oms_order_id) {
            throw new OmsLogisticUpdateError(
                'INCOMPLETE_DATA',
                `Missing fields for OMS push: tracking_number=${!!row.tracking_number}, label_url=${!!row.label_url}, oms_order_id=${!!row.oms_order_id}`
            );
        }

        const customer = await ApiCustomerModel.findById(row.customer_id);
        if (!customer) {
            throw new OmsLogisticUpdateError('NOT_FOUND',
                `Customer ${row.customer_id} not found for order ${omsOrderId}`);
        }
        if (!omsAuth.isConfigured(customer) || !customer.oms_url_api) {
            throw new OmsLogisticUpdateError('NOT_CONFIGURED',
                `OMS not configured for customer ${customer.customer_code}`);
        }

        const tplCode = options.tplCode || row.product_code || row.carrier || 'ITC';
        const body = {
            trackingCode: row.tracking_number,
            shippingLabel: row.label_url,
            tplCode,
        };

        const baseUrl = customer.oms_url_api.replace(/\/+$/, '');
        const url = `${baseUrl}/ors/${encodeURIComponent(row.oms_order_id)}/logistic-info`;

        let response;
        try {
            response = await this._postWith401Retry(url, body, customer.id);
        } catch (err) {
            if (err.response) {
                logger.error('[OMS-UPDATE] OMS rejected logistic-info push', {
                    omsOrderId,
                    customerCode: customer.customer_code,
                    status: err.response.status,
                    body: err.response.data,
                    omsOrderRef: row.oms_order_id,
                });
                throw new OmsLogisticUpdateError(
                    'OMS_REJECTED',
                    `OMS rejected logistic-info (HTTP ${err.response.status}) for order ${row.oms_order_id}`,
                    err
                );
            }
            logger.error('[OMS-UPDATE] network error', {
                omsOrderId,
                customerCode: customer.customer_code,
                error: err.message,
            });
            throw new OmsLogisticUpdateError(
                'NETWORK_ERROR',
                `OMS network error: ${err.message}`,
                err
            );
        }

        // Atomic transition: only flip if still in label_purchased / error
        const transitioned = await OmsOrderModel.transitionInternalStatus(
            omsOrderId,
            ['label_purchased', 'error'],
            'oms_updated',
            null
        );
        if (!transitioned) {
            // Someone else moved it (manual edit, race) — log and continue success
            logger.warn('[OMS-UPDATE] state transition skipped (already moved)', {
                omsOrderId,
                customerCode: customer.customer_code,
            });
        }

        logger.info('[OMS-UPDATE] logistic-info pushed', {
            omsOrderId,
            customerCode: customer.customer_code,
            omsOrderRef: row.oms_order_id,
            trackingCode: body.trackingCode,
            tplCode: body.tplCode,
        });

        return { success: true, omsResponse: response.data };
    }

    /**
     * POST with the same 401-retry-once pattern used by Phase 3 fetcher.
     */
    async _postWith401Retry(url, body, customerId) {
        try {
            const headers = await omsAuth.getAuthHeaders(customerId);
            return await axios.post(url, body, {
                headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json' },
                timeout: REQUEST_TIMEOUT_MS,
            });
        } catch (err) {
            if (err.response?.status === 401) {
                logger.warn('[OMS-UPDATE] 401 from OMS, invalidating cached token', { customerId });
                await omsAuth.invalidate(customerId);
                const freshHeaders = await omsAuth.getAuthHeaders(customerId);
                return await axios.post(url, body, {
                    headers: { ...freshHeaders, 'Content-Type': 'application/json', Accept: 'application/json' },
                    timeout: REQUEST_TIMEOUT_MS,
                });
            }
            throw err;
        }
    }
}

const instance = new OmsLogisticUpdateService();
module.exports = instance;
module.exports.OmsLogisticUpdateError = OmsLogisticUpdateError;
