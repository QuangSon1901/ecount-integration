// src/models/session.model.js
const db = require('../database/connection');
const logger = require('../utils/logger');

class SessionModel {
    /**
     * Lưu hoặc cập nhật session
     */
    static async upsert(sessionKey, sessionType, cookies, urlParams, expiresAt, metadata = null) {
        const connection = await db.getConnection();
        
        try {
            const [result] = await connection.query(
                `INSERT INTO sessions (
                    session_key, session_type, cookies, url_params, expires_at, metadata
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    cookies = VALUES(cookies),
                    url_params = VALUES(url_params),
                    expires_at = VALUES(expires_at),
                    metadata = VALUES(metadata),
                    updated_at = CURRENT_TIMESTAMP`,
                [
                    sessionKey,
                    sessionType,
                    JSON.stringify(cookies),
                    JSON.stringify(urlParams),
                    expiresAt,
                    metadata ? JSON.stringify(metadata) : null
                ]
            );
            
            return result.insertId || result.affectedRows;
        } finally {
            connection.release();
        }
    }

    /**
     * Lấy session theo key
     */
    static async getByKey(sessionKey) {
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query(
                `SELECT * FROM sessions 
                WHERE session_key = ? 
                AND expires_at > NOW()
                LIMIT 1`,
                [sessionKey]
            );
            
            if (rows.length === 0) {
                return null;
            }

            const session = rows[0];
            
            // Parse JSON fields nếu là string
            if (typeof session.cookies === 'string') {
                session.cookies = JSON.parse(session.cookies);
            }
            if (session.url_params && typeof session.url_params === 'string') {
                session.url_params = JSON.parse(session.url_params);
            }
            if (session.metadata && typeof session.metadata === 'string') {
                session.metadata = JSON.parse(session.metadata);
            }
            
            return session;
        } finally {
            connection.release();
        }
    }

    /**
     * Xóa session theo key
     */
    static async deleteByKey(sessionKey) {
        const connection = await db.getConnection();
        
        try {
            const [result] = await connection.query(
                'DELETE FROM sessions WHERE session_key = ?',
                [sessionKey]
            );
            
            return result.affectedRows > 0;
        } finally {
            connection.release();
        }
    }

    /**
     * Xóa các session đã hết hạn
     */
    static async cleanupExpired() {
        const connection = await db.getConnection();
        
        try {
            const [result] = await connection.query(
                'DELETE FROM sessions WHERE expires_at < NOW()'
            );
            
            if (result.affectedRows > 0) {
                logger.info(`🧹 Cleaned up ${result.affectedRows} expired sessions`);
            }
            
            return result.affectedRows;
        } finally {
            connection.release();
        }
    }

    /**
     * Lấy tất cả sessions (cho debug)
     */
    static async getAll(sessionType = null) {
        const connection = await db.getConnection();
        
        try {
            let query = 'SELECT * FROM sessions WHERE expires_at > NOW()';
            const params = [];
            
            if (sessionType) {
                query += ' AND session_type = ?';
                params.push(sessionType);
            }
            
            query += ' ORDER BY created_at DESC';
            
            const [rows] = await connection.query(query, params);
            
            return rows.map(session => {
                // Parse JSON fields
                if (typeof session.cookies === 'string') {
                    session.cookies = JSON.parse(session.cookies);
                }
                if (session.url_params && typeof session.url_params === 'string') {
                    session.url_params = JSON.parse(session.url_params);
                }
                if (session.metadata && typeof session.metadata === 'string') {
                    session.metadata = JSON.parse(session.metadata);
                }
                return session;
            });
        } finally {
            connection.release();
        }
    }

    /**
     * Đếm sessions
     */
    static async count(sessionType = null) {
        const connection = await db.getConnection();
        
        try {
            let query = 'SELECT COUNT(*) as count FROM sessions WHERE expires_at > NOW()';
            const params = [];
            
            if (sessionType) {
                query += ' AND session_type = ?';
                params.push(sessionType);
            }
            
            const [rows] = await connection.query(query, params);
            
            return rows[0].count;
        } finally {
            connection.release();
        }
    }
}

module.exports = SessionModel;