const cron = require('node-cron');
const SessionModel = require('../models/session.model');
const logger = require('../utils/logger');

class CleanupSessionsCron {
    constructor() {
        this.schedule = '0 */6 * * *'; // Chạy mỗi 6 giờ
    }

    start() {
        cron.schedule(this.schedule, async () => {
            await this.run();
        });

        logger.info('Cleanup sessions cron job started');
    }

    async run() {
        try {
            logger.info('Đang cleanup expired sessions...');
            
            const deletedCount = await SessionModel.cleanupExpired();
            
            logger.info('Cleanup sessions completed', {
                deletedCount
            });
        } catch (error) {
            logger.error('Cleanup sessions failed:', error);
        }
    }
}

module.exports = new CleanupSessionsCron();