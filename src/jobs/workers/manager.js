// src/jobs/workers/manager.js
const CreateOrderWorker = require('./create-order.worker');
const UpdateTrackingEcountWorker = require('./update-tracking-ecount.worker');
const UpdateStatusEcountWorker = require('./update-status-ecount.worker');
const logger = require('../../utils/logger');

class WorkerManager {
    constructor() {
        this.workers = [];
    }

    start() {
        logger.info('Starting all workers...');

        this.workers = [
            new CreateOrderWorker(),           // 5 concurrent
            new UpdateTrackingEcountWorker(),  // 2 concurrent
            new UpdateStatusEcountWorker()     // 2 concurrent
        ];

        this.workers.forEach(worker => {
            worker.start();
        });

        const totalConcurrency = this.workers.reduce((sum, w) => sum + w.concurrency, 0);
        logger.info(`Started ${this.workers.length} workers with total concurrency=${totalConcurrency}`);
    }

    stop() {
        logger.info('Stopping all workers...');

        this.workers.forEach(worker => {
            worker.stop();
        });

        logger.info('All workers stopped');
    }

    getStats() {
        return this.workers.map(worker => worker.getStats());
    }
}

module.exports = new WorkerManager();
