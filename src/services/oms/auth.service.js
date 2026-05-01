// src/services/oms/auth.service.js
//
// OAuth2 client_credentials token broker for customer OMS endpoints.
// One token per customer. Two cache layers:
//   L1: per-process Map (avoids DB hit on hot path)
//   L2: oms_access_tokens table (shared between server.js and worker.js processes)
// In-flight Promise dedup prevents thundering-herd when many callers
// request the same customer's token concurrently.
//
// Tokens are auto-invalidated when admin rotates credentials: the stored
// `credential_fingerprint` is compared against the current customer config
// before a cached token is reused.

const axios = require('axios');
const crypto = require('crypto');
const ApiCustomerModel = require('../../models/api-customer.model');
const OmsAccessTokenModel = require('../../models/oms-access-token.model');
const logger = require('../../utils/logger');

const REFRESH_SAFETY_MS = 60 * 1000;        // refresh if <60s remaining
const DEFAULT_EXPIRES_IN_SEC = 3600;        // fallback when OMS omits expires_in
const AUTH_REQUEST_TIMEOUT_MS = 15000;

class OmsAuthError extends Error {
    constructor(code, message, cause) {
        super(message);
        this.name = 'OmsAuthError';
        this.code = code; // 'NOT_CONFIGURED' | 'AUTH_FAILED' | 'INVALID_RESPONSE' | 'NETWORK_ERROR'
        if (cause) this.cause = cause;
    }
}

class OmsAuthService {
    constructor() {
        this.memoryCache = new Map(); // customerId -> {accessToken, tokenType, expiresAt, fingerprint}
        this.inFlight = new Map();    // customerId -> Promise<token>
    }

    /**
     * Hash of the credential triple — changes when admin rotates any of them,
     * causing the cached token to be discarded on next read.
     */
    fingerprint(customer) {
        const material = [
            customer.oms_realm || '',
            customer.oms_client_id || '',
            customer.oms_client_secret || '',
            customer.oms_url_auth || '',
        ].join('|');
        return crypto.createHash('sha256').update(material).digest('hex');
    }

    isFresh(record) {
        if (!record) return false;
        const expiresMs = new Date(record.expires_at || record.expiresAt).getTime();
        return expiresMs - Date.now() > REFRESH_SAFETY_MS;
    }

    isConfigured(customer) {
        return !!(customer
            && customer.oms_client_id
            && customer.oms_client_secret
            && customer.oms_url_auth);
    }

    /**
     * Returns a fresh token for the customer. Reuses cache when possible.
     * Throws OmsAuthError on failure.
     *
     * @param {number} customerId
     * @returns {Promise<{accessToken: string, tokenType: string, expiresAt: Date, fingerprint: string}>}
     */
    async getToken(customerId) {
        const cached = this.memoryCache.get(customerId);
        if (cached && this.isFresh(cached)) {
            return cached;
        }

        // Dedup concurrent fetches for the same customer
        if (this.inFlight.has(customerId)) {
            return this.inFlight.get(customerId);
        }

        const promise = this._loadOrFetch(customerId)
            .finally(() => this.inFlight.delete(customerId));
        this.inFlight.set(customerId, promise);
        return promise;
    }

    /**
     * Convenience: returns headers ready to attach to an axios call.
     */
    async getAuthHeaders(customerId) {
        const token = await this.getToken(customerId);
        return { Authorization: `${token.tokenType} ${token.accessToken}` };
    }

    /**
     * Forcefully drop cached token (memory + DB).
     * Call this on a 401 response from the OMS API to force re-auth on next request.
     */
    async invalidate(customerId) {
        this.memoryCache.delete(customerId);
        await OmsAccessTokenModel.deleteByCustomerId(customerId);
    }

    // ─── Internal ─────────────────────────────────────────────────

