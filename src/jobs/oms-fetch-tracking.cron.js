// src/jobs/oms-fetch-tracking.cron.js
//
// Phase 9 (revised): poll ITC order detail for OMS orders every 5 minutes
// and advance internal_status from the returned status_text field.
//
// Lives entirely in the OMS namespace — does not touch the existing
// fetch-tracking / update-status crons or the orders table.

const cron = require('node-cron');
const OmsOrderModel = require('../models/oms-order.model');
const CronLogModel = require('../models/cron-log.model');
const omsTracking = require('../services/oms/tracking.service');
const itcClient = require('../services/itc/itc.client');
const logger = require('../utils/logger');

class OmsFetchTrackingCron {
    constructor() {
        this.isRunning = false;
        this.schedule = '*/5 * * * *'; // every 5 minutes
        this.batchSize = 50;
        this.minMinutesSinceCheck = 30;
    }

    start() {
        this.run();
        cron.schedule(this.schedule, async () => {
            if (this.isRunning) {
                logger.warn('[OMS-TRACKING] previous run still in progress, skipping');
                return;
            }
            await this.run();
        });
        logger.info(`[OMS-TRACKING] cron started — schedule: ${this.schedule}`);
    }

    async run() {
        const startTime = Date.now();
        let cronLogId = null;
        const stats = {
            ordersChecked: 0,
            ordersErrored: 0,
            ordersSkipped: 0,
            transitions: 0,
        };

        try {
            this.isRunning = true;
            cronLogId = await CronLogModel.start('oms_fetch_tracking');

            if (!itcClient.isConfigured()) {
                logger.warn('[OMS-TRACKING] ITC not configured — skipping run');
                await CronLogModel.update(cronLogId, {
                    status: 'completed',
                    errorMessage: 'ITC not configured',
                    executionTimeMs: Date.now() - startTime,
                });
                return;
            }

            const orders = await OmsOrderModel.findForTrackingPoll({
                minMinutesSinceCheck: this.minMinutesSinceCheck,
                limit: this.batchSize,
            });

            if (orders.length === 0) {
                logger.info('[OMS-TRACKING] no orders due for polling');
            }

            for (const order of orders) {
                try {
                    const result = await omsTracking.checkAndUpdate(order);
                    if (result.skipped) {
                        stats.ordersSkipped++;
                        logger.debug('[OMS-TRACKING] skipped', {
                            omsOrderId: order.id,
                            reason: result.skipped,
                        });
                    } else {
                        stats.ordersChecked++;
                        if (result.transitionedTo) stats.transitions++;
                        logger.info('[OMS-TRACKING] polled', {
                            omsOrderId:    order.id,
                            itcSid:        result.itcSid,
                            itcStatusText: result.itcStatusText,
                            targetStatus:  result.targetStatus,
                            transitionedTo: result.transitionedTo,
                        });
                    }
                } catch (err) {
                    stats.ordersErrored++;
                    logger.error('[OMS-TRACKING] order poll failed', {
                        omsOrderId: order.id,
                        itcSid:     order.itc_sid,
                        error:      err.message,
                        code:       err.code,
                    });
                }
            }

            const executionTime = Date.now() - startTime;
            await CronLogModel.update(cronLogId, {
                status: 'completed',
                ordersProcessed: orders.length,
                ordersSuccess:   stats.ordersChecked,
                ordersFailed:    stats.ordersErrored,
                executionTimeMs: executionTime,
            });

            logger.info('[OMS-TRACKING] run complete', {
                executionTime: `${executionTime}ms`,
                ...stats,
            });
        } catch (err) {
            const executionTime = Date.now() - startTime;
            logger.error('[OMS-TRACKING] run failed', { error: err.message });
            if (cronLogId) {
                await CronLogModel.update(cronLogId, {
                    status: 'failed',
                    errorMessage: err.message,
                    executionTimeMs: executionTime,
                });
            }
        } finally {
            this.isRunning = false;
        }
    }
}

module.exports = new OmsFetchTrackingCron();