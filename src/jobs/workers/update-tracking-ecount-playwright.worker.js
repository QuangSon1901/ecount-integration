const BaseWorker = require('./base.worker');
const OrderModel = require('../../models/order.model');
const ecountService = require('../../services/erp/ecount-playwright.service');
const telegram = require('../../utils/telegram');
const logger = require('../../utils/logger');

class UpdateTrackingEcountPlaywrightWorker extends BaseWorker {
    constructor() {
        super('update_tracking_ecount', {
            intervalMs: 10000,  // Check mỗi 10s
            concurrency: 1,     // 1 batch tại 1 thời điểm
            batchSize: 20       // Xử lý 20 orders/batch
        });
    }

    async processJobs() {
        try {
            // Reset stuck jobs
            await this.resetStuckJobs(30);

            // Lấy batch jobs
            const jobs = await this.getNextJobsBatch(this.batchSize);
            
            if (jobs.length === 0) {
                return;
            }

            logger.info(`🚀 Processing batch of ${jobs.length} jobs with Playwright`);

            // Xử lý batch
            await this.processBatch(jobs);

        } catch (error) {
            logger.error(`Error in Playwright batch worker:`, error);
        }
    }

    async processBatch(jobs) {
        let browser, context, page;
        let successCount = 0;
        let failedCount = 0;
        const startTime = Date.now();
        
        try {
            // Mở browser 1 lần cho cả batch
            logger.info('Opening Playwright browser for batch...');
            
            const result = await ecountService.getBrowserWithSession(
                jobs[0].payload.ecountLink
            );
            browser = result.browser;
            context = result.context;
            page = result.page;

            logger.info('Browser opened successfully, processing jobs...');

            // Xử lý từng job trong batch
            for (let i = 0; i < jobs.length; i++) {
                const job = jobs[i];
                
                try {
                    logger.info(`[${i + 1}/${jobs.length}] Processing job ${job.id} - Order ${job.payload.orderId}`);
                    
                    await this.processJobInBatch(job, page);
                    await this.markCompleted(job.id, { success: true });
                    
                    successCount++;
                    logger.info(`✓ [${i + 1}/${jobs.length}] Job ${job.id} completed successfully`);
                    
                    // Delay nhỏ giữa các orders để tránh overload
                    if (i < jobs.length - 1) {
                        await this.sleep(1000);
                    }
                    
                } catch (error) {
                    failedCount++;
                    logger.error(`✗ [${i + 1}/${jobs.length}] Job ${job.id} failed:`, error.message);
                    await this.markFailed(job.id, error.message, true);

                    // Nếu job đã hết attempts, thông báo
                    if (job.attempts >= job.max_attempts - 1) {
                        await this.onJobMaxAttemptsReached(job, error);
                    }
                }
            }

            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            logger.info(`✅ Batch completed: ${successCount}/${jobs.length} succeeded in ${duration}s`, {
                success: successCount,
                failed: failedCount,
                total: jobs.length,
                duration: `${duration}s`
            });

            // Gửi telegram summary nếu có failed
            if (failedCount > 0) {
                await telegram.notifyWarning('Batch Update Tracking Completed with Errors', {
                    total: jobs.length,
                    success: successCount,
                    failed: failedCount,
                    duration: `${duration}s`
                });
            }

        } catch (error) {
            logger.error('Fatal error in batch processing:', error);
            
            // Mark tất cả jobs chưa xử lý là failed
            for (const job of jobs) {
                try {
                    await this.markFailed(job.id, `Batch failed: ${error.message}`, true);
                } catch (e) {
                    // Ignore
                }
            }

            throw error;
            
        } finally {
            if (browser) {
                await browser.close();
                logger.info('Browser closed');
            }
        }
    }

    async processJobInBatch(job, page) {
        const { orderId, erpOrderCode, trackingNumber, ecountLink } = job.payload;

        // Kiểm tra xem đã update chưa
        const order = await OrderModel.findById(orderId);
        if (!order) {
            throw new Error(`Order ${orderId} not found`);
        }

        if (order.erp_tracking_number_updated) {
            logger.info(`Order ${orderId} already updated, skipping`);
            return { skipped: true };
        }

        // Tìm kiếm order
        await ecountService.searchOrder(page, erpOrderCode);

        // Chuẩn bị data
        const waybillNumber = order?.waybill_number || '';
        let labelUrl = null;
        
        if (order.label_url) {
            if (order.label_access_key && process.env.SHORT_LINK_LABEL === 'true') {
                const baseUrl = process.env.BASE_URL || '';
                labelUrl = `${baseUrl}/api/labels/${order.label_access_key}`;
            } else {
                labelUrl = order.label_url;
            }
        }

        // Update tracking
        await ecountService.updateTrackingNumberInBatch(
            page,
            trackingNumber,
            waybillNumber,
            labelUrl
        );

        // Cập nhật DB
        await OrderModel.update(orderId, {
            erpTrackingNumberUpdated: true,
        });

        logger.info(`Successfully updated tracking for order ${orderId}`);
        
        return { success: true };
    }

