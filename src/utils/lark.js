const axios = require('axios');
const logger = require('./logger');

class LarkNotifier {
    constructor() {
        this.appId = process.env.LARK_APP_ID;
        this.appSecret = process.env.LARK_APP_SECRET;
        this.enabled = process.env.LARK_ENABLED === 'true';
        this.baseUrl = 'https://open.larksuite.com/open-apis';

        // Token cache
        this.tenantToken = null;
        this.tokenExpiry = null;
    }

    /**
     * Lấy tenant_access_token (cache 2 giờ, Lark cho tối đa 2h)
     */
    async getTenantToken() {
        if (this.tenantToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
            return this.tenantToken;
        }

        try {
            const response = await axios.post(
                `${this.baseUrl}/auth/v3/tenant_access_token/internal`,
                {
                    app_id: this.appId,
                    app_secret: this.appSecret
                },
                { timeout: 10000 }
            );

            if (response.data.code !== 0) {
                throw new Error(`Lark auth failed: ${response.data.msg}`);
            }

            this.tenantToken = response.data.tenant_access_token;
            // Lark token hết hạn sau 2h, refresh trước 10 phút
            this.tokenExpiry = Date.now() + (110 * 60 * 1000);

            logger.info('[Lark] Tenant token obtained');
            return this.tenantToken;
        } catch (error) {
            logger.error('[Lark] getTenantToken failed:', error.message);
            throw new Error(`Lark authentication failed: ${error.message}`);
        }
    }

    /**
     * Escape text cho Lark rich text (không cần escape nhiều như HTML)
     */
    escapeText(text) {
        return String(text || '');
    }

    /**
     * Gửi message vào group chat bằng chat_id
     * Dùng rich text (post) format cho message đẹp
     *
     * @param {string} chatId - Lark group chat_id
     * @param {string} title - Tiêu đề message
     * @param {Array} contentLines - Array of rich text content lines (Lark post format)
     */
    async sendMessage(chatId, title, contentLines) {
        if (!this.enabled) {
            logger.debug('[Lark] Notification disabled');
            return { success: false, reason: 'disabled' };
        }

        if (!this.appId || !this.appSecret) {
            logger.warn('[Lark] App ID or App Secret not configured');
            return { success: false, reason: 'not_configured' };
        }

        try {
            const token = await this.getTenantToken();

            const contentObj = {
                en_us: {
                    title: title,
                    content: contentLines
                }
            };

            const payload = {
                receive_id: chatId,
                msg_type: 'post',
                content: JSON.stringify(contentObj)
            };

            logger.info('[Lark] Sending rich text message', {
                chatId,
                title,
                contentJson: payload.content
            });

            const response = await axios.post(
                `${this.baseUrl}/im/v1/messages?receive_id_type=chat_id`,
                payload,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );

            if (response.data.code !== 0) {
                throw new Error(`Lark send failed: ${response.data.msg}`);
            }

            logger.debug('[Lark] Message sent successfully', {
                chatId,
                messageId: response.data.data?.message_id
            });

            return {
                success: true,
                messageId: response.data.data?.message_id
            };
        } catch (error) {
            logger.error('[Lark] Failed to send message:', {
                chatId,
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
     * Gửi text message đơn giản vào group
     * @param {string} chatId - Lark group chat_id
     * @param {string} text - Nội dung text
     */
    async sendTextMessage(chatId, text) {
        if (!this.enabled) {
            return { success: false, reason: 'disabled' };
        }

        try {
            const token = await this.getTenantToken();

            const payload = {
                receive_id: chatId,
                msg_type: 'text',
                content: JSON.stringify({ text })
            };

            const response = await axios.post(
                `${this.baseUrl}/im/v1/messages?receive_id_type=chat_id`,
                payload,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );

            if (response.data.code !== 0) {
                throw new Error(`Lark send failed: ${response.data.msg}`);
            }

            return {
                success: true,
                messageId: response.data.data?.message_id
            };
        } catch (error) {
            logger.error('[Lark] Failed to send text message:', {
                chatId,
                error: error.message
            });
            return { success: false, error: error.message };
        }
    }

    /**
     * Xử lý Lark Event Callback - khi bot được add vào group
     * Lark gửi event p2p_chat_create hoặc bot_added_to_chat
     *
     * Flow:
     * 1. Lark gửi URL Verification challenge → trả lại challenge
     * 2. Lark gửi event khi bot được thêm vào group → gửi welcome message với chat_id
     */
    async handleEventCallback(body) {
        try {
            // URL Verification (Lark yêu cầu khi đăng ký event URL)
            if (body.type === 'url_verification') {
                logger.info('[Lark] URL verification challenge received');
                return { challenge: body.challenge };
            }

            // Event callback v2
            const event = body.event;
            if (!event) {
                logger.debug('[Lark] No event in callback body');
                return { success: true };
            }

            const eventType = body.header?.event_type;

            // Bot được thêm vào group
            if (eventType === 'im.chat.member.bot.added_v1') {
                const chatId = event.chat_id;
                if (chatId) {
                    const botName = process.env.LARK_BOT_NAME || 'THG Robot';
                    const welcomeText =
                        `Xin chào, Tôi là ${botName}, tôi sẽ gửi thông báo khi có cảnh báo phát sinh\n` +
                        `Lark Group Chat ID là: ${chatId}\n` +
                        `Hãy thêm ID trên vào phần cấu hình Thông báo Lark nhé!`;

                    await this.sendTextMessage(chatId, welcomeText);
                    logger.info('[Lark] Sent welcome message to group', { chatId });
                }
            }

            return { success: true };
        } catch (error) {
            logger.error('[Lark] Error handling event callback:', { error: error.message });
            return { success: false, error: error.message };
        }
    }
}

module.exports = new LarkNotifier();
