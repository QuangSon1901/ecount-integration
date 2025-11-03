const db = require('../database/connection');
const logger = require('../utils/logger');

class JobModel {
    /**
     * Tạo job mới
     */
    static async create(jobType, payload, delaySeconds = 0, maxAttempts = 6) {
        const connection = await db.getConnection();
        
        try {
            const availableAt = new Date(Date.now() + (delaySeconds * 1000));
            
            const [result] = await connection.query(
                `INSERT INTO jobs (
                    job_type, status, payload, max_attempts, available_at
                ) VALUES (?, 'pending', ?, ?, ?)`,
                [jobType, JSON.stringify(payload), maxAttempts, availableAt]
            );
            
            logger.info(`✅ Created job ${result.insertId}`, {
                jobType,
                jobId: result.insertId,
                delaySeconds
            });
            
            return result.insertId;
        } finally {
            connection.release();
        }
    }

    /**
     * Lấy job tiếp theo để xử lý
     * Sử dụng SELECT ... FOR UPDATE để tránh race condition
     */
    static async getNextJob() {
        const connection = await db.getConnection();
        
        try {
            await connection.beginTransaction();
            
            // Lấy job đầu tiên có thể xử lý
            const [rows] = await connection.query(
                `SELECT * FROM jobs 
                WHERE status = 'pending' 
                AND available_at <= NOW()
                AND attempts < max_attempts
                ORDER BY available_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED`
            );
            
            if (rows.length === 0) {
                await connection.commit();
                return null;
            }
            
            const job = rows[0];
            
            // Cập nhật status sang processing
            await connection.query(
                `UPDATE jobs 
                SET status = 'processing', 
                    started_at = NOW(),
                    attempts = attempts + 1
                WHERE id = ?`,
                [job.id]
            );
            
            await connection.commit();
            
            // KHÔNG CẦN PARSE - MySQL driver đã parse JSON tự động
            // Chỉ cần kiểm tra nếu là string mới parse
            if (typeof job.payload === 'string') {
                try {
                    job.payload = JSON.parse(job.payload);
                } catch (e) {
                    logger.error(`Failed to parse payload for job ${job.id}:`, e);
                }
            }
            
            if (job.result && typeof job.result === 'string') {
                try {
                    job.result = JSON.parse(job.result);
                } catch (e) {
                    logger.error(`Failed to parse result for job ${job.id}:`, e);
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

    /**
     * Đánh dấu job hoàn thành
     */
    static async markCompleted(jobId, result = null) {
        const connection = await db.getConnection();
        
        try {
            await connection.query(
                `UPDATE jobs 
                SET status = 'completed',
                    completed_at = NOW(),
                    result = ?
                WHERE id = ?`,
                [result ? JSON.stringify(result) : null, jobId]
            );
            
            logger.info(`✅ Job ${jobId} completed`);
        } finally {
            connection.release();
        }
    }

    /**
     * Đánh dấu job thất bại
     */
    static async markFailed(jobId, errorMessage, shouldRetry = true) {
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query(
                'SELECT attempts, max_attempts FROM jobs WHERE id = ?',
                [jobId]
            );
            
            if (rows.length === 0) return;
            
            const job = rows[0];
            const canRetry = shouldRetry && job.attempts < job.max_attempts;
            
            if (canRetry) {
                // Tính delay cho lần retry tiếp theo (exponential backoff)
                const delaySeconds = Math.pow(2, job.attempts) * 5; // 5s, 10s, 20s, 40s, 80s, 160s
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
                
                logger.warn(`⚠️ Job ${jobId} failed, will retry in ${delaySeconds}s`, {
                    attempt: job.attempts,
                    maxAttempts: job.max_attempts
                });
            } else {
                // Hết số lần retry hoặc không retry
                await connection.query(
                    `UPDATE jobs 
                    SET status = 'failed',
                        error_message = ?,
                        completed_at = NOW()
                    WHERE id = ?`,
                    [errorMessage, jobId]
                );
                
                logger.error(`❌ Job ${jobId} failed permanently`, {
                    attempts: job.attempts,
                    error: errorMessage
                });
            }
        } finally {
            connection.release();
        }
    }

    /**
     * Lấy thống kê jobs
     */
    static async getStats() {
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query(
                `SELECT 
                    status,
                    COUNT(*) as count
                FROM jobs
                GROUP BY status`
            );
            
            return rows.reduce((acc, row) => {
                acc[row.status] = row.count;
                return acc;
            }, {});
        } finally {
            connection.release();
        }
    }

    /**
     * Lấy danh sách jobs
     */
    static async list(filters = {}) {
        const connection = await db.getConnection();
        
        try {
            let query = 'SELECT * FROM jobs WHERE 1=1';
            const params = [];
            
            if (filters.status) {
                query += ' AND status = ?';
                params.push(filters.status);
            }
            
            if (filters.jobType) {
                query += ' AND job_type = ?';
                params.push(filters.jobType);
            }
            
            query += ' ORDER BY created_at DESC LIMIT ?';
            params.push(filters.limit || 100);
            
            const [rows] = await connection.query(query, params);
            
            // Parse JSON fields - CHỈ PARSE NẾU LÀ STRING
            return rows.map(job => {
                const parsed = { ...job };
                
                // Parse payload nếu là string
                if (typeof job.payload === 'string') {
                    try {
                        parsed.payload = JSON.parse(job.payload);
                    } catch (e) {
                        logger.warn(`Failed to parse payload for job ${job.id}`);
                        parsed.payload = job.payload;
                    }
                }
                
                // Parse result nếu có và là string
                if (job.result) {
                    if (typeof job.result === 'string') {
                        try {
                            parsed.result = JSON.parse(job.result);
                        } catch (e) {
                            logger.warn(`Failed to parse result for job ${job.id}`);
                            parsed.result = job.result;
                        }
                    }
                }
                
                return parsed;
            });
        } finally {
            connection.release();
        }
    }

    /**
     * Xóa jobs cũ đã hoàn thành
     */
    static async cleanupOldJobs(daysOld = 7) {
        const connection = await db.getConnection();
        
        try {
            const [result] = await connection.query(
                `DELETE FROM jobs 
                WHERE status IN ('completed', 'failed')
                AND completed_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
                [daysOld]
            );
            
            logger.info(`🧹 Cleaned up ${result.affectedRows} old jobs`);
            return result.affectedRows;
        } finally {
            connection.release();
        }
    }

    /**
     * Reset stuck jobs (đang processing quá lâu)
     */
    static async resetStuckJobs(timeoutMinutes = 30) {
        const connection = await db.getConnection();
        
        try {
            const [result] = await connection.query(
                `UPDATE jobs 
                SET status = 'pending',
                    started_at = NULL,
                    available_at = NOW()
                WHERE status = 'processing'
                AND started_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
                [timeoutMinutes]
            );
            
            if (result.affectedRows > 0) {
                logger.warn(`⚠️ Reset ${result.affectedRows} stuck jobs`);
            }
            
            return result.affectedRows;
        } finally {
            connection.release();
        }
    }
}

module.exports = JobModel;