    async _loadOrFetch(customerId) {
        const customer = await ApiCustomerModel.findById(customerId);
        if (!customer) {
            throw new OmsAuthError('NOT_CONFIGURED', `Customer ${customerId} not found`);
        }
        if (!this.isConfigured(customer)) {
            throw new OmsAuthError(
                'NOT_CONFIGURED',
                `OMS auth not configured for customer ${customer.customer_code} (id=${customerId})`
            );
        }

        const fp = this.fingerprint(customer);

        // L2 cache (DB) — shared across processes
        const stored = await OmsAccessTokenModel.findByCustomerId(customerId);
        if (stored && stored.credential_fingerprint === fp && this.isFresh(stored)) {
            const token = this._toMemoryShape(stored, fp);
            this.memoryCache.set(customerId, token);
            return token;
        }

        // Miss / expired / fingerprint mismatch — call OMS auth
        return this._fetchAndStore(customer, fp);
    }

    async _fetchAndStore(customer, fingerprint) {
        const body = new URLSearchParams();
        body.append('grant_type', 'client_credentials');
        body.append('client_id', customer.oms_client_id);
        body.append('client_secret', customer.oms_client_secret);

        let response;
        try {
            response = await axios.post(`${customer.oms_url_auth}/auth/realms/${customer.oms_realm}/protocol/openid-connect/token`, body.toString(), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Accept: 'application/json',
                },
                timeout: AUTH_REQUEST_TIMEOUT_MS,
                // Surface 4xx/5xx as thrown errors so we can classify them below
                validateStatus: (s) => s >= 200 && s < 300,
            });
        } catch (err) {
            if (err.response) {
                // OMS responded with non-2xx — likely bad creds or misconfigured URL
                logger.error('[OMS-AUTH] auth request rejected', {
                    customerId: customer.id,
                    customerCode: customer.customer_code,
                    status: err.response.status,
                    body: err.response.data,
                });
                throw new OmsAuthError(
                    'AUTH_FAILED',
                    `OMS auth rejected (HTTP ${err.response.status}) for customer ${customer.customer_code}`,
                    err
                );
            }
            logger.error('[OMS-AUTH] auth request network error', {
                customerId: customer.id,
                customerCode: customer.customer_code,
                error: err.message,
            });
            throw new OmsAuthError(
                'NETWORK_ERROR',
                `OMS auth network error for customer ${customer.customer_code}: ${err.message}`,
                err
            );
        }

        const data = response.data || {};
        if (!data.access_token) {
            logger.error('[OMS-AUTH] response missing access_token', {
                customerId: customer.id,
                customerCode: customer.customer_code,
                payload: data,
            });
            throw new OmsAuthError(
                'INVALID_RESPONSE',
                `OMS auth response missing access_token for customer ${customer.customer_code}`
            );
        }

        const expiresInSec = Number(data.expires_in) > 0 ? Number(data.expires_in) : DEFAULT_EXPIRES_IN_SEC;
        const expiresAt = new Date(Date.now() + expiresInSec * 1000);
        const tokenType = data.token_type || 'Bearer';
        const scope = data.scope || null;

        await OmsAccessTokenModel.upsert({
            customerId: customer.id,
            accessToken: data.access_token,
            tokenType,
            scope,
            expiresAt,
            fingerprint,
        });

        const token = {
            accessToken: data.access_token,
            tokenType,
            expiresAt,
            fingerprint,
        };
        this.memoryCache.set(customer.id, token);

        logger.info('[OMS-AUTH] token issued', {
            customerId: customer.id,
            customerCode: customer.customer_code,
            expiresAt: expiresAt.toISOString(),
            ttlSec: expiresInSec,
        });

        return token;
    }

    _toMemoryShape(dbRow, fingerprint) {
        return {
            accessToken: dbRow.access_token,
            tokenType: dbRow.token_type,
            expiresAt: new Date(dbRow.expires_at),
            fingerprint,
        };
    }
}

module.exports = new OmsAuthService();
module.exports.OmsAuthError = OmsAuthError;
