const axios = require('axios');
const logger = require('./logger');

class TelegramNotifier {
    constructor() {
        this.botToken = process.env.TELEGRAM_BOT_TOKEN;
        this.chatId = process.env.TELEGRAM_CHAT_ID;
        this.chatIdError = process.env.TELEGRAM_CHAT_ID_ERROR;
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
                chat_id: options.chatId || this.chatId,
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
    escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    formatErrorMessage(error, context = {}) {
        const timestamp = new Date().toLocaleString('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh'
        });

        const errorMsg = this.escapeHtml(error.message || error);

        let message = `🚨 <b>ERROR ALERT</b>\n`;
        message += `<b>Time:</b> ${timestamp}\n`;
        message += `<b>Message:</b> ${errorMsg}\n`;

        if (context.orderId) {
            message += `<b>Order ID:</b> ${this.escapeHtml(context.orderId)}\n`;
        }
        if (context.erpOrderCode) {
            message += `<b>ERP Code:</b> ${this.escapeHtml(context.erpOrderCode)}\n`;
        }
        if (context.trackingNumber) {
            message += `<b>Tracking:</b> ${this.escapeHtml(context.trackingNumber)}\n`;
        }
        if (context.jobId) {
            message += `<b>Job ID:</b> ${this.escapeHtml(context.jobId)}\n`;
        }
        if (context.action) {
            message += `<b>Action:</b> ${this.escapeHtml(context.action)}\n`;
        }
        if (context.message) {
            message += `<b>Detail:</b> ${this.escapeHtml(context.message)}\n`;
        }

        if (error.stack && process.env.TELEGRAM_INCLUDE_STACK === 'true') {
            const stackLines = error.stack.split('\n').slice(0, 5);
            message += `\n<pre>${this.escapeHtml(stackLines.join('\n'))}</pre>`;
        }

        return message;
    }

    /**
     * Gửi error notification
     */
    async notifyError(error, context = {}, options = {}) {
        if (options?.type == 'error') {
            options = {...options, chatId: this.chatIdError}
        } else {
            options = {...options, chatId: this.chatId}
        }

        const message = this.formatErrorMessage(error, context);
        return await this.sendMessage(message, options);
    }

    /**
     * Format success message
     */
    formatSuccessMessage(title, details = {}) {
        const timestamp = new Date().toLocaleString('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh'
        });

        let message = `✅ <b>${this.escapeHtml(title)}</b>\n`;
        message += `<b>Time:</b> ${timestamp}\n`;

        Object.entries(details).forEach(([key, value]) => {
            const icon = this.getIconForKey(key);
            const label = this.getLabelForKey(key);
            message += `${icon} <b>${label}:</b> ${this.escapeHtml(value)}\n`;
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
        message += `<b>Time:</b> ${timestamp}\n`;

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
        message += `<b>Time:</b> ${timestamp}\n`;
        message += `<b>Processed:</b> ${stats.processed}\n`;
        message += `<b>Success:</b> ${stats.success}\n`;
        message += `<b>Failed:</b> ${stats.failed}\n`;

        if (stats.updated !== undefined) {
            message += `<b>Updated:</b> ${stats.updated}\n`;
        }

        if (stats.duration) {
            message += `<b>Duration:</b> ${stats.duration}\n`;
        }

        return message;
    }

    /**
     * Handle Telegram webhook update - gửi lời chào khi bot được thêm vào group
     */
    async handleUpdate(update) {
        try {
            // Xử lý khi bot được thêm vào group (my_chat_member event)
            if (update.my_chat_member) {
                const chatMember = update.my_chat_member;
                const chat = chatMember.chat;
                const newStatus = chatMember.new_chat_member?.status;
                const oldStatus = chatMember.old_chat_member?.status;

                // Bot vừa được thêm vào group (từ left/kicked -> member/administrator)
                if (
                    (chat.type === 'group' || chat.type === 'supergroup') &&
                    (oldStatus === 'left' || oldStatus === 'kicked') &&
                    (newStatus === 'member' || newStatus === 'administrator')
                ) {
                    const botName = process.env.TELEGRAM_BOT_NAME || 'THG Robot';
                    const message =
                        `Xin chào, Tôi là <b>${botName}</b>, tôi sẽ gửi thông báo khi có trạng thái mới hoặc cảnh báo phát sinh\n` +
                        `Telegram Group ID là: <code>${chat.id}</code>\n` +
                        `Hãy thêm ID trên vào phần cấu hình Thông báo Telegram nhé!`;

                    await this.sendMessage(message, { chatId: chat.id });
                    logger.info('Sent welcome message to group', { chatId: chat.id, chatTitle: chat.title });
                }
            }

            // Xử lý lệnh /start trong group (fallback nếu ai đó gõ /start)
            if (update.message) {
                const msg = update.message;
                const chat = msg.chat;

                if (
                    msg.text === '/start' &&
                    (chat.type === 'group' || chat.type === 'supergroup')
                ) {
                    const botName = process.env.TELEGRAM_BOT_NAME || 'THG Express Robot';
                    const message =
                        `Xin chào, Tôi là <b>${botName}</b>, tôi sẽ gửi thông báo khi có trạng thái mới hoặc cảnh báo phát sinh\n` +
                        `Telegram Group ID là: <code>${chat.id}</code>\n` +
                        `Hãy thêm ID trên vào phần cấu hình Thông báo Telegram nhé!`;

                    await this.sendMessage(message, { chatId: chat.id });
                    logger.info('Sent welcome message via /start command', { chatId: chat.id, chatTitle: chat.title });
                }
            }

            return { success: true };
        } catch (error) {
            logger.error('Error handling Telegram update:', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Đăng ký webhook URL với Telegram API
     */
    async setWebhook(webhookUrl) {
        try {
            const response = await axios.post(
                `${this.baseUrl}/setWebhook`,
                { url: webhookUrl },
                { timeout: 10000 }
            );
            logger.info('Telegram webhook set successfully', { url: webhookUrl, result: response.data });
            return { success: true, data: response.data };
        } catch (error) {
            logger.error('Failed to set Telegram webhook:', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Xóa webhook (dùng khi cần reset)
     */
    async deleteWebhook() {
        try {
            const response = await axios.post(
                `${this.baseUrl}/deleteWebhook`,
                {},
                { timeout: 10000 }
            );
            logger.info('Telegram webhook deleted', { result: response.data });
            return { success: true, data: response.data };
        } catch (error) {
            logger.error('Failed to delete Telegram webhook:', { error: error.message });
            return { success: false, error: error.message };
        }
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