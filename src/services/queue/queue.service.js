const Queue = require('bull');
const config = require('../../config');
const logger = require('../../utils/logger');

class QueueService {
    constructor() {
        this.queues = {};
        this.redisConfig = this.getRedisConfig();
    }

    /**
     * Lấy Redis config dựa vào environment
     */
    getRedisConfig() {
        // Nếu có REDIS_URL (Redis Cloud, Upstash, etc.)
        if (config.redis.url) {
            logger.info('🔗 Using Redis URL connection');
            
            return config.redis.url;
            
            // Hoặc nếu muốn chi tiết hơn:
            /*
            return {
                redis: config.redis.url,
                maxRetriesPerRequest: null,
                enableReadyCheck: false
            };
            */
        }
        
        // Nếu dùng host/port riêng (local)
        logger.info('🔗 Using Redis host/port connection', {
            host: config.redis.host,
            port: config.redis.port,
            hasPassword: !!config.redis.password
        });
        
        const redisConfig = {
            host: config.redis.host,
            port: config.redis.port,
            db: config.redis.db || 0,
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
            connectTimeout: 10000
        };
        
        // Thêm authentication nếu có
        if (config.redis.username) {
            redisConfig.username = config.redis.username;
        }
        
        if (config.redis.password) {
            redisConfig.password = config.redis.password;
        }
        
        // Thêm TLS nếu cần (Redis Cloud yêu cầu)
        if (config.redis.tls) {
            redisConfig.tls = config.redis.tls;
        }
        
        return redisConfig;
    }

    /**
     * Tạo hoặc lấy queue
     */
    getQueue(queueName, options = {}) {
        if (!this.queues[queueName]) {
            try {
                this.queues[queueName] = new Queue(queueName, {
                    redis: this.redisConfig,
                    defaultJobOptions: {
                        attempts: 3,
                        backoff: {
                            type: 'exponential',
                            delay: 2000
                        },
                        removeOnComplete: 100,
                        removeOnFail: 200,
                        ...options
                    }
                });

                // Event listeners
                this.queues[queueName].on('error', (error) => {
                    logger.error(`❌ Queue ${queueName} error:`, error);
                });

                this.queues[queueName].on('failed', (job, err) => {
                    logger.error(`❌ Job ${job.id} in queue ${queueName} failed:`, err.message);
                });

                this.queues[queueName].on('completed', (job) => {
                    logger.info(`✅ Job ${job.id} in queue ${queueName} completed`);
                });
                
                this.queues[queueName].on('ready', () => {
                    logger.info(`✅ Queue ${queueName} is ready`);
                });

                logger.info(`✅ Queue ${queueName} created`);
                
            } catch (error) {
                logger.error(`❌ Failed to create queue ${queueName}:`, error);
                throw error;
            }
        }

        return this.queues[queueName];
    }

    /**
     * Test Redis connection
     */
    async testConnection() {
        try {
            const testQueue = this.getQueue('test-connection');
            
            // Thêm và xóa một test job
            const job = await testQueue.add('test', { test: true });
            await job.remove();
            
            // Clean up test queue
            await testQueue.close();
            delete this.queues['test-connection'];
            
            logger.info('✅ Redis connection successful');
            return true;
            
        } catch (error) {
            logger.error('❌ Redis connection failed:', error);
            throw error;
        }
    }

    /**
     * Đóng tất cả queues
     */
    async closeAll() {
        const promises = Object.values(this.queues).map(queue => queue.close());
        await Promise.all(promises);
        logger.info('✅ All queues closed');
    }
}

module.exports = new QueueService();