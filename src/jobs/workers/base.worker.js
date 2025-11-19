// src/jobs/workers/base.worker.js
const JobModel = require('../../models/job.model');
const logger = require('../../utils/logger');

class BaseWorker {
    constructor(jobType, options = {}) {
        this.jobType = jobType;
        this.intervalMs = options.intervalMs || 5000;
        this.concurrency = options.concurrency || 1; // Số jobs chạy đồng thời
        this.isRunning = false;
        this.intervalId = null;
        this.activeJobs = new Set(); // Track jobs đang xử lý
    }

    start() {
        if (this.isRunning) {
            logger.warn(`${this.jobType} worker already running`);
            return;
        }

        this.isRunning = true;
        logger.info(`${this.jobType} worker started with concurrency=${this.concurrency}`);

        this.processJobs();
        this.intervalId = setInterval(() => {
            this.processJobs();
        }, this.intervalMs);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        logger.info(`${this.jobType} worker stopped`);
    }

    async processJobs() {
        try {
            // Reset stuck jobs
            await JobModel.resetStuckJobs(30);

            // Lấy số slots còn trống
            const availableSlots = this.concurrency - this.activeJobs.size;
            
            if (availableSlots <= 0) {
                // Đã full concurrency, bỏ qua
                return;
            }

            // Lấy nhiều jobs cùng lúc
            const jobs = await this.getNextJobs(availableSlots);
            
            if (jobs.length === 0) {
                return;
            }

            logger.debug(`${this.jobType} worker: processing ${jobs.length} jobs (${this.activeJobs.size}/${this.concurrency} slots used)`);

            // Xử lý song song
            jobs.forEach(job => {
                this.handleJobAsync(job);
            });

        } catch (error) {
            logger.error(`Error in ${this.jobType} worker:`, error);
        }
    }

    async getNextJobs(limit) {
        const db = require('../../database/connection');
        const connection = await db.getConnection();
        
        try {
            await connection.beginTransaction();
            
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
            
            // Update tất cả jobs sang processing
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

    async handleJobAsync(job) {
        // Track job đang xử lý
        this.activeJobs.add(job.id);

        try {
            await this.handleJob(job);
        } catch (error) {
            logger.error(`Unexpected error handling job ${job.id}:`, error);
        } finally {
            // Remove khỏi active jobs
            this.activeJobs.delete(job.id);
        }
    }

    async handleJob(job) {
        logger.info(`Processing ${this.jobType} job ${job.id}`, {
            attempt: job.attempts,
            maxAttempts: job.max_attempts,
            activeJobs: this.activeJobs.size
        });

        try {
            const result = await this.processJob(job);
            await JobModel.markCompleted(job.id, result);
        } catch (error) {
            logger.error(`${this.jobType} job ${job.id} failed:`, error.message);
            await JobModel.markFailed(job.id, error.message, true);

            if (job.attempts == job.max_attempts - 1) {
                await this.onJobMaxAttemptsReached(job, error);
            }
        }
    }

    async processJob(job) {
        throw new Error('processJob must be implemented by subclass');
    }

    async onJobMaxAttemptsReached(job, error) {
        // Override in subclass if needed
    }

    getStats() {
        return {
            jobType: this.jobType,
            concurrency: this.concurrency,
            activeJobs: this.activeJobs.size,
            availableSlots: this.concurrency - this.activeJobs.size
        };
    }
}

module.exports = BaseWorker;