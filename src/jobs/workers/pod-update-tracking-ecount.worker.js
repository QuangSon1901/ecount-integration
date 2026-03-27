// src/jobs/workers/pod-update-tracking-ecount.worker.js
// Playwright batch worker cho POD Ecount - tương tự update-tracking-batch.worker.js
// Dùng podSessionManager + config.ecount_pod thay vì sessionManager + config.ecount
const { chromium } = require('playwright');
const BaseWorker = require('./base.worker');
const OrderModel = require('../../models/order.model');
const JobModel = require('../../models/job.model');
const { podSessionManager } = require('../../services/erp/ecount-session.manager');
const telegram = require('../../utils/telegram');
const logger = require('../../utils/logger');
const config = require('../../config');
const path = require('path');
const fs = require('fs');

class PodUpdateTrackingBatchWorker extends BaseWorker {
    constructor() {
        super('pod_update_tracking_ecount', {
            intervalMs: 10000,
            concurrency: 2
        });

        this.playwrightConfig = config.playwright;
        this.ecountConfig = config.ecount_pod;
        this.sessionManager = podSessionManager;
        this.screenshotDir = path.join(__dirname, '../../../logs/screenshots');

        if (!fs.existsSync(this.screenshotDir)) {
            fs.mkdirSync(this.screenshotDir, { recursive: true });
        }

        this.maxBatchSize = 10;
        this.maxConcurrentBrowsers = 1;
        this.maxConcurrentWorkers = 2;
    }

    /**
     * Override processJobs để xử lý theo batch
     */
    async processJobs() {
        try {
            if (this.activeJobs.size === 0) {
                await JobModel.resetStuckJobs(30);
            }

            if (this.activeJobs.size >= this.maxConcurrentWorkers) {
                logger.debug(`[POD] Đã đạt giới hạn ${this.maxConcurrentWorkers} workers, chờ...`);
                return;
            }

            const jobs = await this.getNextJobsBatch(this.maxBatchSize);

            if (jobs.length === 0) {
                return;
            }

            const workerId = `pod-tracking-${Date.now()}-${Math.random().toString(36).substring(7)}`;

            logger.info(`🚀 ${workerId}: [POD] Bắt đầu xử lý ${jobs.length} jobs (active: ${this.activeJobs.size + 1}/${this.maxConcurrentWorkers})`);

            this.activeJobs.add(workerId);

            try {
                await this.processBatch(jobs, workerId);
            } finally {
                this.activeJobs.delete(workerId);
                logger.info(`🏁 ${workerId}: [POD] Đã hoàn thành (active: ${this.activeJobs.size}/${this.maxConcurrentWorkers})`);
            }

        } catch (error) {
            logger.error(`[POD] Error in ${this.jobType} batch worker:`, error);
        }
    }

