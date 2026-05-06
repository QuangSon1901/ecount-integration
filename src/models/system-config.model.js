// src/models/system-config.model.js
//
// CRUD cho bảng system_configs — lưu cấu hình hệ thống dạng JSON.
// Mỗi config_key là duy nhất; config_value là JSON tuỳ ý.

const db = require('../database/connection');

class SystemConfigModel {
    static async get(key) {
        const conn = await db.getConnection();
        try {
            const [rows] = await conn.query(
                'SELECT * FROM system_configs WHERE config_key = ?',
                [key]
            );
            if (!rows[0]) return null;
            const row = rows[0];
            // MySQL trả về JSON đã parse nếu driver hỗ trợ; đảm bảo luôn là object
            if (typeof row.config_value === 'string') {
                try { row.config_value = JSON.parse(row.config_value); } catch { /* giữ nguyên */ }
            }
            return row;
        } finally {
            conn.release();
        }
    }

    static async getValue(key, defaultValue = null) {
        const row = await SystemConfigModel.get(key);
        return row ? row.config_value : defaultValue;
    }

    static async set(key, value, description = null) {
        const conn = await db.getConnection();
        try {
            const jsonValue = JSON.stringify(value);
            await conn.query(
                `INSERT INTO system_configs (config_key, config_value, description)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE config_value = VALUES(config_value),
                                         description  = COALESCE(VALUES(description), description)`,
                [key, jsonValue, description]
            );
        } finally {
            conn.release();
        }
    }

    static async list() {
        const conn = await db.getConnection();
        try {
            const [rows] = await conn.query(
                'SELECT * FROM system_configs ORDER BY config_key ASC'
            );
            return rows.map(row => {
                if (typeof row.config_value === 'string') {
                    try { row.config_value = JSON.parse(row.config_value); } catch { /* giữ nguyên */ }
                }
                return row;
            });
        } finally {
            conn.release();
        }
    }

    static async delete(key) {
        const conn = await db.getConnection();
        try {
            const [result] = await conn.query(
                'DELETE FROM system_configs WHERE config_key = ?',
                [key]
            );
            return result.affectedRows > 0;
        } finally {
            conn.release();
        }
    }
}

module.exports = SystemConfigModel;
