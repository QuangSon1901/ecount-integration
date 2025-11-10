require('dotenv').config();
const db = require('./src/database/connection');
const logger = require('./src/utils/logger');

const jobWorker = require('./src/jobs/worker');
const fetchTrackingCron = require('./src/jobs/fetch-tracking.cron');
const updateStatusCron = require('./src/jobs/update-status.cron');
const cleanupSessionsCron = require('./src/jobs/cleanup-sessions.cron');

db.testConnection()
    .then(() => {
        jobWorker.start();
        fetchTrackingCron.start();
        updateStatusCron.start();
        cleanupSessionsCron.start();
        logger.info('Worker started successfully');
    })
    .catch(err => {
        logger.error('Worker failed:', err);
        process.exit(1);
    });

process.on('SIGTERM', () => {
    jobWorker.stop();
    process.exit(0);
});