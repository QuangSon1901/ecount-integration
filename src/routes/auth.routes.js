/**
 * auth.routes.js
 *
 * Xử lý login/logout cho cả admin & customer.
 *
 * Routes:
 *   GET  /login  - Hiển thị form login
 *   POST /login  - Xử lý login (admin hoặc customer)
 *   GET  /logout - Xóa session + redirect về /login
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const AdminUserModel = require('../models/admin-user.model');
const ApiCustomerModel = require('../models/api-customer.model');
const { createSession, destroySession, requireAuth } = require('../middlewares/session-auth.middleware');
const { getCurrentUser } = require('../controllers/auth.controller');

/**
 * GET /login
 * Hiển thị form login (HTML page)
 */
router.get('/login', (req, res) => {
    const viewPath = path.join(__dirname, '../../public/views/login.html');

    if (!fs.existsSync(viewPath)) {
        logger.error('Login view not found');
        return res.status(500).send('<h1>Login page not found</h1>');
    }

    res.sendFile(viewPath);
});

/**
 * POST /login
 * Xử lý login:
 *   1. Thử tìm admin với username
 *   2. Nếu không có → thử tìm customer với customer_code
 *   3. Verify password → tạo session → redirect /dashboard
 */
router.post('/login', async (req, res) => {
    const { username, password } = req.body || {};

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            message: 'Username và password là bắt buộc',
            timestamp: new Date().toISOString()
        });
    }

    try {
        // 1. Thử tìm admin trước
        const admin = await AdminUserModel.findByUsername(username);

        if (admin && admin.status === 'active') {
            const valid = await bcrypt.compare(password, admin.password_hash);

            if (valid) {
                logger.info('Admin login success', { username: admin.username });

                // Tạo session cookie
                const sessionCookie = createSession({
                    role: 'admin',
                    userId: admin.id,
                    username: admin.username
                });

                res.setHeader('Set-Cookie', sessionCookie);
                return res.json({
                    success: true,
                    message: 'Login thành công',
                    data: {
                        role: 'admin',
                        username: admin.username,
                        redirectUrl: '/extensions/dashboard'
                    },
                    timestamp: new Date().toISOString()
                });
            }
        }

        // 2. Thử tìm customer
        const customer = await ApiCustomerModel.findByCode(username);

        if (customer && customer.status === 'active' && customer.portal_password_hash) {
            const valid = await bcrypt.compare(password, customer.portal_password_hash);

            if (valid) {
                logger.info('Customer login success', { customerCode: customer.customer_code });

                // Tạo session cookie
                const sessionCookie = createSession({
                    role: 'customer',
                    userId: customer.id,
                    username: customer.customer_code
                });

                res.setHeader('Set-Cookie', sessionCookie);
                return res.json({
                    success: true,
                    message: 'Login thành công',
                    data: {
                        role: 'customer',
                        username: customer.customer_code,
                        redirectUrl: '/extensions/dashboard'
                    },
                    timestamp: new Date().toISOString()
                });
            }
        }

        // 3. Login failed
        logger.warn('Login failed', { username });
        return res.status(401).json({
            success: false,
            message: 'Username hoặc password không đúng',
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        logger.error('Login error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi hệ thống. Vui lòng thử lại.',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /logout
 * Xóa session cookie + redirect về /login
 */
router.get('/logout', (req, res) => {
    res.setHeader('Set-Cookie', destroySession());
    logger.info('User logged out');
    res.redirect(302, '/login');
});

/**
 * GET /api/v1/me
 * Lấy thông tin user hiện tại (admin hoặc customer)
 * @access Private (requireAuth)
 */
router.get('/api/v1/me', requireAuth, getCurrentUser);

module.exports = router;
