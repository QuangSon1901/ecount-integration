const axios = require('axios');
const logger = require('./logger');

class TelegramNotifier {
    constructor() {
        this.botToken = process.env.TELEGRAM_BOT_TOKEN;
        this.chatId = process.env.TELEGRAM_CHAT_ID;
        this.enabled = process.env.TELEGRAM_ENABLED === 'true';
        this.baseUrl = `https://api.telegram.org/bot${this.botToken}`;
    }

    /**
     * Gửi message lên Telegram
     */
    async sendMessage(message, options = {}) {
        if (!this.enabled) {
            logger.debug('Telegram notification disabled');
            return { success: false, reason: 'disabled' };
        }

        if (!this.botToken || !this.chatId) {
            logger.warn('Telegram bot token or chat ID not configured');
            return { success: false, reason: 'not_configured' };
        }

        try {
            const payload = {
                chat_id: this.chatId,
                text: message,
                parse_mode: options.parseMode || 'HTML',
                disable_web_page_preview: options.disablePreview !== false,
                ...options
            };

            const response = await axios.post(
                `${this.baseUrl}/sendMessage`,
                payload,
                { timeout: 10000 }
            );

            logger.debug('Telegram message sent successfully', {
                messageLength: message.length
            });

            return {
                success: true,
                messageId: response.data.result.message_id
            };

        } catch (error) {
            logger.error('Failed to send Telegram message:', {
                error: error.message,
                response: error.response?.data
            });

            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Format error message cho Telegram
     */
    formatErrorMessage(error, context = {}) {
        const timestamp = new Date().toLocaleString('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh'
        });

        let message = `🚨 <b>ERROR ALERT</b>\n\n`;
        message += `⏰ <b>Time:</b> ${timestamp}\n`;
        message += `📋 <b>Message:</b> ${error.message || error}\n`;

        if (context.orderId) {
            message += `🔖 <b>Order ID:</b> ${context.orderId}\n`;
        }
        if (context.erpOrderCode) {
            message += `📦 <b>ERP Code:</b> ${context.erpOrderCode}\n`;
        }
        if (context.trackingNumber) {
            message += `🔍 <b>Tracking:</b> ${context.trackingNumber}\n`;
        }
        if (context.jobId) {
            message += `⚙️ <b>Job ID:</b> ${context.jobId}\n`;
        }
        if (context.action) {
            message += `🎯 <b>Action:</b> ${context.action}\n`;
        }

        if (error.stack && process.env.TELEGRAM_INCLUDE_STACK === 'true') {
            const stackLines = error.stack.split('\n').slice(0, 5);
            message += `\n<pre>${stackLines.join('\n')}</pre>`;
        }

        return message;
    }

    /**
     * Gửi error notification
     */
    async notifyError(error, context = {}) {
        const message = this.formatErrorMessage(error, context);
        return await this.sendMessage(message);
    }

    /**
     * Format success message
     */
    formatSuccessMessage(title, details = {}) {
        const timestamp = new Date().toLocaleString('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh'
        });

        let message = `✅ <b>${title}</b>\n`;
        message += `⏰ <b>Time:</b> ${timestamp}\n`;

        Object.entries(details).forEach(([key, value]) => {
            const icon = this.getIconForKey(key);
            const label = this.getLabelForKey(key);
            message += `${icon} <b>${label}:</b> ${value}\n`;
        });

        return message;
    }

    /**
     * Gửi success notification
     */
    async notifySuccess(title, details = {}) {
        const message = this.formatSuccessMessage(title, details);
        return await this.sendMessage(message);
    }

    /**
     * Format warning message
     */
    formatWarningMessage(title, details = {}) {
        const timestamp = new Date().toLocaleString('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh'
        });

        let message = `⚠️ <b>${title}</b>\n`;
        message += `⏰ <b>Time:</b> ${timestamp}\n`;

        Object.entries(details).forEach(([key, value]) => {
            const icon = this.getIconForKey(key);
            const label = this.getLabelForKey(key);
            message += `${icon} <b>${label}:</b> ${value}\n`;
        });

        return message;
    }

    /**
     * Gửi warning notification
     */
    async notifyWarning(title, details = {}) {
        const message = this.formatWarningMessage(title, details);
        return await this.sendMessage(message);
    }

    /**
     * Get icon cho key
     */
    getIconForKey(key) {
        const iconMap = {
            orderId: '',
            erpOrderCode: '',
            trackingNumber: '',
            jobId: '',
            status: '',
            carrier: '',
            action: '',
            count: '',
            duration: '',
            error: '',
            success: ''
        };
        return iconMap[key] || '•';
    }

    /**
     * Get label cho key
     */
    getLabelForKey(key) {
        const labelMap = {
            orderId: 'Order ID',
            erpOrderCode: 'ERP Code',
            trackingNumber: 'Tracking',
            jobId: 'Job ID',
            status: 'Status',
            carrier: 'Carrier',
            action: 'Action',
            count: 'Count',
            duration: 'Duration',
            error: 'Error',
            success: 'Success'
        };
        return labelMap[key] || key;
    }

    /**
     * Format batch job notification
     */
    formatBatchJobMessage(jobName, stats) {
        const timestamp = new Date().toLocaleString('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh'
        });

        let message = `📊 <b>JOB COMPLETED: ${jobName}</b>\n\n`;
        message += `⏰ <b>Time:</b> ${timestamp}\n`;
        message += `🔢 <b>Processed:</b> ${stats.processed}\n`;
        message += `✅ <b>Success:</b> ${stats.success}\n`;
        message += `❌ <b>Failed:</b> ${stats.failed}\n`;

        if (stats.updated !== undefined) {
            message += `📝 <b>Updated:</b> ${stats.updated}\n`;
        }

        if (stats.duration) {
            message += `⏱️ <b>Duration:</b> ${stats.duration}\n`;
        }

        return message;
    }

    /**
     * Gửi batch job notification
     */
    async notifyBatchJob(jobName, stats) {
        // Chỉ gửi nếu có failed hoặc processed > 0
        if (stats.processed === 0 && stats.failed === 0) {
            return { success: false, reason: 'no_data' };
        }

        const message = this.formatBatchJobMessage(jobName, stats);
        return await this.sendMessage(message);
    }
}

module.exports = new TelegramNotifier();