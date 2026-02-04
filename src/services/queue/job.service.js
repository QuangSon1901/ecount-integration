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
     * Thêm job update warning lên ECount
     */
    async addUpdateWarningJob(orderId, erpOrderCode, warningMessage, ecountLink, delaySeconds = 0) {
        return await JobModel.create(
            'update_warning_ecount',
            {
                orderId,
                erpOrderCode,
                warningMessage,
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
     * Thêm job track other order (non-carrier orders)
     */
    async addTrackOtherOrderJob(orderId, trackingNumber, delaySeconds = 0) {
        return await JobModel.create(
            'track_other_order',
            {
                orderId,
                trackingNumber
            },
            delaySeconds,
            2 // max attempts
        );
    }

    /**
     * Thêm job lookup DOC_NO
     * @param {string[]} slipNos - Array of SlipNos
     * @param {number[]} orderIds - Array of Order IDs tương ứng
     * @param {number} delaySeconds - Delay trước khi xử lý
     */
    async addLookupDocNoJob(slipNos, orderIds, delaySeconds = 30) {
        return await JobModel.create(
            'lookup_docno',
            {
                slipNos,
                orderIds
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