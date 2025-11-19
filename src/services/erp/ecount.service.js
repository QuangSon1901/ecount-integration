const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const logger = require('../../utils/logger');
const sessionManager = require('./ecount-session.manager');

class ECountService {
    constructor() {
        this.config = config.ecount;
        this.puppeteerConfig = config.puppeteer;

        // Tạo thư mục screenshots nếu chưa có
        this.screenshotDir = path.join(__dirname, '../../../logs/screenshots');
        if (!fs.existsSync(this.screenshotDir)) {
            fs.mkdirSync(this.screenshotDir, { recursive: true });
        }
    }

    /**
     * Chờ network idle (không còn request nào đang xử lý)
     */
    async waitForNetworkIdle(page, timeout = config.puppeteer.timeout, maxInflight = 0) {
        return page.waitForNetworkIdle({
            timeout,
            idleTime: 500,
            maxInflight
        });
    }

    /**
     * Chờ element xuất hiện và sẵn sàng tương tác
     */
    async waitForElement(frameOrPage, selector, options = {}) {
        const defaultOptions = {
            visible: true,
            timeout: config.puppeteer.timeout,
            ...options
        };

        await frameOrPage.waitForSelector(selector, defaultOptions);

        // Đảm bảo element thực sự có thể click
        if (defaultOptions.clickable !== false) {
            await frameOrPage.waitForFunction(
                (sel) => {
                    const el = document.querySelector(sel);
                    if (!el) return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0 &&
                        window.getComputedStyle(el).visibility !== 'hidden' &&
                        window.getComputedStyle(el).display !== 'none';
                },
                { timeout: defaultOptions.timeout },
                selector
            );
        }

        return frameOrPage.$(selector);
    }

