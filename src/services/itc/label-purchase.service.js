// src/services/itc/label-purchase.service.js
//
// Orchestrates a single ITC label purchase against an oms_orders row.
//
// Concurrency / safety model:
//   1. Atomic state transition pending|selected → label_purchasing.
//      If the transition fails, another caller already claimed the row.
//   2. ITC HTTP call happens OUTSIDE any DB transaction (avoid holding a
//      pool connection across the network roundtrip).
//   3. On success: record fields + transition to label_purchased.
//      On failure: transition to error with note.
//
// If step 3 itself fails after a successful ITC purchase (DB outage), the
// error is logged with the FULL ITC response (barcode, sid, usd) so an admin
// can recover manually. The order is left in 'label_purchasing' — a separate
// recovery job (out of scope for Phase 5) can sweep stale rows.

const itcClient = require('./itc.client');
const OmsOrderModel = require('../../models/oms-order.model');
const ApiCustomerModel = require('../../models/api-customer.model');
const UrlProxyModel = require('../../models/url-proxy.model');
const jobService = require('../queue/job.service');
const logger = require('../../utils/logger');

const VALID_PRE_STATES = ['pending', 'selected'];

class LabelPurchaseError extends Error {
    constructor(code, message, cause) {
        super(message);
        this.name = 'LabelPurchaseError';
        this.code = code;  // 'NOT_FOUND' | 'INVALID_STATE' | 'INCOMPLETE_DATA' | 'ITC_REJECTED' | 'NETWORK_ERROR' | 'PERSIST_FAILED' | 'NOT_CONFIGURED'
        if (cause) this.cause = cause;
    }
}

