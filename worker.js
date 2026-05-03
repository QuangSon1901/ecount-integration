// worker.js
require('dotenv').config();
const db = require('./src/database/connection');
const logger = require('./src/utils/logger');

const workerManager = require('./src/jobs/workers/manager');
const fetchTrackingCron = require('./src/jobs/fetch-tracking.cron');
const updateStatusCron = require('./src/jobs/update-status.cron');
const cleanupSessionsCron = require('./src/jobs/cleanup-sessions.cron');
const syncOrdersCron = require('./src/jobs/sync-orders-ecount.cron');
const podFetchTrackingCron = require('./src/jobs/pod-fetch-tracking.cron');
const syncOmsOrdersCron = require('./src/jobs/sync-oms-orders.cron');
const omsFetchTrackingCron = require('./src/jobs/oms-fetch-tracking.cron');
const omsRecoveryCron = require('./src/jobs/oms-recovery.cron');

db.testConnection()
    .then(() => {
        workerManager.start();
        // fetchTrackingCron.start();
        // updateStatusCron.start();
        // cleanupSessionsCron.start();
        // syncOrdersCron.start();
        // podFetchTrackingCron.start();
        syncOmsOrdersCron.start();
        // omsFetchTrackingCron.start();
        // omsRecoveryCron.start();
        logger.info('Worker started successfully');
    })
    .catch(err => {
        logger.error('Worker failed:', err);
        process.exit(1);
    });

process.on('SIGTERM', () => {
    workerManager.stop();
    process.exit(0);
});