    async getNextJobsBatch(limit) {
        const db = require('../../database/connection');
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const [rows] = await connection.query(
                `SELECT * FROM jobs
                WHERE status = 'pending'
                AND job_type = ?
                AND available_at <= NOW()
                AND attempts < max_attempts
                ORDER BY available_at ASC
                LIMIT ?
                FOR UPDATE SKIP LOCKED`,
                [this.jobType, limit]
            );

            if (rows.length === 0) {
                await connection.commit();
                return [];
            }

            const jobIds = rows.map(r => r.id);
            await connection.query(
                `UPDATE jobs
                SET status = 'processing',
                    started_at = NOW(),
                    attempts = attempts + 1
                WHERE id IN (?)`,
                [jobIds]
            );

            await connection.commit();

            return rows.map(job => {
                if (typeof job.payload === 'string') {
                    try {
                        job.payload = JSON.parse(job.payload);
                    } catch (e) {
                        logger.error(`[POD] Failed to parse payload for job ${job.id}:`, e);
                    }
                }
                return job;
            });

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    async processBatch(jobs, workerId) {
        const startTime = Date.now();
        const jobsByLink = this.groupJobsByEcountLink(jobs);

        logger.info(`${workerId}: [POD] Nhóm thành ${Object.keys(jobsByLink).length} groups theo ecountLink`);

        const results = [];
        const groups = Object.entries(jobsByLink);

        for (let i = 0; i < groups.length; i++) {
            const [ecountLink, groupJobs] = groups[i];

            logger.info(`${workerId}: [POD] Group ${i + 1}/${groups.length} - ${groupJobs.length} orders`);

            try {
                const result = await this.processGroup(ecountLink, groupJobs, workerId);
                results.push({ status: 'fulfilled', value: result });
            } catch (error) {
                logger.error(`${workerId}: [POD] Group ${i + 1} failed:`, error);
                results.push({ status: 'rejected', reason: error });

                for (const job of groupJobs) {
                    await JobModel.markFailed(job.id, `Group error: ${error.message}`, true);
                }
            }
        }

        const stats = { total: jobs.length, success: 0, failed: 0, duration: Date.now() - startTime };
        results.forEach((result) => {
            if (result.status === 'fulfilled') {
                stats.success += result.value.success;
                stats.failed += result.value.failed;
            }
        });

        logger.info(`✅ ${workerId}: [POD] Hoàn thành`, {
            ...stats,
            avgTimePerOrder: stats.total > 0 ? (stats.duration / stats.total).toFixed(0) + 'ms' : 'N/A',
            successRate: stats.total > 0 ? ((stats.success / stats.total) * 100).toFixed(1) + '%' : 'N/A'
        });

        return stats;
    }

    async processGroup(ecountLink, jobs, workerId) {
        let browser, context, page;
        const stats = { success: 0, failed: 0 };

        try {
            logger.info(`🌐 ${workerId}: [POD] Launch browser cho ${jobs.length} orders`);

            const result = await this.getBrowserWithSession(ecountLink);
            browser = result.browser;
            context = result.context;
            page = result.page;

            for (let i = 0; i < jobs.length; i++) {
                const job = jobs[i];
                try {
                    logger.info(`  📝 ${workerId}: [POD] [${i + 1}/${jobs.length}] ${job.payload.erpOrderCode}`);
                    await this.processJobInBrowser(job, page);
                    await JobModel.markCompleted(job.id, { success: true });
                    stats.success++;
                    logger.info(`  ✅ ${workerId}: [POD] [${i + 1}/${jobs.length}] Success`);
                } catch (error) {
                    logger.error(`  ❌ ${workerId}: [POD] [${i + 1}/${jobs.length}] Failed: ${error.message}`);
                    await JobModel.markFailed(job.id, error.message, true);
                    if (page) await this.saveDebugInfo(page, job.payload.erpOrderCode);
                    stats.failed++;
                }

                if (i < jobs.length - 1) {
                    await page.waitForTimeout(1000);
                }
            }

            logger.info(`✅ ${workerId}: [POD] Browser hoàn thành - ${stats.success}/${jobs.length} success`);

        } catch (error) {
            logger.error(`❌ ${workerId}: [POD] Browser error: ${error.message}`);
            const remaining = jobs.length - (stats.success + stats.failed);
            if (remaining > 0) {
                for (let i = stats.success + stats.failed; i < jobs.length; i++) {
                    await JobModel.markFailed(jobs[i].id, 'Browser error: ' + error.message, true);
                    stats.failed++;
                }
            }
        } finally {
            if (browser) {
                await browser.close();
                logger.info(`🔒 ${workerId}: [POD] Browser closed`);
            }
        }

        return stats;
    }

    groupJobsByEcountLink(jobs) {
        const groups = {};
        jobs.forEach(job => {
            const ecountLink = job.payload.ecountLink || 'default';
            if (!groups[ecountLink]) groups[ecountLink] = [];
            groups[ecountLink].push(job);
        });
        return groups;
    }

    async processJobInBrowser(job, page) {
        const { orderId, erpOrderCode, trackingNumber } = job.payload;

        const order = await OrderModel.findById(orderId);
        if (!order) throw new Error(`Order ${orderId} not found`);

        const waybillNumber = order.waybill_number || '';
        let labelUrl = null;
        if (order.label_url) {
            if (order.label_access_key && process.env.SHORT_LINK_LABEL == 'true') {
                const baseUrl = process.env.BASE_URL || '';
                labelUrl = `${baseUrl}/api/labels/${order.label_access_key}`;
            } else {
                labelUrl = order.label_url;
            }
        }

        await this.searchOrder(page, erpOrderCode);
        await this.updateTrackingNumber(page, trackingNumber, waybillNumber, labelUrl);

        await OrderModel.update(orderId, { erpTrackingNumberUpdated: true });

        logger.info(`✓ [POD] Updated tracking for order ${orderId}`);
    }

    // ========== Browser helpers (podSessionManager + config.ecount_pod) ==========

    async getBrowserWithSession(ecountLink) {
        const session = await this.sessionManager.getSession();
        const browser = await chromium.launch(this.playwrightConfig.launchOptions);

        try {
            const context = await browser.newContext(this.playwrightConfig.contextOptions);
            const page = await context.newPage();

            page.setDefaultNavigationTimeout(this.playwrightConfig.timeout);
            page.setDefaultTimeout(this.playwrightConfig.timeout);

            if (session) {
                logger.info('[POD] Sử dụng session có sẵn');

                const urlParams = session.url_params;
                const baseUrl = this.ecountConfig.baseUrl.replace('login.ecount.com', 'loginia.ecount.com');
                const sessionUrl = `${baseUrl}/ec5/view/erp?w_flag=${urlParams.w_flag}&ec_req_sid=${urlParams.ec_req_sid}${ecountLink}`;

                const baseDomain = new URL(baseUrl).origin;
                await page.goto(baseDomain, { waitUntil: 'domcontentloaded', timeout: this.playwrightConfig.timeout });

                const cookiesToSet = session.cookies.map(cookie => {
                    const fixedCookie = { ...cookie };
                    if (fixedCookie.domain && !baseDomain.includes(fixedCookie.domain.replace(/^\./, ''))) {
                        fixedCookie.domain = new URL(baseDomain).hostname;
                    }
                    return fixedCookie;
                });

                await context.addCookies(cookiesToSet);
                await page.goto(sessionUrl, { waitUntil: 'domcontentloaded', timeout: this.playwrightConfig.timeout });

                if (!page.url().includes('ec_req_sid')) {
                    logger.warn('[POD] Session expired (có thể bị kick bởi Express login)');
                    await this.sessionManager.clearSession();
                    throw new Error('SESSION_EXPIRED');
                }

                logger.info('[POD] Đã sử dụng session thành công');

            } else {
                logger.info('[POD] Không có session, đang login...');

                // Acquire login lock để tránh Express + POD login đồng thời
                if (!this.sessionManager.acquireLoginLock()) {
                    throw new Error('SESSION_LOGIN_LOCKED');
                }

                try {
                    await this.login(page);

                    const cookies = await context.cookies();
                    const currentUrl = page.url();
                    const urlObj = new URL(currentUrl);
                    const urlParams = {
                        w_flag: urlObj.searchParams.get('w_flag'),
                        ec_req_sid: urlObj.searchParams.get('ec_req_sid')
                    };

                    // Lưu session (sẽ cross-invalidate Express session)
                    await this.sessionManager.saveSession(cookies, urlParams, 30);

                    const baseUrl = this.ecountConfig.baseUrl.replace('login.ecount.com', 'loginia.ecount.com');
                    const targetUrl = `${baseUrl}/ec5/view/erp?w_flag=${urlParams.w_flag}&ec_req_sid=${urlParams.ec_req_sid}${ecountLink}`;

                    if (!currentUrl.includes(ecountLink)) {
                        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: this.playwrightConfig.timeout });
                        await page.waitForFunction(() => document.readyState === 'complete' && window.frames.length > 0, null, { timeout: this.playwrightConfig.timeout });
                    }

                    logger.info('[POD] Đã login và navigate thành công');
                } finally {
                    this.sessionManager.releaseLoginLock();
                }
            }

            return { browser, context, page };

        } catch (error) {
            await browser.close();
            throw error;
        }
    }

    async login(page) {
        logger.info('[POD] Đăng nhập ECount POD...');

        await page.goto(
            `${this.ecountConfig.baseUrl}/?xurl_rd=Y&login_lantype=&lan_type=vi-VN`,
            { waitUntil: 'networkidle', timeout: this.playwrightConfig.timeout }
        );

        const hasLoginForm = await page.$('#com_code');
        if (hasLoginForm) {
            await page.fill('#com_code', this.ecountConfig.companyCode);
            await page.fill('#id', this.ecountConfig.id);
            await page.fill('#passwd', this.ecountConfig.password);

            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle', timeout: this.playwrightConfig.timeout }),
                page.click('button#save')
            ]);

            try {
                const hasPopup = await page.waitForSelector('#toolbar_sid_toolbar_item_non_regist', { state: 'visible', timeout: 3000 }).catch(() => null);
                if (hasPopup) {
                    await page.click('#toolbar_sid_toolbar_item_non_regist');
                    await page.waitForTimeout(1000);
                }
            } catch (e) { /* no popup */ }

            logger.info('[POD] Đã đăng nhập thành công');
        }
    }

    async searchOrder(page, orderCode) {
        const searchFrame = await this.findFrameWithSelector(page, '#quick_search');

        await searchFrame.waitForFunction(() => {
            const input = document.querySelector('#quick_search');
            return input && window.getComputedStyle(input).display !== 'none' && !input.disabled;
        }, null, { timeout: this.playwrightConfig.timeout });

        await searchFrame.evaluate(() => {
            const input = document.querySelector('#quick_search');
            if (input) { input.value = ''; input.focus(); }
        });

        await searchFrame.type('#quick_search', orderCode, { delay: 50 });
        await searchFrame.waitForTimeout(2000);

        await Promise.all([
            searchFrame.waitForFunction(({ orderCode }) => {
                const loading = document.querySelector('.page-progress-icon');
                if (loading && window.getComputedStyle(loading).display !== 'none') return false;
                const firstRow = document.querySelector('#app-root .wrapper-frame-body .contents tbody tr');
                if (!firstRow) return false;
                const cells = firstRow.querySelectorAll('td');
                return Array.from(cells).some(cell => {
                    const text = cell.textContent.trim();
                    return text == orderCode || text.includes(orderCode);
                });
            }, { orderCode }, { timeout: this.playwrightConfig.timeout }),
            searchFrame.press('#quick_search', 'Enter')
        ]);
    }

    async updateTrackingNumber(page, trackingNumber, waybillNumber = '', labelUrl = null) {
        const dataFrame = await this.findFrameWithSelector(page, '#app-root .wrapper-frame-body .contents tbody tr');

        await dataFrame.waitForSelector('#app-root .wrapper-frame-body .contents tbody tr', { state: 'visible', timeout: this.playwrightConfig.timeout });

        await dataFrame.evaluate(() => {
            const linkModal = document.querySelector('#app-root .wrapper-frame-body .contents tbody tr a[id][data-item-key]');
            if (!linkModal) throw new Error('Không tìm thấy link để mở modal');
            linkModal.click();
        });

        await dataFrame.waitForSelector('[data-container="popup-body"] .contents [placeholder="Lastmile tracking"]', { state: 'visible', timeout: this.playwrightConfig.timeout });

        await dataFrame.waitForFunction(() => {
            const input = document.querySelector('[data-container="popup-body"] .contents [placeholder="Lastmile tracking"]');
            return input && !input.disabled;
        }, null, { timeout: this.playwrightConfig.timeout });

        await dataFrame.evaluate(({ trackingNumber, waybillNumber, labelUrl }) => {
            const input = document.querySelector('[data-container="popup-body"] .contents [placeholder="Lastmile tracking"]');
            if (!input) throw new Error('Không tìm thấy input Tracking number');

            input.value = trackingNumber;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));

            if (labelUrl) {
                const labelInput = document.querySelector('[data-container="popup-body"] .contents [placeholder="Shipping label"]');
                if (labelInput) {
                    labelInput.value = labelUrl;
                    labelInput.dispatchEvent(new Event('input', { bubbles: true }));
                    labelInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }

            if (waybillNumber && waybillNumber != '') {
                const waybillInput = document.querySelector('[data-container="popup-body"] .contents [placeholder="Master tracking"]');
                if (waybillInput) {
                    waybillInput.value = waybillNumber;
                    waybillInput.dispatchEvent(new Event('input', { bubbles: true }));
                    waybillInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        }, { trackingNumber, waybillNumber, labelUrl });

        await this.verifyTrackingUpdate(dataFrame, trackingNumber, waybillNumber, labelUrl);
    }

    async verifyTrackingUpdate(dataFrame, trackingNumber, waybillNumber = '', labelUrl = null) {
        const maxRetries = 10;
        const retryDelay = 1000;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            await dataFrame.evaluate(() => {
                const submitBtn = document.querySelector('[data-container="popup-body"] .footer #group3slipSave');
                if (submitBtn) submitBtn.click();
            });

            try {
                const result = await dataFrame.evaluate(({ trackingNumber, waybillNumber, labelUrl }) => {
                    const headers = Array.from(document.querySelectorAll('#app-root .wrapper-frame-body .contents thead th'));
                    const trackingIdx = headers.findIndex(th => th.textContent.trim().normalize('NFC').includes('Lastmile tracking'));
                    const masterIdx = headers.findIndex(th => th.textContent.trim().normalize('NFC').includes('Master tracking'));
                    const labelIdx = headers.findIndex(th => th.textContent.trim().normalize('NFC').includes('Shipping label'));

                    const firstRow = document.querySelector('#app-root .wrapper-frame-body .contents tbody tr');
                    if (!firstRow) return { success: false, reason: 'No row found' };
                    const cells = firstRow.querySelectorAll('td');

                    if (trackingNumber && trackingIdx !== -1) {
                        const val = cells[trackingIdx]?.textContent.normalize('NFC').trim();
                        if (val !== trackingNumber) return { success: false, reason: `Tracking mismatch: "${val}" vs "${trackingNumber}"` };
                    }
                    if (waybillNumber && waybillNumber !== '' && masterIdx !== -1) {
                        const val = cells[masterIdx]?.textContent.normalize('NFC').trim();
                        if (val !== waybillNumber) return { success: false, reason: `Master mismatch: "${val}" vs "${waybillNumber}"` };
                    }
                    if (labelUrl && labelUrl !== '' && labelIdx !== -1) {
                        const val = cells[labelIdx]?.textContent.normalize('NFC').trim();
                        if (val !== labelUrl) return { success: false, reason: `Label mismatch: "${val}" vs "${labelUrl}"` };
                    }

                    return { success: true, values: {
                        trackingLastMile: trackingIdx !== -1 ? cells[trackingIdx]?.textContent.trim() : null,
                        masterTracking: masterIdx !== -1 ? cells[masterIdx]?.textContent.trim() : null,
                        shippingLabel: labelIdx !== -1 ? cells[labelIdx]?.textContent.trim() : null
                    }};
                }, { trackingNumber, waybillNumber, labelUrl });

                if (result.success) {
                    logger.info(`✓ [POD] Verify thành công sau ${attempt} lần thử:`, result.values);
                    return;
                }
                if (attempt < maxRetries) await dataFrame.waitForTimeout(retryDelay);
            } catch (error) {
                if (attempt < maxRetries) await dataFrame.waitForTimeout(retryDelay);
            }
        }

        throw new Error(`[POD] Verify tracking update thất bại sau ${maxRetries} lần thử.`);
    }

    async findFrameWithSelector(page, selector, timeout = null) {
        timeout = timeout || this.playwrightConfig.timeout;
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            for (const frame of page.frames()) {
                try { if (await frame.$(selector)) return frame; } catch (e) { }
            }
            await page.waitForTimeout(100);
        }
        throw new Error(`[POD] Không tìm thấy frame chứa selector: ${selector}`);
    }

    async saveDebugInfo(page, orderCode) {
        try {
            const ts = Date.now();
            const safe = orderCode.replace(/[^a-zA-Z0-9]/g, '_');
            await page.screenshot({ path: path.join(this.screenshotDir, `pod_tracking_error_${safe}_${ts}.png`), fullPage: true });
            fs.writeFileSync(path.join(this.screenshotDir, `pod_tracking_error_${safe}_${ts}.html`), await page.content());
        } catch (e) {
            logger.error('[POD] Không thể lưu debug files:', e.message);
        }
    }

    async onJobMaxAttemptsReached(job, error) {
        await telegram.notifyError(error, {
            action: 'POD Batch Update Tracking',
            jobId: job.id,
            orderId: job.payload.orderId,
            erpOrderCode: job.payload.erpOrderCode,
            message: '[POD] Failed after max attempts in batch processing'
        }, { type: 'error' });
    }
}

module.exports = PodUpdateTrackingBatchWorker;
