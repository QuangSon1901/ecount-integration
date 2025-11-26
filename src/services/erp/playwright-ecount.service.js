const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const logger = require('../../utils/logger');
const sessionManager = require('./ecount-session.manager');

class PlaywrightECountService {
    constructor() {
        this.config = config.ecount;
        this.playwrightConfig = config.playwright;
        this.screenshotDir = path.join(__dirname, '../../../logs/screenshots');
        
        if (!fs.existsSync(this.screenshotDir)) {
            fs.mkdirSync(this.screenshotDir, { recursive: true });
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
        return frameOrPage.locator(selector);
    }

    /**
     * Tìm frame chứa selector
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
     * Type text với validation
     */
    async typeText(page, selector, text, options = {}) {
        await this.waitForElement(page, selector);
        await page.click(selector);
        await page.fill(selector, text);
        
        // Verify
        await page.waitForFunction(
            ({ sel, expectedText }) => {
                const input = document.querySelector(sel);
                return input && input.value === expectedText;
            },
            { sel: selector, expectedText: text },
            { timeout: 5000 }
        );
    }

    /**
     * Login vào ECount
     */
    async login(page) {
        logger.info('Đăng nhập ECount...');

        await page.goto(
            `${this.config.baseUrl}/?xurl_rd=Y&login_lantype=&lan_type=vi-VN`,
            { waitUntil: 'networkidle', timeout: this.playwrightConfig.timeout }
        );

        const hasLoginForm = await page.$('#com_code');
        if (hasLoginForm) {
            await this.typeText(page, '#com_code', this.config.companyCode);
            await this.typeText(page, '#id', this.config.id);
            await this.typeText(page, '#passwd', this.config.password);

            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle', timeout: this.playwrightConfig.timeout }),
                page.click('button#save')
            ]);

            // Close popup if exists
            const hasPopup = await page.$('#toolbar_sid_toolbar_item_non_regist');
            if (hasPopup) {
                await page.click('#toolbar_sid_toolbar_item_non_regist');
                await page.waitForTimeout(1000);
            }

            logger.info('Đã đăng nhập');
        }
    }

    /**
     * Navigate đến order management
     */
    async navigateToOrderManagement(page, ecountLink) {
        logger.info('Điều hướng đến quản lý đơn hàng...');

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

        logger.info('Đã vào trang quản lý đơn hàng');
    }

    /**
     * Tìm kiếm đơn hàng
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
            null,
            { timeout: this.playwrightConfig.timeout }
        );

        await searchFrame.evaluate(() => {
            const input = document.querySelector('#quick_search');
            if (input) {
                input.scrollIntoView({ behavior: 'instant', block: 'center' });
                input.focus();
            }
        });

        await searchFrame.type('#quick_search', orderCode, { delay: 100 });
        await searchFrame.waitForTimeout(5000);

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

        logger.info('Đã tìm thấy đơn hàng');
    }

    /**
     * Update tracking number
     */
    async updateTrackingNumber(page, trackingNumber, waybillNumber = '', labelUrl = null) {
        logger.info('Cập nhật tracking...');

        const dataFrame = await this.findFrameWithSelector(
            page,
            '#app-root .wrapper-frame-body .contents tbody tr'
        );

        await this.waitForElement(
            dataFrame,
            '#app-root .wrapper-frame-body .contents tbody tr'
        );

        await dataFrame.evaluate(() => {
            const linkModal = document.querySelector('#app-root .wrapper-frame-body .contents tbody tr a[id][data-item-key]');
            if (!linkModal) throw new Error('Không tìm thấy link để mở modal');
            linkModal.click();
        });

        await this.waitForElement(
            dataFrame,
            '[data-container="popup-body"] .contents [placeholder="Tracking last mile"]'
        );

        await dataFrame.waitForFunction(
            () => {
                const input = document.querySelector('[data-container="popup-body"] .contents [placeholder="Tracking last mile"]');
                return input && !input.disabled;
            },
            null,
            { timeout: this.playwrightConfig.timeout }
        );

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
                const waybillInput = document.querySelector('[data-container="popup-body"] .contents [placeholder="Master tracking"]');
                if (waybillInput) {
                    waybillInput.value = waybillNumber;
                    waybillInput.dispatchEvent(new Event('input', { bubbles: true }));
                    waybillInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }

            return true;
        }, trackingNumber, waybillNumber, labelUrl);

        if (!updateSuccess) {
            throw new Error('Không thể cập nhật tracking number');
        }

        await page.keyboard.press('F8');
        await page.waitForTimeout(3000);
        
        logger.info('Đã cập nhật tracking number thành công');
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
                logger.info('Đang sử dụng session có sẵn', {
                    ttl: sessionManager.getSessionTTL() + 's',
                    cookiesCount: session.cookies.length
                });

                const urlParams = session.url_params;
                const baseUrl = this.config.baseUrl.replace('login.ecount.com', 'loginia.ecount.com');
                const sessionUrl = `${baseUrl}/ec5/view/erp?w_flag=${urlParams.w_flag}&ec_req_sid=${urlParams.ec_req_sid}${ecountLink}`;

                const baseDomain = new URL(baseUrl).origin;
                await page.goto(baseDomain, {
                    waitUntil: 'domcontentloaded',
                    timeout: this.playwrightConfig.timeout
                });

                await page.waitForLoadState('domcontentloaded');

                // Set cookies
                const cookiesToSet = session.cookies.map(cookie => {
                    const fixedCookie = { ...cookie };
                    if (fixedCookie.domain && !baseDomain.includes(fixedCookie.domain.replace(/^\./, ''))) {
                        const baseHostname = new URL(baseDomain).hostname;
                        fixedCookie.domain = baseHostname;
                    }
                    return fixedCookie;
                });

                await context.addCookies(cookiesToSet);
                logger.info('Cookies set successfully');

                await page.goto(sessionUrl, {
                    waitUntil: 'domcontentloaded',
                    timeout: this.playwrightConfig.timeout
                });

                await page.waitForLoadState('domcontentloaded');

                const currentUrl = page.url();
                if (!currentUrl.includes('ec_req_sid')) {
                    logger.warn('Session không còn hợp lệ, cần login lại');
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
     * Update tracking - Single order
     */
    async updateSingleOrder(orderId, erpOrderCode, trackingNumber, ecountLink, waybillNumber = '', labelUrl = null) {
        let browser, context, page;

        try {
            const result = await this.getBrowserWithSession(ecountLink);
            browser = result.browser;
            context = result.context;
            page = result.page;

            await this.searchOrder(page, erpOrderCode);
            await this.updateTrackingNumber(page, trackingNumber, waybillNumber, labelUrl);

            return {
                success: true,
                orderId,
                erpOrderCode,
                trackingNumber
            };

        } catch (error) {
            if (error.message === 'SESSION_EXPIRED') {
                logger.info('Session hết hạn, thử lại...');
                if (browser) await browser.close();
                
                await sessionManager.clearSession();
                return await this.updateSingleOrder(orderId, erpOrderCode, trackingNumber, ecountLink, waybillNumber, labelUrl);
            }

            logger.error('Lỗi update tracking:', error.message);
            if (page) await this.saveDebugInfo(page, erpOrderCode);
            throw error;

        } finally {
            if (browser) await browser.close();
        }
    }
}

module.exports = new PlaywrightECountService();