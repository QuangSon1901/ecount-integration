// src/jobs/sync-orders-ecount.cron.js
const cron = require('node-cron');
const { chromium } = require('playwright');
const CronLogModel = require('../models/cron-log.model');
const OrderModel = require('../models/order.model');
const sessionManager = require('../services/erp/ecount-session.manager');
const logger = require('../utils/logger');
const config = require('../config');
const path = require('path');
const fs = require('fs');

class SyncOrdersECountCron {
    constructor() {
        this.isRunning = false;
        this.schedule = '0 6,18 * * *'; // Chạy vào 6h sáng và 18h tối
        this.playwrightConfig = config.playwright;
        this.ecountConfig = config.ecount;
        this.logDir = path.join(__dirname, '../../logs/sync-orders');
        
        // Tạo folder logs nếu chưa có
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    /**
     * Start cron job
     */
    start() {
        logger.info(`Sync Orders ECount cron started - Schedule: ${this.schedule}`);

        cron.schedule(this.schedule, async () => {
            if (this.isRunning) {
                logger.warn('Sync orders job already running, skipping...');
                return;
            }

            await this.run();
        });

        logger.info('Sync Orders ECount cron job started');
    }

    /**
     * Run job
     */
    async run() {
        const startTime = Date.now();
        let cronLogId = null;
        let stats = {
            totalOrders: 0,
            totalPages: 0,
            newOrders: 0,
            existingOrders: 0,
            errors: 0
        };

        try {
            this.isRunning = true;
            cronLogId = await CronLogModel.start('sync_orders_ecount');

            logger.info('Bắt đầu sync orders từ ECount...');

            const orders = await this.fetchOrdersFromECount();
            stats.totalOrders = orders.length;
            stats.totalPages = orders.totalPages || 0;

            // Process orders - check và insert vào database
            const processResult = await this.processOrders(orders);
            stats.newOrders = processResult.newOrders;
            stats.existingOrders = processResult.existingOrders;
            stats.errors = processResult.errors;

            // Update cron log thành công
            const executionTime = Date.now() - startTime;
            await CronLogModel.update(cronLogId, {
                status: 'completed',
                ordersProcessed: stats.totalOrders,
                ordersSuccess: stats.newOrders,
                ordersFailed: stats.errors,
                executionTimeMs: executionTime,
                details: JSON.stringify({
                    newOrders: stats.newOrders,
                    existingOrders: stats.existingOrders,
                    totalPages: stats.totalPages
                })
            });

            logger.info('Sync orders job hoàn thành', {
                ...stats,
                executionTime: `${executionTime}ms`
            });

        } catch (error) {
            logger.error('Sync orders job thất bại:', error);

            if (cronLogId) {
                const executionTime = Date.now() - startTime;
                await CronLogModel.update(cronLogId, {
                    status: 'failed',
                    ordersProcessed: stats.totalOrders,
                    ordersSuccess: stats.newOrders,
                    ordersFailed: stats.errors,
                    errorMessage: error.message,
                    executionTimeMs: executionTime
                });
            }
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Process orders - check existing và insert new
     */
    async processOrders(orders) {
        const result = {
            newOrders: 0,
            existingOrders: 0,
            errors: 0
        };

        logger.info(`Bắt đầu xử lý ${orders.length} orders...`);

        for (const order of orders) {
            try {
                // Skip nếu không có codeThg (erp_order_code)
                if (!order.codeThg) {
                    logger.warn('Order không có codeThg, bỏ qua:', order);
                    result.errors++;
                    continue;
                }

                // Check order đã tồn tại chưa
                const existingOrder = await OrderModel.findByErpOrderCode(order.codeThg);

                if (existingOrder) {
                    logger.debug(`Order ${order.codeThg} đã tồn tại, bỏ qua`);
                    result.existingOrders++;
                    continue;
                }

                // Insert order mới
                const orderData = this.mapECountOrderToOrderData(order);
                const orderId = await OrderModel.create(orderData);

                logger.info(`Đã insert order mới: ${order.codeThg} (ID: ${orderId})`);
                result.newOrders++;

            } catch (error) {
                logger.error(`Lỗi xử lý order ${order.codeThg}:`, error);
                result.errors++;
            }
        }

        logger.info('Hoàn thành xử lý orders:', result);
        return result;
    }

    /**
     * Map ECount order data sang format OrderModel
     */
    mapECountOrderToOrderData(ecountOrder) {
        // Parse service để lấy carrier
        const service = (ecountOrder.service || '').toLowerCase();
        let carrier = 'YUNEXPRESS'; // default
        
        if (service.includes('ups')) {
            carrier = 'UPS';
        } else if (service.includes('fedex')) {
            carrier = 'FEDEX';
        } else if (service.includes('dhl')) {
            carrier = 'DHL';
        } else if (service.includes('mason')) {
            carrier = 'MASON';
        }

        return {
            orderNumber: this.generateOrderNumber(),
            customerOrderNumber: ecountOrder.orderId,
            erpOrderCode: ecountOrder.codeThg,
            carrier: carrier,
            productCode: ecountOrder.service,
            trackingNumber: ecountOrder.trackingLastMile || null,
            waybillNumber: ecountOrder.trackingLastMile || null,
            status: 'created',
            erpStatus: ecountOrder.status || 'Đang xử lý',
            receiverName: ecountOrder.customerName || null,
            orderData: ecountOrder,
            carrierResponse: {},
            ecountLink: this.ecountConfig.hashLink
        };
    }

    generateOrderNumber() {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        return `ORD${timestamp}${random}`;
    }

    /**
     * Fetch orders từ ECount
     */
    async fetchOrdersFromECount() {
        let browser, context, page;

        try {
            // Launch browser
            const result = await this.getBrowserWithSession();
            browser = result.browser;
            context = result.context;
            page = result.page;

            logger.info('Đã login ECount, bắt đầu lấy danh sách orders');
            
            await this.executeSearch(page);
            // Mở form search
            await this.openSearchForm(page);

            // Search
            await this.executeSearch(page);

            // Lấy tất cả orders từ tất cả trang
            const orders = await this.getAllOrders(page);

            logger.info(`Đã lấy được ${orders.length} orders từ ECount`);

            return orders;

        } finally {
            if (browser) {
                await browser.close();
                logger.info('Browser closed');
            }
        }
    }

    /**
     * Get browser với session
     */
    async getBrowserWithSession() {
        const session = await sessionManager.getSession();
        const browser = await chromium.launch(this.playwrightConfig.launchOptions);
        
        try {
            const context = await browser.newContext(this.playwrightConfig.contextOptions);
            const page = await context.newPage();

            page.setDefaultNavigationTimeout(this.playwrightConfig.timeout);
            page.setDefaultTimeout(this.playwrightConfig.timeout);

            const ecountLink = this.ecountConfig.hashLink;

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
                
                logger.info('Navigate đến order management');

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
     * Login ECount
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

            // Đóng popup nếu có
            try {
                const hasPopup = await page.waitForSelector('#toolbar_sid_toolbar_item_non_regist', { 
                    state: 'visible',
                    timeout: 3000 
                }).catch(() => null);
                
                if (hasPopup) {
                    await page.click('#toolbar_sid_toolbar_item_non_regist');
                    await page.waitForTimeout(1000);
                }
            } catch (e) {
                // Ignore
            }

            logger.info('Đã đăng nhập thành công');
        }
    }

    /**
     * Mở form search
     */
    async openSearchForm(page) {
        logger.info('Mở form search...');
        await page.waitForTimeout(2000);
        const frame = await this.findFrameWithSelector(page, '#search');

        // Chờ button search xuất hiện
        await frame.waitForSelector('#search', {
            state: 'visible',
            timeout: this.playwrightConfig.timeout
        });

        await frame.click('#search');

        // Chờ form search hiển thị
        await frame.waitForSelector('[data-item-key="search_tab_container"]', {
            state: 'visible',
            timeout: this.playwrightConfig.timeout
        });

        await page.waitForTimeout(2000);
        const frame2 = await this.findFrameWithSelector(page, 'button[data-id="51"]');

        await frame2.waitForSelector('button[data-id="51"]', {
            state: 'visible',
            timeout: this.playwrightConfig.timeout
        });

        await frame2.click('button[data-id="51"]');
        logger.info('Form search đã mở');
        await page.waitForTimeout(3000);
    }

    /**
     * Execute search
     */
    async executeSearch(page) {
        logger.info('Thực hiện search...');

        // Chờ loading biến mất và có kết quả
        const frame = await this.findFrameWithSelector(page, '#app-root .wrapper-frame-body .contents tbody tr');

        await frame.waitForFunction(
            () => {
                const loading = document.querySelector('.page-progress-icon');
                if (loading && window.getComputedStyle(loading).display !== 'none') {
                    return false;
                }
                
                const firstRow = document.querySelector('#app-root .wrapper-frame-body .contents tbody tr');
                return firstRow !== null;
            },
            null,
            { timeout: this.playwrightConfig.timeout }
        );

        logger.info('Search hoàn tất, có kết quả');
    }

    /**
     * Lấy tất cả orders từ tất cả trang
     */
    async getAllOrders(page) {
        logger.info('Lấy danh sách orders...');

        const allOrders = [];
        let currentPage = 1;
        let hasNextPage = true;

        const frame = await this.findFrameWithSelector(page, '#app-root .wrapper-frame-body .contents tbody tr');

        while (hasNextPage) {
            logger.info(`Đang lấy trang ${currentPage}...`);

            // Lấy orders trang hiện tại
            const orders = await this.getOrdersFromCurrentPage(frame);
            allOrders.push(...orders);

            logger.info(`Trang ${currentPage}: ${orders.length} orders`);

            // Check có trang tiếp theo không
            hasNextPage = await this.goToNextPage(frame);
            
            if (hasNextPage) {
                currentPage++;
                // Chờ load trang mới
                await frame.waitForTimeout(2000);
            }
        }

        logger.info(`Tổng cộng: ${allOrders.length} orders từ ${currentPage} trang`);

        return allOrders;
    }

    /**
     * Lấy orders từ trang hiện tại
     */
    async getOrdersFromCurrentPage(frame) {
        return await frame.evaluate(() => {
            const headers = Array.from(document.querySelectorAll('#app-root .wrapper-frame-body .contents thead th'));
            
            // Map vị trí các cột
            const columnMap = {
                date: headers.findIndex(th => th.textContent.trim().normalize('NFC') === 'Date'),
                customerCode: headers.findIndex(th => th.textContent.trim().normalize('NFC') === 'ID KH/NCC'),
                customerName: headers.findIndex(th => th.textContent.trim().normalize('NFC') === 'Name KH/NCC'),
                codeThg: headers.findIndex(th => th.textContent.trim().normalize('NFC') === 'Code-THG'),
                orderId: headers.findIndex(th => th.textContent.trim().normalize('NFC') === 'Order ID'),
                status: headers.findIndex(th => th.textContent.trim().normalize('NFC') === 'Status'),
                statusThg: headers.findIndex(th => th.textContent.trim().normalize('NFC') === 'Status-THG'),
                trackingLastMile: headers.findIndex(th => th.textContent.trim().normalize('NFC') === 'Tracking last mile'),
                masterTracking: headers.findIndex(th => th.textContent.trim().normalize('NFC') === 'Master tracking'),
                shippingLabel: headers.findIndex(th => th.textContent.trim().normalize('NFC') === 'Shipping label'),
                service: headers.findIndex(th => th.textContent.trim().normalize('NFC') === 'Service'),
                troubleTicket: headers.findIndex(th => th.textContent.trim().normalize('NFC') === 'Trouble/Ticket')
            };

            const KEYWORDS = ['ups', 'fedex', 'dhl', 'mason'];
            const rows = document.querySelectorAll('#app-root .wrapper-frame-body .contents tbody tr');
            const orders = [];

            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                const service = columnMap.service !== -1 ? (cells[columnMap.service]?.textContent || '').trim() : '';

                // Lọc theo keywords (không phân biệt hoa thường)
                const serviceLower = service.toLowerCase();
                const matched = KEYWORDS.some(k => serviceLower.includes(k));
                if (!matched) return;

                const trackingLastMile = columnMap.trackingLastMile !== -1 ? (cells[columnMap.trackingLastMile]?.textContent || '').trim() : '';
                if (!trackingLastMile) return;
                
                const order = {
                    date: columnMap.date !== -1 ? cells[columnMap.date]?.textContent.trim() : null,
                    customerCode: columnMap.customerCode !== -1 ? cells[columnMap.customerCode]?.textContent.trim() : null,
                    customerName: columnMap.customerName !== -1 ? cells[columnMap.customerName]?.textContent.trim() : null,
                    codeThg: columnMap.codeThg !== -1 ? cells[columnMap.codeThg]?.textContent.trim() : null,
                    orderId: columnMap.orderId !== -1 ? cells[columnMap.orderId]?.textContent.trim() : null,
                    status: columnMap.status !== -1 ? cells[columnMap.status]?.textContent.trim() : null,
                    statusThg: columnMap.statusThg !== -1 ? cells[columnMap.statusThg]?.textContent.trim() : null,
                    trackingLastMile,
                    masterTracking: columnMap.masterTracking !== -1 ? cells[columnMap.masterTracking]?.textContent.trim() : null,
                    shippingLabel: columnMap.shippingLabel !== -1 ? cells[columnMap.shippingLabel]?.textContent.trim() : null,
                    service,
                    troubleTicket: columnMap.troubleTicket !== -1 ? cells[columnMap.troubleTicket]?.textContent.trim() : null
                };

                orders.push(order);
            });

            return orders;
        });
    }

    /**
     * Chuyển sang trang tiếp theo
     */
    async goToNextPage(frame) {
        const hasNext = await frame.evaluate(() => {
            const lastBtn = document.querySelector('.pagination .last-page:not(.hidden) a[data-role="last"]');
            if (lastBtn) {
                const current = document.querySelector('.pagination .active [data-role]');
                if (!current) return false;

                const currentRole = parseInt(current.getAttribute('data-role'), 10);
                if (isNaN(currentRole)) return false;

                const nextRole = currentRole + 1;
                const nextBtn = document.querySelector(`.pagination [data-role="${nextRole}"]`);
                if (!nextBtn) return false;

                nextBtn.click();
                return true;
            }
            return false;
        });

        return hasNext;
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
     * Run manually (for testing)
     */
    async runManually() {
        logger.info('Running sync orders job manually...');
        await this.run();
    }
}

module.exports = new SyncOrdersECountCron();