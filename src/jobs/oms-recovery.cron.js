// src/jobs/oms-recovery.cron.js
//
// Phase 10: hourly safety sweep for the OMS subsystem.
//
//   1. Reset `label_purchasing` rows older than 5 min → 'error'.
//      A row stuck in this intermediate state means the API process crashed
//      between a successful ITC purchase and the local DB write. The full
//      ITC details (sid, barcode, usd) were logged at critical level by
//      LabelPurchaseService so admin can recover manually.
//
//   2. Cleanup expired oms_access_tokens (>1h past expiry).
//      Tokens get overwritten naturally on refresh — this is purely tidying
//      so the table doesn't grow unbounded for churned customers.
//
// Cron logs everything via cron_logs so admin can monitor in dashboard.

const cron = require('node-cron');
const OmsOrderModel = require('../models/oms-order.model');
const OmsAccessTokenModel = require('../models/oms-access-token.model');
const CronLogModel = require('../models/cron-log.model');
const logger = require('../utils/logger');

const STUCK_THRESHOLD_MIN = 5;
const TOKEN_GRACE_MIN = 60;

class OmsRecoveryCron {
    constructor() {
        this.isRunning = false;
        this.schedule = '0 * * * *'; // hourly on the hour
    }

    start() {
        cron.schedule(this.schedule, async () => {
            if (this.isRunning) {
                logger.warn('[OMS-RECOVERY] previous run still in progress, skipping');
                return;
            }
            await this.run();
        });
        logger.info(`[OMS-RECOVERY] cron started — schedule: ${this.schedule}`);
    }

    async run() {
        const startTime = Date.now();
        let cronLogId = null;
        const stats = {
            stuckLabelPurchasing: 0,
            stuckResetToError: 0,
            stuckResetFailed: 0,
            expiredTokensDeleted: 0,
        };

        try {
            this.isRunning = true;
            cronLogId = await CronLogModel.start('oms_recovery');

            // (1) Stuck label_purchasing rows
            const stuck = await OmsOrderModel.findStuckLabelPurchasing(STUCK_THRESHOLD_MIN, 100);
            stats.stuckLabelPurchasing = stuck.length;

            for (const row of stuck) {
                try {
                    const note = `Stuck in label_purchasing > ${STUCK_THRESHOLD_MIN}min — auto-reset by recovery cron. ` +
                                 `Search logs for omsOrderId=${row.id} 'PERSIST_FAILED' to find ITC details (sid/barcode/usd).`;
                    await OmsOrderModel.setInternalStatus(row.id, 'error', note);
                    stats.stuckResetToError++;
                    logger.warn('[OMS-RECOVERY] reset stuck label_purchasing → error', {
                        omsOrderId: row.id,
                        orderNumber: row.order_number,
                        customerId: row.customer_id,
                        stuckSinceMin: Math.round((Date.now() - new Date(row.updated_at).getTime()) / 60000),
                        critical: true,
                    });
                } catch (err) {
                    stats.stuckResetFailed++;
                    logger.error('[OMS-RECOVERY] failed to reset stuck row', {
                        omsOrderId: row.id, error: err.message,
                    });
                }
            }

            // (2) Cleanup expired tokens
            try {
                stats.expiredTokensDeleted = await OmsAccessTokenModel.cleanupExpired(TOKEN_GRACE_MIN);
            } catch (err) {
                logger.error('[OMS-RECOVERY] token cleanup failed', { error: err.message });
            }

            const executionTime = Date.now() - startTime;
            await CronLogModel.update(cronLogId, {
                status: 'completed',
                ordersProcessed: stats.stuckLabelPurchasing,
                ordersSuccess: stats.stuckResetToError,
                ordersFailed: stats.stuckResetFailed,
                executionTimeMs: executionTime,
            });

            logger.info('[OMS-RECOVERY] run complete', {
                executionTime: `${executionTime}ms`,
                ...stats,
            });
        } catch (err) {
            logger.error('[OMS-RECOVERY] run failed', { error: err.message });
            if (cronLogId) {
                await CronLogModel.update(cronLogId, {
                    status: 'failed',
                    errorMessage: err.message,
                    executionTimeMs: Date.now() - startTime,
                });
            }
        } finally {
            this.isRunning = false;
        }
    }
}

module.exports = new OmsRecoveryCron();
