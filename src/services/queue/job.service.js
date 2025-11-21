const JobModel = require('../../models/job.model');
const logger = require('../../utils/logger');

class JobService {
    /**
     * Thêm job tạo order
     */
    async addCreateOrderJob(orderData, delaySeconds = 0) {
        return await JobModel.create(
            'create_order',
            {
                orderData
            },
            delaySeconds,
            3
        );
    }

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
            3
        );
    }

    /**
     * Thêm job update tracking number lên ECount
     */
    async addUpdateTrackingNumberJob(orderId, erpOrderCode, trackingNumber, ecountLink, delaySeconds = 0) {
        return await JobModel.create(
            'update_tracking_ecount',
            {
                orderId,
                erpOrderCode,
                trackingNumber,
                ecountLink
            },
            delaySeconds,
            3
        );
    }

    /**
     * Thêm job update status lên ECount
     */
    async addUpdateStatusJob(orderId, erpOrderCode, trackingNumber, status, ecountLink, delaySeconds = 0) {
        return await JobModel.create(
            'update_status_ecount',
            {
                orderId,
                erpOrderCode,
                trackingNumber,
                status,
                ecountLink
            },
            delaySeconds,
            3
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