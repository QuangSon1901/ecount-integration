/**
 * admin-user.model.js
 *
 * Quản lý admin users — login vào dashboard với full quyền.
 * Password được hash bằng bcrypt (bcrypt.hash / bcrypt.compare).
 */

const db = require('../database/connection');
const logger = require('../utils/logger');

class AdminUserModel {
    /**
     * Tạo admin mới
     * @param {Object} data - { username, passwordHash, full_name?, email? }
     * @returns {Promise<number>} - Admin ID
     */
    static async create({ username, passwordHash, fullName = null, email = null }) {
        const connection = await db.getConnection();
        try {
            const query = `
                INSERT INTO admin_users (username, password_hash, full_name, email)
                VALUES (?, ?, ?, ?)
            `;
            const [result] = await connection.query(query, [username, passwordHash, fullName, email]);
            return result.insertId;
        } finally {
            connection.release();
        }
    }

    /**
     * Tìm admin theo username
     * @param {string} username
     * @returns {Promise<Object|null>}
     */
    static async findByUsername(username) {
        const connection = await db.getConnection();
        try {
            const query = `
                SELECT id, username, password_hash, full_name, email, status, created_at, updated_at
                FROM admin_users
                WHERE username = ?
                LIMIT 1
            `;
            const [rows] = await connection.query(query, [username]);
            return rows.length > 0 ? rows[0] : null;
        } finally {
            connection.release();
        }
    }

    /**
     * Tìm admin theo ID
     * @param {number} id
     * @returns {Promise<Object|null>}
     */
    static async findById(id) {
        const connection = await db.getConnection();
        try {
            const query = `
                SELECT id, username, password_hash, full_name, email, status, created_at, updated_at
                FROM admin_users
                WHERE id = ?
                LIMIT 1
            `;
            const [rows] = await connection.query(query, [id]);
            return rows.length > 0 ? rows[0] : null;
        } finally {
            connection.release();
        }
    }

    /**
     * Liệt kê tất cả admins
     * @returns {Promise<Array>}
     */
    static async list() {
        const connection = await db.getConnection();
        try {
            const query = `
                SELECT id, username, full_name, email, status, created_at, updated_at
                FROM admin_users
                ORDER BY created_at DESC
            `;
            const [rows] = await connection.query(query);
            return rows;
        } finally {
            connection.release();
        }
    }

    /**
     * Cập nhật password
     * @param {number} id
     * @param {string} passwordHash
     * @returns {Promise<boolean>}
     */
    static async updatePassword(id, passwordHash) {
        const connection = await db.getConnection();
        try {
            const query = `
                UPDATE admin_users
                SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `;
            const [result] = await connection.query(query, [passwordHash, id]);
            return result.affectedRows > 0;
        } finally {
            connection.release();
        }
    }

    /**
     * Cập nhật thông tin admin
     * @param {number} id
     * @param {Object} data - { full_name?, email?, status? }
     * @returns {Promise<boolean>}
     */
    static async update(id, { fullName, email, status }) {
        const updates = [];
        const values = [];

        if (fullName !== undefined) {
            updates.push('full_name = ?');
            values.push(fullName);
        }
        if (email !== undefined) {
            updates.push('email = ?');
            values.push(email);
        }
        if (status !== undefined) {
            updates.push('status = ?');
            values.push(status);
        }

        if (updates.length === 0) return false;

        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(id);

        const connection = await db.getConnection();
        try {
            const query = `UPDATE admin_users SET ${updates.join(', ')} WHERE id = ?`;
            const [result] = await connection.query(query, values);
            return result.affectedRows > 0;
        } finally {
            connection.release();
        }
    }

    /**
     * Xóa admin (soft delete bằng status = 'inactive')
     * @param {number} id
     * @returns {Promise<boolean>}
     */
    static async deactivate(id) {
        return this.update(id, { status: 'inactive' });
    }
}

module.exports = AdminUserModel;
