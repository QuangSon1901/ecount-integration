// src/jobs/workers/track-other-order.worker.js
const { chromium } = require('playwright');
const BaseWorker = require('./base.worker');
const OrderModel = require('../../models/order.model');
const jobService = require('../../services/queue/job.service');
const telegram = require('../../utils/telegram');
const logger = require('../../utils/logger');

class TrackOtherOrderWorker extends BaseWorker {
    constructor() {
        super('track_other_order', {
            intervalMs: 10000,    // Check mỗi 10s
            concurrency: 1        // Chỉ chạy 1 job tại một thời điểm để tránh bị block
        });

        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
        ];

        this.playwrightConfig = {
            headless: process.env.PLAYWRIGHT_HEADLESS === 'true',
            timeout: 30000,
            
            launchOptions: {
                headless: process.env.PLAYWRIGHT_HEADLESS === 'true',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-blink-features=AutomationControlled'
                ]
            }
        };
    }

    async processJob(job) {
        const { orderId, trackingNumber } = job.payload;

        logger.info(`[TRACK_OTHER] Processing order ${orderId}`, {
            trackingNumber,
            attempt: job.attempts
        });

        // Lấy thông tin order
        const order = await OrderModel.findById(orderId);
        if (!order) {
            throw new Error(`Order ${orderId} not found`);
        }

        // Track order
        const trackingResult = await this.trackOrder(trackingNumber);

        if (!trackingResult) {
            throw new Error('Failed to get tracking data from API');
        }

        // Map status
        const { newStatus, newOrderStatus, labelStatus } = this.mapStatus(trackingResult.status);

        if (!newStatus || !newOrderStatus) {
            logger.info(`[TRACK_OTHER] Status "${trackingResult.status}" không match rule, skip order ${orderId}`);
            return {
                success: true,
                skipped: true,
                reason: 'Status not matched'
            };
        }

        // Check thay đổi
        const hasChangeStatus = newOrderStatus !== order.order_status;
        const hasChangePkgStatus = newStatus !== order.status;

        if (!hasChangePkgStatus && !hasChangeStatus) {
            logger.info(`[TRACK_OTHER] Status unchanged for order ${orderId}: ${order.status}`);
            return {
                success: true,
                unchanged: true
            };
        }

        logger.info(`[TRACK_OTHER] Status changed for order ${orderId}: ${order.status} → ${newStatus} + ${order.order_status} → ${newOrderStatus}`);

        // Update order
        const updateData = {
            status: newStatus,
            orderStatus: newOrderStatus,
            lastTrackedAt: new Date()
        };

        if (newStatus === 'delivered') {
            updateData.deliveredAt = new Date();
        }

        // Lưu tracking details (optional)
        if (trackingResult.details) {
            updateData.trackingInfo = trackingResult.details;
        }

        await OrderModel.update(orderId, updateData);

        // Nếu có thay đổi order_status và có đủ thông tin ERP
        if (hasChangeStatus && order.erp_order_code && order.ecount_link && labelStatus) {
            await jobService.addUpdateStatusJob(
                orderId,
                order.erp_order_code,
                order.tracking_number,
                labelStatus,
                order.ecount_link,
                5 // delay 5s
            );

            logger.info(`[TRACK_OTHER] Added job to update status to ECount for order ${orderId}`);
        }

        return {
            success: true,
            updated: true,
            oldStatus: order.status,
            newStatus,
            oldOrderStatus: order.order_status,
            newOrderStatus,
            statusUpdatedToERP: hasChangeStatus && order.erp_order_code && order.ecount_link && labelStatus
        };
    }

    /**
     * Track order qua ship24 API
     */
    async trackOrder(trackingNumber) {
        let browser = null;
        let apiData = null;

        try {
            const randomUserAgent = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];

            browser = await chromium.launch(this.playwrightConfig.launchOptions);
            const context = await browser.newContext({
                viewport: { width: 1366, height: 768 },
                userAgent: randomUserAgent,
                locale: 'vi-VN',
                timezoneId: 'Asia/Ho_Chi_Minh'
            });

            const page = await context.newPage();
            page.setDefaultTimeout(this.playwrightConfig.timeout);

            // Intercept API response
            page.on('response', async (response) => {
                const url = response.url();
                if (url.includes('api.ship24.com/api/parcels')) {
                    try {
                        const contentType = response.headers()['content-type'] || '';
                        if (contentType.includes('application/json')) {
                            apiData = await response.json();
                        }
                    } catch (e) {
                        logger.error('[TRACK_OTHER] Failed to parse API response:', e);
                    }
                }
            });

            const trackingUrl = `https://www.ship24.com/tracking?p=${encodeURIComponent(trackingNumber)}`;
            logger.info(`[TRACK_OTHER] Navigating to: ${trackingUrl}`);
            
            await page.goto(trackingUrl, {
                waitUntil: 'domcontentloaded',
                timeout: this.playwrightConfig.timeout
            });

            // Đợi API response (tối đa 15s)
            const maxWaitTime = 15000;
            const startTime = Date.now();
            
            while (!apiData && (Date.now() - startTime < maxWaitTime)) {
                await page.waitForTimeout(500);
            }

            await page.waitForTimeout(1000);

            await browser.close();
            browser = null;

            if (!apiData || !apiData?.data?.dispatch_code?.desc) {
                logger.warn(`[TRACK_OTHER] No API data for tracking ${trackingNumber}`);
                return null;
            }

            logger.info(`[TRACK_OTHER] API Status: ${apiData.data.dispatch_code.desc} for tracking ${trackingNumber}`);

            return {
                status: apiData.data.dispatch_code.desc.toLowerCase(),
                details: {
                    steps: apiData.data.steps?.slice(0, 3),
                    couriers: apiData.data.couriers,
                    daysInTransit: apiData.data.daysInTransit,
                    statusLabel: apiData.data.statusLabel
                }
            };

        } catch (error) {
            logger.error(`[TRACK_OTHER] Error tracking order:`, error);
            throw error;
        } finally {
            if (browser) {
                try {
                    await browser.close();
                } catch (e) {
                    logger.error('[TRACK_OTHER] Error closing browser:', e);
                }
            }
        }
    }

    /**
     * Map status từ API sang internal status
     */
    mapStatus(apiStatus) {
        const status = apiStatus.toLowerCase();

        if (status === 'delivered') {
            return {
                newStatus: 'delivered',
                newOrderStatus: 'V',
                labelStatus: 'Have been received'
            };
        }

        if (status === 'shipped' || status === 'in_transit' || status === 'in transit') {
            return {
                newStatus: 'in_transit',
                newOrderStatus: 'D',
                labelStatus: 'Shipped'
            };
        }

        if (status === 'out_for_delivery') {
            return {
                newStatus: 'in_transit',
                newOrderStatus: 'D',
                labelStatus: 'Shipped'
            };
        }

        return {
            newStatus: null,
            newOrderStatus: null,
            labelStatus: null
        };
    }

    async onJobMaxAttemptsReached(job, error) {
        const { orderId, trackingNumber } = job.payload;
        
        await telegram.notifyError(error, {
            action: 'Track Other Order',
            jobName: 'track_other_order',
            orderId,
            trackingNumber
        });
    }
}

module.exports = TrackOtherOrderWorker;