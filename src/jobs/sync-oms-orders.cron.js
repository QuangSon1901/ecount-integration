// src/jobs/sync-oms-orders.cron.js
//
// New approach (replaces per-customer OAuth client_credentials flow):
//   1. Playwright opens admin.thgfulfill.com → auto-redirects to Keycloak login
//   2. Fill credentials, submit form
//   3. Intercept the POST to /protocol/openid-connect/token to capture access_token
//   4. Use that token via plain HTTP to fetch ALL orders across all partners
//      (admin scope — no per-customer loop needed)
//   5. Persist via existing order-storage service (customerId = null for now)
//
// The browser is closed after token extraction; only HTTP calls happen during
// the fetch. Token is reused across runs until expired.

const cron = require('node-cron');
const { chromium } = require('playwright');

const CronLogModel = require('../models/cron-log.model');
const omsOrderFetcher = require('../services/oms/order-fetcher.service');
const omsOrderStorage = require('../services/oms/order-storage.service');
const SystemConfigModel = require('../models/system-config.model');
const logger = require('../utils/logger');

const MONTHLY_TOTALS_KEY = 'oms_monthly_order_totals';

// ─── Hardcoded config (move to config/env later) ──────────────────────────────
const ADMIN_PORTAL_URL = 'https://admin.thgfulfill.com/';
const TOKEN_ENDPOINT_PATTERN = /\/protocol\/openid-connect\/token$/;
const ADMIN_USERNAME = process.env.OMS_VIETFUL_ADMIN_PORTAL_USERNAME;
const ADMIN_PASSWORD = process.env.OMS_VIETFUL_ADMIN_PORTAL_PASSWORD;

const LOGIN_TIMEOUT_MS = 60_000;
const TOKEN_WAIT_MS = 30_000;

class SyncOmsOrdersCron {
    constructor() {
        this.isRunning = false;
        this.schedule = '*/5 * * * *'; // every 10 minutes
        this.lookbackDays = 15;

        // Cached token to avoid logging in on every run if still valid.
        // Shape: { accessToken, tokenType, expiresAt: Date, refreshToken? }
        this.tokenCache = null;
    }

    start() {
        cron.schedule(this.schedule, async () => {
            if (this.isRunning) {
                logger.warn('[OMS-SYNC] previous run still in progress, skipping');
                return;
            }
            await this.run();
        });
        logger.info(`[OMS-SYNC] cron started — schedule: ${this.schedule}`);
    }

    async run() {
        const startTime = Date.now();
        let cronLogId = null;
        const stats = {
            ordersFetched: 0,
            pagesFetched: 0,
            ordersInserted: 0,
            ordersUpdated: 0,
            ordersPreserved: 0,
            ordersErrored: 0,
        };

        try {
            this.isRunning = true;
            cronLogId = await CronLogModel.start('sync_oms_orders');

            // ─── Step 1: get a valid token (login if needed) ──────────────────
            const token = await this.getToken();
            logger.info('[OMS-SYNC] token ready', {
                tokenType: token.tokenType,
                expiresAt: token.expiresAt.toISOString(),
            });

            // ─── Step 2: fetch ALL orders in one admin call ───────────────────
            // Admin token returns orders across all partners — no per-customer
            // loop needed. customerId is set to null until matching is wired up.
            let result;
            try {
                result = await omsOrderFetcher.fetchNewOrders({
                    lookbackDays: this.lookbackDays,
                    accessToken: token.accessToken,
                    tokenType: token.tokenType,
                });
            } catch (err) {
                // 401 → token revoked; force re-login on next run
                if (err.response?.status === 401) {
                    logger.warn('[OMS-SYNC] token rejected during fetch, invalidating cache');
                    this.tokenCache = null;
                }
                throw err;
            }

            stats.ordersFetched = result.orders.length;
            stats.pagesFetched  = result.pagesFetched;

            logger.info('[OMS-SYNC] admin fetch complete', {
                pagesFetched: result.pagesFetched,
                rawCount: result.rawCount,
                matchedCount: result.orders.length,
            });

            // ─── Step 3: persist all orders (customerId = null for now) ──────
            const persistStats = await omsOrderStorage.persistBatch(result.orders);
            stats.ordersInserted  = persistStats.inserted;
            stats.ordersUpdated   = persistStats.updated;
            stats.ordersPreserved = persistStats.preserved;
            stats.ordersErrored   = persistStats.errors;

            // ─── Step 4: cập nhật tổng đơn tháng hiện tại ───────────────────
            // Non-fatal: lỗi ở đây không được làm fail cả cron run.
            try {
                await this.syncMonthlyTotal(token);
            } catch (err) {
                logger.warn('[OMS-SYNC] syncMonthlyTotal failed (non-fatal)', { error: err.message });
            }

            const executionTime = Date.now() - startTime;
            await CronLogModel.update(cronLogId, {
                status: 'completed',
                ordersProcessed: stats.ordersFetched,
                ordersSuccess: stats.ordersInserted + stats.ordersUpdated + stats.ordersPreserved,
                ordersFailed: stats.ordersErrored,
                executionTimeMs: executionTime,
            });

            logger.info('[OMS-SYNC] run complete', { executionTime: `${executionTime}ms`, ...stats });

        } catch (err) {
            const executionTime = Date.now() - startTime;
            logger.error('[OMS-SYNC] run failed', { error: err.message, stack: err.stack });
            if (cronLogId) {
                await CronLogModel.update(cronLogId, {
                    status: 'failed',
                    ordersProcessed: stats.ordersFetched,
                    ordersSuccess: stats.ordersInserted + stats.ordersUpdated + stats.ordersPreserved,
                    ordersFailed: stats.ordersErrored,
                    errorMessage: err.message,
                    executionTimeMs: executionTime,
                });
            }
        } finally {
            this.isRunning = false;
        }
    }

