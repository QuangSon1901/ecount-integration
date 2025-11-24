const { chromium } = require('playwright');
const BaseWorker = require('./base.worker');
const OrderModel = require('../../models/order.model');
const sessionManager = require('../../services/erp/ecount-session.manager');
const telegram = require('../../utils/telegram');
const logger = require('../../utils/logger');
const config = require('../../config');
const path = require('path');
const fs = require('fs');

class UpdateTrackingBatchWorker extends BaseWorker {
    constructor() {
        super('update_tracking_ecount', {
            intervalMs: 10000,    // Check mỗi 10s
            concurrency: 1        // Chỉ chạy 1 batch worker
        });

        this.playwrightConfig = config.playwright;
        this.ecountConfig = config.ecount;
        this.screenshotDir = path.join(__dirname, '../../../logs/screenshots');

        if (!fs.existsSync(this.screenshotDir)) {
            fs.mkdirSync(this.screenshotDir, { recursive: true });
        }

        // Batch configuration
        this.maxBatchSize = 10; // Xử lý tối đa 10 orders/batch
        this.maxConcurrentBrowsers = this.playwrightConfig.concurrentBrowsers || 2;
    }

    /**
     * Override processJobs để xử lý theo batch
     */
    async processJobs() {
        try {
            // Reset stuck jobs
            await this.JobModel.resetStuckJobs(30);

            if (this.activeJobs.size > 0) {
                return; // Đang xử lý batch khác
            }

            // Lấy batch jobs
            const jobs = await this.getNextJobsBatch(this.maxBatchSize);

            if (jobs.length === 0) {
                return;
            }

            logger.info(`${this.jobType} batch worker: processing ${jobs.length} jobs`);

            // Đánh dấu đang xử lý
            this.activeJobs.add('batch');

            try {
                await this.processBatch(jobs);
            } finally {
                this.activeJobs.delete('batch');
            }

        } catch (error) {
            logger.error(`Error in ${this.jobType} batch worker:`, error);
        }
    }

    /**
     * Lấy batch jobs
     */
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
                        logger.error('Failed to parse payload for job ${ job.id }:', e);
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

