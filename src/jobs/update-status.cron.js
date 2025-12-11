// src/jobs/update-status.cron.js
const cron = require('node-cron');
const { chromium } = require('playwright');
const OrderModel = require('../models/order.model');
const CronLogModel = require('../models/cron-log.model');
const jobService = require('../services/queue/job.service');
const carrierFactory = require('../services/carriers');
const carriersConfig = require('../config/carriers.config'); // Thêm import này
const logger = require('../utils/logger');
const telegram = require('../utils/telegram');

class UpdateStatusCron {
    constructor() {
        this.isRunning = false;
        this.schedule = '*/10 * * * *';
        this.batchSize = 50;
        this.statusCheckInterval = 6 * 60 * 60;

        // Tạo danh sách tất cả product codes từ carriers config
        this.validProductCodes = this.getAllValidProductCodes();
    }

    /**
     * Lấy tất cả product codes từ carriers config
     */
    getAllValidProductCodes() {
        const productCodes = [];
        
        Object.values(carriersConfig).forEach(carrier => {
            if (carrier.enabled && carrier.productCodes) {
                productCodes.push(...carrier.productCodes);
            }
        });
        
        return productCodes;
    }

    /**
     * Start cron job
     */
    start() {
        logger.info(`Update status cron started - Schedule: ${this.schedule}`);

        cron.schedule(this.schedule, async () => {
            if (this.isRunning) {
                logger.warn('Update status job already running, skipping...');
                return;
            }

            await this.run();
        });

        logger.info('Update status cron job started');
    }

