/**
 * rbac.middleware.js
 *
 * Clean RBAC (Role-Based Access Control) middleware.
 *
 * Roles:
 *   - admin   : Full system access
 *   - customer : Own data only
 *
 * Usage:
 *   const { requireRole, requireAdminOrOwner } = require('./middlewares/rbac.middleware');
 *
 *   router.get('/admin-only', requireRole('admin'), handler);
 *   router.get('/both', requireRole('admin', 'customer'), handler);
 *   router.get('/:customerId/data', requireAdminOrOwner('customerId'), handler);
 */

const { getSession } = require('./session-auth.middleware');
const logger = require('../utils/logger');

/**
 * Base auth check — attaches session to req if valid.
 * Redirects HTML requests to /login; returns 401 JSON for API calls.
 */
function authenticate(req, res, next) {
    const session = getSession(req.headers.cookie);

    if (!session || !session.role || !session.userId) {
        logger.debug('RBAC: unauthenticated', { url: req.originalUrl });

        const wantsJson = req.xhr ||
            (req.headers.accept && req.headers.accept.includes('application/json'));

        if (wantsJson) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required',
                timestamp: new Date().toISOString()
            });
        }
        return res.redirect(302, '/login');
    }

    req.session = session;
    req.userRole = session.role;
    req.userId = session.userId;
    req.username = session.username;
    next();
}

/**
 * Require one or more roles.
 *
 * @param  {...string} allowedRoles  e.g. 'admin', 'customer'
 * @returns {Function[]} Express middleware chain [authenticate, roleCheck]
 */
function requireRole(...allowedRoles) {
    return [
        authenticate,
        (req, res, next) => {
            if (!allowedRoles.includes(req.session.role)) {
                logger.warn('RBAC: role denied', {
                    required: allowedRoles,
                    actual: req.session.role,
                    username: req.session.username,
                    url: req.originalUrl
                });
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden — insufficient permissions',
                    timestamp: new Date().toISOString()
                });
            }
            next();
        }
    ];
}

/**
 * Allow admin (full access) OR customer who owns the resource.
 * The resource owner is determined by matching req.params[paramName] with req.userId.
 *
 * @param {string} paramName  Route param that holds the customer id (default 'customerId')
 * @returns {Function[]}
 */
function requireAdminOrOwner(paramName = 'customerId') {
    return [
        authenticate,
        (req, res, next) => {
            const { role, userId } = req.session;

            if (role === 'admin') {
                req.isAdmin = true;
                return next();
            }

            if (role === 'customer') {
                const resourceId = parseInt(req.params[paramName], 10);
                if (userId === resourceId) {
                    req.isAdmin = false;
                    req.customerId = userId;
                    return next();
                }

                logger.warn('RBAC: owner mismatch', {
                    userId,
                    resourceId,
                    url: req.originalUrl
                });
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden — you can only access your own data',
                    timestamp: new Date().toISOString()
                });
            }

            return res.status(403).json({
                success: false,
                message: 'Forbidden — invalid role',
                timestamp: new Date().toISOString()
            });
        }
    ];
}

module.exports = {
    authenticate,
    requireRole,
    requireAdminOrOwner
};