    /**
     * Xử lý batch jobs với concurrent browsers
     */
    async processBatch(jobs) {
        const startTime = Date.now();
        logger.info(`Bắt đầu xử lý batch ${jobs.length} orders`);

        // Nhóm jobs theo ecountLink
        const jobsByLink = this.groupJobsByEcountLink(jobs);

        logger.info(`Nhóm thành ${Object.keys(jobsByLink).length} groups theo ecountLink`);

        // Xử lý từng group song song (tối đa maxConcurrentBrowsers)
        const groups = Object.entries(jobsByLink);
        const results = [];

        for (let i = 0; i < groups.length; i += this.maxConcurrentBrowsers) {
            const batch = groups.slice(i, i + this.maxConcurrentBrowsers);

            logger.info(`Xử lý batch ${i / this.maxConcurrentBrowsers + 1}/${Math.ceil(groups.length / this.maxConcurrentBrowsers)} với ${batch.length} browsers`);

            const batchPromises = batch.map(([ecountLink, groupJobs]) =>
                this.processGroup(ecountLink, groupJobs)
            );

            const batchResults = await Promise.allSettled(batchPromises);
            results.push(...batchResults);
        }

        // Tổng hợp kết quả
        const stats = {
            total: jobs.length,
            success: 0,
            failed: 0,
            duration: Date.now() - startTime
        };

        results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                stats.success += result.value.success;
                stats.failed += result.value.failed;
            } else {
                logger.error(`Group ${index} failed:`, result.reason);
                stats.failed += groups[index][1].length;
            }
        });

        logger.info(`Hoàn thành batch processing:`, {
            ...stats,
            avgTimePerOrder: (stats.duration / stats.total).toFixed(0) + 'ms'
        });

        // Gửi telegram nếu có lỗi
        if (stats.failed > 0) {
            await telegram.notifyWarning('Batch Update Tracking Completed with Errors', {
                total: stats.total,
                success: stats.success,
                failed: stats.failed,
                duration: (stats.duration / 1000).toFixed(1) + 's'
            });
        }
    }

    /**
     * Nhóm jobs theo ecountLink
     */
    groupJobsByEcountLink(jobs) {
        const groups = {};

        jobs.forEach(job => {
            const ecountLink = job.payload.ecountLink || 'default';
            if (!groups[ecountLink]) {
                groups[ecountLink] = [];
            }
            groups[ecountLink].push(job);
        });

        return groups;
    }

    /**
     * Xử lý một group jobs (dùng chung 1 browser)
     */
    async processGroup(ecountLink, jobs) {
        let browser, context, page;
        const stats = { success: 0, failed: 0 };

        try {
            logger.info(`Processing group với ${jobs.length} orders (ecountLink: ${ecountLink.substring(0, 30)}...)`);

            // Launch browser
            const result = await this.getBrowserWithSession(ecountLink);
            browser = result.browser;
            context = result.context;
            page = result.page;

            // Xử lý từng order tuần tự
            for (const job of jobs) {
                try {
                    await this.processJobInBrowser(job, page);
                    await this.markJobCompleted(job.id, { success: true });
                    stats.success++;
                } catch (error) {
                    logger.error(`Job ${job.id} failed:`, error.message);
                    await this.markJobFailed(job.id, error.message);
                    stats.failed++;
                }

                // Delay giữa các orders
                await page.waitForTimeout(1000);
            }

        } catch (error) {
            logger.error('Group processing failed:', error.message);

            // Mark tất cả jobs còn lại là failed
            for (const job of jobs) {
                if (stats.success + stats.failed < jobs.length) {
                    await this.markJobFailed(job.id, 'Browser error: ' + error.message);
                    stats.failed++;
                }
            }

        } finally {
            if (browser) {
                await browser.close();
            }
        }

        return stats;
    }

    /**
     * Xử lý 1 job trong browser đã có sẵn
     */
    async processJobInBrowser(job, page) {
        const { orderId, erpOrderCode, trackingNumber, ecountLink } = job.payload;

        logger.info(`Processing order ${orderId} - ${erpOrderCode}`);

        const order = await OrderModel.findById(orderId);
        if (!order) {
            throw new Error(`Order ${orderId} not found`);
        }

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

        // Search order
        await this.searchOrder(page, erpOrderCode);

        // Update tracking
        await this.updateTrackingNumber(page, trackingNumber, waybillNumber, labelUrl);

        // Update DB
        await OrderModel.update(orderId, {
            erpTrackingNumberUpdated: true,
        });

        logger.info(`✓ Updated tracking for order ${orderId}`);
    }

    /**
     * Mark job completed
     */
    async markJobCompleted(jobId, result) {
        const JobModel = require('../../models/job.model');
        await JobModel.markCompleted(jobId, result);
    }

    /**
     * Mark job failed
     */
    async markJobFailed(jobId, errorMessage) {
        const JobModel = require('../../models/job.model');
        await JobModel.markFailed(jobId, errorMessage, true);
    }

    /**
     * Lấy browser với session (tương tự PlaywrightECountService)
     */
    async getBrowserWithSession(ecountLink) {
        const session = await sessionManager.getSession();

        const browser = await chromium.launch(this.playwrightConfig.launchOptions);

        try {
            const context = await browser.newContext(this.playwrightConfig.contextOptions);
            const page = await context.newPage();

            page.setDefaultNavigationTimeout(this.playwrightConfig.timeout);
            page.setDefaultTimeout(this.playwrightConfig.timeout);

            if (session) {
                logger.info('Sử dụng session có sẵn');

                const urlParams = session.url_params;
                const baseUrl = this.ecountConfig.baseUrl.replace('login.ecount.com', 'loginia.ecount.com');
                const sessionUrl = `${baseUrl}/ec5/view/erp?w_flag=${urlParams.w_flag}&ec_req_sid=${urlParams.ec_req_sid}${ecountLink}`;

                const baseDomain = new URL(baseUrl).origin;
                await page.goto(baseDomain, {
                    waitUntil: 'domcontentloaded',
                    timeout: this.playwrightConfig.timeout
                });

                const cookiesToSet = session.cookies.map(cookie => {
                    const fixedCookie = { ...cookie };
                    if (fixedCookie.domain && !baseDomain.includes(fixedCookie.domain.replace(/^\./, ''))) {
                        const baseHostname = new URL(baseDomain).hostname;
                        fixedCookie.domain = baseHostname;
                    }
                    return fixedCookie;
                });

                await context.addCookies(cookiesToSet);

                await page.goto(sessionUrl, {
                    waitUntil: 'domcontentloaded',
                    timeout: this.playwrightConfig.timeout
                });

                const currentUrl = page.url();
                if (!currentUrl.includes('ec_req_sid')) {
                    logger.warn('Session expired');
                    await sessionManager.clearSession();
                    throw new Error('SESSION_EXPIRED');
                }

            } else {
                logger.info('Login mới...');
                await this.login(page);

                const cookies = await context.cookies();
                const currentUrl = page.url();
                const urlObj = new URL(currentUrl);
                const urlParams = {
                    w_flag: urlObj.searchParams.get('w_flag'),
                    ec_req_sid: urlObj.searchParams.get('ec_req_sid')
                };

                await sessionManager.saveSession(cookies, urlParams, 30);
                await this.navigateToOrderManagement(page, ecountLink);
            }

            return { browser, context, page };

        } catch (error) {
            await browser.close();
            throw error;
        }
    }

    /**
     * Login (copy từ PlaywrightECountService)
     */
    async login(page) {
        logger.info('Đăng nhập ECount...');

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

            const hasPopup = await page.$('#toolbar_sid_toolbar_item_non_regist');
            if (hasPopup) {
                await page.click('#toolbar_sid_toolbar_item_non_regist');
                await page.waitForTimeout(1000);
            }

            logger.info('Đã đăng nhập');
        }
    }

    /**
     * Navigate to order management
     */
    async navigateToOrderManagement(page, ecountLink) {
        const currentUrl = page.url();
        const urlObj = new URL(currentUrl);
        const baseUrl = urlObj.origin + urlObj.pathname + urlObj.search;
        const targetUrl = `${baseUrl}${ecountLink}`;

        await page.goto(targetUrl, {
            waitUntil: 'networkidle',
            timeout: this.playwrightConfig.timeout
        });

        await page.waitForFunction(() => {
            const frames = window.frames;
            return document.readyState === 'complete' && frames.length > 0;
        }, null, { timeout: this.playwrightConfig.timeout });
    }

    /**
     * Search order
     */
    async searchOrder(page, orderCode) {
        const searchFrame = await this.findFrameWithSelector(page, '#quick_search');

        await searchFrame.waitForFunction(
            () => {
                const input = document.querySelector('#quick_search');
                return input !== null &&
                    window.getComputedStyle(input).display !== 'none' &&
                    !input.disabled;
            },
            null,
            { timeout: this.playwrightConfig.timeout }
        );

        await searchFrame.evaluate(() => {
            const input = document.querySelector('#quick_search');
            if (input) {
                input.value = '';
                input.focus();
            }
        });

        await searchFrame.type('#quick_search', orderCode, { delay: 50 });
        await searchFrame.waitForTimeout(2000);

        await Promise.all([
            searchFrame.waitForFunction(
                (orderCode) => {
                    const loading = document.querySelector('.page-progress-icon');
                    if (loading && window.getComputedStyle(loading).display !== 'none') {
                        return false;
                    }

                    const firstRow = document.querySelector('#app-root .wrapper-frame-body .contents tbody tr');
                    if (!firstRow) return false;

                    const cells = firstRow.querySelectorAll('td');
                    return Array.from(cells).some(cell => {
                        const text = cell.textContent.trim();
                        return text == orderCode || text.includes(orderCode);
                    });
                },
                orderCode,
                { timeout: this.playwrightConfig.timeout }
            ),
            searchFrame.press('#quick_search', 'Enter')
        ]);
    }

    /**
     * Update tracking number
     */
    async updateTrackingNumber(page, trackingNumber, waybillNumber = '', labelUrl = null) {
        const dataFrame = await this.findFrameWithSelector(
            page,
            '#app-root .wrapper-frame-body .contents tbody tr'
        );

        await dataFrame.waitForSelector('#app-root .wrapper-frame-body .contents tbody tr', {
            state: 'visible',
            timeout: this.playwrightConfig.timeout
        });

        await dataFrame.evaluate(() => {
            const linkModal = document.querySelector('#app-root .wrapper-frame-body .contents tbody tr a[id][data-item-key]');
            if (!linkModal) throw new Error('Không tìm thấy link để mở modal');
            linkModal.click();
        });

        await dataFrame.waitForSelector(
            '[data-container="popup-body"] .contents [placeholder="Tracking last mile"]',
            { state: 'visible', timeout: this.playwrightConfig.timeout }
        );

        await dataFrame.waitForFunction(
            () => {
                const input = document.querySelector('[data-container="popup-body"] .contents [placeholder="Tracking last mile"]');
                return input && !input.disabled;
            },
            null,
            { timeout: this.playwrightConfig.timeout }
        );

        await dataFrame.evaluate((trackingNumber, waybillNumber, labelUrl) => {
            const input = document.querySelector('[data-container="popup-body"] .contents [placeholder="Tracking last mile"]');
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
        }, trackingNumber, waybillNumber, labelUrl);

        await page.keyboard.press('F8');
        await page.waitForTimeout(2000);
    }

    /**
     * Find frame with selector
     */
    async findFrameWithSelector(page, selector, timeout = null) {
        timeout = timeout || this.playwrightConfig.timeout;
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            const frames = page.frames();

            for (const frame of frames) {
                try {
                    const element = await frame.$(selector);
                    if (element) {
                        return frame;
                    }
                } catch (e) {
                    // Frame chưa ready
                }
            }

            await page.waitForTimeout(100);
        }

        throw new Error(`Không tìm thấy frame chứa selector: ${selector}`);
    }

    async onJobMaxAttemptsReached(job, error) {
        // Gửi telegram và reschedule
        await telegram.notifyError(error, {
            action: 'Batch Update Tracking',
            jobId: job.id,
            orderId: job.payload.orderId,
            erpOrderCode: job.payload.erpOrderCode,
            message: 'Failed after max attempts in batch processing'
        }, { type: 'error' });
    }
}

module.exports = UpdateTrackingBatchWorker;