    // ─── Monthly total sync ───────────────────────────────────────────────────

    /**
     * Gọi OMS API (tất cả statuses, từ đầu đến cuối tháng hiện tại)
     * để lấy tổng số đơn, rồi lưu/cập nhật vào system_configs.
     *
     * Config key: 'oms_monthly_order_totals'
     * Value shape: { "2026-05": { total: 150, updatedAt: "..." }, ... }
     */
    async syncMonthlyTotal(token) {
        const { total, monthKey } = await omsOrderFetcher.fetchMonthlyOrderCount({
            accessToken:  token.accessToken,
            tokenType:    token.tokenType,
        });

        // Đọc record hiện tại (hoặc {} nếu chưa có)
        const current = await SystemConfigModel.getValue(MONTHLY_TOTALS_KEY, {});
        const updated = {
            ...(typeof current === 'object' && current !== null ? current : {}),
            [monthKey]: {
                total,
                updatedAt: new Date().toISOString(),
            },
        };

        await SystemConfigModel.set(
            MONTHLY_TOTALS_KEY,
            updated,
            'Tổng số đơn OMS theo tháng (tất cả trạng thái) — dùng để tính cost'
        );

        logger.info('[OMS-SYNC] monthly total updated', { monthKey, total });
    }

    // ─── Token management ─────────────────────────────────────────────────────

    /**
     * Returns a valid access token, logging in via Playwright if cache is
     * empty or expired. Uses a 60-second safety margin before expiry.
     */
    async getToken() {
        const SAFETY_MS = 60 * 1000;
        if (this.tokenCache
            && this.tokenCache.expiresAt.getTime() - Date.now() > SAFETY_MS) {
            logger.info('[OMS-SYNC] reusing cached token');
            return this.tokenCache;
        }

        logger.info('[OMS-SYNC] no valid cached token, logging in via Playwright...');
        const token = await this.loginAndCaptureToken();
        this.tokenCache = token;
        return token;
    }

    /**
     * Opens admin portal in a headless browser, fills the Keycloak login form,
     * and intercepts the network response that contains the access token.
     */
    async loginAndCaptureToken() {
        const browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });

        try {
            const context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
                    + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            });
            const page = await context.newPage();

            page.setDefaultNavigationTimeout(LOGIN_TIMEOUT_MS);
            page.setDefaultTimeout(LOGIN_TIMEOUT_MS);

            // ── Set up token interception BEFORE navigating ──────────────────
            const tokenPromise = new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new Error('Timed out waiting for token response'));
                }, TOKEN_WAIT_MS);

                page.on('response', async (response) => {
                    const url = response.url();
                    if (!TOKEN_ENDPOINT_PATTERN.test(url)) return;
                    if (response.status() < 200 || response.status() >= 300) return;

                    try {
                        const body = await response.json();
                        if (body && body.access_token) {
                            clearTimeout(timer);
                            resolve(body);
                        }
                    } catch (e) {
                        // Not JSON or parse error — ignore and keep listening
                    }
                });
            });

            // ── Navigate to admin portal (auto-redirects to Keycloak) ────────
            logger.info('[OMS-SYNC] navigating to admin portal');
            await page.goto(ADMIN_PORTAL_URL, { waitUntil: 'domcontentloaded' });

            // ── Wait for Keycloak login form ─────────────────────────────────
            await page.waitForSelector('#kc-form-login', { state: 'visible' });
            logger.info('[OMS-SYNC] login form visible, filling credentials');

            await page.fill('#username', ADMIN_USERNAME);
            await page.fill('#password', ADMIN_PASSWORD);

            // ── Submit and wait for token response in parallel ───────────────
            await Promise.all([
                tokenPromise.catch(err => { throw err; }),
                page.click('#kc-login'),
            ]).catch((err) => {
                throw new Error(`Login failed: ${err.message}`);
            });

            const tokenBody = await tokenPromise;
            logger.info('[OMS-SYNC] token captured from network');

            const expiresInSec = Number(tokenBody.expires_in) > 0
                ? Number(tokenBody.expires_in)
                : 300;

            return {
                accessToken: tokenBody.access_token,
                refreshToken: tokenBody.refresh_token || null,
                tokenType: tokenBody.token_type || 'Bearer',
                expiresAt: new Date(Date.now() + expiresInSec * 1000),
                scope: tokenBody.scope || null,
            };

        } finally {
            await browser.close().catch(() => { /* ignore */ });
        }
    }

    /**
     * Manual run for testing.
     */
    async runManually() {
        logger.info('[OMS-SYNC] manual run triggered');
        await this.run();
    }

    /**
     * Manual login test: just login and return the token (no DB / no fetch).
     */
    async testLogin() {
        const token = await this.loginAndCaptureToken();
        logger.info('[OMS-SYNC] test login successful', {
            tokenType: token.tokenType,
            expiresAt: token.expiresAt.toISOString(),
            tokenPreview: token.accessToken.substring(0, 40) + '...',
        });
        return token;
    }
}

module.exports = new SyncOmsOrdersCron();