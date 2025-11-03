const mysql = require('mysql2/promise');
const config = require('../config');
const logger = require('../utils/logger');

let pool = null;

/**
 * Tạo connection pool
 */
function createPool() {
    if (!pool) {
        pool = mysql.createPool(config.database);
        logger.info('MySQL connection pool created');
    }
    return pool;
}

/**
 * Lấy connection
 */
async function getConnection() {
    const poolInstance = createPool();
    return await poolInstance.getConnection();
}

/**
 * Test connection
 */
async function testConnection() {
    try {
        const connection = await getConnection();
        await connection.ping();
        connection.release();
        logger.info('Database connection successful');
        return true;
    } catch (error) {
        logger.error('Database connection failed:', error.message);
        throw error;
    }
}

/**
 * Close pool
 */
async function closePool() {
    if (pool) {
        await pool.end();
        pool = null;
        logger.info('MySQL connection pool closed');
    }
}

module.exports = {
    createPool,
    getConnection,
    testConnection,
    closePool,
    get pool() {
        return createPool();
    }
};