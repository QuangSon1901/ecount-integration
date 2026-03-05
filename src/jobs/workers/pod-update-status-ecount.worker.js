// src/jobs/workers/pod-update-status-ecount.worker.js
// Playwright batch worker cho POD Ecount status - tương tự update-status-batch.worker.js
// Dùng podSessionManager + config.ecount_pod thay vì sessionManager + config.ecount
const { chromium } = require('playwright');
const BaseWorker = require('./base.worker');
const OrderModel = require('../../models/order.model');
const JobModel = require('../../models/job.model');
const { podSessionManager } = require('../../services/erp/ecount-session.manager');
const jobService = require('../../services/queue/job.service');
const telegram = require('../../utils/telegram');
const logger = require('../../utils/logger');
const config = require('../../config');
const path = require('path');
const fs = require('fs');

class PodUpdateStatusBatchWorker extends BaseWorker {
    constructor() {
        super('pod_update_status_ecount', {
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

            const workerId = `pod-status-${Date.now()}-${Math.random().toString(36).substring(7)}`;

            logger.info(`🚀 ${workerId}: [POD] Bắt đầu xử lý ${jobs.length} status jobs (active: ${this.activeJobs.size + 1}/${this.maxConcurrentWorkers})`);

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
        const { orderId, erpOrderCode, trackingNumber, status } = job.payload;

        const order = await OrderModel.findById(orderId);
        if (!order) throw new Error(`Order ${orderId} not found`);

        // Search order
        await this.searchOrder(page, erpOrderCode);

        // Update status
        await this.updateOrderStatus(page, status, orderId);

        // Update DB
        await OrderModel.update(orderId, {
            erpUpdated: true,
            erpStatus: status
        });

        logger.info(`✓ [POD] Updated status for order ${orderId}`);
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
                    logger.warn('[POD] Session expired');
                    await this.sessionManager.clearSession();
                    throw new Error('SESSION_EXPIRED');
                }

                logger.info('[POD] Đã sử dụng session thành công');

            } else {
                logger.info('[POD] Không có session, đang login...');
                await this.login(page);

                const cookies = await context.cookies();
                const currentUrl = page.url();
                const urlObj = new URL(currentUrl);
                const urlParams = {
                    w_flag: urlObj.searchParams.get('w_flag'),
                    ec_req_sid: urlObj.searchParams.get('ec_req_sid')
                };

                await this.sessionManager.saveSession(cookies, urlParams, 30);

                const baseUrl = this.ecountConfig.baseUrl.replace('login.ecount.com', 'loginia.ecount.com');
                const targetUrl = `${baseUrl}/ec5/view/erp?w_flag=${urlParams.w_flag}&ec_req_sid=${urlParams.ec_req_sid}${ecountLink}`;

                if (!currentUrl.includes(ecountLink)) {
                    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: this.playwrightConfig.timeout });
                    await page.waitForFunction(() => document.readyState === 'complete' && window.frames.length > 0, null, { timeout: this.playwrightConfig.timeout });
                }

                logger.info('[POD] Đã login và navigate thành công');
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

    async updateOrderStatus(page, status, orderId) {
        logger.info('[POD] Cập nhật trạng thái: ' + status);

        const dataFrame = await this.findFrameWithSelector(page, '#app-root .wrapper-frame-body .contents tbody tr');

        await dataFrame.waitForSelector('#app-root .wrapper-frame-body .contents tbody tr', { state: 'visible', timeout: this.playwrightConfig.timeout });

        // Click button status dropdown
        await dataFrame.evaluate(() => {
            const firstRow = document.querySelector('#app-root .wrapper-frame-body .contents tbody tr');
            if (!firstRow) throw new Error('Không tìm thấy record');
            const button = firstRow.querySelector('.control-set:has(a) a');
            if (!button) throw new Error('Không tìm thấy status button');
            button.click();
        });

        // Chờ dropdown
        await dataFrame.waitForSelector('.dropdown-menu [data-baseid] li span', { state: 'visible', timeout: this.playwrightConfig.timeout });

        // Click status
        const statusUpdated = await dataFrame.evaluate((targetStatus) => {
            const spans = document.querySelectorAll('.dropdown-menu [data-baseid] li span');
            if (spans.length === 0) throw new Error('Không tìm thấy danh sách trạng thái');
            let found = false;
            spans.forEach(span => {
                const text = span.innerText.normalize('NFC').trim();
                if (text === targetStatus) { span.click(); found = true; }
            });
            return found;
        }, status);

        if (!statusUpdated) {
            throw new Error(`Không tìm thấy trạng thái: "${status}"`);
        }

        await this.verifyStatusUpdate(dataFrame, status, orderId);
    }

    async verifyStatusUpdate(dataFrame, expectedStatus, orderId) {
        const maxRetries = 10;
        const retryDelay = 1000;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const result = await dataFrame.evaluate((targetStatus) => {
                    const firstRow = document.querySelector('#app-root .wrapper-frame-body .contents tbody tr');
                    if (!firstRow) return { success: false, reason: 'No row' };

                    const statusCell = firstRow.querySelector('.control-set:has(a) a');
                    if (!statusCell) return { success: false, reason: 'No status cell' };

                    const currentStatus = statusCell.textContent.normalize('NFC').trim();
                    if (currentStatus !== targetStatus) {
                        return { success: false, reason: `Mismatch: "${currentStatus}" vs "${targetStatus}"`, currentValue: currentStatus };
                    }

                    return { success: true, currentValue: currentStatus };
                }, expectedStatus);

                if (result.success) {
                    logger.info(`✓ [POD] Verify status thành công sau ${attempt} lần thử: "${result.currentValue}"`);
                    return;
                }

                if (attempt < maxRetries) await dataFrame.waitForTimeout(retryDelay);
            } catch (error) {
                if (attempt < maxRetries) await dataFrame.waitForTimeout(retryDelay);
            }
        }

        throw new Error(`[POD] Verify status update thất bại sau ${maxRetries} lần thử cho "${expectedStatus}".`);
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
            await page.screenshot({ path: path.join(this.screenshotDir, `pod_status_error_${safe}_${ts}.png`), fullPage: true });
            fs.writeFileSync(path.join(this.screenshotDir, `pod_status_error_${safe}_${ts}.html`), await page.content());
        } catch (e) {
            logger.error('[POD] Không thể lưu debug files:', e.message);
        }
    }

    async onJobMaxAttemptsReached(job, error) {
        const { orderId, erpOrderCode, trackingNumber, status } = job.payload;

        try {
            await telegram.notifyError(error, {
                action: 'POD Batch Update Status',
                jobName: job.job_type,
                jobId: job.id,
                orderId,
                erpOrderCode,
                trackingNumber,
                status,
                message: `⚠️ [POD] Job failed after max attempts.`
            }, { type: 'error' });
        } catch (retryError) {
            logger.error(`[POD] Failed to notify error for job ${job.id}:`, retryError);
        }
    }
}

module.exports = PodUpdateStatusBatchWorker;
