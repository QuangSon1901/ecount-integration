// src/jobs/base.worker.js
const JobModel = require('../models/job.model');
const logger = require('../utils/logger');

class BaseWorker {
    constructor(jobTypes, config = {}) {
        this.jobTypes = Array.isArray(jobTypes) ? jobTypes : [jobTypes];
        this.isRunning = false;
        this.intervalMs = config.intervalMs || 5000;
        this.intervalId = null;
        this.isProcessing = false;
        this.concurrency = config.concurrency || 1; // Số jobs xử lý đồng thời
        this.name = config.name || this.jobTypes.join(',');
    }

    /**
     * Start worker
     */
    start() {
        if (this.isRunning) {
            logger.warn(`Worker ${this.name} already running`);
            return;
        }

        this.isRunning = true;
        logger.info(`Worker ${this.name} started (concurrency: ${this.concurrency})`);

        // Process jobs ngay lập tức
        this.processJobs();

        // Setup interval
        this.intervalId = setInterval(() => {
            this.processJobs();
        }, this.intervalMs);
    }

    /**
     * Stop worker
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        logger.info(`Worker ${this.name} stopped`);
    }

    /**
     * Process jobs với concurrency
     */
    async processJobs() {
        if (this.isProcessing) {
            return;
        }

        try {
            this.isProcessing = true;
            await JobModel.resetStuckJobs(30);

            // Lấy nhiều jobs cùng lúc theo concurrency
            const jobs = await this.getNextJobs(this.concurrency);
            
            if (jobs.length > 0) {
                // Xử lý song song
                await Promise.all(
                    jobs.map(job => this.handleJob(job).catch(err => {
                        logger.error(`Error handling job ${job.id}:`, err);
                    }))
                );
            }
        } catch (error) {
            logger.error(`Error in processJobs (${this.name}):`, error);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Lấy nhiều jobs tiếp theo
     */
    async getNextJobs(limit) {
        const db = require('../database/connection');
        const connection = await db.getConnection();
        
        try {
            await connection.beginTransaction();
            
            const placeholders = this.jobTypes.map(() => '?').join(',');
            const [rows] = await connection.query(
                `SELECT * FROM jobs 
                WHERE status = 'pending' 
                AND job_type IN (${placeholders})
                AND available_at <= NOW()
                AND attempts < max_attempts
                ORDER BY available_at ASC
                LIMIT ?
                FOR UPDATE SKIP LOCKED`,
                [...this.jobTypes, limit]
            );
            
            if (rows.length === 0) {
                await connection.commit();
                return [];
            }
            
            // Update tất cả jobs sang processing
            const jobIds = rows.map(r => r.id);
            const idPlaceholders = jobIds.map(() => '?').join(',');
            
            await connection.query(
                `UPDATE jobs 
                SET status = 'processing', 
                    started_at = NOW(),
                    attempts = attempts + 1
                WHERE id IN (${idPlaceholders})`,
                jobIds
            );
            
            await connection.commit();
            
            // Parse payload
            return rows.map(job => {
                if (typeof job.payload === 'string') {
                    try {
                        job.payload = JSON.parse(job.payload);
                    } catch (e) {
                        logger.error(`Failed to parse payload for job ${job.id}:`, e);
                    }
                }
                return job;
            });
            
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Handle single job - PHẢI OVERRIDE
     */
    async handleJob(job) {
        throw new Error('handleJob() must be implemented by subclass');
    }
}

module.exports = BaseWorker;