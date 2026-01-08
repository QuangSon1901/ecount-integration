const { chromium } = require('playwright');
const BaseWorker = require('./base.worker');
const OrderModel = require('../../models/order.model');
const JobModel = require('../../models/job.model');
const sessionManager = require('../../services/erp/ecount-session.manager');
const telegram = require('../../utils/telegram');
const logger = require('../../utils/logger');
const config = require('../../config');
const path = require('path');
const fs = require('fs');

class UpdateWarningBatchWorker extends BaseWorker {
    constructor() {
        super('update_warning_ecount', {
            intervalMs: 10000,    // Check mỗi 10s
            concurrency: 2        // Chạy 2 workers song song
        });
        
        this.playwrightConfig = config.playwright;
        this.ecountConfig = config.ecount;
        this.screenshotDir = path.join(__dirname, '../../../logs/screenshots');
        
        if (!fs.existsSync(this.screenshotDir)) {
            fs.mkdirSync(this.screenshotDir, { recursive: true });
        }

        this.maxBatchSize = 10; // Mỗi worker lấy 10 jobs
        this.maxConcurrentWorkers = 2;
    }

    /**
     * Override processJobs để xử lý theo batch
     */
    async processJobs() {
        try {
            // Reset stuck jobs - chỉ gọi 1 lần
            if (this.activeJobs.size === 0) {
                await JobModel.resetStuckJobs(30);
            }

            // Check giới hạn workers
            if (this.activeJobs.size >= this.maxConcurrentWorkers) {
                logger.debug(`Đã đạt giới hạn ${this.maxConcurrentWorkers} workers, chờ...`);
                return;
            }

            // Lấy batch jobs
            const jobs = await this.getNextJobsBatch(this.maxBatchSize);
            
            if (jobs.length === 0) {
                return;
            }

            const workerId = `worker-${Date.now()}-${Math.random().toString(36).substring(7)}`;
            
            logger.info(`🚀 [WARNING] ${workerId}: Bắt đầu xử lý ${jobs.length} jobs (active: ${this.activeJobs.size + 1}/${this.maxConcurrentWorkers})`);

            // Đánh dấu worker đang chạy
            this.activeJobs.add(workerId);

            try {
                await this.processBatch(jobs, workerId);
            } finally {
                this.activeJobs.delete(workerId);
                logger.info(`🏁 [WARNING] ${workerId}: Đã hoàn thành (active: ${this.activeJobs.size}/${this.maxConcurrentWorkers})`);
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
                        logger.error(`Failed to parse payload for job ${job.id}:`, e);
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

        // Nhóm jobs theo ecountLink
        const jobsByLink = this.groupJobsByEcountLink(jobs);
        
        logger.info(`${workerId}: Nhóm thành ${Object.keys(jobsByLink).length} groups theo ecountLink`);

        // Xử lý từng group tuần tự
        const results = [];
        const groups = Object.entries(jobsByLink);

        for (let i = 0; i < groups.length; i++) {
            const [ecountLink, groupJobs] = groups[i];
            
            logger.info(`${workerId}: Group ${i + 1}/${groups.length} - ${groupJobs.length} orders`);
            
            try {
                const result = await this.processGroup(ecountLink, groupJobs, workerId);
                results.push({ status: 'fulfilled', value: result });
            } catch (error) {
                logger.error(`${workerId}: Group ${i + 1} failed:`, error);
                results.push({ status: 'rejected', reason: error });
                
                // Mark all jobs failed
                for (const job of groupJobs) {
                    await JobModel.markFailed(job.id, `Group error: ${error.message}`, true);
                }
            }
        }

        // Tổng hợp kết quả
        const stats = {
            total: jobs.length,
            success: 0,
            failed: 0,
            duration: Date.now() - startTime
        };

        results.forEach((result) => {
            if (result.status === 'fulfilled') {
                stats.success += result.value.success;
                stats.failed += result.value.failed;
            }
        });

        logger.info(`✅ [WARNING] ${workerId}: Hoàn thành`, {
            ...stats,
            avgTimePerOrder: stats.total > 0 ? (stats.duration / stats.total).toFixed(0) + 'ms' : 'N/A',
            successRate: stats.total > 0 ? ((stats.success / stats.total) * 100).toFixed(1) + '%' : 'N/A'
        });

        return stats;
    }

    /**
     * Xử lý một group jobs
     */
    async processGroup(ecountLink, jobs, workerId) {
        let browser, context, page;
        const stats = { success: 0, failed: 0 };

        try {
            logger.info(`🌐 [WARNING] ${workerId}: Launch browser cho ${jobs.length} orders`);

            // Launch browser
            const result = await this.getBrowserWithSession(ecountLink);
            browser = result.browser;
            context = result.context;
            page = result.page;

            // Xử lý từng order tuần tự
            for (let i = 0; i < jobs.length; i++) {
                const job = jobs[i];
                try {
                    logger.info(`  📝 [WARNING] ${workerId}: [${i + 1}/${jobs.length}] ${job.payload.erpOrderCode}`);
                    
                    await this.processJobInBrowser(job, page);
                    await JobModel.markCompleted(job.id, { success: true });
                    stats.success++;
                    
                    logger.info(`  ✅ [WARNING] ${workerId}: [${i + 1}/${jobs.length}] Success`);
                } catch (error) {
                    logger.error(`  ❌ [WARNING] ${workerId}: [${i + 1}/${jobs.length}] Failed: ${error.message}`);
                    await JobModel.markFailed(job.id, error.message, true);
                    if (page) await this.saveDebugInfo(page, job.payload.erpOrderCode);
                    stats.failed++;
                }

                // Delay giữa các orders
                if (i < jobs.length - 1) {
                    await page.waitForTimeout(1000);
                }
            }

            logger.info(`✅ [WARNING] ${workerId}: Browser hoàn thành - ${stats.success}/${jobs.length} success`);

        } catch (error) {
            logger.error(`❌ [WARNING] ${workerId}: Browser error: ${error.message}`);
            
            // Mark tất cả jobs còn lại là failed
            const remaining = jobs.length - (stats.success + stats.failed);
            if (remaining > 0) {
                logger.warn(`${workerId}: Marking ${remaining} remaining jobs as failed`);
                for (let i = stats.success + stats.failed; i < jobs.length; i++) {
                    await JobModel.markFailed(jobs[i].id, 'Browser error: ' + error.message, true);
                    stats.failed++;
                }
            }

        } finally {
            if (browser) {
                await browser.close();
                logger.info(`🔒 [WARNING] ${workerId}: Browser closed`);
            }
        }

        return stats;
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
     * Xử lý 1 job trong browser đã có sẵn
     */
    async processJobInBrowser(job, page) {
        const { orderId, erpOrderCode, warningMessage, ecountLink } = job.payload;

        logger.info(`Processing warning for order ${orderId} - ${erpOrderCode}`);

        const order = await OrderModel.findById(orderId);
        if (!order) {
            throw new Error(`Order ${orderId} not found`);
        }

        // Search order
        await this.searchOrder(page, erpOrderCode);

        // Update warning message vào trường "Ghi chú"
        await this.updateWarningMessage(page, warningMessage);

        logger.info(`✓ Updated warning for order ${orderId}`);
    }

    /**
     * Lấy browser với session
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

                logger.info('Đã sử dụng session thành công');

            } else {
                logger.info('Không có session, đang login...');
                
                await this.login(page);

                const cookies = await context.cookies();
                const currentUrl = page.url();
                const urlObj = new URL(currentUrl);
                const urlParams = {
                    w_flag: urlObj.searchParams.get('w_flag'),
                    ec_req_sid: urlObj.searchParams.get('ec_req_sid')
                };

                logger.info('Lưu session mới...');

                await sessionManager.saveSession(cookies, urlParams, 30);

                const baseUrl = this.ecountConfig.baseUrl.replace('login.ecount.com', 'loginia.ecount.com');
                const targetUrl = `${baseUrl}/ec5/view/erp?w_flag=${urlParams.w_flag}&ec_req_sid=${urlParams.ec_req_sid}${ecountLink}`;
                
                logger.info('Navigate đến order management:', targetUrl);

                if (!currentUrl.includes(ecountLink)) {
                    await page.goto(targetUrl, {
                        waitUntil: 'domcontentloaded',
                        timeout: this.playwrightConfig.timeout
                    });

                    await page.waitForFunction(() => {
                        const frames = window.frames;
                        return document.readyState === 'complete' && frames.length > 0;
                    }, null, { timeout: this.playwrightConfig.timeout });
                }

                logger.info('Đã login và navigate thành công');
            }

            return { browser, context, page };

        } catch (error) {
            await browser.close();
            throw error;
        }
    }

    /**
     * Login
     */
    async login(page) {
        logger.info('Đăng nhập ECount...');

        await page.goto(
            `${this.ecountConfig.baseUrl}/?xurl_rd=Y&login_lantype=&lan_type=vi-VN`,
            { 
                waitUntil: 'networkidle',
                timeout: this.playwrightConfig.timeout 
            }
        );

        const hasLoginForm = await page.$('#com_code');
        if (hasLoginForm) {
            await page.fill('#com_code', this.ecountConfig.companyCode);
            await page.fill('#id', this.ecountConfig.id);
            await page.fill('#passwd', this.ecountConfig.password);

            await Promise.all([
                page.waitForNavigation({ 
                    waitUntil: 'networkidle',
                    timeout: this.playwrightConfig.timeout 
                }),
                page.click('button#save')
            ]);

            try {
                const hasPopup = await page.waitForSelector('#toolbar_sid_toolbar_item_non_regist', { 
                    state: 'visible',
                    timeout: 3000 
                }).catch(() => null);
                
                if (hasPopup) {
                    await page.click('#toolbar_sid_toolbar_item_non_regist');
                    await page.waitForTimeout(1000);
                    logger.info('Đã đóng popup');
                }
            } catch (e) {
                logger.debug('Không có popup hoặc đã đóng');
            }

            logger.info('Đã đăng nhập thành công');
        } else {
            logger.info('Đã login trước đó');
        }
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
                ({ orderCode }) => {
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
                { orderCode },
                { timeout: this.playwrightConfig.timeout }
            ),
            searchFrame.press('#quick_search', 'Enter')
        ]);
    }

    /**
     * Update warning message vào trường "Ghi chú"
     */
    async updateWarningMessage(page, warningMessage) {
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
            '[data-container="popup-body"] .contents [placeholder="Status-THG"]',
            { state: 'visible', timeout: this.playwrightConfig.timeout }
        );

        await dataFrame.waitForFunction(
            () => {
                const input = document.querySelector('[data-container="popup-body"] .contents [placeholder="Status-THG"]');
                return input && !input.disabled;
            },
            null,
            { timeout: this.playwrightConfig.timeout }
        );

        await dataFrame.evaluate(({ warningMessage }) => {
            // Tìm tất cả labels
            const input = document.querySelector('[data-container="popup-body"] .contents [placeholder="Status-THG"]');
            if (!input) throw new Error('Không tìm thấy trường THG-Status');

            input.value = warningMessage;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));

        }, { warningMessage });

        await this.verifyWarningUpdate(dataFrame, warningMessage);
    }

    async verifyWarningUpdate(dataFrame, warningMessage) {
        const maxRetries = 10;
        const retryDelay = 1000;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            await dataFrame.press('body', 'F8');

            try {
                const result = await dataFrame.evaluate(({ warningMessage }) => {
                    const headers = Array.from(document.querySelectorAll('#app-root .wrapper-frame-body .contents thead th'));
                
                    const warningIndex = headers.findIndex(th => 
                        th.textContent.trim().normalize('NFC').includes('Status-THG')
                    );

                    const firstRow = document.querySelector('#app-root .wrapper-frame-body .contents tbody tr');
                    if (!firstRow) {
                        return { success: false, reason: 'Không tìm thấy row đầu tiên' };
                    }

                    const cells = firstRow.querySelectorAll('td');

                    if (warningIndex !== -1) {
                        const trackingCell = cells[warningIndex];
                        if (!trackingCell) {
                            return { success: false, reason: 'Không tìm thấy cell Warning' };
                        }
                        const cellValue = trackingCell.textContent.normalize('NFC').trim();
                        if (cellValue.trim() !== warningMessage.trim()) {
                            return { 
                                success: false, 
                                reason: `Warning không khớp. Expected: "${warningMessage}", Got: "${cellValue}"` 
                            };
                        }
                    }

                    return { 
                        success: true, 
                        reason: 'Tất cả giá trị đã được cập nhật đúng',
                        values: {
                            warningMessage: warningIndex !== -1 ? cells[warningIndex]?.textContent.trim() : null,
                        }
                    };
                }, { warningMessage });

                if (result.success) {
                    logger.info(`✓ Verify thành công sau ${attempt} lần thử:`, result.values);
                    return;
                }

                logger.debug(`Attempt ${attempt}/${maxRetries}: ${result.reason}`);

                if (attempt < maxRetries) {
                    await dataFrame.waitForTimeout(retryDelay);
                }

            } catch (error) {
                logger.debug(`Attempt ${attempt}/${maxRetries} failed:`, error.message);
                
                if (attempt < maxRetries) {
                    await dataFrame.waitForTimeout(retryDelay);
                }
            }
        }

        throw new Error(`Verify warning update thất bại sau ${maxRetries} lần thử. Warning chưa được cập nhật đúng vào table.`);
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

    /**
     * Lưu debug info
     */
    async saveDebugInfo(page, orderCode) {
        try {
            const timestamp = Date.now();
            const safeOrderCode = orderCode.replace(/[^a-zA-Z0-9]/g, '_');

            const screenshotPath = path.join(
                this.screenshotDir,
                `error_warning_${safeOrderCode}_${timestamp}.png`
            );
            await page.screenshot({ path: screenshotPath, fullPage: true });
            logger.info(`Screenshot lưu tại: ${screenshotPath}`);

            const htmlPath = path.join(
                this.screenshotDir,
                `error_warning_${safeOrderCode}_${timestamp}.html`
            );
            const html = await page.content();
            fs.writeFileSync(htmlPath, html);
            logger.info(`HTML lưu tại: ${htmlPath}`);

        } catch (e) {
            logger.error('Không thể lưu debug files:', e.message);
        }
    }

    async onJobMaxAttemptsReached(job, error) {
        await telegram.notifyError(error, {
            action: 'Batch Update Warning',
            jobId: job.id,
            orderId: job.payload.orderId,
            erpOrderCode: job.payload.erpOrderCode,
            warningMessage: job.payload.warningMessage,
            message: 'Failed after max attempts in batch processing'
        }, { type: 'error' });
    }
}

module.exports = UpdateWarningBatchWorker;