    /**
     * Tìm frame chứa selector cụ thể
     */
    async findFrameWithSelector(page, selector, timeout = config.puppeteer.timeout) {
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
                    // Frame chưa ready, tiếp tục
                }
            }

            // Chờ 100ms trước khi thử lại
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        throw new Error(`Không tìm thấy frame chứa selector: ${selector}`);
    }

    /**
     * Type text với validation
     */
    async typeText(page, selector, text, options = {}) {
        await this.waitForElement(page, selector);
        await page.click(selector);
        await page.type(selector, text, { delay: options.delay || 50 });

        // Verify text đã được nhập
        await page.waitForFunction(
            (sel, expectedText) => {
                const input = document.querySelector(sel);
                return input && input.value === expectedText;
            },
            { timeout: 5000 },
            selector,
            text
        );
    }

    /**
     * Tạo session mới và lưu lại
     */
    async createSession() {
        logger.info('Đang tạo session ECount mới...');

        const browser = await puppeteer.launch({
            headless: this.puppeteerConfig.headless,
            defaultViewport: null,
            args: this.puppeteerConfig.args,
            ...(this.puppeteerConfig.executablePath && {
                executablePath: this.puppeteerConfig.executablePath
            })
        });

        let page;
        try {
            [page] = await browser.pages();
            await page.setViewport({ width: 1366, height: 768 });

            // Anti-detection
            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
                Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
                window.chrome = { runtime: {} };
            });

            await page.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            );

            // Login
            await this.login(page);

            // Lấy cookies
            const cookies = await page.cookies();

            // Lấy URL params
            const currentUrl = page.url();
            const urlObj = new URL(currentUrl);
            const urlParams = {
                w_flag: urlObj.searchParams.get('w_flag'),
                ec_req_sid: urlObj.searchParams.get('ec_req_sid')
            };

            // Lưu session (30 phút)
            await sessionManager.saveSession(cookies, urlParams, 30);

            logger.info('Đã tạo session thành công', {
                w_flag: urlParams.w_flag,
                ec_req_sid: urlParams.ec_req_sid?.substring(0, 10) + '...',
                cookiesCount: cookies.length
            });

            return {
                success: true,
                // cookies: cookies,
                // urlParams: urlParams,
                expiresIn: 1800 // 30 minutes in seconds
            };

        } finally {
            await browser.close();
        }
    }

    /**
     * Lấy browser với session có sẵn
     */
    async getBrowserWithSession(ecountLink) {
        const session = await sessionManager.getSession();

        const browser = await puppeteer.launch({
            headless: this.puppeteerConfig.headless,
            defaultViewport: null,
            args: [
                ...this.puppeteerConfig.args,
                '--disable-dev-shm-usage',
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ],
            ...(this.puppeteerConfig.executablePath && {
                executablePath: this.puppeteerConfig.executablePath
            })
        });

        try {
            const [page] = await browser.pages();
            await page.setViewport({ width: 1366, height: 768 });

            // Set timeouts
            page.setDefaultNavigationTimeout(config.puppeteer.timeout);
            page.setDefaultTimeout(config.puppeteer.timeout);

            // Anti-detection
            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
                Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
                window.chrome = { runtime: {} };
            });

            await page.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            );

            if (session) {
                logger.info('Đang sử dụng session có sẵn', {
                    ttl: sessionManager.getSessionTTL() + 's',
                    cookiesCount: session.cookies.length
                });

                const urlParams = session.url_params;
                const baseUrl = this.config.baseUrl.replace('login.ecount.com', 'loginia.ecount.com');
                const sessionUrl = `${baseUrl}/ec5/view/erp?w_flag=${urlParams.w_flag}&ec_req_sid=${urlParams.ec_req_sid}${ecountLink}`;

                // Navigate đến base domain TRƯỚC để set cookies
                const baseDomain = new URL(baseUrl).origin;
                logger.info('Navigate to base domain first:', baseDomain);

                await page.goto(baseDomain, {
                    waitUntil: 'domcontentloaded',
                    timeout: config.puppeteer.timeout
                });

                // Chờ page ready
                await page.waitForFunction(() => document.readyState === 'complete');

                // Set cookies
                try {
                    const cookiesToSet = session.cookies.map(cookie => {
                        const fixedCookie = { ...cookie };

                        if (fixedCookie.domain && !baseDomain.includes(fixedCookie.domain.replace(/^\./, ''))) {
                            const baseHostname = new URL(baseDomain).hostname;
                            fixedCookie.domain = baseHostname;
                            logger.warn(`Fixed cookie domain: ${cookie.domain} -> ${fixedCookie.domain}`);
                        }

                        return fixedCookie;
                    });

                    await page.setCookie(...cookiesToSet);
                    logger.info('Cookies set successfully');

                    // Verify cookies đã được set
                    const currentCookies = await page.cookies();
                    logger.info('Current cookies after set:', currentCookies.length);

                } catch (cookieError) {
                    logger.error('Error setting cookies:', cookieError);
                    throw cookieError;
                }

                logger.info('Navigate to final URL:', sessionUrl);
                await page.goto(sessionUrl, {
                    waitUntil: 'domcontentloaded',
                    timeout: config.puppeteer.timeout
                });

                // Chờ page load xong hoàn toàn
                await page.waitForFunction(
                    () => document.readyState === 'complete' && document.body !== null,
                    { timeout: config.puppeteer.timeout }
                );

                const currentUrl = page.url();
                logger.info('Current URL after navigation: ' + currentUrl);

                if (!currentUrl.includes('ec_req_sid')) {
                    logger.warn('Session không còn hợp lệ, cần login lại');
                    await sessionManager.clearSession();
                    throw new Error('SESSION_EXPIRED');
                }

                logger.info('Đã sử dụng session thành công');

            } else {
                logger.info('Không có session, đang login...');

                await this.login(page);

                // Lưu session mới
                const cookies = await page.cookies();
                const currentUrl = page.url();
                const urlObj = new URL(currentUrl);
                const urlParams = {
                    w_flag: urlObj.searchParams.get('w_flag'),
                    ec_req_sid: urlObj.searchParams.get('ec_req_sid')
                };

                logger.info('Lưu session mới...', {
                    w_flag: urlParams.w_flag,
                    ec_req_sid: urlParams.ec_req_sid?.substring(0, 10) + '...',
                    cookiesCount: cookies.length
                });

                await sessionManager.saveSession(cookies, urlParams, 30);
                await this.navigateToOrderManagement(page, ecountLink);
            }

            return { browser, page };

        } catch (error) {
            await browser.close();
            throw error;
        }
    }

    /**
     * Cập nhật tracking number vào ECount
     */
    async updateInfoEcount(type, orderId, orderCode, trackingNumber, status = 'Đã hoàn tất', ecountLink, labelUrl = null, waybillNumber = '') {
        logger.info('Bắt đầu cập nhật tracking vào ECount...', {
            orderId,
            orderCode,
            trackingNumber,
            hasEcountLink: !!ecountLink
        });

        if (!ecountLink) {
            throw new Error('ECount link is required');
        }

        const browser = await puppeteer.launch({
            headless: this.puppeteerConfig.headless,
            defaultViewport: null,
            args: this.puppeteerConfig.args,
            ...(this.puppeteerConfig.executablePath && {
                executablePath: this.puppeteerConfig.executablePath
            })
        });

        let page;
        try {
            [page] = await browser.pages();
            await page.setViewport({ width: 1366, height: 768 });

            // Anti-detection
            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
                Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
                window.chrome = { runtime: {} };
            });

            await page.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            );

            await this.login(page);
            await this.navigateToOrderManagement(page, ecountLink);
            await this.searchOrder(page, orderCode);

            switch (type) {
                case 'status':
                    await this.updateOrderStatus(page, status);
                    break;
                case 'tracking_number':
                    await this.updateTrackingNumber(page, trackingNumber, waybillNumber, labelUrl);
                    break;
            }

            logger.info('Đã cập nhật ECount thành công');

            return {
                success: true,
                orderId,
                orderCode,
                trackingNumber,
                updatedAt: new Date().toISOString()
            };

        } catch (error) {
            logger.error('Lỗi khi cập nhật ECount: ' + error.message);

            if (page) {
                await this.saveDebugInfo(page, orderCode);
            }

            throw error;

        } finally {
            await browser.close();
        }
    }

    async getInfoEcountOld(orderCode, ecountLink) {
        if (!ecountLink) {
            throw new Error('ECount link is required');
        }

        const browser = await puppeteer.launch({
            headless: this.puppeteerConfig.headless,
            defaultViewport: null,
            args: this.puppeteerConfig.args,
            ...(this.puppeteerConfig.executablePath && {
                executablePath: this.puppeteerConfig.executablePath
            })
        });

        let page;

        try {
            [page] = await browser.pages();
            await page.setViewport({ width: 1366, height: 768 });

            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
                Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
                window.chrome = { runtime: {} };
            });

            await page.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            );

            await this.login(page);
            await this.navigateToOrderManagement(page, ecountLink);
            await this.searchOrder(page, orderCode);

            const result = await this.getInfoOrder(page);

            return {
                success: true,
                orderCode,
                data: result
            };
        } catch (error) {
            logger.error('Lỗi khi lấy thông tin đơn hàng từ ECount:', error.message);

            if (page) {
                await this.saveDebugInfo(page, orderCode);
            }

            throw error;

        } finally {
            await browser.close();
        }
    }

    /**
     * Lấy info từ ECount với session
     */
    async getInfoEcount(orderCode, ecountLink) {
        if (!ecountLink) {
            throw new Error('ECount link is required');
        }

        let browser, page;

        try {
            const result = await this.getBrowserWithSession(ecountLink);
            browser = result.browser;
            page = result.page;

            await this.searchOrder(page, orderCode);

            const orderInfo = await this.getInfoOrder(page);

            return {
                success: true,
                orderCode,
                data: orderInfo
            };
        } catch (error) {
            logger.error(error);
            if (error.message === 'SESSION_EXPIRED') {
                logger.info('Session hết hạn, thử lại...');

                if (browser) await browser.close();

                await sessionManager.clearSession();
                await this.createSession();

                return await this.getInfoEcount(orderCode, ecountLink);
            }

            logger.error('Lỗi khi lấy thông tin từ ECount:', error.message);

            if (page) {
                await this.saveDebugInfo(page, orderCode);
            }

            throw error;

        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }

    async getInfoOrder(page) {
        // Tìm frame chứa grid
        const dataFrame = await this.findFrameWithSelector(
            page,
            '#app-root .wrapper-frame-body .contents tbody tr'
        );

        await this.waitForElement(
            dataFrame,
            '#app-root .wrapper-frame-body .contents tbody tr'
        );

        // Click vào link mở modal
        await dataFrame.evaluate(() => {
            const linkModal = document.querySelector('#app-root .wrapper-frame-body .contents tbody tr a[id][data-item-key]');
            if (!linkModal) throw new Error('Không tìm thấy link để mở modal');
            linkModal.click();
        });

        // Chờ modal xuất hiện
        await this.waitForElement(
            dataFrame,
            '[data-container="popup-body"] .contents [placeholder="Tracking last mile"]'
        );

        // Chờ thêm để đảm bảo dữ liệu đã load
        await dataFrame.waitForFunction(
            () => {
                const modal = document.querySelector('[data-container="popup-body"]');
                if (!modal) return false;

                // Kiểm tra các field chính đã có data
                const hasData = document.querySelector('[placeholder="Code-THG"]')?.value ||
                    document.querySelector('[placeholder="OrderID"]')?.value ||
                    document.querySelector('[placeholder="Name"]')?.value;

                return hasData;
            },
            { timeout: 15000 }
        );

        const result = await dataFrame.evaluate(() => {
            const contentModal = document.querySelector('[data-container="popup-body"] .contents [placeholder="Tracking last mile"]')?.closest('[data-container="popup-body"]');
            const fields = {
                order_info: {
                    code_thg: contentModal.querySelector('[placeholder="Code-THG"]')?.value || "",
                    customer_order_number: "",
                    platform_order_number: "",
                    tracking_number: "",
                    service_code: ""
                },
                receiver: {
                    first_name: contentModal.querySelector('[placeholder="Name"]')?.value || "",
                    last_name: "",
                    country_code: contentModal.querySelector('[placeholder="Country Code"]')?.value || "",
                    province: contentModal.querySelector('[placeholder="State"]')?.value || "",
                    city: contentModal.querySelector('[placeholder="City"]')?.value || "",
                    address_lines: [contentModal.querySelector('[placeholder="Street line 1"]')?.value || ""],
                    postal_code: contentModal.querySelector('[placeholder="Zipcode"]')?.value || "",
                    phone_number: contentModal.querySelector('[placeholder="Phone number"]')?.value || "",
                    email: contentModal.querySelector('[placeholder="Email"]')?.value || ""
                },

                packages: [],
                declaration_info: []
            };

            contentModal.querySelectorAll('#grid-main tbody tr').forEach((row, index) => {
                const prodCode = row.querySelector('[data-columnid="prod_cd"] .grid-input-data')?.textContent?.trim();

                if (prodCode && prodCode !== '\u00A0' && prodCode !== '') {
                    const qty = row.querySelector('[data-columnid="qty"] .grid-input-data')?.textContent?.trim().replaceAll(',', '') || 0;
                    const unit_price = row.querySelector('[data-columnid="p_remarks1"] .grid-input-data')?.textContent?.trim().replaceAll(',', '') || 0;
                    const length = row.querySelector('[data-columnid="ADD_NUM_03"] .grid-input-data')?.textContent?.trim().replaceAll(',', '') || 0;
                    const width = row.querySelector('[data-columnid="ADD_NUM_04"] .grid-input-data')?.textContent?.trim().replaceAll(',', '') || 0;
                    const height = row.querySelector('[data-columnid="ADD_NUM_05"] .grid-input-data')?.textContent?.trim().replaceAll(',', '') || 0;
                    const weight = row.querySelector('[data-columnid="ADD_NUM_02"] .grid-input-data')?.textContent?.trim().replaceAll(',', '') || 0;

                    fields.packages.push({
                        length: parseFloat(length) || 0,
                        width: parseFloat(width) || 0,
                        height: parseFloat(height) || 0,
                        weight: parseFloat(weight) || 0,
                    });

                    fields.declaration_info.push({
                        sku_code: prodCode,
                        name_en: row.querySelector('[data-columnid="prod_des"] .grid-input-data')?.textContent?.trim() || "",
                        name_local: row.querySelector('[data-columnid="prod_des"] .grid-input-data')?.textContent?.trim() || "",
                        quantity: parseInt(qty) || 1,
                        unit_price: parseFloat(unit_price) || 0,
                        unit_weight: parseFloat(weight) || 0,
                        hs_code: "",
                        currency: "USD"
                    });
                }
            });

            if (fields.packages.length === 0) {
                fields.packages.push({
                    length: 0,
                    width: 0,
                    height: 0,
                    weight: 0
                });
            }

            return fields;
        });

        return result;
    }

    /**
     * Lưu screenshot và HTML khi có lỗi
     */
    async saveDebugInfo(page, orderCode) {
        try {
            const timestamp = Date.now();
            const safeOrderCode = orderCode.replace(/[^a-zA-Z0-9]/g, '_');

            // Screenshot
            const screenshotPath = path.join(
                this.screenshotDir,
                `error_${safeOrderCode}_${timestamp}.png`
            );
            await page.screenshot({ path: screenshotPath, fullPage: true });
            logger.info(`Screenshot lưu tại: ${screenshotPath}`);

            // HTML
            const htmlPath = path.join(
                this.screenshotDir,
                `error_${safeOrderCode}_${timestamp}.html`
            );
            const html = await page.content();
            fs.writeFileSync(htmlPath, html);
            logger.info(`HTML lưu tại: ${htmlPath}`);

        } catch (e) {
            logger.error('Không thể lưu debug files:', e.message);
        }
    }

    async login(page) {
        logger.info('Đăng nhập ECount...');

        await page.goto(
            `${this.config.baseUrl}/?xurl_rd=Y&login_lantype=&lan_type=vi-VN`,
            { waitUntil: 'networkidle0', timeout: this.puppeteerConfig.timeout }
        );

        // Chờ page load xong
        await page.waitForFunction(() => document.readyState === 'complete');

        const hasLoginForm = await page.$('#com_code');
        if (hasLoginForm) {
            await this.typeText(page, '#com_code', this.config.companyCode);
            await this.typeText(page, '#id', this.config.id);
            await this.typeText(page, '#passwd', this.config.password);

            await Promise.all([
                page.waitForNavigation({
                    waitUntil: 'networkidle0',
                    timeout: this.puppeteerConfig.timeout
                }),
                page.click('button#save')
            ]);

            // Chờ page sau login load xong
            await page.waitForFunction(
                () => document.readyState === 'complete' && document.body !== null,
                { timeout: config.puppeteer.timeout }
            );

            // Close popup if exists
            const hasPopup = await page.$('#toolbar_sid_toolbar_item_non_regist');
            if (hasPopup) {
                await page.click('#toolbar_sid_toolbar_item_non_regist');
                // Chờ popup đóng
                await page.waitForFunction(
                    () => !document.querySelector('#toolbar_sid_toolbar_item_non_regist') ||
                        window.getComputedStyle(document.querySelector('#toolbar_sid_toolbar_item_non_regist')).display === 'none',
                    { timeout: 5000 }
                ).catch(() => { }); // Ignore timeout nếu popup đã đóng
            }

            logger.info('Đã đăng nhập');
        }
    }

    /**
     * Điều hướng đến quản lý đơn hàng với hash link cụ thể
     */
    async navigateToOrderManagement(page, ecountLink) {
        logger.info('Điều hướng đến quản lý đơn hàng với link: ' + ecountLink);

        await page.waitForFunction(
            () => document.readyState === 'complete' && document.body !== null,
            { timeout: config.puppeteer.timeout }
        );

        const currentUrl = page.url();
        const urlObj = new URL(currentUrl);
        const baseUrl = urlObj.origin + urlObj.pathname + urlObj.search;
        const targetUrl = `${baseUrl}${ecountLink}`;

        logger.info('Target URL:', targetUrl);

        await page.goto(targetUrl, {
            waitUntil: 'networkidle2',
            timeout: this.puppeteerConfig.timeout
        });

        // Chờ page load xong và frame sẵn sàng
        await page.waitForFunction(
            () => {
                const frames = window.frames;
                return document.readyState === 'complete' && frames.length > 0;
            },
            { timeout: config.puppeteer.timeout }
        );

        logger.info('Đã vào trang quản lý đơn hàng');
    }

    async searchOrder(page, orderCode) {
        logger.info('Tìm kiếm đơn hàng:' + orderCode);

        // Tìm frame chứa search box
        const searchFrame = await this.findFrameWithSelector(page, '#quick_search');

        // Chờ input sẵn sàng và visible
        await searchFrame.waitForFunction(
            () => {
                const input = document.querySelector('#quick_search');
                return input !== null &&
                    window.getComputedStyle(input).display !== 'none' &&
                    !input.disabled;
            },
            { timeout: config.puppeteer.timeout }
        );

        // Scroll và focus
        await searchFrame.evaluate(() => {
            const input = document.querySelector('#quick_search');
            if (input) {
                input.scrollIntoView({ behavior: 'instant', block: 'center' });
                input.focus();
            }
        });

        // Chờ input đã focus
        await searchFrame.waitForFunction(
            () => document.querySelector('#quick_search') === document.activeElement,
            { timeout: config.puppeteer.timeout }
        );

        await searchFrame.type('#quick_search', orderCode, { delay: 100 });

        await new Promise(resolve => setTimeout(resolve, 5000));

        // Press Enter và chờ kết quả
        await Promise.all([
            searchFrame.waitForFunction(
                (orderCode) => {
                    // Chờ loading biến mất
                    const loading = document.querySelector('.page-progress-icon');
                    if (loading && window.getComputedStyle(loading).display !== 'none') {
                        return false;
                    }
                    
                    // Lấy row đầu tiên
                    const firstRow = document.querySelector('#app-root .wrapper-frame-body .contents tbody tr');
                    if (!firstRow) return false;
                    
                    // Check xem có td nào chứa orderCode không
                    const cells = firstRow.querySelectorAll('td');
                    return Array.from(cells).some(cell => {
                        const text = cell.textContent.trim();
                        return text == orderCode || text.includes(orderCode);
                    });
                },
                { timeout: this.puppeteerConfig.timeout },
                orderCode  // Pass orderCode vào function
            ),
            page.keyboard.press('Enter')
        ]);

        logger.info('Đã tìm thấy đơn hàng');
    }

    async updateOrderStatus(page, status) {
        logger.info('Cập nhật trạng thái...');

        // Tìm frame chứa grid
        const dataFrame = await this.findFrameWithSelector(
            page,
            '#app-root .wrapper-frame-body .contents tbody tr'
        );

        await this.waitForElement(
            dataFrame,
            '#app-root .wrapper-frame-body .contents tbody tr'
        );

        // Click button status
        await dataFrame.evaluate(() => {
            const firstRow = document.querySelector('#app-root .wrapper-frame-body .contents tbody tr');
            if (!firstRow) throw new Error('Không tìm thấy record');

            const button = firstRow.querySelector('.control-set:has(a) a');

            button.click();
        });

        await dataFrame.waitForSelector(
            '.dropdown-menu [data-baseid] li span',
            { visible: true, timeout: 10000 } // Timeout 10s
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

        await new Promise(resolve => setTimeout(resolve, 3000));

        logger.info('Đã cập nhật trạng thái thành công');
    }

    async updateTrackingNumber(page, trackingNumber, waybillNumber = '', labelUrl = null) {
        logger.info('Cập nhật tracking...');

        // Tìm frame chứa grid
        const dataFrame = await this.findFrameWithSelector(
            page,
            '#app-root .wrapper-frame-body .contents tbody tr'
        );

        await this.waitForElement(
            dataFrame,
            '#app-root .wrapper-frame-body .contents tbody tr'
        );

        // Click mở modal
        await dataFrame.evaluate(() => {
            const linkModal = document.querySelector('#app-root .wrapper-frame-body .contents tbody tr a[id][data-item-key]');
            if (!linkModal) throw new Error('Không tìm thấy link để mở modal');
            linkModal.click();
        });// Chờ modal xuất hiện và input tracking sẵn sàng
        await this.waitForElement(
            dataFrame,
            '[data-container="popup-body"] .contents [placeholder="Tracking last mile"]'
        );

        // Chờ modal load đủ dữ liệu
        await dataFrame.waitForFunction(
            () => {
                const input = document.querySelector('[data-container="popup-body"] .contents [placeholder="Tracking last mile"]');
                return input && !input.disabled;
            },
            { timeout: config.puppeteer.timeout }
        );

        // Update tracking number
        const updateSuccess = await dataFrame.evaluate((trackingNumber, waybillNumber, labelUrl) => {
            const input = document.querySelector('[data-container="popup-body"] .contents [placeholder="Tracking last mile"]');
            if (!input) {
                throw new Error('Không tìm thấy input Tracking number');
            }

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
                const labelInput = document.querySelector('[data-container="popup-body"] .contents [placeholder="Master tracking"]');
                if (labelInput) {
                    labelInput.value = waybillNumber;
                    labelInput.dispatchEvent(new Event('input', { bubbles: true }));
                    labelInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }

            return true;
        }, trackingNumber, waybillNumber, labelUrl);

        if (!updateSuccess) {
            throw new Error('Không thể cập nhật tracking number');
        }

        // Verify giá trị đã được set
        await dataFrame.waitForFunction(
            (expectedValue) => {
                const input = document.querySelector('[data-container="popup-body"] .contents [placeholder="Tracking last mile"]');
                return input && input.value === expectedValue;
            },
            { timeout: config.puppeteer.timeout },
            trackingNumber
        );

        // Press F8 để save
        await page.keyboard.press('F8');
        await new Promise(resolve => setTimeout(resolve, 3000));
        logger.info('Đã cập nhật tracking number thành công');
    }
}
module.exports = new ECountService();