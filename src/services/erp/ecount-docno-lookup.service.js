// src/services/erp/ecount-docno-lookup.service.js
const { chromium } = require('playwright');
const sessionManager = require('./ecount-session.manager');
const logger = require('../../utils/logger');
const config = require('../../config');

class ECountDocNoLookupService {
    constructor() {
        this.playwrightConfig = config.playwright;
        this.ecountConfig = config.ecount;
    }

    /**
     * Lookup DOC_NO từ SlipNos
     * @param {string[]} slipNos - Array of SlipNos (e.g., ['20260204-53', '20260204-54'])
     * @returns {Promise<Object>} - Map SlipNo -> DOC_NO
     */
    async lookupDocNos(slipNos) {
        if (!slipNos || slipNos.length === 0) {
            return {};
        }

        let browser, context, page;

        try {
            logger.info('Starting DOC_NO lookup', { slipNos });

            // Parse date từ SlipNo đầu tiên
            const firstSlipNo = slipNos[0];
            const dateMatch = firstSlipNo.match(/^(\d{4})(\d{2})(\d{2})-/);
            
            if (!dateMatch) {
                throw new Error(`Invalid SlipNo format: ${firstSlipNo}`);
            }

            const [, year, month, day] = dateMatch;
            const searchDate = `${day}/${month}/${year}`; // DD/MM/YYYY

            // Get browser with session
            const result = await this.getBrowserWithSession();
            browser = result.browser;
            context = result.context;
            page = result.page;

            logger.info('Browser ready, searching for orders', { searchDate });

            await this.executeSearch(page);
            // Mở form search
            await this.openSearchForm(page);

            // Search
            await this.executeSearch(page);

            // Lấy mapping SlipNo -> DOC_NO
            const mapping = await this.extractDocNoMapping(page, slipNos, searchDate);

            logger.info('DOC_NO lookup completed', { 
                found: Object.keys(mapping).length,
                total: slipNos.length,
                mapping 
            });

            return mapping;

        } catch (error) {
            logger.error('Failed to lookup DOC_NO:', error);
            throw error;
        } finally {
            if (browser) {
                await browser.close();
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
                logger.debug('Using existing session');

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
                    logger.warn('Session expired, need re-login');
                    await sessionManager.clearSession();
                    throw new Error('SESSION_EXPIRED');
                }

            } else {
                logger.info('No session found, logging in...');
                
                await this.login(page);

                const cookies = await context.cookies();
                const currentUrl = page.url();
                const urlObj = new URL(currentUrl);
                const urlParams = {
                    w_flag: urlObj.searchParams.get('w_flag'),
                    ec_req_sid: urlObj.searchParams.get('ec_req_sid')
                };

                await sessionManager.saveSession(cookies, urlParams, 30);

                const baseUrl = this.ecountConfig.baseUrl.replace('login.ecount.com', 'loginia.ecount.com');
                const targetUrl = `${baseUrl}/ec5/view/erp?w_flag=${urlParams.w_flag}&ec_req_sid=${urlParams.ec_req_sid}${ecountLink}`;

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
        logger.info('Logging in to ECount...');

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
        const frame2 = await this.findFrameWithSelector(page, 'button[data-id="1"]');

        await frame2.waitForSelector('button[data-id="1"]', {
            state: 'visible',
            timeout: this.playwrightConfig.timeout
        });

        await frame2.click('button[data-id="1"]');
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
     * Extract mapping SlipNo -> DOC_NO
     */
    async extractDocNoMapping(page, slipNos, searchDate) {
        const frame = await this.findFrameWithSelector(page, '#app-root .wrapper-frame-body .contents tbody tr');

        // Chuẩn bị SlipNo patterns để so sánh
        const slipNoPatterns = slipNos.map(slipNo => {
            const match = slipNo.match(/^(\d{4})(\d{2})(\d{2})-(\d+)$/);
            if (!match) return null;
            
            const [, year, month, day, id] = match;
            return {
                original: slipNo,
                dateStr: `${day}/${month}/${year}`,
                id: id,
                pattern: `${day}/${month}/${year}-${id}` // DD/MM/YYYY-ID
            };
        }).filter(p => p !== null);

        logger.debug('SlipNo patterns:', slipNoPatterns);

        const mapping = await frame.evaluate(({ patterns }) => {
            const headers = Array.from(document.querySelectorAll('#app-root .wrapper-frame-body .contents thead th'));
            
            // Map vị trí các cột
            const columnMap = {
                date: headers.findIndex(th => th.textContent.trim().normalize('NFC') === 'Date'),
                codeThg: headers.findIndex(th => th.textContent.trim().normalize('NFC') === 'Code-THG')
            };

            if (columnMap.date === -1 || columnMap.codeThg === -1) {
                throw new Error('Required columns not found');
            }

            const rows = document.querySelectorAll('#app-root .wrapper-frame-body .contents tbody tr');
            const result = {};

            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                
                // Lấy giá trị Date và Code-THG
                const dateCell = cells[columnMap.date]?.textContent || '';
                const codeThg = cells[columnMap.codeThg]?.textContent.trim() || '';

                if (!dateCell || !codeThg) return;

                // Remove tất cả whitespace để so sánh
                const normalizedDate = dateCell.replace(/\s+/g, '');

                // So sánh với các pattern
                patterns.forEach(pattern => {
                    const normalizedPattern = pattern.pattern.replace(/\s+/g, '');
                    
                    if (normalizedDate === normalizedPattern) {
                        result[pattern.original] = codeThg;
                    }
                });
            });

            return result;
        }, { patterns: slipNoPatterns });

        return mapping;
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
                    // Frame not ready
                }
            }

            await page.waitForTimeout(100);
        }

        throw new Error(`Frame with selector not found: ${selector}`);
    }
}

module.exports = new ECountDocNoLookupService();