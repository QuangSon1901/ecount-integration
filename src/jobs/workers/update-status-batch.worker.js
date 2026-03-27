// src/jobs/workers/update-status-ecount.worker.js
const { chromium } = require('playwright');
const BaseWorker = require('./base.worker');
const OrderModel = require('../../models/order.model');
const JobModel = require('../../models/job.model');
const sessionManager = require('../../services/erp/ecount-session.manager');
const jobService = require('../../services/queue/job.service');
const webhookService = require('../../services/api/webhook.service');

const telegram = require('../../utils/telegram');
const logger = require('../../utils/logger');
const config = require('../../config');
const path = require('path');
const fs = require('fs');

class UpdateStatusBatchWorker extends BaseWorker {
    constructor() {
        super('update_status_ecount', {
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
        this.maxConcurrentBrowsers = 1; // Mỗi worker = 1 browser
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

            // CHECK: Chỉ cho phép tối đa maxConcurrentWorkers workers chạy song song
            if (this.activeJobs.size >= this.maxConcurrentWorkers) {
                logger.debug(`[UpdateStatus] Đã đạt giới hạn ${this.maxConcurrentWorkers} workers, chờ...`);
                return;
            }

            // Lấy batch jobs
            const jobs = await this.getNextJobsBatch(this.maxBatchSize);
            
            if (jobs.length === 0) {
                return;
            }

            const workerId = `status-worker-${Date.now()}-${Math.random().toString(36).substring(7)}`;
            
            logger.info(`🚀 ${workerId}: Bắt đầu xử lý ${jobs.length} jobs (active: ${this.activeJobs.size + 1}/${this.maxConcurrentWorkers})`);

            // Đánh dấu worker đang chạy
            this.activeJobs.add(workerId);

            try {
                await this.processBatch(jobs, workerId);
            } finally {
                this.activeJobs.delete(workerId);
                logger.info(`🏁 ${workerId}: Đã hoàn thành (active: ${this.activeJobs.size}/${this.maxConcurrentWorkers})`);
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

        logger.info(`✅ ${workerId}: Hoàn thành`, {
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
            logger.info(`🌐 ${workerId}: Launch browser cho ${jobs.length} orders`);

            // Launch browser
            const result = await this.getBrowserWithSession(ecountLink);
            browser = result.browser;
            context = result.context;
            page = result.page;

            // Xử lý từng order tuần tự
            for (let i = 0; i < jobs.length; i++) {
                const job = jobs[i];
                try {
                    logger.info(`  📝 ${workerId}: [${i + 1}/${jobs.length}] ${job.payload.erpOrderCode}`);
                    
                    await this.processJobInBrowser(job, page);
                    await JobModel.markCompleted(job.id, { success: true });
                    stats.success++;
                    
                    logger.info(`  ✅ ${workerId}: [${i + 1}/${jobs.length}] Success`);
                } catch (error) {
                    logger.error(`  ❌ ${workerId}: [${i + 1}/${jobs.length}] Failed: ${error.message}`);
                    await JobModel.markFailed(job.id, error.message, true);
                    if (page) await this.saveDebugInfo(page, job.payload.erpOrderCode);
                    stats.failed++;
                }

                // Delay giữa các orders
                if (i < jobs.length - 1) {
                    await page.waitForTimeout(1000);
                }
            }

            logger.info(`✅ ${workerId}: Browser hoàn thành - ${stats.success}/${jobs.length} success`);

        } catch (error) {
            logger.error(`❌ ${workerId}: Browser error: ${error.message}`);
            
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
                logger.info(`🔒 ${workerId}: Browser closed`);
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
        const { orderId, erpOrderCode, trackingNumber, status } = job.payload;

        const order = await OrderModel.findById(orderId);
        if (!order) {
            throw new Error(`Order ${orderId} not found`);
        }

        // Search order
        await this.searchOrder(page, erpOrderCode);

        // Update status
        await this.updateOrderStatus(page, status, orderId);

        // Update DB
        await OrderModel.update(orderId, {
            erpUpdated: true,
            erpStatus: status
        });

        await webhookService.dispatch(
            'order.status',
            order.partner_id,
            order.id,
            {
                order: {
                    reference_code: order.order_number,
                    code_thg: erpOrderCode,
                    tracking_number: trackingNumber,
                    status: status
                }
            }
        );

        logger.info(`✓ Updated status for order ${orderId}`);
    }

    /**
     * Lấy browser với session (tương tự UpdateTrackingBatchWorker)
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
                    logger.warn('[EXPRESS] Session expired (có thể bị kick bởi POD login)');
                    await sessionManager.clearSession();
                    throw new Error('SESSION_EXPIRED');
                }

                logger.info('[EXPRESS] Đã sử dụng session thành công');

            } else {
                logger.info('[EXPRESS] Không có session, đang login...');

                // Acquire login lock để tránh Express + POD login đồng thời
                if (!sessionManager.acquireLoginLock()) {
                    throw new Error('SESSION_LOGIN_LOCKED');
                }

                try {
                // Login
                await this.login(page);

                // Lấy cookies và URL params SAU KHI LOGIN
                const cookies = await context.cookies();
                const currentUrl = page.url();
                const urlObj = new URL(currentUrl);
                const urlParams = {
                    w_flag: urlObj.searchParams.get('w_flag'),
                    ec_req_sid: urlObj.searchParams.get('ec_req_sid')
                };

                logger.info('[EXPRESS] Lưu session mới...', {
                    w_flag: urlParams.w_flag,
                    ec_req_sid: urlParams.ec_req_sid?.substring(0, 10) + '...'
                });

                // Lưu session (sẽ cross-invalidate POD session)
                await sessionManager.saveSession(cookies, urlParams, 30);

                // Navigate đến order management với ecountLink CỤ THỂ
                const baseUrl = this.ecountConfig.baseUrl.replace('login.ecount.com', 'loginia.ecount.com');
                const targetUrl = `${baseUrl}/ec5/view/erp?w_flag=${urlParams.w_flag}&ec_req_sid=${urlParams.ec_req_sid}${ecountLink}`;

                logger.info('[EXPRESS] Navigate đến order management:', targetUrl);

                // Chỉ navigate nếu chưa ở trang đúng
                if (!currentUrl.includes(ecountLink)) {
                    await page.goto(targetUrl, {
                        waitUntil: 'domcontentloaded',
                        timeout: this.playwrightConfig.timeout
                    });

                    // Chờ frames load
                    await page.waitForFunction(() => {
                        const frames = window.frames;
                        return document.readyState === 'complete' && frames.length > 0;
                    }, null, { timeout: this.playwrightConfig.timeout });
                }

                logger.info('[EXPRESS] Đã login và navigate thành công');
                } finally {
                    sessionManager.releaseLoginLock();
                }
            }

            return { browser, context, page };

        } catch (error) {
            await browser.close();
            throw error;
        }
    }

    /**
     * Login (copy từ UpdateTrackingBatchWorker)
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

            // Click login và chờ navigate
            await Promise.all([
                page.waitForNavigation({ 
                    waitUntil: 'networkidle',
                    timeout: this.playwrightConfig.timeout 
                }),
                page.click('button#save')
            ]);

            // Đóng popup nếu có
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
            logger.info('Đã login trước đó (không có form login)');
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
     * Update order status
     */
    async updateOrderStatus(page, status, orderId) {
        logger.info('Cập nhật trạng thái: ' + status);

        // Tìm frame chứa grid
        const dataFrame = await this.findFrameWithSelector(
            page,
            '#app-root .wrapper-frame-body .contents tbody tr'
        );

        await dataFrame.waitForSelector('#app-root .wrapper-frame-body .contents tbody tr', {
            state: 'visible',
            timeout: this.playwrightConfig.timeout
        });

        // Click button status dropdown
        await dataFrame.evaluate(() => {
            const firstRow = document.querySelector('#app-root .wrapper-frame-body .contents tbody tr');
            if (!firstRow) throw new Error('Không tìm thấy record');

            const button = firstRow.querySelector('.control-set:has(a) a');
            if (!button) throw new Error('Không tìm thấy status button');
            
            button.click();
        });

        // Chờ dropdown xuất hiện
        await dataFrame.waitForSelector(
            '.dropdown-menu [data-baseid] li span',
            { state: 'visible', timeout: this.playwrightConfig.timeout }
        );

        // Click vào status
        const statusUpdated = await dataFrame.evaluate((targetStatus) => {
            const spans = document.querySelectorAll('.dropdown-menu [data-baseid] li span');

            if (spans.length === 0) {
                throw new Error('Không tìm thấy danh sách trạng thái');
            }

            let found = false;
            spans.forEach(span => {
                const text = span.innerText.normalize('NFC').trim();
                if (text === targetStatus) {
                    span.click();
                    found = true;
                }
            });

            return found;
        }, status);

        if (!statusUpdated) {
            throw new Error(`Không tìm thấy trạng thái: "${status}"`);
        }

        await this.verifyStatusUpdate(dataFrame, status, orderId);
    }

    /**
     * Verify status update thành công
     */
    async verifyStatusUpdate(dataFrame, expectedStatus, orderId) {
        logger.info('Verifying status update...');

        const maxRetries = 10;
        const retryDelay = 1000;
        
        const order = await OrderModel.findById(orderId);

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const result = await dataFrame.evaluate((targetStatus) => {
                    const firstRow = document.querySelector('#app-root .wrapper-frame-body .contents tbody tr');
                    if (!firstRow) {
                        return { success: false, reason: 'Không tìm thấy row đầu tiên' };
                    }

                    let statusCell = firstRow.querySelector('.control-set:has(a) a');

                    if (!statusCell) {
                        return { success: false, reason: 'Không tìm thấy status cell' };
                    }

                    const currentStatus = statusCell.textContent.normalize('NFC').trim();
                    
                    if (currentStatus !== targetStatus) {
                        return { 
                            success: false, 
                            reason: `Status không khớp. Expected: "${targetStatus}", Got: "${currentStatus}"`,
                            currentValue: currentStatus
                        };
                    }

                    let hasWarning = false;

                    const headers = Array.from(
                        document.querySelectorAll('#app-root .wrapper-frame-body .contents thead th')
                    );

                    const warningIndex = headers.findIndex(th =>
                        th.textContent.trim().normalize('NFC').includes('Status-THG')
                    );

                    if (warningIndex !== -1) {
                        const cells = firstRow.querySelectorAll('td');
                        const warningCell = cells[warningIndex];
                        if (warningCell) {
                            const warningValue = warningCell.textContent.normalize('NFC').trim().toLowerCase();
                            hasWarning = warningValue.includes('warning');
                        }
                    }

                    return { 
                        success: true, 
                        reason: 'Status đã được cập nhật đúng',
                        currentValue: currentStatus,
                        hasWarning
                    };

                }, expectedStatus);

                if (result.success) {
                    logger.info(`✓ Verify status thành công sau ${attempt} lần thử: "${result.currentValue}"`);

                    if (result.hasWarning && order && ['THG Received', 'Carrier Received', 'Shipped', 'Have been received', 'Delivered'].includes(expectedStatus)) {
                        await jobService.addUpdateWarningJob(
                            order.id,
                            order.erp_order_code,
                            ' ',
                            order.ecount_link,
                            5
                        );
                    }

                    return;
                }

                logger.debug(`Attempt ${attempt}/${maxRetries}: ${result.reason}`, 
                    result.currentValue ? { currentValue: result.currentValue } : {}
                );

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

        throw new Error(
            `Verify status update thất bại sau ${maxRetries} lần thử. ` +
            `Status chưa được cập nhật đúng thành "${expectedStatus}". `
        );
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
                `status_error_${safeOrderCode}_${timestamp}.png`
            );
            await page.screenshot({ path: screenshotPath, fullPage: true });
            logger.info(`Screenshot lưu tại: ${screenshotPath}`);

            const htmlPath = path.join(
                this.screenshotDir,
                `status_error_${safeOrderCode}_${timestamp}.html`
            );
            const html = await page.content();
            fs.writeFileSync(htmlPath, html);
            logger.info(`HTML lưu tại: ${htmlPath}`);

        } catch (e) {
            logger.error('Không thể lưu debug files:', e.message);
        }
    }

    async onJobMaxAttemptsReached(job, error) {
        const { orderId, erpOrderCode, trackingNumber, status } = job.payload;
        
        try {
            // Gửi telegram thông báo
            await telegram.notifyError(error, {
                action: 'Batch Update Status',
                jobName: job.job_type,
                jobId: job.id,
                orderId: orderId,
                erpOrderCode: erpOrderCode,
                trackingNumber: trackingNumber,
                status: status,
                message: `⚠️ Job failed after max attempts.`
            }, {
                type: 'error'
            });

            logger.warn(`Job ${job.id} failed after max attempts`, {
                orderId,
                erpOrderCode,
                status
            });

        } catch (retryError) {
            logger.error(`Failed to notify error for job ${job.id}:`, retryError);
        }
    }
}

module.exports = UpdateStatusBatchWorker;