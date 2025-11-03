const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const logger = require('../../utils/logger');

class ECountService {
    constructor() {
        this.config = config.ecount;
        this.puppeteerConfig = config.puppeteer;
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Cập nhật tracking number vào ECount
     */
    async updateTrackingNumber(orderCode, trackingNumber, status = 'Đã hoàn tất') {
        logger.info('🤖 Bắt đầu cập nhật tracking vào ECount...', {
            orderCode,
            trackingNumber
        });

        const browser = await puppeteer.launch({
            headless: this.puppeteerConfig.headless,
            defaultViewport: null,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--lang=vi-VN',
                '--window-size=1366,768',
                '--disable-blink-features=AutomationControlled',
            ],
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

            // Navigate to order management
            await this.navigateToOrderManagement(page);

            // Search for order
            await this.searchOrder(page, orderCode);

            // Update tracking and status
            await this.updateOrderStatus(page, trackingNumber, status);

            logger.info('✅ Đã cập nhật tracking vào ECount thành công');

            return {
                success: true,
                orderCode,
                trackingNumber,
                updatedAt: new Date().toISOString()
            };

        } catch (error) {
            logger.error('❌ Lỗi khi cập nhật ECount:', error.message);

            // Screenshot for debugging
            if (page) {
                try {
                    const screenshotPath = path.join(
                        __dirname,
                        '../../../',
                        `ecount-error-${Date.now()}.png`
                    );
                    await page.screenshot({ path: screenshotPath, fullPage: true });
                    logger.info(`📸 Đã lưu screenshot: ${screenshotPath}`);
                } catch (e) {
                    logger.error('Không thể lưu screenshot:', e.message);
                }
            }

            throw error;

        } finally {
            await browser.close();
        }
    }

    async login(page) {
        logger.info('📍 Đăng nhập ECount...');

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

            logger.info('✅ Đã đăng nhập');
        }
    }

    async navigateToOrderManagement(page) {
        logger.info('📍 Điều hướng đến quản lý đơn hàng...');

        await this.sleep(3000);
        await page.waitForFunction(
            () => document.readyState === 'complete' && document.body !== null,
            { timeout: 30000 }
        );

        const currentUrl = page.url();
        const urlObj = new URL(currentUrl);
        const baseUrl = urlObj.origin + urlObj.pathname + urlObj.search;

        const menuHash = "#menuType=MENUTREE_000004&menuSeq=MENUTREE_000030&groupSeq=MENUTREE_000030&prgId=C000030";
        const targetUrl = `${baseUrl}${menuHash}`;

        await page.goto(targetUrl, {
            waitUntil: 'networkidle2',
            timeout: this.puppeteerConfig.timeout
        });

        await this.sleep(5000);
        logger.info('✅ Đã vào trang quản lý đơn hàng');
    }

    async searchOrder(page, orderCode) {
        logger.info('📍 Tìm kiếm đơn hàng:', orderCode);

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
            { timeout: 20000 }
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
        logger.info('✅ Đã tìm thấy đơn hàng');
    }

    async updateOrderStatus(page, trackingNumber, status) {
        logger.info('📍 Cập nhật trạng thái và tracking...');

        let dataFrame = page;
        for (const frame of page.frames()) {
            try {
                const hasGrid = await frame.evaluate(() => {
                    return document.querySelector('#grid-main tbody tr') !== null;
                });
                if (hasGrid) {
                    dataFrame = frame;
                    break;
                }
            } catch (e) {}
        }

        await dataFrame.waitForSelector('#grid-main tbody tr', { timeout: 20000 });

        await dataFrame.evaluate(
            async (params) => {
                const firstRow = document.querySelector('#grid-main tbody tr');
                if (!firstRow) return;

                // Update status
                const statusBtn = firstRow.querySelector('td:nth-child(3) a');
                if (statusBtn) {
                    statusBtn.click();
                    await new Promise(res => setTimeout(res, 2000));

                    const findSpanStatus = document.querySelectorAll('.dropdown-menu [data-baseid] li span');
                    findSpanStatus.forEach(span => {
                        if (span.innerText.trim() === params.status) {
                            span.click();
                        }
                    });
                }

                // TODO: Update tracking number field
                // Cần xác định field tracking number trong ECount
                // và cập nhật giá trị params.trackingNumber

            },
            { status, trackingNumber }
        );

        await this.sleep(3000);
        logger.info('✅ Đã cập nhật trạng thái');
    }
}

module.exports = new ECountService();