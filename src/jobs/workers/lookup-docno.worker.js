// src/jobs/workers/lookup-docno.worker.js
const BaseWorker = require('./base.worker');
const OrderModel = require('../../models/order.model');
const docNoLookupService = require('../../services/erp/ecount-docno-lookup.service');
const logger = require('../../utils/logger');

class LookupDocNoWorker extends BaseWorker {
    constructor() {
        super('lookup_docno', {
            intervalMs: 10000,    // Check mỗi 10s (không cần nhanh)
            concurrency: 1        // Chỉ 1 browser tại 1 thời điểm
        });
    }

    async processJob(job) {
        const { slipNos, orderIds } = job.payload;

        logger.info(`Looking up DOC_NO for ${slipNos.length} orders`, {
            slipNos,
            orderIds
        });

        try {
            // Lookup DOC_NO từ SlipNos
            const mapping = await docNoLookupService.lookupDocNos(slipNos);

            logger.info('DOC_NO lookup completed', { 
                found: Object.keys(mapping).length,
                total: slipNos.length,
                mapping 
            });

            // Update từng order với DOC_NO tương ứng
            const updatePromises = slipNos.map(async (slipNo, index) => {
                const orderId = orderIds[index];
                const docNo = mapping[slipNo];

                if (docNo) {
                    await OrderModel.update(orderId, {
                        erpOrderCode: docNo
                    });
                    
                    logger.info(`Updated order ${orderId} with DOC_NO: ${docNo}`, {
                        orderId,
                        slipNo,
                        docNo
                    });
                } else {
                    logger.warn(`No DOC_NO found for order ${orderId}`, {
                        orderId,
                        slipNo
                    });
                }
            });

            await Promise.all(updatePromises);

            return {
                success: true,
                total: slipNos.length,
                found: Object.keys(mapping).length,
                mapping
            };

        } catch (error) {
            logger.error('Failed to lookup DOC_NO:', error);
            throw error;
        }
    }

    async onJobMaxAttemptsReached(job, error) {
        logger.error('DOC_NO lookup failed permanently', {
            slipNos: job.payload.slipNos,
            orderIds: job.payload.orderIds,
            error: error.message
        });
    }
}

module.exports = LookupDocNoWorker;