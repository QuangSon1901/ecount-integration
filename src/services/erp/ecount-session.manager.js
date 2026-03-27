// src/services/erp/ecount-session.manager.js
const SessionModel = require('../../models/session.model');
const logger = require('../../utils/logger');
const config = require('../../config');

class ECountSessionManager {
    constructor(sessionKey = 'ecount:main', sessionType = 'ecount', accountConfig = null) {
        this.sessionKey = sessionKey;
        this.sessionType = sessionType;
        this.accountConfig = accountConfig;  // { companyCode, id } để validate đúng account
        this.session = null;
        this.sessionExpiry = null;
        this._loginLock = false;

        // Auto-load session khi khởi động
        this.initialize();
    }

    /**
     * Log prefix cho dễ phân biệt: [ECOUNT:main] hoặc [ECOUNT:pod]
     */
    get logPrefix() {
        return `[ECOUNT:${this.sessionType}]`;
    }

    /**
     * Initialize - load session ngay khi start
     */
    async initialize() {
        try {
            await this.getSession();
            logger.info(`${this.logPrefix} Session Manager initialized`, {
                account: this.sessionKey,
                companyCode: this.accountConfig?.companyCode || 'N/A',
                hasSession: !!this.session,
                ttl: this.getSessionTTL() + 's',
            });
        } catch (error) {
            logger.error(`${this.logPrefix} Failed to initialize session manager:`, error);
        }
    }

    /**
     * Lưu session vào database
     * Gồm companyCode trong metadata để validate khi load lại
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
            // Lưu vào database, kèm companyCode trong metadata
            await SessionModel.upsert(
                this.sessionKey,
                this.sessionType,
                cookies,
                urlParams,
                expiresAt,
                {
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    source: 'playwright',
                    companyCode: this.accountConfig?.companyCode || null,
                    accountId: this.accountConfig?.id || null,
                    savedAt: new Date().toISOString()
                }
            );

            // Cache in memory
            this.session = sessionData;
            this.sessionExpiry = expiresAt.getTime();

            logger.info(`${this.logPrefix} Đã lưu session vào database`, {
                account: this.sessionKey,
                companyCode: this.accountConfig?.companyCode || 'N/A',
                expiresAt: expiresAt.toISOString(),
                cookiesCount: cookies.length,
                w_flag: urlParams.w_flag,
                ec_req_sid: urlParams.ec_req_sid?.substring(0, 10) + '...'
            });

            return sessionData;
        } catch (error) {
            logger.error(`${this.logPrefix} Lỗi lưu session vào database:`, error);
            throw error;
        }
    }

    /**
     * Lấy session từ database
     * Validate companyCode khớp với account config
     */
    async getSession() {
        // Kiểm tra memory cache trước
        if (this.session && this.sessionExpiry && Date.now() < this.sessionExpiry) {
            logger.debug(`${this.logPrefix} Sử dụng session từ memory cache`);
            return this.session;
        }

        try {
            // Đọc từ database
            const dbSession = await SessionModel.getByKey(this.sessionKey);

            if (!dbSession) {
                logger.debug(`${this.logPrefix} Không tìm thấy session trong database`);
                this.session = null;
                this.sessionExpiry = null;
                return null;
            }

            // Validate companyCode: đảm bảo session thuộc đúng account
            if (this.accountConfig?.companyCode && dbSession.metadata?.companyCode) {
                if (dbSession.metadata.companyCode !== this.accountConfig.companyCode) {
                    logger.error(`${this.logPrefix} SESSION MIS-MATCH! DB session companyCode="${dbSession.metadata.companyCode}" !== expected="${this.accountConfig.companyCode}". Clearing corrupted session.`, {
                        sessionKey: this.sessionKey,
                        dbCompanyCode: dbSession.metadata.companyCode,
                        expectedCompanyCode: this.accountConfig.companyCode
                    });
                    await this.clearSession();
                    return null;
                }
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

                logger.info(`${this.logPrefix} Đã load session từ database`, {
                    account: this.sessionKey,
                    companyCode: dbSession.metadata?.companyCode || 'N/A',
                    expiresAt: new Date(expiresAt).toISOString(),
                    ttl: this.getSessionTTL() + 's',
                    cookiesCount: sessionData.cookies.length
                });

                return sessionData;
            } else {
                logger.info(`${this.logPrefix} Session trong database đã hết hạn`);
                await this.clearSession();
                return null;
            }
        } catch (error) {
            logger.error(`${this.logPrefix} Lỗi đọc session từ database:`, error);
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
            logger.info(`${this.logPrefix} Đã xóa session từ database`, {
                account: this.sessionKey
            });
        } catch (error) {
            logger.error(`${this.logPrefix} Lỗi xóa session từ database:`, error);
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
            throw new Error(`${this.logPrefix} No active session to refresh`);
        }

        const expiresAt = new Date(Date.now() + (expiryMinutes * 60 * 1000));

        await SessionModel.upsert(
            this.sessionKey,
            this.sessionType,
            this.session.cookies,
            this.session.url_params,
            expiresAt,
            {
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                source: 'playwright',
                companyCode: this.accountConfig?.companyCode || null,
                accountId: this.accountConfig?.id || null,
                refreshedAt: new Date().toISOString()
            }
        );

        this.sessionExpiry = expiresAt.getTime();

        logger.info(`${this.logPrefix} Đã refresh session`, {
            account: this.sessionKey,
            newExpiresAt: expiresAt.toISOString(),
            ttl: this.getSessionTTL() + 's'
        });

        return this.session;
    }

    /**
     * Acquire login lock - tránh multiple workers login đồng thời
     * Ecount server sẽ confused nếu 2 login cùng lúc từ cùng IP
     * Returns true nếu acquire được lock, false nếu đang bị lock
     */
    acquireLoginLock(timeoutMs = 60000) {
        if (this._loginLock && this._loginLockExpiry && Date.now() < this._loginLockExpiry) {
            logger.warn(`${this.logPrefix} Login đang bị lock bởi process khác, chờ...`, {
                account: this.sessionKey,
                lockExpiresIn: Math.floor((this._loginLockExpiry - Date.now()) / 1000) + 's'
            });
            return false;
        }

        this._loginLock = true;
        this._loginLockExpiry = Date.now() + timeoutMs;
        logger.info(`${this.logPrefix} Acquired login lock`, { account: this.sessionKey });
        return true;
    }

    /**
     * Release login lock
     */
    releaseLoginLock() {
        this._loginLock = false;
        this._loginLockExpiry = null;
        logger.info(`${this.logPrefix} Released login lock`, { account: this.sessionKey });
    }

    /**
     * Cleanup expired sessions (gọi từ cron)
     */
    static async cleanupExpired() {
        return await SessionModel.cleanupExpired();
    }
}

// Tạo instances với account config để validate
const mainSessionManager = new ECountSessionManager('ecount:main', 'ecount', {
    companyCode: config.ecount?.companyCode,
    id: config.ecount?.id
});

const podSessionManager = new ECountSessionManager('ecount:pod', 'ecount_pod', {
    companyCode: config.ecount_pod?.companyCode,
    id: config.ecount_pod?.id
});

module.exports = mainSessionManager;
module.exports.podSessionManager = podSessionManager;
module.exports.ECountSessionManager = ECountSessionManager;
