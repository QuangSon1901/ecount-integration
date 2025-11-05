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

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
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
                cookies: cookies,
                urlParams: urlParams,
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
            args: this.puppeteerConfig.args,
            ...(this.puppeteerConfig.executablePath && { 
                executablePath: this.puppeteerConfig.executablePath 
            })
        });

        try {
            const [page] = await browser.pages();
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

            if (session) {
                logger.info('Đang sử dụng session có sẵn', {
                    ttl: sessionManager.getSessionTTL() + 's'
                });

                // Set cookies từ session
                await page.setCookie(...session.cookies);

                // Navigate với session params
                // Lưu ý: session.url_params từ DB (snake_case)
                const urlParams = session.url_params;
                const baseUrl = this.config.baseUrl.replace('login.ecount.com', 'loginia.ecount.com');
                const sessionUrl = `${baseUrl}/ec5/view/erp?w_flag=${urlParams.w_flag}&ec_req_sid=${urlParams.ec_req_sid}${ecountLink}`;
                
                logger.info('Navigate to:', sessionUrl);

                await page.goto(sessionUrl, {
                    waitUntil: 'networkidle0',
                    timeout: this.puppeteerConfig.timeout
                });

                await this.sleep(3000);

                // Verify session còn hợp lệ
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
                
                // Không có session, login bình thường
                await this.login(page);
                
                await this.sleep(2000);

                // Lấy cookies và URL params sau khi login
                const cookies = await page.cookies();
                const currentUrl = page.url();
                const urlObj = new URL(currentUrl);
                const urlParams = {
                    w_flag: urlObj.searchParams.get('w_flag'),
                    ec_req_sid: urlObj.searchParams.get('ec_req_sid')
                };

                logger.info('Lưu session mới...', {
                    w_flag: urlParams.w_flag,
                    ec_req_sid: urlParams.ec_req_sid?.substring(0, 10) + '...'
                });
                
                // Lưu session mới vào DB
                await sessionManager.saveSession(cookies, urlParams, 30);
                await this.navigateToOrderManagement(page, ecountLink);
            }

            return { browser, page };

        } catch (error) {
            // Nếu có lỗi, đóng browser trước khi throw
            await browser.close();
            throw error;
        }
    }

    /**
     * Cập nhật tracking number vào ECount
     * @param {string} type - Loại update "status", "tracking_number"
     * @param {number} orderId - ID order trong DB
     * @param {string} orderCode - Mã đơn hàng trong ECount
     * @param {string} trackingNumber - Tracking number
     * @param {string} status - Trạng thái cần cập nhật
     * @param {string} ecountLink - Hash link đầy đủ từ ECount
     */
    async updateInfoEcount(type, orderId, orderCode, trackingNumber, status = 'Đã hoàn tất', ecountLink) {
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
                    await this.updateTrackingNumber(page, trackingNumber);
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
            logger.error('Lỗi khi cập nhật ECount:', error.message);

            if (page) {
                await this.saveDebugInfo(page, orderCode);
            }

            throw error;

        } finally {
            await browser.close();
        }
    }

    async getInfoEcount(orderCode, ecountLink) {
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
    async getInfoEcountOld(orderCode, ecountLink) {
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
        let dataFrame = page;
        for (const frame of page.frames()) {
            try {
                const hasGrid = await frame.evaluate(() => {
                    return document.querySelector('#app-root .wrapper-frame-body .contents tbody tr') !== null;
                });
                if (hasGrid) {
                    dataFrame = frame;
                    break;
                }
            } catch (e) {}
        }

        await dataFrame.waitForSelector('#app-root .wrapper-frame-body .contents tbody tr', { timeout: 20000 });

        await dataFrame.evaluate(() => {
            const linkModal = document.querySelector('#app-root .wrapper-frame-body .contents tbody tr a[id][data-item-key]');
            if (!linkModal) throw new Error('Không tìm thấy link để mở modal');
            linkModal.click();
        });

        await this.sleep(3000);

        await dataFrame.waitForSelector('[data-container="popup-body"] .contents [placeholder="Tracking number (Yun)"]', { 
            visible: true,
            timeout: 15000 
        });

        await this.sleep(2000);

        const result = await dataFrame.evaluate(() => {
            const contentModal = document.querySelector('[data-container="popup-body"] .contents [placeholder="Tracking number (Yun)"]')?.closest('[data-container="popup-body"]');
            const fields = {
                order_info: {
                    customer_order_number: contentModal.querySelector('[placeholder="Code-THG"]')?.value || "",
                    platform_order_number: contentModal.querySelector('[placeholder="OrderID"]')?.value || "",
                    tracking_number: contentModal.querySelector('[placeholder="Tracking number (Yun)"]')?.value || "",
                    service_code: contentModal.querySelector('[placeholder="Service"]')?.value || ""
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
                
                if(prodCode && prodCode !== '\u00A0' && prodCode !== '') {
                    const qty = row.querySelector('[data-columnid="qty"] .grid-input-data')?.textContent?.trim() || "0";
                    const dimensions = row.querySelector('[data-columnid="ADD_TXT_04"] .grid-input-data')?.textContent?.trim() || "";
                    const weight = row.querySelector('[data-columnid="ADD_TXT_03"] .grid-input-data')?.textContent?.trim() || "0";
                    
                    let length = 0, width = 0, height = 0;
                    if(dimensions) {
                        const parts = dimensions.split('x');
                        length = parseFloat(parts[0]) || 0;
                        width = parseFloat(parts[1]) || 0;
                        height = parseFloat(parts[2]) || 0;
                    }
                    
                    fields.packages.push({
                        length: length,
                        width: width,
                        height: height,
                        weight: parseFloat(weight) || 0
                    });
                    
                    fields.declaration_info.push({
                        sku_code: prodCode,
                        name_en: row.querySelector('[data-columnid="prod_des"] .grid-input-data')?.textContent?.trim() || "",
                        name_local: row.querySelector('[data-columnid="prod_des"] .grid-input-data')?.textContent?.trim() || "",
                        quantity: parseInt(qty) || 1,
                        unit_price: 0,
                        unit_weight: parseFloat(weight) || 0,
                        hs_code: "",
                        currency: "USD"
                    });
                }
            });

            if(fields.packages.length === 0) {
                fields.packages.push({
                    length: 0,
                    width: 0,
                    height: 0,
                    weight: 0
                });
            }
            
            return fields;
        })

        await this.sleep(1000);
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

        await this.sleep(2000);

        const hasLoginForm = await page.$('#com_code');
        if (hasLoginForm) {
            await page.waitForSelector('#com_code', { visible: true, timeout: 10000 });
            await page.click('#com_code');
            await this.sleep(500);
            await page.type('#com_code', this.config.companyCode, { delay: 100 });

            await page.click('#id');
            await this.sleep(500);
            await page.type('#id', this.config.id, { delay: 100 });

            await page.click('#passwd');
            await this.sleep(500);
            await page.type('#passwd', this.config.password, { delay: 100 });

            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle0', timeout: this.puppeteerConfig.timeout }),
                page.click('button#save')
            ]);

            await this.sleep(3000);

            // Close popup if exists
            const hasPopup = await page.$('#toolbar_sid_toolbar_item_non_regist');
            if (hasPopup) {
                await page.click('#toolbar_sid_toolbar_item_non_regist');
                await this.sleep(1000);
            }

            logger.info('Đã đăng nhập');
        }
    }

    /**
     * Điều hướng đến quản lý đơn hàng với hash link cụ thể
     * @param {Page} page - Puppeteer page
     * @param {string} ecountLink - Hash link đầy đủ, ví dụ: "#menuType=MENUTREE_000004&menuSeq=..."
     */
    async navigateToOrderManagement(page, ecountLink) {
        logger.info('Điều hướng đến quản lý đơn hàng với link: ' + ecountLink, );

        await this.sleep(3000);
        await page.waitForFunction(
            () => document.readyState === 'complete' && document.body !== null,
            { timeout: 30000 }
        );

        const currentUrl = page.url();
        const urlObj = new URL(currentUrl);
        const baseUrl = urlObj.origin + urlObj.pathname + urlObj.search;

        // Sử dụng hash link từ parameter thay vì config cố định
        const targetUrl = `${baseUrl}${ecountLink}`;

        logger.info('Target URL:', targetUrl);

        await page.goto(targetUrl, {
            waitUntil: 'networkidle2',
            timeout: this.puppeteerConfig.timeout
        });

        await this.sleep(5000);
        logger.info('Đã vào trang quản lý đơn hàng');
    }

    async searchOrder(page, orderCode) {
        logger.info('Tìm kiếm đơn hàng:', orderCode);

        let searchFrame = page;
        for (const frame of page.frames()) {
            try {
                const hasSearch = await frame.evaluate(() => {
                    return document.querySelector('#quick_search') !== null;
                });
                if (hasSearch) {
                    searchFrame = frame;
                    break;
                }
            } catch (e) {}
        }

        await searchFrame.waitForFunction(
            () => {
                const input = document.querySelector('#quick_search');
                return input !== null && window.getComputedStyle(input).display !== 'none';
            },
            { timeout: 30000 }
        );

        await this.sleep(2000);

        await searchFrame.evaluate(() => {
            const input = document.querySelector('#quick_search');
            if (input) {
                input.scrollIntoView({ behavior: 'instant', block: 'center' });
                input.focus();
            }
        });

        await this.sleep(1000);
        await searchFrame.type('#quick_search', orderCode, { delay: 150 });
        await page.keyboard.press('Enter');

        await this.sleep(6000);
        logger.info('Đã tìm thấy đơn hàng');
    }

    async updateOrderStatus(page, status) {
        logger.info('Cập nhật trạng thái...');

        let dataFrame = page;
        for (const frame of page.frames()) {
            try {
                const hasGrid = await frame.evaluate(() => {
                    return document.querySelector('#app-root .wrapper-frame-body .contents tbody tr') !== null;
                });
                if (hasGrid) {
                    dataFrame = frame;
                    break;
                }
            } catch (e) {}
        }

        await dataFrame.waitForSelector('#app-root .wrapper-frame-body .contents tbody tr', { timeout: 20000 });

        // Step 1: Check checkbox
        await dataFrame.evaluate(() => {
            const firstRow = document.querySelector('#app-root .wrapper-frame-body .contents tbody tr');
            if (!firstRow) throw new Error('Không tìm thấy record');

            const button = firstRow.querySelector('.control-set:has(a) a');
            button.click();
        });

        await this.sleep(2000);

        // Step 3: Đợi dropdown xuất hiện và click vào status
        await dataFrame.waitForSelector('.dropdown-menu [data-baseid] li span', {
            visible: true,
            timeout: 10000
        });

        await this.sleep(500);

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

        await this.sleep(3000);
        logger.info('Đã cập nhật trạng thái thành công');
    }

    async updateTrackingNumber(page, trackingNumber) {
        logger.info('Cập nhật tracking...');

        let dataFrame = page;
        for (const frame of page.frames()) {
            try {
                const hasGrid = await frame.evaluate(() => {
                    return document.querySelector('#app-root .wrapper-frame-body .contents tbody tr') !== null;
                });
                if (hasGrid) {
                    dataFrame = frame;
                    break;
                }
            } catch (e) {}
        }

        await dataFrame.waitForSelector('#app-root .wrapper-frame-body .contents tbody tr', { timeout: 20000 });
        
        await dataFrame.evaluate(() => {
            const linkModal = document.querySelector('#app-root .wrapper-frame-body .contents tbody tr a[id][data-item-key]');
            if (!linkModal) throw new Error('Không tìm thấy link để mở modal');
            linkModal.click();
        });

        await this.sleep(3000);

        await dataFrame.waitForSelector('[data-container="popup-body"] .contents [placeholder="Tracking number (Yun)"]', { 
            visible: true,
            timeout: 15000 
        });

        await this.sleep(2000);

        const updateSuccess = await dataFrame.evaluate((trackingNumber) => {
            const input = document.querySelector('[data-container="popup-body"] .contents [placeholder="Tracking number (Yun)"]');
            if (!input) {
                throw new Error('Không tìm thấy input Tracking number');
            }

            input.value = trackingNumber;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            
            return true;
        }, trackingNumber);

        if (!updateSuccess) {
            throw new Error('Không thể cập nhật tracking number');
        }

        await this.sleep(1000);
        await page.keyboard.press('F8');
        await this.sleep(5000);
    }
}

module.exports = new ECountService();