// src/services/oms/order-storage.service.js
//
// Bridges Phase-3 normalized OMS payloads → oms_orders rows.
//
// Public surface (used by the sync cron and Phase 6/8/9 callers):
//   persistBatch(normalizedOrders) → { inserted, updated, preserved, skipped, errors }
//
// "preserved" = row existed and admin_edited_at was set, so editable columns
// were left alone but raw_data / oms_status / oms_updated_at were refreshed.
//
// Note: customerId / customerCode are null in the normalized payload for now.
// Customer matching (via partnerCode → api_customers) will be wired up later.

const OmsOrderModel = require('../../models/oms-order.model');
const logger = require('../../utils/logger');

class OmsOrderStorageService {
    /**
     * Generate an internal order_number distinct from the orders.* namespace.
     * Format: OMS{ts}{rand4} — visually distinct from existing ORD{ts}{rand4}.
     */
    generateOrderNumber() {
        const ts = Date.now().toString(36); // rút gọn timestamp
        const rand = Math.random().toString(36).substring(2, 6); // 4 ký tự
        return `OMS${ts}${rand}`.substring(0, 14).toUpperCase();
    }

    /**
     * Map a Phase-3 normalized order into a column-shaped payload.
     * customer_id / customer_code are null until matching is resolved.
     */
    toColumnPayload(normalized, now = new Date()) {
        const r = normalized.receiver || {};
        return {
            customer_id: normalized.customerId ?? null,
            customer_order_number: normalized.customerOrderNumber || null,
            platform_order_number: normalized.platformOrderNumber || null,

            oms_order_id: normalized.omsOrderId,
            oms_order_number: normalized.omsOrderNumber || null,
            oms_status: normalized.omsStatus || null,
            oms_created_at: this._toMysqlTimestamp(normalized.omsCreatedAt),
            oms_updated_at: this._toMysqlTimestamp(normalized.omsUpdatedAt),
            last_oms_synced_at: now,

            // Partner info — kept for future customer-matching join
            partner_id: normalized.partnerId ?? null,
            partner_code: normalized.partnerCode || null,
            partner_name: normalized.partnerName || null,

            receiver_name: r.name || null,
            receiver_phone: r.phone || null,
            receiver_email: r.email || null,
            receiver_country: r.country || null,
            receiver_state: r.state || null,
            receiver_city: r.city || null,
            receiver_postal_code: r.postalCode || null,
            receiver_address_line1: r.addressLine1 || null,
            receiver_address_line2: r.addressLine2 || null,

            package_weight: normalized.weight ?? null,
            package_length: normalized.length ?? null,
            package_width: normalized.width ?? null,
            package_height: normalized.height ?? null,
            weight_unit: normalized.weightUnit || 'KG',
            size_unit: normalized.sizeUnit || 'CM',

            declared_value: normalized.declaredValue ?? null,
            declared_currency: normalized.declaredCurrency || 'USD',
            items: Array.isArray(normalized.items) ? normalized.items : null,

            // raw_data: store the FULL normalized object (which itself contains .raw)
            // so we have both the OMS source payload and the normalized shape for audit.
            raw_data: normalized,
        };
    }

    /**
     * Persist a batch of normalized OMS orders.
     * Idempotent — re-running on the same payload is safe (UPSERT semantics).
     * Lookup is by omsOrderId only (no customer scoping while customerId = null).
     */
    async persistBatch(normalizedOrders) {
        const stats = {
            inserted: 0,
            updated: 0,
            preserved: 0,   // existed + admin_edited → editable cols left alone
            skipped: 0,
            errors: 0,
        };

        for (const normalized of normalizedOrders) {
            try {
                if (!normalized.omsOrderId) {
                    stats.skipped++;
                    logger.warn('[OMS-STORAGE] skipping order without omsOrderId', {
                        omsOrderNumber: normalized.omsOrderNumber,
                        partnerCode: normalized.partnerCode,
                    });
                    continue;
                }

                const existing = await OmsOrderModel.findByOmsId(normalized.omsOrderId);
                const payload = this.toColumnPayload(normalized);

                if (!existing) {
                    payload.order_number = this.generateOrderNumber();
                    payload.internal_status = 'pending';
                    await OmsOrderModel.create(payload);
                    stats.inserted++;
                } else {
                    const adminEdited = !!existing.admin_edited_at;
                    await OmsOrderModel.refreshFromOms(
                        existing.id, payload, /* preserveEditable */ adminEdited
                    );
                    if (adminEdited) stats.preserved++;
                    else stats.updated++;
                }
            } catch (err) {
                stats.errors++;
                logger.error('[OMS-STORAGE] persist failed for one order', {
                    omsOrderId: normalized.omsOrderId,
                    partnerCode: normalized.partnerCode,
                    error: err.message,
                });
            }
        }

        return stats;
    }

    _toMysqlTimestamp(value) {
        if (!value) return null;
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return null;
        return d;
    }
}

module.exports = new OmsOrderStorageService();