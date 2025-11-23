const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const logger = require('../../utils/logger');
const sessionManager = require('./ecount-session.manager');

class ECountPlaywrightService {
    constructor() {
        this.config = config.ecount;
        this.playwrightConfig = {
            headless: config.puppeteer.headless === 'new' ? true : false,
            timeout: config.puppeteer.timeout
        };

        // Tạo thư mục screenshots
        this.screenshotDir = path.join(__dirname, '../../../logs/screenshots');
        if (!fs.existsSync(this.screenshotDir)) {
            fs.mkdirSync(this.screenshotDir, { recursive: true });
        }
    }

    /**
     * Chờ network idle
     */
    async waitForNetworkIdle(page, timeout = this.playwrightConfig.timeout) {
        try {
            await page.waitForLoadState('networkidle', { timeout });
        } catch (error) {
            logger.warn('Network idle timeout, continuing...', { timeout });
        }
    }

    /**
     * Chờ element xuất hiện và sẵn sàng
     */
    async waitForElement(frameOrPage, selector, options = {}) {
        const defaultOptions = {
            state: 'visible',
            timeout: this.playwrightConfig.timeout,
            ...options
        };

        await frameOrPage.waitForSelector(selector, defaultOptions);

        // Đảm bảo element có thể click
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
                selector,
                { timeout: defaultOptions.timeout }
            );
        }

        return frameOrPage.locator(selector).first();
    }

    /**
     * Tìm frame chứa selector
     */
    async findFrameWithSelector(page, selector, timeout = this.playwrightConfig.timeout) {
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            const frames = page.frames();

            for (const frame of frames) {
                try {
                    const element = await frame.locator(selector).first().elementHandle({ timeout: 100 });
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
     * Type text với validation
     */
    async typeText(frameOrPage, selector, text, options = {}) {
        await this.waitForElement(frameOrPage, selector);
        await frameOrPage.click(selector);
        await frameOrPage.fill(selector, text);

        // Verify
        await frameOrPage.waitForFunction(
            (sel, expectedText) => {
                const input = document.querySelector(sel);
                return input && input.value === expectedText;
            },
            [selector, text],
            { timeout: 5000 }
        );
    }

    /**
     * Tạo session mới
     */
    async createSession() {
        logger.info('Đang tạo session ECount mới với Playwright...');

        const browser = await chromium.launch({
            headless: this.playwrightConfig.headless,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ]
        });

        let context, page;
        try {
            context = await browser.newContext({
                viewport: { width: 1366, height: 768 },
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            });

            page = await context.newPage();
            page.setDefaultTimeout(this.playwrightConfig.timeout);

            // Anti-detection
            await page.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
                Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
                window.chrome = { runtime: {} };
            });

            // Login
            await this.login(page);

            // Lấy cookies và URL params
            const cookies = await context.cookies();
            const currentUrl = page.url();
            const urlObj = new URL(currentUrl);
            const urlParams = {
                w_flag: urlObj.searchParams.get('w_flag'),
                ec_req_sid: urlObj.searchParams.get('ec_req_sid')
            };

            // Lưu session
            await sessionManager.saveSession(cookies, urlParams, 30);

            logger.info('Đã tạo session thành công với Playwright', {
                w_flag: urlParams.w_flag,
                ec_req_sid: urlParams.ec_req_sid?.substring(0, 10) + '...',
                cookiesCount: cookies.length
            });

            return {
                success: true,
                expiresIn: 1800
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

        const browser = await chromium.launch({
            headless: this.playwrightConfig.headless,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ]
        });

        try {
            const context = await browser.newContext({
                viewport: { width: 1366, height: 768 },
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            });

            const page = await context.newPage();
            page.setDefaultTimeout(this.playwrightConfig.timeout);

            // Anti-detection
            await page.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
                Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
                window.chrome = { runtime: {} };
            });

            if (session) {
                logger.info('Đang sử dụng session có sẵn', {
                    ttl: sessionManager.getSessionTTL() + 's',
                    cookiesCount: session.cookies.length
                });

                const urlParams = session.url_params;
                const baseUrl = this.config.baseUrl.replace('login.ecount.com', 'loginia.ecount.com');
                const sessionUrl = `${baseUrl}/ec5/view/erp?w_flag=${urlParams.w_flag}&ec_req_sid=${urlParams.ec_req_sid}${ecountLink}`;

                // Navigate đến base domain trước
                const baseDomain = new URL(baseUrl).origin;
                logger.info('Navigate to base domain first:', baseDomain);

                await page.goto(baseDomain, {
                    waitUntil: 'domcontentloaded',
                    timeout: this.playwrightConfig.timeout
                });

                // Chờ page ready
                await page.waitForFunction(() => document.readyState === 'complete');

                // Set cookies (Playwright tự động fix domain)
                await context.addCookies(session.cookies);
                logger.info('Cookies set successfully');

                // Navigate đến URL cuối
                logger.info('Navigate to final URL:', sessionUrl);
                await page.goto(sessionUrl, {
                    waitUntil: 'domcontentloaded',
                    timeout: this.playwrightConfig.timeout
                });

                await page.waitForFunction(
                    () => document.readyState === 'complete' && document.body !== null,
                    { timeout: this.playwrightConfig.timeout }
                );

                const currentUrl = page.url();
                logger.info('Current URL after navigation:', currentUrl);

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
     * Login
     */
    async login(page) {
        logger.info('Đăng nhập ECount với Playwright...');

        await page.goto(
            `${this.config.baseUrl}/?xurl_rd=Y&login_lantype=&lan_type=vi-VN`,
            { waitUntil: 'networkidle', timeout: this.playwrightConfig.timeout }
        );

        await page.waitForFunction(() => document.readyState === 'complete');

        const hasLoginForm = await page.locator('#com_code').count() > 0;
        if (hasLoginForm) {
            await this.typeText(page, '#com_code', this.config.companyCode);
            await this.typeText(page, '#id', this.config.id);
            await this.typeText(page, '#passwd', this.config.password);

            await Promise.all([
                page.waitForNavigation({
                    waitUntil: 'networkidle',
                    timeout: this.playwrightConfig.timeout
                }),
                page.click('button#save')
            ]);

            await page.waitForFunction(
                () => document.readyState === 'complete' && document.body !== null,
                { timeout: this.playwrightConfig.timeout }
            );

            // Close popup if exists
            const hasPopup = await page.locator('#toolbar_sid_toolbar_item_non_regist').count() > 0;
            if (hasPopup) {
                await page.click('#toolbar_sid_toolbar_item_non_regist');
                await page.waitForTimeout(1000);
            }

            logger.info('Đã đăng nhập thành công');
        }
    }

    /**
     * Navigate đến quản lý đơn hàng
     */
    async navigateToOrderManagement(page, ecountLink) {
        logger.info('Điều hướng đến quản lý đơn hàng với link:', ecountLink);

        await page.waitForFunction(
            () => document.readyState === 'complete' && document.body !== null,
            { timeout: this.playwrightConfig.timeout }
        );

        const currentUrl = page.url();
        const urlObj = new URL(currentUrl);
        const baseUrl = urlObj.origin + urlObj.pathname + urlObj.search;
        const targetUrl = `${baseUrl}${ecountLink}`;

        logger.info('Target URL:', targetUrl);

        await page.goto(targetUrl, {
            waitUntil: 'networkidle',
            timeout: this.playwrightConfig.timeout
        });

        await page.waitForFunction(
            () => {
                const frames = window.frames;
                return document.readyState === 'complete' && frames.length > 0;
            },
            { timeout: this.playwrightConfig.timeout }
        );

        logger.info('Đã vào trang quản lý đơn hàng');
    }

    /**
     * Tìm kiếm order
     */
    async searchOrder(page, orderCode) {
        logger.info('Tìm kiếm đơn hàng:', orderCode);

        const searchFrame = await this.findFrameWithSelector(page, '#quick_search');

        await searchFrame.waitForFunction(
            () => {
                const input = document.querySelector('#quick_search');
                return input !== null &&
                    window.getComputedStyle(input).display !== 'none' &&
                    !input.disabled;
            },
            { timeout: this.playwrightConfig.timeout }
        );

        // Scroll và focus
        await searchFrame.evaluate(() => {
            const input = document.querySelector('#quick_search');
            if (input) {
                input.scrollIntoView({ behavior: 'instant', block: 'center' });
                input.focus();
            }
        });

        await searchFrame.waitForFunction(
            () => document.querySelector('#quick_search') === document.activeElement,
            { timeout: this.playwrightConfig.timeout }
        );

        await searchFrame.locator('#quick_search').fill(orderCode);
        await page.waitForTimeout(5000);

        // Press Enter và chờ kết quả
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
            page.keyboard.press('Enter')
        ]);

        logger.info('Đã tìm thấy đơn hàng');
    }

    /**
     * Update tracking number (batch mode - không close browser)
     */
    async updateTrackingNumberInBatch(page, trackingNumber, waybillNumber = '', labelUrl = null) {
        logger.info('Updating tracking in batch mode...');

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
            if (!linkModal) throw new Error('Không tìm thấy link');
            linkModal.click();
        });

        // Chờ modal
        await this.waitForElement(
            dataFrame,
            '[data-container="popup-body"] .contents [placeholder="Tracking last mile"]'
        );

        await dataFrame.waitForFunction(
            () => {
                const input = document.querySelector('[data-container="popup-body"] .contents [placeholder="Tracking last mile"]');
                return input && !input.disabled;
            },
            { timeout: this.playwrightConfig.timeout }
        );

        // Update tracking
        const updateSuccess = await dataFrame.evaluate(
            ([trackingNumber, waybillNumber, labelUrl]) => {
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

                return true;
            },
            [trackingNumber, waybillNumber, labelUrl]
        );

        if (!updateSuccess) {
            throw new Error('Không thể cập nhật tracking number');
        }

        // Verify
        await dataFrame.waitForFunction(
            (expectedValue) => {
                const input = document.querySelector('[data-container="popup-body"] .contents [placeholder="Tracking last mile"]');
                return input && input.value === expectedValue;
            },
            trackingNumber,
            { timeout: this.playwrightConfig.timeout }
        );

        // Save
        await page.keyboard.press('F8');
        await page.waitForTimeout(3000);
        
        logger.info('Đã cập nhật tracking number thành công');
    }

    /**
     * Update order status
     */
    async updateOrderStatus(page, status) {
        logger.info('Cập nhật trạng thái...', status);

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
            { state: 'visible', timeout: 10000 }
        );

        // Click status
        const statusUpdated = await dataFrame.evaluate((targetStatus) => {
            const spans = document.querySelectorAll('.dropdown-menu [data-baseid] li span');
            if (spans.length === 0) throw new Error('Không tìm thấy danh sách trạng thái');

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

        await page.waitForTimeout(3000);
        logger.info('Đã cập nhật trạng thái thành công');
    }

    /**
     * Lưu screenshot debug
     */
    async saveDebugInfo(page, orderCode) {
        try {
            const timestamp = Date.now();
            const safeOrderCode = orderCode.replace(/[^a-zA-Z0-9]/g, '_');

            const screenshotPath = path.join(
                this.screenshotDir,
                `error_${safeOrderCode}_${timestamp}.png`
            );
            await page.screenshot({ path: screenshotPath, fullPage: true });
            logger.info(`Screenshot lưu tại: ${screenshotPath}`);

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
}

module.exports = new ECountPlaywrightService();