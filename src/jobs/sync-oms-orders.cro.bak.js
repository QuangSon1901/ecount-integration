// src/jobs/sync-oms-orders.cron.old.js (old)
//
// Pulls "New" OMS orders for every active OMS-configured customer.
// Runs every 10 minutes. Per Phase 3 constraints: fetch + transform ONLY,
// no DB writes for the orders themselves. Phase 4 will wire persistence
// at the marked seam below.

const cron = require('node-cron');
const ApiCustomerModel = require('../models/api-customer.model');
const CronLogModel = require('../models/cron-log.model');
const omsOrderFetcher = require('../services/oms/order-fetcher.service');
const omsOrderStorage = require('../services/oms/order-storage.service');
const omsAuth = require('../services/oms/auth.service');
const logger = require('../utils/logger');

class SyncOmsOrdersCron {
    constructor() {
        this.isRunning = false;
        this.schedule = '*/1 * * * *'; // every 10 minutes
        this.lookbackDays = 7;
    }

    start() {
        cron.schedule(this.schedule, async () => {
            if (this.isRunning) {
                logger.warn('[OMS-SYNC] previous run still in progress, skipping');
                return;
            }
            await this.run();
        });
        logger.info(`[OMS-SYNC] cron started — schedule: ${this.schedule}`);
    }

    async run() {
        const startTime = Date.now();
        let cronLogId = null;
        const stats = {
            customersTotal: 0,
            customersProcessed: 0,
            customersSkipped: 0,
            customersFailed: 0,
            ordersFetched: 0,
            pagesFetched: 0,
            ordersInserted: 0,
            ordersUpdated: 0,
            ordersPreserved: 0,
            ordersErrored: 0,
        };

        try {
            this.isRunning = true;
            cronLogId = await CronLogModel.start('sync_oms_orders');

            // Iterate active customers; skip those without OMS config.
            // ApiCustomerModel.list does not accept a high limit by default — pull
            // a generous slice. If we ever exceed this, we'll paginate here too.
            const customers = await ApiCustomerModel.list({
                status: 'active',
                limit: 1000,
            });
            stats.customersTotal = customers.length;

            for (const customer of customers) {
                if (!omsAuth.isConfigured(customer)) {
                    stats.customersSkipped++;
                    continue;
                }

                try {
                    const result = await omsOrderFetcher.fetchNewOrders(customer, {
                        lookbackDays: this.lookbackDays,
                    });

                    if (result.skipped) {
                        stats.customersSkipped++;
                        continue;
                    }

                    stats.customersProcessed++;
                    stats.ordersFetched += result.orders.length;
                    stats.pagesFetched += result.pagesFetched;

                    // Phase 4: persist into oms_orders (isolated table — no impact on `orders` crons)
                    const persistStats = await omsOrderStorage.persistBatch(customer, result.orders);
                    stats.ordersInserted += persistStats.inserted;
                    stats.ordersUpdated += persistStats.updated;
                    stats.ordersPreserved += persistStats.preserved;
                    stats.ordersErrored += persistStats.errors;

                    logger.info('[OMS-SYNC] customer synced', {
                        customerCode: customer.customer_code,
                        fetched: result.orders.length,
                        pages: result.pagesFetched,
                        inserted: persistStats.inserted,
                        updated: persistStats.updated,
                        preserved: persistStats.preserved,
                        errors: persistStats.errors,
                    });

                } catch (err) {
                    stats.customersFailed++;
                    logger.error('[OMS-SYNC] customer fetch failed', {
                        customerCode: customer.customer_code,
                        error: err.message,
                        code: err.code,
                        status: err.response?.status,
                    });
                }
            }

            const executionTime = Date.now() - startTime;
            await CronLogModel.update(cronLogId, {
                status: 'completed',
                ordersProcessed: stats.ordersFetched,
                ordersSuccess: stats.ordersInserted + stats.ordersUpdated + stats.ordersPreserved,
                ordersFailed: stats.ordersErrored + stats.customersFailed,
                executionTimeMs: executionTime,
            });

            logger.info('[OMS-SYNC] run complete', { executionTime: `${executionTime}ms`, ...stats });
        } catch (err) {
            const executionTime = Date.now() - startTime;
            logger.error('[OMS-SYNC] run failed', { error: err.message });
            if (cronLogId) {
                await CronLogModel.update(cronLogId, {
                    status: 'failed',
                    ordersProcessed: stats.ordersFetched,
                    ordersSuccess: stats.customersProcessed,
                    ordersFailed: stats.customersFailed,
                    errorMessage: err.message,
                    executionTimeMs: executionTime,
                });
            }
        } finally {
            this.isRunning = false;
        }
    }
}

module.exports = new SyncOmsOrdersCron();
