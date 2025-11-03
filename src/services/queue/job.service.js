const JobModel = require('../../models/job.model');
const logger = require('../../utils/logger');

class JobService {
    /**
     * Thêm job tracking number
     */
    async addTrackingNumberJob(orderId, orderCode, carrierCode, delaySeconds = 5) {
        return await JobModel.create(
            'tracking_number',
            {
                orderId,
                orderCode,
                carrierCode
            },
            delaySeconds,
            6 // max 6 attempts
        );
    }

    /**
     * Thêm job update ERP
     */
    async addUpdateErpJob(orderId, erpOrderCode, trackingNumber, status, ecountLink, delaySeconds = 0) {
        return await JobModel.create(
            'update_erp',
            {
                orderId,
                erpOrderCode,
                trackingNumber,
                status,
                ecountLink
            },
            delaySeconds,
            3 // max 3 attempts
        );
    }

    /**
     * Lấy stats
     */
    async getStats() {
        return await JobModel.getStats();
    }

    /**
     * Lấy danh sách jobs
     */
    async listJobs(filters = {}) {
        return await JobModel.list(filters);
    }

    /**
     * Cleanup jobs cũ
     */
    async cleanup(daysOld = 7) {
        return await JobModel.cleanupOldJobs(daysOld);
    }

    /**
     * Reset stuck jobs
     */
    async resetStuckJobs(timeoutMinutes = 30) {
        return await JobModel.resetStuckJobs(timeoutMinutes);
    }
}

module.exports = new JobService();