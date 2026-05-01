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
    async addUpdateWarningJob(orderId, erpOrderCode, warningMessage, ecountLink, warningData, delaySeconds = 0) {
        return await JobModel.create(
            'update_warning_ecount',
            {
                orderId,
                erpOrderCode,
                warningMessage,
                warningData,
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
    /**
     * @param {string[]} slipNos
     * @param {number[]} orderIds
     * @param {number} delaySeconds
     * @param {'express'|'pod'} accountType - Ecount account to use
     */
    async addLookupDocNoJob(slipNos, orderIds, delaySeconds = 30, accountType = 'express') {
        return await JobModel.create(
            'lookup_docno',
            {
                slipNos,
                orderIds,
                accountType
            },
            delaySeconds,
            3 // max 3 attempts
        );
    }

    /**
     * Thêm job gửi webhook delivery
     * @param {number} webhookId   - webhook_registrations.id
     * @param {string} event       - 'tracking.updated' | 'order.status' | 'order.exception'
     * @param {number} orderId     - orders.id
     * @param {object} payload     - data payload gửi kèm
     */
    async addWebhookDeliveryJob(webhookId, event, orderId, payload) {
        return await JobModel.create(
            'webhook_delivery',
            {
                webhookId,
                event,
                orderId,
                payload
            },
            0,  // no delay — gửi ngay
            3   // max 3 attempts (retry via base.worker backoff)
        );
    }

    // ========== POD Jobs ==========

    /**
     * Thêm job tạo POD order
     */
    async addPodCreateOrderJob(orderData, delaySeconds = 0) {
        return await JobModel.create(
            'pod_create_order',
            { orderData },
            delaySeconds,
            3
        );
    }

    /**
     * Thêm job update tracking number lên ECount POD
     */
    async addPodUpdateTrackingEcountJob(orderId, erpOrderCode, trackingNumber, ecountLink, delaySeconds = 0) {
        return await JobModel.create(
            'pod_update_tracking_ecount',
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
     * Thêm job upload tracking label lên S2BDIY cho SBTT order
     */
    async addSbttLabelUploadJob(orderId, podWarehouseOrderId, erpOrderCode, trackingNumber, labelUrl, delaySeconds = 0) {
        return await JobModel.create(
            'sbtt_label_upload',
            {
                orderId,
                erpOrderCode,
                podWarehouseOrderId,
                trackingNumber,
                labelUrl
            },
            delaySeconds,
            3
        );
    }

    /**
     * Thêm job update status lên ECount POD
     */
    async addPodUpdateStatusEcountJob(orderId, erpOrderCode, trackingNumber, status, ecountLink, delaySeconds = 0) {
        return await JobModel.create(
            'pod_update_status_ecount',
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

    // ========== OMS Jobs (Phase 6) ==========

    /**
     * Push tracking + label back to a customer's OMS.
     * Worker: src/jobs/workers/oms-update-logistic.worker.js
     *
     * @param {number} omsOrderId — oms_orders.id
     * @param {object} [options]
     * @param {string} [options.tplCode] — override; defaults to row.product_code at run time
     * @param {number} [delaySeconds=0]
     */
    async addOmsUpdateLogisticJob(omsOrderId, options = {}, delaySeconds = 0) {
        return await JobModel.create(
            'oms_update_logistic',
            {
                omsOrderId,
                tplCode: options.tplCode || null,
            },
            delaySeconds,
            5 // max attempts — backoff: 5s, 10s, 20s, 40s, 80s
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