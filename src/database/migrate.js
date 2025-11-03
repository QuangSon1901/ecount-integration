require('dotenv').config();

const db = require('./connection');
const logger = require('../utils/logger');

const migrations = [
    {
        version: 1,
        name: 'create_orders_table',
        up: `
            CREATE TABLE IF NOT EXISTS orders (
                id INT AUTO_INCREMENT PRIMARY KEY,
                
                -- Order identifiers
                order_number VARCHAR(100) UNIQUE NOT NULL,
                customer_order_number VARCHAR(100),
                platform_order_number VARCHAR(100),
                erp_order_code VARCHAR(100),
                
                -- Carrier info
                carrier VARCHAR(50) NOT NULL DEFAULT 'YUNEXPRESS',
                product_code VARCHAR(50),
                tracking_number VARCHAR(100),
                
                -- Status tracking
                status ENUM(
                    'pending',           -- Chờ xử lý
                    'created',           -- Đã tạo đơn carrier
                    'in_transit',        -- Đang vận chuyển
                    'delivered',         -- Đã giao hàng
                    'cancelled',         -- Đã hủy
                    'failed'             -- Thất bại
                ) NOT NULL DEFAULT 'pending',
                
                erp_status VARCHAR(50) DEFAULT 'Chờ xử lý',
                erp_updated BOOLEAN DEFAULT FALSE,
                
                -- ECount link
                ecount_link TEXT,
                
                -- Order data (JSON)
                order_data JSON,
                carrier_response JSON,
                tracking_info JSON,
                
                -- Timestamps
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                carrier_created_at TIMESTAMP NULL,
                delivered_at TIMESTAMP NULL,
                
                -- Indexes
                INDEX idx_order_number (order_number),
                INDEX idx_tracking_number (tracking_number),
                INDEX idx_status (status),
                INDEX idx_erp_order_code (erp_order_code),
                INDEX idx_carrier (carrier),
                INDEX idx_created_at (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `
    },
    {
        version: 2,
        name: 'create_tracking_logs_table',
        up: `
            CREATE TABLE IF NOT EXISTS tracking_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                order_id INT NOT NULL,
                tracking_number VARCHAR(100) NOT NULL,
                carrier VARCHAR(50) NOT NULL,
                
                -- Tracking data
                status VARCHAR(50),
                location VARCHAR(255),
                description TEXT,
                tracking_data JSON,
                
                -- Timestamps
                event_time TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                -- Foreign key
                FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
                
                -- Indexes
                INDEX idx_order_id (order_id),
                INDEX idx_tracking_number (tracking_number),
                INDEX idx_event_time (event_time)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `
    },
    {
        version: 3,
        name: 'create_cron_logs_table',
        up: `
            CREATE TABLE IF NOT EXISTS cron_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                job_name VARCHAR(100) NOT NULL,
                status ENUM('started', 'completed', 'failed') NOT NULL,
                
                -- Statistics
                orders_processed INT DEFAULT 0,
                orders_success INT DEFAULT 0,
                orders_failed INT DEFAULT 0,
                
                -- Details
                error_message TEXT,
                execution_time_ms INT,
                
                -- Timestamps
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP NULL,
                
                -- Indexes
                INDEX idx_job_name (job_name),
                INDEX idx_started_at (started_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `
    }
];

async function runMigrations(fresh = false) {
    let connection;
    
    try {
        connection = await db.getConnection();
        
        logger.info('🚀 Starting database migration...');
        
        // Create migrations table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS migrations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                version INT NOT NULL UNIQUE,
                name VARCHAR(255) NOT NULL,
                executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        
        // Drop all tables if fresh migration
        if (fresh) {
            logger.warn('⚠️  Running fresh migration - dropping all tables...');
            await connection.query('SET FOREIGN_KEY_CHECKS = 0');
            await connection.query('DROP TABLE IF EXISTS tracking_logs');
            await connection.query('DROP TABLE IF EXISTS cron_logs');
            await connection.query('DROP TABLE IF EXISTS orders');
            await connection.query('DROP TABLE IF EXISTS migrations');
            await connection.query('SET FOREIGN_KEY_CHECKS = 1');
            
            // Recreate migrations table
            await connection.query(`
                CREATE TABLE migrations (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    version INT NOT NULL UNIQUE,
                    name VARCHAR(255) NOT NULL,
                    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `);
        }
        
        // Get executed migrations
        const [executed] = await connection.query(
            'SELECT version FROM migrations ORDER BY version'
        );
        const executedVersions = executed.map(row => row.version);
        
        // Run pending migrations
        for (const migration of migrations) {
            if (!executedVersions.includes(migration.version)) {
                logger.info(`📝 Running migration ${migration.version}: ${migration.name}`);
                
                await connection.query(migration.up);
                await connection.query(
                    'INSERT INTO migrations (version, name) VALUES (?, ?)',
                    [migration.version, migration.name]
                );
                
                logger.info(`✅ Migration ${migration.version} completed`);
            } else {
                logger.info(`⏭️  Migration ${migration.version} already executed`);
            }
        }
        
        logger.info('🎉 All migrations completed successfully!');
        
    } catch (error) {
        logger.error('❌ Migration failed:', error);
        throw error;
    } finally {
        if (connection) {
            connection.release();
        }
    }
}

// Run migrations if called directly
if (require.main === module) {
    const fresh = process.argv.includes('--fresh');
    
    runMigrations(fresh)
        .then(() => {
            logger.info('✅ Migration script finished');
            process.exit(0);
        })
        .catch((error) => {
            logger.error('❌ Migration script failed:', error);
            process.exit(1);
        });
}

module.exports = { runMigrations };