    /**
     * Run job
     */
    async run() {
        const startTime = Date.now();
        let cronLogId = null;
        let stats = {
            processed: 0,
            success: 0,
            failed: 0,
            updated: 0,
            warned: 0,
            batches: 0,
            carrierOrders: 0, // Orders có product code trong config
            otherOrders: 0    // Orders khác
        };

        try {
            this.isRunning = true;
            cronLogId = await CronLogModel.start('update_status_job');

            logger.info('Bắt đầu update status job...');

            let hasMoreOrders = true;
            const processedOrderIds = new Set();

            while (hasMoreOrders) {
                const orders = await this.getOrdersNeedStatusUpdate(
                    this.batchSize,
                    Array.from(processedOrderIds)
                );
                
                if (orders.length === 0) {
                    hasMoreOrders = false;
                    logger.info(`Không còn orders cần xử lý sau ${stats.batches} batches`);
                    break;
                }

                stats.batches++;
                logger.info(`Batch ${stats.batches}: Xử lý ${orders.length} đơn hàng`);

                for (const order of orders) {
                    stats.processed++;
                    processedOrderIds.add(order.id);

                    try {
                        // Kiểm tra product code có trong carriers config không
                        const isCarrierOrder = this.validProductCodes.includes(order.product_code);
                        
                        if (isCarrierOrder) {
                            // Xử lý orders có product code trong carriers config
                            stats.carrierOrders++;
                            await this.processCarrierOrder(order, stats);
                        } else {
                            // Xử lý orders khác (để trống, bạn sẽ implement sau)
                            stats.otherOrders++;
                            await this.processOtherOrder(order, stats);
                        }

                        // Sleep để tránh rate limit
                        await this.sleep(200);

                    } catch (error) {
                        stats.failed++;
                        logger.error(`Lỗi xử lý order ${order.id}: ${error.message}`);
                        
                        try {
                            await OrderModel.updateLastStatusCheck(order.id);
                        } catch (e) {
                            logger.error(`Failed to update last_status_check_at for order ${order.id}`);
                        }
                    }
                }

                if (orders.length < this.batchSize) {
                    hasMoreOrders = false;
                    logger.info('Đã xử lý hết orders');
                }

                await this.sleep(100);
            }

            // Update cron log thành công
            const executionTime = Date.now() - startTime;
            await CronLogModel.update(cronLogId, {
                status: 'completed',
                ordersProcessed: stats.processed,
                ordersSuccess: stats.success,
                ordersFailed: stats.failed,
                ordersUpdated: stats.updated,
                executionTimeMs: executionTime
            });

            logger.info('Update status job hoàn thành', {
                ...stats,
                executionTime: `${executionTime}ms`,
                averageTimePerOrder: stats.processed > 0 
                    ? `${(executionTime / stats.processed).toFixed(0)}ms` 
                    : 'N/A'
            });

        } catch (error) {
            logger.error('Update status job thất bại: ', error);

            if (cronLogId) {
                const executionTime = Date.now() - startTime;
                await CronLogModel.update(cronLogId, {
                    status: 'failed',
                    ordersProcessed: stats.processed,
                    ordersSuccess: stats.success,
                    ordersFailed: stats.failed,
                    ordersUpdated: stats.updated,
                    errorMessage: error.message,
                    executionTimeMs: executionTime
                });
            }
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Xử lý orders có product code trong carriers config
     */
    async processCarrierOrder(order, stats) {
        const carrier = carrierFactory.getCarrier(order.carrier);
        
        logger.info(`[CARRIER] Tracking status for order ${order.id}`, {
            trackingNumber: order.waybill_number,
            productCode: order.product_code,
            currentStatus: order.status
        });

        const trackingResult = await carrier.trackOrder(order.waybill_number);
        const inquiryResult = await carrier.getOrderInfo(order.waybill_number);

        const hasChangeStatus = inquiryResult.data.status !== order.order_status;
        const hasChangePkgStatus = trackingResult.status !== order.status;

        await OrderModel.updateLastStatusCheck(order.id);

        if (hasChangePkgStatus || hasChangeStatus) {
            logger.info(`Status changed for order ${order.id}: ${order.status} → ${trackingResult.status} + ${order.order_status} → ${inquiryResult.data.status}`);

            const updateData = {
                status: trackingResult.status,
                orderStatus: inquiryResult.data.status,
                trackingInfo: trackingResult.trackingInfo,
                lastTrackedAt: new Date()
            };

            if (trackingResult.status === 'delivered') {
                updateData.deliveredAt = new Date();
            }

            await OrderModel.update(order.id, updateData);

            if (hasChangeStatus) {
                const labelStatus = this.mapToLabelStatus(inquiryResult.data.status);

                if (order.erp_order_code && order.ecount_link && labelStatus) {
                    await jobService.addUpdateStatusJob(
                        order.id,
                        order.erp_order_code,
                        order.tracking_number,
                        labelStatus,
                        order.ecount_link,
                        5
                    );
                    stats.updated++;

                    logger.info(`Added job to update status to ECount for order ${order.id}`);
                } 
                    
                if (labelStatus === 'Returned' || labelStatus === 'Deleted' || labelStatus === 'Abnormal' || labelStatus === 'Warning') {
                    await telegram.notifyError(
                        new Error(`Order status changed to ${labelStatus}`), 
                        {
                            action: 'Track Express Status',
                            jobName: 'Track Express Status',
                            orderId: order.customer_order_number,
                            waybillNumber: order.waybill_number || null,
                            trackingNumber: order.tracking_number || null,
                            erpOrderCode: order.erp_order_code,
                            packageStatus: trackingResult.packageStatus,
                            orderStatus: inquiryResult.data.status,
                            trackingStatus: trackingResult.status,
                            labelStatus: labelStatus
                        }, 
                        {type: 'error'}
                    );
                }
            }

            stats.success++;
        } else {
            logger.info(`Status unchanged for order ${order.id}: ${order.status}`);
            stats.success++;
        }
    }

    /**
     * Xử lý orders khác (không có product code trong carriers config)
     * Check tracking qua API ordertracker.com sử dụng Playwright
     */
    async processOtherOrder(order, stats) {
        let browser = null;
        let apiData = null;

        const userAgents = [
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

        const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

        const playwrightConfigMore = {
            headless: process.env.PLAYWRIGHT_HEADLESS === 'true' ? true : false,
            timeout: 30000,
            concurrentBrowsers: 1,
            
            launchOptions: {
                headless: process.env.PLAYWRIGHT_HEADLESS === 'true' ? true : false,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-blink-features=AutomationControlled'
                ]
            },
            
            contextOptions: {
                viewport: { width: 1366, height: 768 },
                userAgent: randomUserAgent,
                locale: 'vi-VN',
                timezoneId: 'Asia/Ho_Chi_Minh'
            }
        }
        
        try {
            browser = await chromium.launch(playwrightConfigMore.launchOptions);
            const context = await browser.newContext(playwrightConfigMore.contextOptions);
            const page = await context.newPage();
            page.setDefaultTimeout(playwrightConfigMore.timeout);

            // Intercept API response - chấp nhận cả EN và VI
            page.on('response', async (response) => {
                const url = response.url();
                if (url.includes('api.ship24.com/api/parcels')) {
                    try {
                        
                        const contentType = response.headers()['content-type'] || '';
                        if (contentType.includes('application/json')) {
                            apiData = await response.json();
                        }
                    } catch (e) {
                    }
                }
            });

            const trackingUrl = `https://www.ship24.com/tracking?p=${encodeURIComponent(order.tracking_number)}`;
            logger.info(`[OTHER] Navigating to: ${trackingUrl}`);
            
            await page.goto(trackingUrl, {
                waitUntil: 'domcontentloaded', // Chỉ đợi DOM load, không cần networkidle
                timeout: this.playwrightConfigMore.timeout
            });

            // Đợi cho đến khi apiData được set (tối đa 15 giây)
            const maxWaitTime = 15000;
            const startTime = Date.now();
            
            while (!apiData && (Date.now() - startTime < maxWaitTime)) {
                await page.waitForTimeout(500); // Check mỗi 500ms
            }

            await page.waitForTimeout(1000);

            await browser.close();
            browser = null;

            await OrderModel.updateLastStatusCheck(order.id);

            if (!apiData || !apiData?.data?.dispatch_code?.desc) {
                logger.warn(`[OTHER] Không intercept được API response cho order ${order.id}`);
                stats.success++;
                return;
            }

            logger.info(`[OTHER] API Status: ${apiData?.data?.dispatch_code?.desc} for order ${order.id}`);

            let newStatus = null;
            let newOrderStatus = null;
            let labelStatus = null;

            const apiStatus = apiData?.data?.dispatch_code?.desc.toLowerCase();

            if (apiStatus === 'delivered') {
                newStatus = 'delivered';
                newOrderStatus = 'V';
                labelStatus = 'Have been received';
            } else if (apiStatus === 'shipped' || apiStatus === 'in_transit' || apiStatus === 'in transit') {
                newStatus = 'in_transit';
                newOrderStatus = 'D';
                labelStatus = 'Shipped';
            } else if (apiStatus === 'out_for_delivery') {
                newStatus = 'in_transit';
                newOrderStatus = 'D';
                labelStatus = 'Shipped';
            }

            // Nếu không match status nào thì skip
            if (!newStatus || !newOrderStatus) {
                logger.info(`[OTHER] Status "${apiData.status}" không match rule, skip order ${order.id}`);
                stats.success++;
                return;
            }

            // Check xem có thay đổi status không
            const hasChangeStatus = newOrderStatus !== order.order_status;
            const hasChangePkgStatus = newStatus !== order.status;

            if (hasChangePkgStatus || hasChangeStatus) {
                logger.info(`[OTHER] Status changed for order ${order.id}: ${order.status} → ${newStatus} + ${order.order_status} → ${newOrderStatus}`);

                // Update order
                const updateData = {
                    status: newStatus,
                    orderStatus: newOrderStatus,
                    lastTrackedAt: new Date()
                };

                if (newStatus === 'delivered') {
                    updateData.deliveredAt = new Date();
                }

                // Lưu thêm thông tin từ API (optional)
                if (apiData.steps && apiData.steps.length > 0) {
                    updateData.trackingDetails = JSON.stringify({
                        steps: apiData.steps.slice(0, 3),
                        couriers: apiData.couriers,
                        daysInTransit: apiData.daysInTransit,
                        statusLabel: apiData.statusLabel
                    });
                }

                await OrderModel.update(order.id, updateData);

                // Nếu có thay đổi order_status và có đủ thông tin ERP
                if (hasChangeStatus && order.erp_order_code && order.ecount_link && labelStatus) {
                    // await jobService.addUpdateStatusJob(
                    //     order.id,
                    //     order.erp_order_code,
                    //     order.tracking_number,
                    //     labelStatus,
                    //     order.ecount_link,
                    //     5
                    // );
                    stats.updated++;

                    logger.info(`[OTHER] Added job to update status to ECount for order ${order.id}`);
                }

                stats.success++;
            } else {
                logger.info(`[OTHER] Status unchanged for order ${order.id}: ${order.status}`);
                stats.success++;
            }

        } catch (error) {
            logger.error(`[OTHER] Lỗi xử lý order ${order.id}: ${error.message}`);
            logger.error(error.stack); // Log stack trace để debug
            
            // Update last_status_check_at để không bị query lại liên tục
            try {
                await OrderModel.updateLastStatusCheck(order.id);
            } catch (e) {
                logger.error(`[OTHER] Failed to update last_status_check_at for order ${order.id}`);
            }
            
            stats.failed = (stats.failed || 0) + 1; // Đếm số failed
            
        } finally {
            // Đảm bảo browser được đóng
            if (browser) {
                try {
                    await browser.close();
                    logger.info(`[OTHER] Browser closed for order ${order.id}`);
                } catch (e) {
                    logger.error(`[OTHER] Error closing browser: ${e.message}`);
                }
            }
        }
    }

    /**
     * Map order_status sang label status cho ECount
     */
    mapToLabelStatus(orderStatus) {
        const ordStatus = orderStatus?.toUpperCase();
        
        if (!ordStatus) {
            return null;
        }
        
        if (ordStatus === 'V') {
            return 'Have been received';
        }
        
        if (ordStatus === 'F' || ordStatus === 'P') {
            return 'Returned';
        }
        
        if (ordStatus === 'C' || ordStatus === 'Q') {
            return 'Deleted';
        }
        
        if (ordStatus === 'R') {
            return 'Carrier Received';
        }
        
        if (ordStatus === 'D') {
            return 'Shipped';
        }
        
        if (ordStatus === 'S') {
            return 'Scheduled';
        }
        
        if (ordStatus === 'T' || ordStatus === 'DRAFT') {
            return 'New';
        }
        
        return null;
    }

    /**
     * Lấy orders cần check status
     */
    async getOrdersNeedStatusUpdate(limit = 50, excludeIds = []) {
        const db = require('../database/connection');
        const connection = await db.getConnection();
        
        try {
            let query = `
                SELECT o.*
                FROM orders o
                INNER JOIN (
                    SELECT erp_order_code, MAX(created_at) AS latest
                    FROM orders
                    WHERE waybill_number IS NOT NULL
                    AND waybill_number != ''
                    AND status NOT IN ('new', 'deleted', 'delivered', 'received', 'returned', 'deleted', 'cancelled', 'failed', 'pending')
                    AND order_status NOT IN ('V', 'C', 'F')
                    AND erp_order_code IS NOT NULL
                    AND ecount_link IS NOT NULL
                    
                    AND (
                        last_status_check_at IS NULL 
                        OR last_status_check_at < DATE_SUB(NOW(), INTERVAL 6 HOUR)
                    )
                    
                    GROUP BY erp_order_code
                ) latest_orders
                ON o.erp_order_code = latest_orders.erp_order_code
                AND o.created_at = latest_orders.latest
                
                LEFT JOIN jobs j_update_status 
                    ON j_update_status.job_type = 'update_status_ecount'
                    AND JSON_EXTRACT(j_update_status.payload, '$.orderId') = o.id
                    AND j_update_status.status IN ('pending', 'processing')
                
                WHERE j_update_status.id IS NULL
            `;
            
            const params = [];
            
            if (excludeIds.length > 0) {
                query += ` AND o.id NOT IN (${excludeIds.map(() => '?').join(',')})`;
                params.push(...excludeIds);
            }
            
            query += ` 
                ORDER BY 
                    CASE WHEN o.last_status_check_at IS NULL THEN 0 ELSE 1 END,
                    o.last_status_check_at ASC,
                    o.created_at ASC
                LIMIT ?
            `;
            params.push(limit);
            
            const [rows] = await connection.query(query, params);
            return rows;
            
        } finally {
            connection.release();
        }
    }

    /**
     * Sleep helper
     */
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Run manually (for testing)
     */
    async runManually() {
        logger.info('Running update status job manually...');
        await this.run();
    }
}

module.exports = new UpdateStatusCron();