    async getNextJobsBatch(limit) {
        const db = require('../../database/connection');
        const connection = await db.getConnection();
        
        try {
            await connection.beginTransaction();
            
            // Lấy nhiều jobs cùng lúc
            const [rows] = await connection.query(
                `SELECT * FROM jobs 
                WHERE status = 'pending' 
                AND job_type = ?
                AND available_at <= NOW()
                AND attempts < max_attempts
                ORDER BY available_at ASC
                LIMIT ?
                FOR UPDATE SKIP LOCKED`,
                [this.jobType, limit]
            );
            
            if (rows.length === 0) {
                await connection.commit();
                return [];
            }
            
            // Update tất cả sang processing
            const jobIds = rows.map(r => r.id);
            await connection.query(
                `UPDATE jobs 
                SET status = 'processing', 
                    started_at = NOW(),
                    attempts = attempts + 1
                WHERE id IN (?)`,
                [jobIds]
            );
            
            await connection.commit();
            
            // Parse JSON
            const jobs = rows.map(job => {
                if (typeof job.payload === 'string') {
                    try {
                        job.payload = JSON.parse(job.payload);
                    } catch (e) {
                        logger.error(`Failed to parse payload for job ${job.id}:`, e);
                    }
                }
                return job;
            });
            
            return jobs;
            
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    async markCompleted(jobId, result = null) {
        const connection = require('../../database/connection').pool;
        await connection.query(
            `UPDATE jobs 
            SET status = 'completed',
                completed_at = NOW(),
                result = ?
            WHERE id = ?`,
            [result ? JSON.stringify(result) : null, jobId]
        );
    }

    async markFailed(jobId, errorMessage, shouldRetry = true) {
        const connection = require('../../database/connection').pool;
        
        const [rows] = await connection.query(
            'SELECT attempts, max_attempts FROM jobs WHERE id = ?',
            [jobId]
        );
        
        if (rows.length === 0) return;
        
        const job = rows[0];
        const canRetry = shouldRetry && job.attempts < job.max_attempts;
        
        if (canRetry) {
            const delaySeconds = Math.pow(2, job.attempts) * 5;
            const availableAt = new Date(Date.now() + (delaySeconds * 1000));
            
            await connection.query(
                `UPDATE jobs 
                SET status = 'pending',
                    started_at = NULL,
                    available_at = ?,
                    error_message = ?
                WHERE id = ?`,
                [availableAt, errorMessage, jobId]
            );
            
            logger.warn(`Job ${jobId} will retry in ${delaySeconds}s`);
        } else {
            await connection.query(
                `UPDATE jobs 
                SET status = 'failed',
                    error_message = ?,
                    completed_at = NOW()
                WHERE id = ?`,
                [errorMessage, jobId]
            );
            
            logger.error(`Job ${jobId} failed permanently`);
        }
    }
    
    async resetStuckJobs(timeoutMinutes = 30) {
        const connection = require('../../database/connection').pool;
        
        const [result] = await connection.query(
            `UPDATE jobs 
            SET status = 'pending',
                started_at = NULL,
                available_at = NOW()
            WHERE status = 'processing'
            AND job_type = ?
            AND started_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
            [this.jobType, timeoutMinutes]
        );
        
        if (result.affectedRows > 0) {
            logger.warn(`Reset ${result.affectedRows} stuck jobs`);
        }
        
        return result.affectedRows;
    }

    async onJobMaxAttemptsReached(job, error) {
        const { orderId, erpOrderCode, trackingNumber } = job.payload;
        
        await telegram.notifyError(error, {
            action: job.job_type,
            jobName: 'Update Tracking ECount (Playwright)',
            orderId: orderId,
            erpOrderCode: erpOrderCode,
            trackingNumber: trackingNumber,
            attempts: job.attempts,
            maxAttempts: job.max_attempts,
            message: '⚠️ Job đã thất bại sau tất cả các lần retry'
        }, {
            type: 'error'
        });
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getStats() {
        return {
            jobType: this.jobType,
            concurrency: this.concurrency,
            batchSize: this.batchSize,
            activeJobs: this.activeJobs ? this.activeJobs.size : 0
        };
    }
}

module.exports = UpdateTrackingEcountPlaywrightWorker;