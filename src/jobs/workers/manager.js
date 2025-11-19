// src/jobs/workers/manager.js
const CreateOrderWorker = require('./create-order.worker');
const TrackingNumberWorker = require('./tracking-number.worker');
const UpdateTrackingEcountWorker = require('./update-tracking-ecount.worker');
const UpdateStatusEcountWorker = require('./update-status-ecount.worker');
const logger = require('../../utils/logger');

class WorkerManager {
    constructor() {
        this.workers = [];
    }

    start() {
        logger.info('Starting all workers...');

        // Khởi tạo các workers
        this.workers = [
            new CreateOrderWorker(),
            new TrackingNumberWorker(),
            new UpdateTrackingEcountWorker(),
            new UpdateStatusEcountWorker()
        ];

        // Start tất cả workers
        this.workers.forEach(worker => {
            worker.start();
        });

        logger.info(`Started ${this.workers.length} workers`);
    }

    stop() {
        logger.info('Stopping all workers...');

        this.workers.forEach(worker => {
            worker.stop();
        });

        logger.info('All workers stopped');
    }
}

module.exports = new WorkerManager();