class LabelPurchaseService {
    /**
     * Buy a label for one OMS order.
     *
     * @param {number} omsOrderId
     * @param {object} [options]
     * @param {string} [options.productCode] — overrides config.itc.defaultService
     * @returns {Promise<object>} updated oms_orders row
     */
    async purchaseFor(omsOrderId, options = {}) {
        if (!itcClient.isConfigured()) {
            throw new LabelPurchaseError('NOT_CONFIGURED', 'ITC client is not configured');
        }

        // 1. Read current state
        const row = await OmsOrderModel.findById(omsOrderId);
        if (!row) {
            throw new LabelPurchaseError('NOT_FOUND', `OMS order ${omsOrderId} not found`);
        }
        if (!VALID_PRE_STATES.includes(row.internal_status)) {
            throw new LabelPurchaseError(
                'INVALID_STATE',
                `Cannot buy label for order in state '${row.internal_status}' (expected one of ${VALID_PRE_STATES.join(', ')})`
            );
        }
        this._validateRowForItc(row);

        // 2. Atomic claim — refuse if someone else just changed the state
        const claimed = await OmsOrderModel.transitionInternalStatus(
            omsOrderId,
            VALID_PRE_STATES,
            'label_purchasing',
            null
        );
        if (!claimed) {
            throw new LabelPurchaseError(
                'INVALID_STATE',
                `Order ${omsOrderId} state changed before claim — refusing to buy label`
            );
        }

        // 3. Build ITC body and call the API (no DB lock held)
        const customer = await ApiCustomerModel.findById(row.customer_id);
        const body = itcClient.buildOrderBody(row, options);

        let itcResponse;
        try {
            itcResponse = await itcClient.createOrder(body);
        } catch (err) {
            // ITC failed — revert to error state with explanation
            await OmsOrderModel.setInternalStatus(omsOrderId, 'error',
                `ITC call failed: ${err.message}`);
            throw new LabelPurchaseError(
                err.code || 'ITC_REJECTED',
                err.message,
                err
            );
        }

        if (!itcResponse.barcode || !itcResponse.sid) {
            await OmsOrderModel.setInternalStatus(omsOrderId, 'error',
                'ITC response missing barcode or sid');
            throw new LabelPurchaseError('ITC_REJECTED',
                'ITC response missing required fields (barcode, sid)');
        }

        // 4. Resolve label URL: inline preferred, fall back to /labels/{sid}
        let labelOriginalUrl = itcResponse.labelUrl;
        if (!labelOriginalUrl) {
            try {
                labelOriginalUrl = await itcClient.fetchLabelUrl(itcResponse.sid);
            } catch (err) {
                logger.warn('[ITC] fetchLabelUrl failed after successful create', {
                    sid: itcResponse.sid,
                    barcode: itcResponse.barcode,
                    error: err.message,
                });
            }
        }

        // 5. Proxy the label URL via url_proxies (Phase 5 constraint).
        //    If we couldn't get a URL at all, store nulls — admin can fetch later.
        let accessKey = null, shortUrl = null;
        if (labelOriginalUrl) {
            try {
                const proxy = await UrlProxyModel.createShortUrl(labelOriginalUrl, 'label', null);
                accessKey = proxy.accessKey;
                shortUrl = proxy.shortUrl;
            } catch (err) {
                logger.error('[ITC] url_proxies.createShortUrl failed', {
                    omsOrderId,
                    sid: itcResponse.sid,
                    barcode: itcResponse.barcode,
                    error: err.message,
                });
                // Don't fail the whole purchase — store the raw URL as a fallback
                shortUrl = labelOriginalUrl;
            }
        }

        // 6. Snapshot markup at purchase time and compute charged cost
        const markupPct = Number(customer?.shipping_markup_percent ?? 0);
        const rawCost = Number(itcResponse.usd ?? 0);
        const chargedCost = Math.round(rawCost * (1 + markupPct / 100) * 10000) / 10000;

        // 7. Persist (Phase 7 column names: shipping_fee_purchase / shipping_fee_selling)
        try {
            await OmsOrderModel.recordItcLabel(omsOrderId, {
                carrier: 'ITC',
                productCode: body.service,
                trackingNumber: itcResponse.barcode,
                waybillNumber: itcResponse.barcode,
                labelUrl: shortUrl,
                labelAccessKey: accessKey,
                itcSid: itcResponse.sid,
                itcResponse: itcResponse.raw,
                shippingFeePurchase: rawCost,
                shippingMarkupPercent: markupPct,
                shippingFeeSelling: chargedCost,
                costCurrency: 'USD',
                internalStatus: 'label_purchased',
            });
        } catch (err) {
            // ITC succeeded but we can't write — loud log so admin can recover
            logger.error('[ITC] persistence failed AFTER successful ITC purchase — manual recovery needed', {
                omsOrderId,
                customerCode: customer?.customer_code,
                barcode: itcResponse.barcode,
                sid: itcResponse.sid,
                usd: itcResponse.usd,
                labelOriginalUrl,
                error: err.message,
                critical: true,
            });
            throw new LabelPurchaseError('PERSIST_FAILED',
                `ITC purchased (sid=${itcResponse.sid}, barcode=${itcResponse.barcode}) but DB write failed: ${err.message}`,
                err);
        }

        logger.info('[ITC] label purchased', {
            omsOrderId,
            customerCode: customer?.customer_code,
            barcode: itcResponse.barcode,
            sid: itcResponse.sid,
            shippingFeePurchase: rawCost,
            shippingFeeSelling: chargedCost,
            markupPct,
        });

        // Phase 6 trigger: queue OMS logistic-info push.
        // Failure to enqueue is non-fatal — admin can hit the manual retry endpoint.
        try {
            await jobService.addOmsUpdateLogisticJob(omsOrderId);
        } catch (err) {
            logger.warn('[ITC] failed to enqueue OMS update job (label still purchased)', {
                omsOrderId,
                error: err.message,
            });
        }

        return await OmsOrderModel.findById(omsOrderId);
    }

    /**
     * Bulk variant — sequential to avoid hammering ITC. Per-order failures
     * are captured in `results`, not raised, so partial success is reported.
     */
    async purchaseBatch(omsOrderIds, options = {}) {
        const results = [];
        for (const id of omsOrderIds) {
            try {
                const order = await this.purchaseFor(id, options);
                results.push({
                    id,
                    success: true,
                    trackingNumber: order.tracking_number,
                    labelUrl: order.label_url,
                    shippingFeePurchase: order.shipping_fee_purchase,
                    shippingFeeSelling: order.shipping_fee_selling,
                    grossProfit: order.gross_profit,
                });
            } catch (err) {
                results.push({
                    id,
                    success: false,
                    code: err.code || 'UNKNOWN',
                    error: err.message,
                });
            }
        }
        return results;
    }

    _validateRowForItc(row) {
        const required = ['receiver_name', 'receiver_country', 'receiver_address_line1', 'receiver_city'];
        const missing = required.filter(f => !row[f]);
        if (missing.length) {
            throw new LabelPurchaseError(
                'INCOMPLETE_DATA',
                `OMS order ${row.id} missing required fields: ${missing.join(', ')}`
            );
        }
    }
}

const instance = new LabelPurchaseService();
module.exports = instance;
module.exports.LabelPurchaseError = LabelPurchaseError;
