// src/services/erp/ecount-session.manager.js
const SessionModel = require('../../models/session.model');
const logger = require('../../utils/logger');

class ECountSessionManager {
    constructor() {
        this.sessionKey = 'ecount:main';
        this.sessionType = 'ecount';
        this.session = null;
        this.sessionExpiry = null;
        
        // Auto-load session khi khởi động
        this.initialize();
    }

    /**
     * Initialize - load session ngay khi start
     */
    async initialize() {
        try {
            await this.getSession();
            logger.info('ECount Session Manager initialized', {
                hasSession: !!this.session,
                ttl: this.getSessionTTL() + 's',
            });
        } catch (error) {
            logger.error('Failed to initialize session manager:', error);
        }
    }

    /**
     * Lưu session vào database
     */
    async saveSession(cookies, urlParams, expiryMinutes = 30) {
        const expiresAt = new Date(Date.now() + (expiryMinutes * 60 * 1000));
        
        const sessionData = {
            cookies: cookies,
            url_params: urlParams,
            expires_at: expiresAt,
            created_at: new Date()
        };

        try {
            // Lưu vào database
            await SessionModel.upsert(
                this.sessionKey,
                this.sessionType,
                cookies,
                urlParams,
                expiresAt,
                {
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    source: 'puppeteer'
                }
            );

            // Cache in memory
            this.session = sessionData;
            this.sessionExpiry = expiresAt.getTime();

            logger.info('Đã lưu ECount session vào database', {
                expiresAt: expiresAt.toISOString(),
                cookiesCount: cookies.length,
                w_flag: urlParams.w_flag,
                ec_req_sid: urlParams.ec_req_sid?.substring(0, 10) + '...'
            });

            return sessionData;
        } catch (error) {
            logger.error('Lỗi lưu session vào database:', error);
            throw error;
        }
    }

    /**
     * Lấy session từ database
     */
    async getSession() {
        // Kiểm tra memory cache trước
        if (this.session && this.sessionExpiry && Date.now() < this.sessionExpiry) {
            logger.debug('Sử dụng session từ memory cache');
            return this.session;
        }

        try {
            // Đọc từ database
            const dbSession = await SessionModel.getByKey(this.sessionKey);

            if (!dbSession) {
                logger.debug('Không tìm thấy session trong database');
                this.session = null;
                this.sessionExpiry = null;
                return null;
            }

            // Convert expires_at to timestamp
            const expiresAt = new Date(dbSession.expires_at).getTime();

            // Kiểm tra expiry
            if (Date.now() < expiresAt) {
                const sessionData = {
                    cookies: dbSession.cookies,
                    url_params: dbSession.url_params,
                    expires_at: dbSession.expires_at,
                    created_at: dbSession.created_at
                };

                // Cache in memory
                this.session = sessionData;
                this.sessionExpiry = expiresAt;

                logger.info('Đã load session từ database', {
                    expiresAt: new Date(expiresAt).toISOString(),
                    ttl: this.getSessionTTL() + 's',
                    cookiesCount: sessionData.cookies.length
                });

                return sessionData;
            } else {
                logger.info('Session trong database đã hết hạn');
                await this.clearSession();
                return null;
            }
        } catch (error) {
            logger.error('Lỗi đọc session từ database:', error);
            return null;
        }
    }

    /**
     * Xóa session
     */
    async clearSession() {
        this.session = null;
        this.sessionExpiry = null;

        try {
            await SessionModel.deleteByKey(this.sessionKey);
            logger.info('Đã xóa session từ database');
        } catch (error) {
            logger.error('Lỗi xóa session từ database:', error);
        }
    }

    /**
     * Kiểm tra session còn hợp lệ không
     */
    isSessionValid() {
        return this.session && this.sessionExpiry && Date.now() < this.sessionExpiry;
    }

    /**
     * Lấy thời gian còn lại của session (seconds)
     */
    getSessionTTL() {
        if (!this.isSessionValid()) return 0;
        return Math.floor((this.sessionExpiry - Date.now()) / 1000);
    }

    /**
     * Làm mới session (refresh expiry)
     */
    async refreshSession(expiryMinutes = 30) {
        if (!this.session) {
            throw new Error('No active session to refresh');
        }

        const expiresAt = new Date(Date.now() + (expiryMinutes * 60 * 1000));

        await SessionModel.upsert(
            this.sessionKey,
            this.sessionType,
            this.session.cookies,
            this.session.url_params,
            expiresAt
        );

        this.sessionExpiry = expiresAt.getTime();

        logger.info('Đã refresh session', {
            newExpiresAt: expiresAt.toISOString(),
            ttl: this.getSessionTTL() + 's'
        });

        return this.session;
    }

    /**
     * Cleanup expired sessions (gọi từ cron)
     */
    static async cleanupExpired() {
        return await SessionModel.cleanupExpired();
    }
}

module.exports = new ECountSessionManager();