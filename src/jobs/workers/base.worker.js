// src/jobs/workers/base.worker.js
const JobModel = require('../../models/job.model');
const logger = require('../../utils/logger');

class BaseWorker {
    constructor(jobType, intervalMs = 5000) {
        this.jobType = jobType;
        this.intervalMs = intervalMs;
        this.isRunning = false;
        this.intervalId = null;
        this.isProcessing = false;
    }

    start() {
        if (this.isRunning) {
            logger.warn(`${this.jobType} worker already running`);
            return;
        }

        this.isRunning = true;
        logger.info(`${this.jobType} worker started`);

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
        if (this.isProcessing) {
            return;
        }

        try {
            this.isProcessing = true;
            await JobModel.resetStuckJobs(30);

            const job = await this.getNextJob();
            
            if (job) {
                await this.handleJob(job);
            }
        } catch (error) {
            logger.error(`Error in ${this.jobType} worker:`, error);
        } finally {
            this.isProcessing = false;
        }
    }

    async getNextJob() {
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
                LIMIT 1
                FOR UPDATE SKIP LOCKED`,
                [this.jobType]
            );
            
            if (rows.length === 0) {
                await connection.commit();
                return null;
            }
            
            const job = rows[0];
            
            await connection.query(
                `UPDATE jobs 
                SET status = 'processing', 
                    started_at = NOW(),
                    attempts = attempts + 1
                WHERE id = ?`,
                [job.id]
            );
            
            await connection.commit();
            
            if (typeof job.payload === 'string') {
                try {
                    job.payload = JSON.parse(job.payload);
                } catch (e) {
                    logger.error(`Failed to parse payload for job ${job.id}:`, e);
                }
            }
            
            return job;
            
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    async handleJob(job) {
        logger.info(`Processing ${this.jobType} job ${job.id}`, {
            attempt: job.attempts,
            maxAttempts: job.max_attempts
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
}

module.exports = BaseWorker;