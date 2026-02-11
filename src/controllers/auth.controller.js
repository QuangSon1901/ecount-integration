/**
 * auth.controller.js
 *
 * Controller xử lý auth-related endpoints
 */

const AdminUserModel = require('../models/admin-user.model');
const ApiCustomerModel = require('../models/api-customer.model');
const logger = require('../utils/logger');

/**
 * GET /api/v1/me
 * Lấy thông tin user hiện tại (admin hoặc customer)
 * @requires req.session (từ requireAuth middleware)
 */
async function getCurrentUser(req, res) {
    try {
        const { role, userId, username } = req.session;

        if (role === 'admin') {
            const admin = await AdminUserModel.findById(userId);

            if (!admin) {
                logger.warn('Admin not found in getCurrentUser', { userId });
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                    timestamp: new Date().toISOString()
                });
            }

            return res.json({
                success: true,
                data: {
                    role: 'admin',
                    id: admin.id,
                    username: admin.username,
                    fullName: admin.full_name,
                    email: admin.email,
                    status: admin.status
                },
                timestamp: new Date().toISOString()
            });
        }

        if (role === 'customer') {
            const customer = await ApiCustomerModel.findById(userId);

            if (!customer) {
                logger.warn('Customer not found in getCurrentUser', { userId });
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                    timestamp: new Date().toISOString()
                });
            }

            return res.json({
                success: true,
                data: {
                    role: 'customer',
                    id: customer.id,
                    customerCode: customer.customer_code,
                    customerName: customer.customer_name,
                    email: customer.email,
                    phone: customer.phone,
                    environment: customer.environment,
                    status: customer.status
                },
                timestamp: new Date().toISOString()
            });
        }

        // Invalid role
        logger.error('Invalid role in session', { role, userId });
        return res.status(400).json({
            success: false,
            message: 'Invalid session data',
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        logger.error('Error in getCurrentUser:', err);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            timestamp: new Date().toISOString()
        });
    }
}

module.exports = {
    getCurrentUser
};
