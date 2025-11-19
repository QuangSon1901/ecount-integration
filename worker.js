// worker.js
require('dotenv').config();
const db = require('./src/database/connection');
const logger = require('./src/utils/logger');

// Import các workers
const CreateOrderWorker = require('./src/jobs/workers/create-order.worker');
const TrackingNumberWorker = require('./src/jobs/workers/tracking-number.worker');
const UpdateTrackingEcountWorker = require('./src/jobs/workers/update-tracking-ecount.worker');
const UpdateStatusEcountWorker = require('./src/jobs/workers/update-status-ecount.worker');

// Import cron jobs
const fetchTrackingCron = require('./src/jobs/fetch-tracking.cron');
const updateStatusCron = require('./src/jobs/update-status.cron');
const cleanupSessionsCron = require('./src/jobs/cleanup-sessions.cron');

// Khởi tạo workers
const workers = {
    createOrder: new CreateOrderWorker(),
    trackingNumber: new TrackingNumberWorker(),
    updateTrackingEcount: new UpdateTrackingEcountWorker(),
    updateStatusEcount: new UpdateStatusEcountWorker()
};

db.testConnection()
    .then(() => {
        // Start tất cả workers
        logger.info('Starting all workers...');
        
        Object.entries(workers).forEach(([name, worker]) => {
            worker.start();
            logger.info(`✓ ${name} worker started`);
        });
        
        // Start cron jobs
        fetchTrackingCron.start();
        updateStatusCron.start();
        cleanupSessionsCron.start();
        
        logger.info('All workers and cron jobs started successfully');
        logger.info('Workers running:', {
            createOrder: '3s interval',
            trackingNumber: '5s interval',
            updateTrackingEcount: '4s interval',
            updateStatusEcount: '4s interval'
        });
    })
    .catch(err => {
        logger.error('Worker startup failed:', err);
        process.exit(1);
    });

process.on('SIGTERM', () => {
    logger.info('SIGTERM received, stopping all workers...');
    
    Object.values(workers).forEach(worker => {
        worker.stop();
    });
    
    process.exit(0);
});