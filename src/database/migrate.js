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
                order_number VARCHAR(100) UNIQUE NOT NULL COMMENT 'Mã đơn hàng nội bộ',
                customer_order_number VARCHAR(100) COMMENT 'Mã đơn khách hàng tự định nghĩa',
                platform_order_number VARCHAR(100) COMMENT 'Mã đơn từ platform (Amazon, Shopify...)',
                erp_order_code VARCHAR(100) COMMENT 'Mã đơn trong ERP (ECount)',
                
                -- Carrier info
                carrier VARCHAR(50) NOT NULL DEFAULT 'YUNEXPRESS' COMMENT 'Nhà vận chuyển',
                product_code VARCHAR(50) COMMENT 'Mã sản phẩm vận chuyển (VN-YTYCPREC)',
                waybill_number VARCHAR(100) COMMENT 'Số vận đơn từ carrier',
                tracking_number VARCHAR(100) COMMENT 'Tracking number',
                bar_codes TEXT COMMENT 'Mã vạch label',
                label_url TEXT COMMENT 'Link tải label PDF/PNG',
                
                -- Package info
                package_weight DECIMAL(10,3) COMMENT 'Trọng lượng (KG)',
                package_length DECIMAL(10,3) COMMENT 'Chiều dài (CM)',
                package_width DECIMAL(10,3) COMMENT 'Chiều rộng (CM)',
                package_height DECIMAL(10,3) COMMENT 'Chiều cao (CM)',
                weight_unit VARCHAR(10) DEFAULT 'KG' COMMENT 'Đơn vị trọng lượng',
                size_unit VARCHAR(10) DEFAULT 'CM' COMMENT 'Đơn vị kích thước',
                
                -- Receiver info (lưu trực tiếp để query dễ)
                receiver_name VARCHAR(200) COMMENT 'Tên người nhận',
                receiver_country VARCHAR(2) COMMENT 'Mã quốc gia',
                receiver_state VARCHAR(100) COMMENT 'Tỉnh/bang',
                receiver_city VARCHAR(100) COMMENT 'Thành phố',
                receiver_postal_code VARCHAR(20) COMMENT 'Mã bưu điện',
                receiver_phone VARCHAR(50) COMMENT 'Số điện thoại',
                receiver_email VARCHAR(100) COMMENT 'Email',
                
                -- Declaration info summary
                declared_value DECIMAL(12,2) COMMENT 'Tổng giá trị khai báo (USD)',
                declared_currency VARCHAR(3) DEFAULT 'USD' COMMENT 'Loại tiền tệ',
                items_count INT DEFAULT 1 COMMENT 'Số lượng mặt hàng',
                
                -- Status tracking
                status ENUM(
                    'pending',           -- Chờ xử lý
                    'created',           -- Đã tạo đơn carrier
                    'in_transit',        -- Đang vận chuyển
                    'out_for_delivery',  -- Đang giao hàng
                    'delivered',         -- Đã giao hàng
                    'exception',         -- Có vấn đề
                    'returned',          -- Đã trả hàng
                    'cancelled',         -- Đã hủy
                    'failed'             -- Thất bại
                ) NOT NULL DEFAULT 'pending' COMMENT 'Trạng thái đơn hàng',
                
                track_type VARCHAR(10) COMMENT 'Loại tracking (Y/W/N)',
                remote_area ENUM('Y', 'N') COMMENT 'Khu vực xa xôi',
                
                -- ERP status
                erp_status VARCHAR(50) DEFAULT 'Chờ xử lý' COMMENT 'Trạng thái trong ERP',
                erp_updated BOOLEAN DEFAULT FALSE COMMENT 'Đã cập nhật ERP',
                ecount_link TEXT COMMENT 'Hash link ECount',
                
                -- Additional services
                extra_services JSON COMMENT 'Dịch vụ bổ sung',
                sensitive_type VARCHAR(10) COMMENT 'Loại hàng hóa (W/D/F/L)',
                goods_type VARCHAR(10) COMMENT 'Loại hàng (W/F/O)',
                dangerous_goods_type VARCHAR(30) COMMENT 'Mã hàng nguy hiểm',
                
                -- Customs info
                vat_number VARCHAR(100) COMMENT 'Số VAT',
                ioss_code VARCHAR(100) COMMENT 'Mã IOSS (EU)',
                eori_number VARCHAR(100) COMMENT 'Số EORI (EU)',
                
                -- Full data (JSON for flexibility)
                order_data JSON COMMENT 'Dữ liệu đơn hàng đầy đủ',
                carrier_response JSON COMMENT 'Response từ carrier API',
                tracking_info JSON COMMENT 'Thông tin tracking mới nhất',
                error_info JSON COMMENT 'Thông tin lỗi (nếu có)',
                
                -- Timestamps
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Thời gian tạo',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Thời gian cập nhật',
                carrier_created_at TIMESTAMP NULL COMMENT 'Thời gian tạo đơn carrier',
                last_tracked_at TIMESTAMP NULL COMMENT 'Lần tracking cuối',
                delivered_at TIMESTAMP NULL COMMENT 'Thời gian giao hàng',
                
                -- Indexes for better performance
                INDEX idx_order_number (order_number),
                INDEX idx_waybill_number (waybill_number),
                INDEX idx_tracking_number (tracking_number),
                INDEX idx_platform_order (platform_order_number),
                INDEX idx_erp_order_code (erp_order_code),
                INDEX idx_status (status),
                INDEX idx_carrier (carrier),
                INDEX idx_receiver_country (receiver_country),
                INDEX idx_created_at (created_at),
                INDEX idx_status_erp_updated (status, erp_updated),
                FULLTEXT INDEX idx_receiver_name (receiver_name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='Bảng quản lý đơn hàng vận chuyển';
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
                waybill_number VARCHAR(100) COMMENT 'Số vận đơn',
                carrier VARCHAR(50) NOT NULL,
                
                -- Tracking event data
                status VARCHAR(50) COMMENT 'Trạng thái sự kiện',
                event_code VARCHAR(100) COMMENT 'Mã sự kiện từ carrier',
                location VARCHAR(255) COMMENT 'Địa điểm',
                description TEXT COMMENT 'Mô tả sự kiện',
                
                -- Additional info
                checkpoint_type VARCHAR(50) COMMENT 'Loại checkpoint',
                origin_code VARCHAR(10) COMMENT 'Mã nơi gửi',
                destination_code VARCHAR(10) COMMENT 'Mã nơi nhận',
                last_mile_carrier VARCHAR(100) COMMENT 'Đơn vị giao hàng cuối',
                
                -- Full tracking data
                tracking_data JSON COMMENT 'Dữ liệu tracking đầy đủ',
                
                -- Timestamps
                event_time TIMESTAMP NULL COMMENT 'Thời gian sự kiện',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Thời gian ghi log',
                
                -- Foreign key
                FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
                
                -- Indexes
                INDEX idx_order_id (order_id),
                INDEX idx_tracking_number (tracking_number),
                INDEX idx_waybill_number (waybill_number),
                INDEX idx_status (status),
                INDEX idx_event_time (event_time),
                INDEX idx_carrier (carrier)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='Bảng log tracking đơn hàng';
        `
    },
    {
        version: 3,
        name: 'create_cron_logs_table',
        up: `
            CREATE TABLE IF NOT EXISTS cron_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                job_name VARCHAR(100) NOT NULL COMMENT 'Tên công việc cron',
                status ENUM('started', 'completed', 'failed') NOT NULL COMMENT 'Trạng thái',
                
                -- Statistics
                orders_processed INT DEFAULT 0 COMMENT 'Số đơn đã xử lý',
                orders_success INT DEFAULT 0 COMMENT 'Số đơn thành công',
                orders_failed INT DEFAULT 0 COMMENT 'Số đơn thất bại',
                orders_updated INT DEFAULT 0 COMMENT 'Số đơn đã cập nhật',
                
                -- Details
                error_message TEXT COMMENT 'Thông báo lỗi',
                execution_time_ms INT COMMENT 'Thời gian thực thi (ms)',
                details JSON COMMENT 'Chi tiết thêm',
                
                -- Timestamps
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Thời gian bắt đầu',
                completed_at TIMESTAMP NULL COMMENT 'Thời gian hoàn thành',
                
                -- Indexes
                INDEX idx_job_name (job_name),
                INDEX idx_status (status),
                INDEX idx_started_at (started_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='Bảng log công việc cron';
        `
    },
    {
        version: 4,
        name: 'create_carrier_labels_table',
        up: `
            CREATE TABLE IF NOT EXISTS carrier_labels (
                id INT AUTO_INCREMENT PRIMARY KEY,
                order_id INT NOT NULL,
                tracking_number VARCHAR(100) NOT NULL,
                waybill_number VARCHAR(100),
                carrier VARCHAR(50) NOT NULL,
                
                -- Label info
                label_type VARCHAR(10) DEFAULT 'PDF' COMMENT 'Loại label (PDF/PNG/ZPL)',
                label_url TEXT COMMENT 'URL download label',
                label_base64 LONGTEXT COMMENT 'Label dạng base64',
                label_size_kb INT COMMENT 'Kích thước file (KB)',
                
                -- Print tracking
                printed BOOLEAN DEFAULT FALSE COMMENT 'Đã in',
                print_count INT DEFAULT 0 COMMENT 'Số lần in',
                last_printed_at TIMESTAMP NULL COMMENT 'Lần in cuối',
                
                -- Timestamps
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NULL COMMENT 'Thời gian hết hạn',
                
                -- Foreign key
                FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
                
                -- Indexes
                INDEX idx_order_id (order_id),
                INDEX idx_tracking_number (tracking_number),
                INDEX idx_carrier (carrier),
                INDEX idx_printed (printed)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='Bảng quản lý label vận chuyển';
        `
    },
    {
        version: 5,
        name: 'create_api_logs_table',
        up: `
            CREATE TABLE IF NOT EXISTS api_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                
                -- Request info
                method VARCHAR(10) NOT NULL COMMENT 'HTTP method',
                endpoint VARCHAR(255) NOT NULL COMMENT 'API endpoint',
                carrier VARCHAR(50) COMMENT 'Nhà vận chuyển',
                
                -- Request/Response
                request_headers JSON COMMENT 'Request headers',
                request_body JSON COMMENT 'Request body',
                response_status INT COMMENT 'Response status code',
                response_body JSON COMMENT 'Response body',
                
                -- Timing
                duration_ms INT COMMENT 'Thời gian xử lý (ms)',
                
                -- Association
                order_id INT COMMENT 'ID đơn hàng liên quan',
                
                -- Result
                success BOOLEAN DEFAULT FALSE COMMENT 'Thành công',
                error_message TEXT COMMENT 'Thông báo lỗi',
                
                -- Timestamps
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                -- Indexes
                INDEX idx_carrier (carrier),
                INDEX idx_endpoint (endpoint),
                INDEX idx_success (success),
                INDEX idx_created_at (created_at),
                INDEX idx_order_id (order_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='Bảng log API calls';
        `
    },
    {
        version: 6,
        name: 'create_jobs_table',
        up: `
            CREATE TABLE IF NOT EXISTS jobs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                
                -- Job info
                job_type VARCHAR(50) NOT NULL COMMENT 'Loại job (tracking_number, update_erp...)',
                status ENUM('pending', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'pending',
                
                -- Payload
                payload JSON NOT NULL COMMENT 'Dữ liệu job',
                
                -- Retry logic
                attempts INT DEFAULT 0 COMMENT 'Số lần đã thử',
                max_attempts INT DEFAULT 6 COMMENT 'Số lần thử tối đa',
                
                -- Timing
                available_at TIMESTAMP NOT NULL COMMENT 'Thời gian sẵn sàng để xử lý',
                started_at TIMESTAMP NULL COMMENT 'Thời gian bắt đầu xử lý',
                completed_at TIMESTAMP NULL COMMENT 'Thời gian hoàn thành',
                
                -- Result
                result JSON COMMENT 'Kết quả sau khi xử lý',
                error_message TEXT COMMENT 'Thông báo lỗi',
                
                -- Timestamps
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                
                -- Indexes
                INDEX idx_status (status),
                INDEX idx_job_type (job_type),
                INDEX idx_available_at (available_at),
                INDEX idx_status_available (status, available_at),
                INDEX idx_created_at (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='Bảng quản lý jobs queue';
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
                executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_version (version)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        
        // Drop all tables if fresh migration
        if (fresh) {
            logger.warn('⚠️  Running fresh migration - dropping all tables...');
            await connection.query('SET FOREIGN_KEY_CHECKS = 0');
            await connection.query('DROP TABLE IF EXISTS api_logs');
            await connection.query('DROP TABLE IF EXISTS carrier_labels');
            await connection.query('DROP TABLE IF EXISTS tracking_logs');
            await connection.query('DROP TABLE IF EXISTS cron_logs');
            await connection.query('DROP TABLE IF EXISTS orders');
            await connection.query('DROP TABLE IF EXISTS jobs');
            await connection.query('DROP TABLE IF EXISTS migrations');
            await connection.query('SET FOREIGN_KEY_CHECKS = 1');
            
            // Recreate migrations table
            await connection.query(`
                CREATE TABLE migrations (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    version INT NOT NULL UNIQUE,
                    name VARCHAR(255) NOT NULL,
                    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_version (version)
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
        
        // Show table summary
        const [tables] = await connection.query(`
            SELECT TABLE_NAME, TABLE_ROWS, 
                   ROUND(DATA_LENGTH/1024/1024, 2) as SIZE_MB
            FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME NOT IN ('migrations')
            ORDER BY TABLE_NAME
        `);
        
        logger.info('📊 Database tables:');
        tables.forEach(table => {
            logger.info(`   - ${table.TABLE_NAME}: ${table.TABLE_ROWS} rows, ${table.SIZE_MB} MB`);
        });
        
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