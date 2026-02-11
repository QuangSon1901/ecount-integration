/**
 * session-auth.middleware.js
 *
 * Unified session authentication cho cả admin & customer.
 *
 * Session cookie `app_session` (signed bằng HMAC-SHA256):
 *   Payload: { role: 'admin'|'customer', userId, username, expiresAt }
 *
 * Middleware exports:
 *   - requireAuth: Bắt buộc phải login (admin hoặc customer)
 *   - requireAdmin: Chỉ admin mới được truy cập
 *   - requireCustomer: Chỉ customer mới được truy cập
 *   - optionalAuth: Optional auth (set req.session nếu có cookie hợp lệ)
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

const SESSION_SECRET = process.env.APP_SESSION_SECRET || 'thg-session-secret-change-in-prod';
const COOKIE_NAME = 'app_session';
const COOKIE_MAX_AGE = 60 * 60 * 24; // 24h in seconds

// ─── Sign / Verify helpers ─────────────────────────────────────────

function signValue(value) {
    const sig = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64');
    return `${value}.${sig}`;
}

function unsignValue(signed) {
    if (!signed) return null;
    const idx = signed.lastIndexOf('.');
    if (idx === -1) return null;
    const value = signed.slice(0, idx);
    const sig = signed.slice(idx + 1);
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64');
    return sig === expected ? value : null;
}

// ─── Parse cookie string ─────────────────────────────────────────────

function parseCookies(cookieHeader) {
    const cookies = {};
    if (!cookieHeader) return cookies;
    cookieHeader.split(';').forEach(part => {
        const [key, ...rest] = part.trim().split('=');
        if (key) cookies[key.trim()] = decodeURIComponent(rest.join('='));
    });
    return cookies;
}

// ─── Session management ─────────────────────────────────────────────

/**
 * Tạo session cookie
 * @param {Object} payload - { role, userId, username }
 * @returns {string} - Set-Cookie header value
 */
function createSession(payload) {
    const session = {
        ...payload,
        expiresAt: Date.now() + COOKIE_MAX_AGE * 1000
    };
    const signed = signValue(JSON.stringify(session));
    return `${COOKIE_NAME}=${encodeURIComponent(signed)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}`;
}

/**
 * Parse & verify session từ cookie header
 * @param {string} cookieHeader
 * @returns {Object|null} - Session payload or null
 */
function getSession(cookieHeader) {
    try {
        const cookies = parseCookies(cookieHeader);
        const signedSession = cookies[COOKIE_NAME];
        if (!signedSession) return null;

        const json = unsignValue(signedSession);
        if (!json) return null;

        const session = JSON.parse(json);

        // Check expiration
        if (Date.now() > session.expiresAt) {
            logger.debug('Session expired', { username: session.username });
            return null;
        }

        return session;
    } catch (err) {
        logger.warn('Failed to parse session cookie', { error: err.message });
        return null;
    }
}

/**
 * Destroy session (clear cookie)
 * @returns {string} - Set-Cookie header value
 */
function destroySession() {
    return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

// ─── Middlewares ─────────────────────────────────────────────────────

/**
 * Require authentication (admin or customer)
 * Redirect to /login nếu chưa đăng nhập.
 */
function requireAuth(req, res, next) {
    const session = getSession(req.headers.cookie);

    if (!session || !session.role || !session.userId) {
        logger.debug('Unauthorized access attempt', { url: req.originalUrl });
        return res.redirect(302, '/login');
    }

    // Attach session to request
    req.session = session;
    req.userRole = session.role;
    req.userId = session.userId;
    req.username = session.username;

    logger.debug('Auth success', { role: session.role, username: session.username });
    next();
}

/**
 * Require admin role
 * Return 403 nếu không phải admin.
 */
function requireAdmin(req, res, next) {
    requireAuth(req, res, () => {
        if (req.session.role !== 'admin') {
            logger.warn('Admin access denied', {
                role: req.session.role,
                username: req.session.username,
                url: req.originalUrl
            });
            return res.status(403).json({
                success: false,
                message: 'Admin access required',
                timestamp: new Date().toISOString()
            });
        }
        next();
    });
}

/**
 * Require customer role
 * Return 403 nếu không phải customer.
 */
function requireCustomer(req, res, next) {
    requireAuth(req, res, () => {
        if (req.session.role !== 'customer') {
            logger.warn('Customer access denied', {
                role: req.session.role,
                username: req.session.username,
                url: req.originalUrl
            });
            return res.status(403).json({
                success: false,
                message: 'Customer access required',
                timestamp: new Date().toISOString()
            });
        }
        next();
    });
}

/**
 * Optional auth - không redirect, chỉ set req.session nếu có
 */
function optionalAuth(req, res, next) {
    const session = getSession(req.headers.cookie);
    if (session) {
        req.session = session;
        req.userRole = session.role;
        req.userId = session.userId;
        req.username = session.username;
    }
    next();
}

// ─── Exports ─────────────────────────────────────────────────────────

module.exports = {
    createSession,
    getSession,
    destroySession,
    requireAuth,
    requireAdmin,
    requireCustomer,
    optionalAuth
};
