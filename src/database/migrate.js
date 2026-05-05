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
                    'pending',           -- Đang xử lý
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
                erp_status VARCHAR(50) DEFAULT 'Đang xử lý' COMMENT 'Trạng thái trong ERP',
                erp_updated BOOLEAN DEFAULT FALSE COMMENT 'Đã cập nhật ERP',
                erp_tracking_number_updated BOOLEAN DEFAULT FALSE COMMENT 'Đã cập nhật ERP',
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
                INDEX idx_status_started (started_at),
                INDEX idx_status_erp_updated (status, erp_updated),
                INDEX idx_status_erp_tracking_number_updated (status, erp_tracking_number_updated),
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
    },
    {
        version: 7,
        name: 'create_sessions_table',
        up: `
            CREATE TABLE IF NOT EXISTS sessions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                
                session_key VARCHAR(100) UNIQUE NOT NULL COMMENT 'Key định danh session',
                session_type VARCHAR(50) NOT NULL DEFAULT 'ecount' COMMENT 'Loại session',
                
                cookies JSON NOT NULL COMMENT 'Browser cookies',
                url_params JSON COMMENT 'URL parameters',
                metadata JSON COMMENT 'Metadata khác',
                
                expires_at TIMESTAMP NOT NULL COMMENT 'Thời gian hết hạn',
                
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                
                INDEX idx_session_key (session_key),
                INDEX idx_session_type (session_type),
                INDEX idx_expires_at (expires_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='Bảng lưu trữ sessions';
        `
    },
    {
        version: 8,
        name: 'add_label_access_key_to_orders',
        up: `
            ALTER TABLE orders 
            ADD COLUMN label_access_key VARCHAR(32) UNIQUE COMMENT 'Key vĩnh viễn để truy cập label URL' AFTER label_url,
            ADD INDEX idx_label_access_key (label_access_key);
        `
    },
    {
        version: 9,
        name: 'update_orders_status_columns',
        up: `
            ALTER TABLE orders 
            MODIFY COLUMN status ENUM(
                'new',
                'scheduled',
                'received',
                'shipped',
                'deleted',
                'warning',
                'pending',
                'created',
                'in_transit',
                'out_for_delivery',
                'delivered',
                'exception',
                'returned',
                'cancelled',
                'failed'
            ) NOT NULL DEFAULT 'pending' COMMENT 'Trạng thái đơn hàng',
            ADD COLUMN order_status ENUM('T','C','S','R','D','F','Q','P','V') 
                NOT NULL DEFAULT 'T' 
                COMMENT 'Trạng thái đơn hàng ERP (T=Đang xử lý, C=Đã hủy, S=Đã gửi, R=Đã nhận, D=Đã giao, F=Thất bại, Q=Chờ xác nhận, P=Đang đóng gói, V=Đã xác minh)' 
                AFTER status,
            ADD INDEX idx_order_status (order_status);
        `
    },
    {
        version: 10,
        name: 'add_last_tracking_check_at_to_orders',
        up: `
            ALTER TABLE orders 
            ADD COLUMN last_tracking_check_at TIMESTAMP NULL 
                COMMENT 'Lần check tracking cuối cùng' 
                AFTER last_tracked_at,
            ADD INDEX idx_last_tracking_check_at (last_tracking_check_at);
        `
    },
    {
        version: 11,
        name: 'add_last_status_check_at_to_orders',
        up: `
            ALTER TABLE orders 
            ADD COLUMN last_status_check_at TIMESTAMP NULL 
                COMMENT 'Lần check status cuối cùng' 
                AFTER last_tracking_check_at,
            ADD INDEX idx_last_status_check_at (last_status_check_at);
        `
    },
    {
        version: 12,
        name: 'create_tracking_checkpoints_table',
        up: `
            CREATE TABLE IF NOT EXISTS tracking_checkpoints (
                id INT AUTO_INCREMENT PRIMARY KEY,
                order_id INT NOT NULL,
                tracking_number VARCHAR(100) NOT NULL,
                
                thg_received_at TIMESTAMP NULL COMMENT 'THG nhận hàng',
                carrier_received_at TIMESTAMP NULL COMMENT 'Carrier nhận và scan',
                customs_start_at TIMESTAMP NULL COMMENT 'Bắt đầu kiểm hóa',
                customs_completed_at TIMESTAMP NULL COMMENT 'Hoàn tất kiểm hóa',
                clearance_completed_at TIMESTAMP NULL COMMENT 'Clearance processing completed',
                usps_received_at TIMESTAMP NULL COMMENT 'USPS nhận hàng',
                out_for_delivery_at TIMESTAMP NULL COMMENT 'Đang giao hàng',
                delivered_at TIMESTAMP NULL COMMENT 'Đã giao hàng',
                
                last_warning_stage VARCHAR(255) NULL COMMENT 'Warning key cuối cùng (unique per event)',
                last_warning_at TIMESTAMP NULL COMMENT 'DEPRECATED - Không dùng nữa',
                warning_count INT DEFAULT 0 COMMENT 'Tổng số lần warning',
                
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                
                FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
                INDEX idx_tracking_number (tracking_number),
                INDEX idx_order_id (order_id),
                INDEX idx_last_warning_stage (last_warning_stage)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='Bảng tracking checkpoints và warnings';
        `
    },
    {
        version: 13,
        name: 'add_performance_indexes',
        up: `
            -- Index cho resetStuckJobs query
            ALTER TABLE jobs 
            ADD INDEX idx_status_started_processing (status, started_at) 
            COMMENT 'For resetStuckJobs query';
        `
    },
    {
        version: 14,
        name: 'idx_jobtype_status_available',
        up: `
            -- Index cho getNextJobs query  
            ALTER TABLE jobs 
            ADD INDEX idx_jobtype_status_available (job_type, status, available_at, attempts)
            COMMENT 'For job queue processing';
        `
    },
    {
        version: 15,
        name: 'idx_tracking_check',
        up: `
            -- Index cho fetch-tracking cron
            ALTER TABLE orders 
            ADD INDEX idx_tracking_check (
                last_tracking_check_at, 
                status, 
                order_status, 
                product_code(50)
            ) COMMENT 'For fetch-tracking cron';
        `
    },
    {
        version: 16,
        name: 'idx_status_check',
        up: `
            -- Index cho update-status cron
            ALTER TABLE orders 
            ADD INDEX idx_status_check (
                last_status_check_at,
                status,
                order_status,
                waybill_number(50)
            ) COMMENT 'For update-status cron';
        `
    },
    {
        version: 17,
        name: 'idx_erp_orders',
        up: `
            -- Index cho ERP orders lookup
            ALTER TABLE orders
            ADD INDEX idx_erp_orders (
                erp_order_code,
                created_at DESC,
                status,
                order_status
            ) COMMENT 'For finding latest orders by ERP code';
        `
    },
    {
        version: 18,
        name: 'idx_tracking_lookup',
        up: `
            -- Index cho tracking/waybill lookup
            ALTER TABLE orders
            ADD INDEX idx_tracking_lookup (tracking_number(50))
            COMMENT 'For tracking number search';
        `
    },
    {
        version: 19,
        name: 'idx_waybill_lookup',
        up: `
            ALTER TABLE orders  
            ADD INDEX idx_waybill_lookup (waybill_number(50))
            COMMENT 'For waybill number search';
        `
    },
    {
        version: 20,
        name: 'add_partner_info_to_orders',
        up: `
            ALTER TABLE orders
            ADD COLUMN partner_id VARCHAR(100) 
                COMMENT 'ID Khách hàng / Nhà cung cấp (ERP/ECount)' 
                AFTER erp_order_code,
            ADD COLUMN partner_name VARCHAR(255) 
                COMMENT 'Tên Khách hàng / Nhà cung cấp' 
                AFTER partner_id,
            ADD INDEX idx_partner_id (partner_id),
            ADD INDEX idx_partner_name (partner_name);
        `
    },
    {
        version: 21,
        name: 'create_api_customers_table',
        up: `
            CREATE TABLE IF NOT EXISTS api_customers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                customer_code VARCHAR(50) UNIQUE NOT NULL COMMENT 'Mã khách hàng THG (CUS0001)',
                customer_name VARCHAR(255) NOT NULL,
                email VARCHAR(255),
                phone VARCHAR(50),
                
                -- Environment separation
                environment ENUM('production', 'sandbox') DEFAULT 'production',
                
                -- Status
                status ENUM('active', 'suspended', 'inactive') DEFAULT 'active',
                
                -- Rate limiting
                rate_limit_per_hour INT DEFAULT 6000,
                rate_limit_per_day INT DEFAULT 10000,
                max_consecutive_errors INT DEFAULT 30,
                
                -- Features
                webhook_enabled BOOLEAN DEFAULT TRUE,
                bulk_order_enabled BOOLEAN DEFAULT TRUE,
                max_bulk_orders INT DEFAULT 100,
                
                -- Metadata
                metadata JSON COMMENT 'Additional customer info',
                
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                
                INDEX idx_customer_code (customer_code),
                INDEX idx_status (status),
                INDEX idx_environment (environment)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='Bảng quản lý khách hàng API';
        `
    },
    {
        version: 22,
        name: 'create_api_credentials_table',
        up: `
            CREATE TABLE IF NOT EXISTS api_credentials (
                id INT AUTO_INCREMENT PRIMARY KEY,
                customer_id INT NOT NULL,
                
                -- OAuth-style credentials
                client_id VARCHAR(64) UNIQUE NOT NULL,
                client_secret_hash VARCHAR(255) NOT NULL COMMENT 'Hashed with bcrypt',
                
                -- Environment
                environment ENUM('production', 'sandbox') NOT NULL,
                
                -- Token settings
                access_token_ttl INT DEFAULT 3600 COMMENT 'Seconds (1 hour)',
                refresh_token_ttl INT DEFAULT 2592000 COMMENT 'Seconds (30 days)',
                
                -- Status
                status ENUM('active', 'revoked') DEFAULT 'active',
                
                -- Metadata
                last_used_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                revoked_at TIMESTAMP NULL,
                revoked_reason TEXT,
                
                FOREIGN KEY (customer_id) REFERENCES api_customers(id) ON DELETE CASCADE,
                INDEX idx_client_id (client_id),
                INDEX idx_customer_env (customer_id, environment),
                INDEX idx_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            COMMENT='Bảng lưu trữ Client ID và Secret';
        `
    },
    {
        version: 23,
        name: 'create_api_access_tokens_table',
        up: `
            CREATE TABLE IF NOT EXISTS api_access_tokens (
                id INT AUTO_INCREMENT PRIMARY KEY,
                credential_id INT NOT NULL,
                customer_id INT NOT NULL,
                
                -- Tokens
                access_token VARCHAR(512) UNIQUE NOT NULL,
                refresh_token VARCHAR(512) UNIQUE,
                
                -- Expiry
                expires_at TIMESTAMP NOT NULL,
                refresh_expires_at TIMESTAMP NULL,
                
                -- Status
                revoked BOOLEAN DEFAULT FALSE,
                revoked_at TIMESTAMP NULL,
                
                -- Metadata
                ip_address VARCHAR(45),
                user_agent TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_used_at TIMESTAMP NULL,
                
                FOREIGN KEY (credential_id) REFERENCES api_credentials(id) ON DELETE CASCADE,
                FOREIGN KEY (customer_id) REFERENCES api_customers(id) ON DELETE CASCADE,
                INDEX idx_access_token (access_token(255)),
                INDEX idx_refresh_token (refresh_token(255)),
                INDEX idx_expires_at (expires_at),
                INDEX idx_customer_active (customer_id, revoked, expires_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            COMMENT='Bảng lưu trữ Access và Refresh Tokens';
        `
    },
    {
        version: 24,
        name: 'create_api_rate_limits_table',
        up: `
            CREATE TABLE IF NOT EXISTS api_rate_limits (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                customer_id INT NOT NULL,
                
                -- Time window
                window_start TIMESTAMP NOT NULL,
                window_type ENUM('hourly', 'daily') NOT NULL,
                
                -- Counters
                request_count INT DEFAULT 0,
                error_count INT DEFAULT 0,
                success_count INT DEFAULT 0,
                
                -- Status
                limit_exceeded BOOLEAN DEFAULT FALSE,
                blocked_until TIMESTAMP NULL,
                
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                
                FOREIGN KEY (customer_id) REFERENCES api_customers(id) ON DELETE CASCADE,
                UNIQUE KEY idx_customer_window (customer_id, window_type, window_start),
                INDEX idx_window_start (window_start),
                INDEX idx_blocked (blocked_until)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            COMMENT='Bảng tracking rate limits';
        `
    },
    {
        version: 25,
        name: 'create_api_audit_logs_table',
        up: `
            CREATE TABLE IF NOT EXISTS api_audit_logs (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                customer_id INT,
                
                -- Request info
                request_id VARCHAR(64) UNIQUE NOT NULL,
                method VARCHAR(10) NOT NULL,
                endpoint VARCHAR(255) NOT NULL,
                
                -- Authentication
                client_id VARCHAR(64),
                access_token_suffix VARCHAR(16) COMMENT 'Last 16 chars for tracking',
                
                -- Request/Response
                request_headers JSON,
                request_body JSON,
                response_status INT,
                response_body JSON,
                
                -- Performance
                duration_ms INT,
                
                -- Client info
                ip_address VARCHAR(45),
                user_agent TEXT,
                
                -- Result
                success BOOLEAN,
                error_code VARCHAR(50),
                error_message TEXT,
                
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                FOREIGN KEY (customer_id) REFERENCES api_customers(id) ON DELETE SET NULL,
                INDEX idx_customer_id (customer_id),
                INDEX idx_request_id (request_id),
                INDEX idx_endpoint (endpoint),
                INDEX idx_created_at (created_at),
                INDEX idx_client_success (client_id, success, created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            COMMENT='Bảng audit logs cho API requests';
        `
    },
    {
        version: 26,
        name: 'add_detailed_order_fields',
        up: `
            ALTER TABLE orders
            ADD COLUMN receiver_address_line1 VARCHAR(500) 
                COMMENT 'Địa chỉ dòng 1' 
                AFTER receiver_postal_code,
            ADD COLUMN receiver_address_line2 VARCHAR(500) 
                COMMENT 'Địa chỉ dòng 2' 
                AFTER receiver_address_line1,

            ADD COLUMN declaration_items VARCHAR(500) 
                AFTER order_data,

            ADD COLUMN additional_service VARCHAR(100) 
                COMMENT 'Dịch vụ bổ sung (G0, G1...)' 
                AFTER product_code,

            ADD COLUMN warehouse_code VARCHAR(50) 
                COMMENT 'Mã kho hàng' 
                AFTER additional_service
        `
    },
    {
        version: 27,
        name: 'add_detailed_order_2_fields',
        up: `
            ALTER TABLE orders
            ADD COLUMN unit_weight VARCHAR(500)
                AFTER package_weight
        `
    },
    {
        version: 28,
        name: 'create_webhook_registrations_table',
        up: `
            CREATE TABLE IF NOT EXISTS webhook_registrations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                customer_id VARCHAR(100) NOT NULL COMMENT 'FK -> api_customers',

                url VARCHAR(2083) NOT NULL COMMENT 'Webhook endpoint URL',
                secret VARCHAR(255) NOT NULL COMMENT 'HMAC signing secret (hashed)',

                events JSON NOT NULL COMMENT 'Danh sach events subscribe: ["tracking.updated","order.status","order.exception"]',

                status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
                fail_count INT NOT NULL DEFAULT 0 COMMENT 'Consecutive failures',

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

                INDEX idx_customer_id (customer_id),
                INDEX idx_status (status),
                INDEX idx_customer_status (customer_id, status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='Bảng đăng ký webhooks của khách hàng API';
        `
    },
    {
        version: 29,
        name: 'create_webhook_delivery_logs_table',
        up: `
            CREATE TABLE IF NOT EXISTS webhook_delivery_logs (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                webhook_id INT NOT NULL COMMENT 'FK -> webhook_registrations',
                customer_id VARCHAR(100) NOT NULL,

                event VARCHAR(50) NOT NULL COMMENT 'Event type gửi',
                order_id INT COMMENT 'Order liên quan',

                payload JSON NOT NULL COMMENT 'Payload đã gửi',
                status ENUM('pending', 'success', 'failed') NOT NULL DEFAULT 'pending',
                http_status INT COMMENT 'HTTP status code từ endpoint',
                response_body TEXT COMMENT 'Response body từ endpoint',
                error_message TEXT,

                attempts INT NOT NULL DEFAULT 0,
                next_retry_at TIMESTAMP NULL COMMENT 'Thời gian retry tiếp theo',

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                delivered_at TIMESTAMP NULL,

                INDEX idx_webhook_id (webhook_id),
                INDEX idx_customer_id (customer_id),
                INDEX idx_status (status),
                INDEX idx_event (event),
                INDEX idx_order_id (order_id),
                INDEX idx_next_retry (status, next_retry_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='Log gửi webhook — retry queue + history';
        `
    },
    {
        version: 30,
        name: 'add_portal_password_to_api_customers',
        up: `
            ALTER TABLE api_customers
            ADD COLUMN portal_password_hash VARCHAR(255) NULL
                COMMENT 'bcrypt hash — khách hàng dùng để login trang chi tiết'
                AFTER metadata;
        `
    },

    {
        version: 31,
        name: 'create_admin_users_table',
        up: `
            CREATE TABLE IF NOT EXISTS admin_users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL COMMENT 'Username đăng nhập',
                password_hash VARCHAR(255) NOT NULL COMMENT 'bcrypt hash',
                full_name VARCHAR(100) COMMENT 'Họ tên đầy đủ',
                email VARCHAR(100) COMMENT 'Email liên hệ',
                status ENUM('active', 'inactive') DEFAULT 'active' COMMENT 'Trạng thái tài khoản',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_username (username),
                INDEX idx_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                COMMENT='Bảng quản trị viên — login vào dashboard với full quyền';
        `
    },

    {
        version: 32,
        name: 'add_client_secret_plain_to_api_credentials',
        up: `
            ALTER TABLE api_credentials
            ADD COLUMN client_secret_plain VARCHAR(255) NULL
                COMMENT 'Plaintext secret — chỉ lưu cho sandbox environment, production luôn NULL'
                AFTER client_secret_hash;
        `
    },
    {
        version: 33,
        name: 'add_telegram_config_to_api_customers',
        up: `
            ALTER TABLE api_customers
            ADD COLUMN telegram_responsibles VARCHAR(500) NULL
                COMMENT 'Danh sách Telegram tag người phụ trách, phân cách bởi dấu phẩy. VD: @user1,@user2'
                AFTER metadata,
            ADD COLUMN telegram_group_ids VARCHAR(500) NULL
                COMMENT 'Danh sách Telegram group chat ID riêng của customer, phân cách bởi dấu phẩy. VD: -100123456,-100789012'
                AFTER telegram_responsibles;
        `
    },

    {
        version: 34,
        name: 'add_pod_support_to_orders',
        up: `
            ALTER TABLE orders
                ADD COLUMN order_type ENUM('express', 'pod') NOT NULL DEFAULT 'express'
                    COMMENT 'Order type: express shipping or POD warehouse'
                    AFTER order_number,
                ADD COLUMN pod_warehouse VARCHAR(50) NULL
                    COMMENT 'POD warehouse code (ONOS, S2BDIY, PRINTPOSS)'
                    AFTER order_type,
                ADD COLUMN pod_warehouse_order_id VARCHAR(200) NULL
                    COMMENT 'Order ID in POD warehouse system'
                    AFTER pod_warehouse,
                ADD COLUMN pod_status VARCHAR(50) NULL
                    COMMENT 'Unified POD status'
                    AFTER pod_warehouse_order_id,
                ADD COLUMN pod_production_status VARCHAR(100) NULL
                    COMMENT 'Raw production status from warehouse'
                    AFTER pod_status,
                ADD COLUMN pod_items JSON NULL
                    COMMENT 'POD items: SKU, product_id, print_areas, design_urls'
                    AFTER pod_production_status,
                ADD COLUMN pod_shipping_method VARCHAR(100) NULL
                    COMMENT 'POD shipping method selected'
                    AFTER pod_items,
                ADD COLUMN pod_warehouse_response JSON NULL
                    COMMENT 'Full response from POD warehouse API'
                    AFTER pod_shipping_method,
                MODIFY COLUMN status ENUM(
                    'new', 'scheduled', 'received', 'shipped', 'deleted', 'warning',
                    'pending', 'created', 'in_transit', 'out_for_delivery', 'delivered',
                    'exception', 'returned', 'cancelled', 'failed',
                    'pod_pending', 'pod_in_production', 'pod_tracking_received',
                    'pod_shipped', 'pod_delivered', 'pod_cancelled', 'pod_on_hold', 'pod_error'
                ) NOT NULL DEFAULT 'pending' COMMENT 'Order status (Express + POD unified)',
                ADD INDEX idx_order_type (order_type),
                ADD INDEX idx_pod_warehouse (pod_warehouse),
                ADD INDEX idx_pod_status (pod_status),
                ADD INDEX idx_pod_warehouse_order_id (pod_warehouse_order_id);
        `
    },
    {
        version: 35,
        name: 'create_webhook_logs_table',
        up: `
            CREATE TABLE IF NOT EXISTS webhook_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                source VARCHAR(50) NOT NULL COMMENT 'Webhook source: ONOS, S2BDIY, PRINTPOSS',
                event VARCHAR(100) NULL COMMENT 'Event type: order.updated, shipment.events',
                method VARCHAR(10) NOT NULL DEFAULT 'POST',
                url VARCHAR(500) NULL COMMENT 'Request URL',
                headers JSON NULL COMMENT 'Request headers',
                body JSON NULL COMMENT 'Request body (full payload)',
                status_code INT NULL DEFAULT 200 COMMENT 'Response status code',
                response JSON NULL COMMENT 'Response sent back',
                order_id INT NULL COMMENT 'Matched order ID in our system',
                pod_warehouse_order_id VARCHAR(200) NULL COMMENT 'Order ID from warehouse',
                processing_result VARCHAR(50) NULL COMMENT 'success, error, skipped, not_found',
                processing_error TEXT NULL COMMENT 'Error message if failed',
                ip_address VARCHAR(50) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_source (source),
                INDEX idx_event (event),
                INDEX idx_order_id (order_id),
                INDEX idx_pod_warehouse_order_id (pod_warehouse_order_id),
                INDEX idx_created_at (created_at),
                INDEX idx_processing_result (processing_result)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `
    },
    {
        version: 36,
        name: 'create_pod_products_table',
        up: `
            CREATE TABLE IF NOT EXISTS pod_products (
                id INT AUTO_INCREMENT PRIMARY KEY,
                pod_warehouse VARCHAR(50) NOT NULL COMMENT 'ONOS, PRINTPOSS, S2BDIY',
                item_name VARCHAR(255) NOT NULL,
                warehouse_sku VARCHAR(100) NOT NULL COMMENT 'SKU gốc warehouse (3DSHIRT-AS-DESIGN-S)',
                product_color VARCHAR(100) NULL,
                size VARCHAR(20) NULL,
                weight DECIMAL(10,2) NULL,
                length DECIMAL(10,2) NULL,
                width DECIMAL(10,2) NULL,
                height DECIMAL(10,2) NULL,
                gross_price DECIMAL(10,2) NULL,
                product_group VARCHAR(100) NULL COMMENT 'Nhóm sản phẩm: T-shirt, Mug, ...',
                sku_key VARCHAR(50) NULL COMMENT 'Key of SKU: 3DSHIRT',
                thg_sku_sbsl VARCHAR(100) NULL COMMENT 'THG SKU cho SBSL (1-3DSHIRT-S)',
                thg_sku_sbtt VARCHAR(100) NULL COMMENT 'THG SKU cho SBTT (2-3DSHIRT-S)',
                thg_price_sbsl DECIMAL(10,2) NULL,
                thg_price_sbtt DECIMAL(10,2) NULL,
                us_import_tax_unit DECIMAL(10,4) NULL,
                customs_fee_order DECIMAL(10,4) NULL,
                metadata JSON NULL COMMENT 'Dữ liệu riêng warehouse (ONOS: cw_sbsl, code_sbsl, sf_sbsl...)',
                status ENUM('active','inactive') NOT NULL DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE INDEX idx_warehouse_sku (pod_warehouse, warehouse_sku),
                INDEX idx_pod_warehouse (pod_warehouse),
                INDEX idx_thg_sku_sbsl (thg_sku_sbsl),
                INDEX idx_thg_sku_sbtt (thg_sku_sbtt),
                INDEX idx_sku_key (sku_key),
                INDEX idx_product_group (product_group),
                INDEX idx_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `
    },
    {
        version: 37,
        name: 'add_missing_pod_status_enum_values',
        up: `
            ALTER TABLE orders
                MODIFY COLUMN status ENUM(
                    'new', 'scheduled', 'received', 'shipped', 'deleted', 'warning',
                    'pending', 'created', 'in_transit', 'out_for_delivery', 'delivered',
                    'exception', 'returned', 'cancelled', 'failed',
                    'pod_pending', 'pod_processing', 'pod_in_production',
                    'pod_fulfilled', 'pod_completed', 'pod_refunded',
                    'pod_tracking_received', 'pod_shipped', 'pod_delivered',
                    'pod_cancelled', 'pod_on_hold', 'pod_error'
                ) NOT NULL DEFAULT 'pending' COMMENT 'Order status (Express + POD unified)';
        `
    },
    {
        version: 38,
        name: 'add_warehouse_id_to_pod_products',
        up: `
            ALTER TABLE pod_products
                ADD COLUMN warehouse_id VARCHAR(100) NULL COMMENT 'ID sản phẩm trên warehouse (PrintPoss variant_id)' AFTER warehouse_sku,
                ADD INDEX idx_warehouse_id (warehouse_id);
        `
    },
    {
        version: 39,
        name: 'add_lark_group_ids_to_api_customers',
        up: `
            ALTER TABLE api_customers
                ADD COLUMN lark_group_ids VARCHAR(500) NULL COMMENT 'Lark group chat IDs (comma-separated)' AFTER telegram_group_ids;
        `
    },
    {
        version: 40,
        name: 'create_url_proxies_table',
        up: `
            CREATE TABLE IF NOT EXISTS url_proxies (
                id INT AUTO_INCREMENT PRIMARY KEY,
                access_key VARCHAR(32) NOT NULL UNIQUE,
                original_url TEXT NOT NULL COMMENT 'URL gốc (dài)',
                url_type ENUM('label', 'mockup', 'design') NOT NULL COMMENT 'Loại URL',
                order_id INT NULL COMMENT 'Liên kết với order (optional)',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_access_key (access_key),
                INDEX idx_order_id (order_id),
                INDEX idx_url_type (url_type)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='Bảng proxy URL ngắn cho mockup/design/label';
        `
    },
    {
        version: 41,
        name: 'add_oms_config_to_api_customers',
        up: `
            ALTER TABLE api_customers
                ADD COLUMN oms_realm VARCHAR(100) NULL
                    COMMENT 'OMS auth realm/tenant identifier'
                    AFTER lark_group_ids,
                ADD COLUMN oms_client_id VARCHAR(255) NULL
                    COMMENT 'OMS OAuth client_id (this system -> customer OMS, NOT same as api_credentials.client_id)'
                    AFTER oms_realm,
                ADD COLUMN oms_client_secret VARCHAR(500) NULL
                    COMMENT 'OMS OAuth client_secret — stored as-is; encrypt at app layer if required by security policy'
                    AFTER oms_client_id,
                ADD COLUMN oms_url_auth VARCHAR(500) NULL
                    COMMENT 'OMS OAuth token endpoint URL'
                    AFTER oms_client_secret,
                ADD COLUMN oms_url_api VARCHAR(500) NULL
                    COMMENT 'OMS API base URL'
                    AFTER oms_url_auth,
                ADD COLUMN shipping_markup_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00
                    COMMENT 'Shipping cost markup percent applied to OMS orders (0.00–100.00)'
                    AFTER oms_url_api,
                ADD INDEX idx_oms_client_id (oms_client_id);
        `
    },
    {
        version: 42,
        name: 'create_oms_access_tokens_table',
        up: `
            CREATE TABLE IF NOT EXISTS oms_access_tokens (
                id INT AUTO_INCREMENT PRIMARY KEY,
                customer_id INT NOT NULL,
                access_token VARCHAR(2048) NOT NULL COMMENT 'OMS-issued bearer token',
                token_type VARCHAR(50) NOT NULL DEFAULT 'Bearer',
                scope VARCHAR(500) NULL,
                expires_at TIMESTAMP NOT NULL COMMENT 'Token expiry (absolute timestamp)',
                credential_fingerprint VARCHAR(64) NOT NULL COMMENT 'sha256(realm|client_id|client_secret) — token auto-invalidated when creds rotate',
                refreshed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

                FOREIGN KEY (customer_id) REFERENCES api_customers(id) ON DELETE CASCADE,
                UNIQUE KEY uk_customer_id (customer_id),
                INDEX idx_expires_at (expires_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='Cache OAuth2 client_credentials tokens for OMS calls — one token per customer';
        `
    },
    {
        version: 43,
        name: 'create_oms_orders_table',
        up: `
            CREATE TABLE IF NOT EXISTS oms_orders (
                id INT AUTO_INCREMENT PRIMARY KEY,

                -- ─── Identity / multi-tenancy ────────────────────────
                order_number VARCHAR(100) NOT NULL UNIQUE COMMENT 'Internal ID format: OMS{ts}{rand4}',
                customer_id INT NOT NULL,
                customer_order_number VARCHAR(100) NULL,
                platform_order_number VARCHAR(100) NULL,

                -- ─── OMS source ──────────────────────────────────────
                oms_order_id VARCHAR(200) NOT NULL COMMENT 'Source order id from customer OMS',
                oms_order_number VARCHAR(200) NULL,
                oms_status VARCHAR(50) NULL,
                oms_created_at TIMESTAMP NULL,
                oms_updated_at TIMESTAMP NULL,
                last_oms_synced_at TIMESTAMP NULL COMMENT 'Last successful pull from OMS for this row',

                -- ─── Receiver (column names mirror orders.receiver_*) ──
                receiver_name VARCHAR(200) NULL,
                receiver_phone VARCHAR(50) NULL,
                receiver_email VARCHAR(100) NULL,
                receiver_country VARCHAR(2) NULL,
                receiver_state VARCHAR(100) NULL,
                receiver_city VARCHAR(100) NULL,
                receiver_postal_code VARCHAR(20) NULL,
                receiver_address_line1 VARCHAR(500) NULL,
                receiver_address_line2 VARCHAR(500) NULL,

                -- ─── Package / declaration ───────────────────────────
                package_weight DECIMAL(10,3) NULL,
                package_length DECIMAL(10,3) NULL,
                package_width DECIMAL(10,3) NULL,
                package_height DECIMAL(10,3) NULL,
                weight_unit VARCHAR(10) DEFAULT 'KG',
                size_unit VARCHAR(10) DEFAULT 'CM',
                declared_value DECIMAL(12,2) NULL COMMENT 'Per-order OMS price (declaration value)',
                declared_currency VARCHAR(3) DEFAULT 'USD',

                items JSON NULL COMMENT 'Line items array (mirrors orders.declaration_items concept)',

                -- ─── ITC label fields (Phase 5 will populate) ────────
                carrier VARCHAR(50) NULL,
                product_code VARCHAR(50) NULL,
                tracking_number VARCHAR(100) NULL COMMENT 'ITC barcode',
                waybill_number VARCHAR(100) NULL,
                label_url TEXT NULL,
                label_access_key VARCHAR(32) NULL UNIQUE COMMENT 'Permanent key for url_proxies lookup',
                itc_sid VARCHAR(200) NULL COMMENT 'ITC sid — used to fetch label',
                itc_response JSON NULL COMMENT 'Last ITC API response (for audit)',

                -- ─── Pricing (Phase 7) ───────────────────────────────
                shipping_cost DECIMAL(12,4) NULL COMMENT 'Raw cost from ITC (usd)',
                shipping_markup_percent DECIMAL(5,2) NULL COMMENT 'Snapshot of markup applied at purchase time',
                shipping_cost_charged DECIMAL(12,4) NULL COMMENT 'cost * (1 + markup/100)',
                cost_currency VARCHAR(3) DEFAULT 'USD',

                -- ─── Internal lifecycle (separate from orders.status) ──
                internal_status ENUM(
                    'pending',          -- newly synced from OMS, awaiting admin
                    'selected',         -- admin selected for label purchase
                    'label_purchased',  -- ITC returned barcode
                    'oms_updated',      -- tracking pushed back to OMS
                    'shipped',
                    'delivered',
                    'cancelled',
                    'failed',
                    'error'
                ) NOT NULL DEFAULT 'pending',
                internal_status_note TEXT NULL,

                -- ─── Editable-overlay tracking ───────────────────────
                admin_edited_at TIMESTAMP NULL COMMENT 'Set on admin edit; resyncs preserve editable columns after this',
                admin_edited_by VARCHAR(100) NULL,

                -- ─── Raw payloads ────────────────────────────────────
                raw_data JSON NULL COMMENT 'Full normalized OMS payload — overwritten on every sync (audit + fallback mapping)',
                editable_data JSON NULL COMMENT 'Optional structured admin overrides (Phase 8 may use)',

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

                FOREIGN KEY (customer_id) REFERENCES api_customers(id) ON DELETE CASCADE,
                UNIQUE KEY uk_customer_oms_order (customer_id, oms_order_id),
                INDEX idx_customer_status (customer_id, internal_status),
                INDEX idx_internal_status (internal_status, created_at),
                INDEX idx_tracking_number (tracking_number),
                INDEX idx_last_synced (last_oms_synced_at),
                INDEX idx_oms_status (oms_status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='OMS orders — fully isolated from orders table; existing crons cannot see these rows';
        `
    },
    {
        version: 44,
        name: 'add_label_purchasing_to_oms_orders_status',
        up: `
            ALTER TABLE oms_orders
                MODIFY COLUMN internal_status ENUM(
                    'pending', 'selected',
                    'label_purchasing',
                    'label_purchased', 'oms_updated',
                    'shipped', 'delivered', 'cancelled', 'failed', 'error'
                ) NOT NULL DEFAULT 'pending'
                COMMENT 'OMS-only lifecycle. label_purchasing = ITC call in flight (row claimed, not finalized)';
        `
    },
    {
        version: 45,
        name: 'rename_pricing_columns_and_add_fulfillment_and_profit',
        up: `
            ALTER TABLE oms_orders
                CHANGE COLUMN shipping_cost shipping_fee_purchase DECIMAL(12,4) NULL
                    COMMENT 'Phase 7: raw ITC cost (readonly source of truth)',
                CHANGE COLUMN shipping_cost_charged shipping_fee_selling DECIMAL(12,4) NULL
                    COMMENT 'Phase 7: shipping fee charged to customer (editable)',
                ADD COLUMN fulfillment_fee_purchase DECIMAL(12,4) NULL
                    COMMENT 'Phase 7: our fulfillment cost (optional, editable)'
                    AFTER shipping_fee_selling,
                ADD COLUMN fulfillment_fee_selling DECIMAL(12,4) NULL
                    COMMENT 'Phase 7: fulfillment fee charged to customer (optional, editable)'
                    AFTER fulfillment_fee_purchase,
                ADD COLUMN gross_profit DECIMAL(12,4) NULL
                    COMMENT 'Phase 7: auto = (shipping_selling + fulfillment_selling||0) - (shipping_purchase + fulfillment_purchase||0)'
                    AFTER fulfillment_fee_selling,
                ADD COLUMN pricing_edited_at TIMESTAMP NULL
                    COMMENT 'Last admin pricing edit (separate from admin_edited_at which gates OMS resync)'
                    AFTER gross_profit,
                ADD COLUMN pricing_edited_by VARCHAR(100) NULL
                    AFTER pricing_edited_at;
        `
    },
    {
        version: 46,
        name: 'create_oms_tracking_logs_table',
        up: `
            CREATE TABLE IF NOT EXISTS oms_tracking_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                oms_order_id INT NOT NULL,
                tracking_number VARCHAR(100) NOT NULL,
                carrier VARCHAR(50) NULL,

                status VARCHAR(50) NULL COMMENT 'Event status from ITC',
                event_code VARCHAR(100) NULL,
                location VARCHAR(255) NULL,
                description TEXT NULL,

                tracking_data JSON NULL COMMENT 'Raw event payload',

                event_time TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                FOREIGN KEY (oms_order_id) REFERENCES oms_orders(id) ON DELETE CASCADE,
                UNIQUE KEY uk_event_dedup (oms_order_id, event_time, event_code, status),
                INDEX idx_oms_order_id (oms_order_id),
                INDEX idx_tracking_number (tracking_number),
                INDEX idx_event_time (event_time),
                INDEX idx_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='Phase 9: per-event ITC tracking history. Parallels tracking_logs but FK to oms_orders.';
        `
    },
    {
        version: 47,
        name: 'create_oms_tracking_checkpoints_table',
        up: `
            CREATE TABLE IF NOT EXISTS oms_tracking_checkpoints (
                id INT AUTO_INCREMENT PRIMARY KEY,
                oms_order_id INT NOT NULL,
                tracking_number VARCHAR(100) NOT NULL,

                in_transit_at TIMESTAMP NULL,
                out_for_delivery_at TIMESTAMP NULL,
                delivered_at TIMESTAMP NULL,
                exception_at TIMESTAMP NULL,
                exception_note TEXT NULL,

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

                FOREIGN KEY (oms_order_id) REFERENCES oms_orders(id) ON DELETE CASCADE,
                UNIQUE KEY uk_oms_order_id (oms_order_id),
                INDEX idx_tracking_number (tracking_number)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='Phase 9: one row per OMS order — milestone timestamps. Parallels tracking_checkpoints.';
        `
    },
    {
        version: 48,
        name: 'add_tracking_throttle_columns_to_oms_orders',
        up: `
            ALTER TABLE oms_orders
                ADD COLUMN last_tracking_check_at TIMESTAMP NULL
                    COMMENT 'Last attempt to poll ITC tracking (set every cron tick)'
                    AFTER updated_at,
                ADD COLUMN last_tracked_at TIMESTAMP NULL
                    COMMENT 'Last successful tracking refresh that yielded events'
                    AFTER last_tracking_check_at,
                ADD INDEX idx_oms_tracking_poll (last_tracking_check_at, internal_status, tracking_number(50))
                    COMMENT 'Used by oms-fetch-tracking cron for the polling sweep';
        `
    },
    {
        version: 49,
        name: 'add_shipping_service_to_oms_orders',
        up: `
            ALTER TABLE oms_orders
                ADD COLUMN oms_shipping_service_name VARCHAR(100) NULL
                    COMMENT 'shippingServiceName từ OMS detail API (Standard USPS, Priority USPS...)'
                    AFTER oms_status,
                ADD COLUMN oms_shipping_partner ENUM('USPS-LABEL', 'USPS-PRIORITY-LABEL') NULL
                    COMMENT 'Shipping partner mapped từ shippingServiceName — NULL nếu không mua qua ITC'
                    AFTER oms_shipping_service_name,
                ADD INDEX idx_oms_shipping_partner (oms_shipping_partner);
        `
    },
    {
        version: 50,
        name: 'create_oms_packaging_materials_table',
        up: `
            CREATE TABLE IF NOT EXISTS oms_packaging_materials (
                id          INT AUTO_INCREMENT PRIMARY KEY,
                name        VARCHAR(255) NOT NULL,
                description TEXT DEFAULT NULL,
                cost_price  DECIMAL(10,4) DEFAULT NULL COMMENT 'Giá cost — sẽ tính sau, hiện chưa dùng',
                sell_price  DECIMAL(10,4) NOT NULL COMMENT 'Giá tính vào selling',
                is_active   TINYINT(1) NOT NULL DEFAULT 1,
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_is_active (is_active)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='Danh mục vật liệu đóng gói cho OMS (poly mailer, hộp carton...)';
        `
    },
    {
        version: 51,
        name: 'create_oms_sku_packaging_mapping_table',
        up: `
            CREATE TABLE IF NOT EXISTS oms_sku_packaging_mapping (
                id          INT AUTO_INCREMENT PRIMARY KEY,
                sku         VARCHAR(255) NOT NULL,
                material_id INT NOT NULL,
                customer_id INT DEFAULT NULL COMMENT 'NULL = áp dụng cho mọi customer',
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (material_id) REFERENCES oms_packaging_materials(id) ON DELETE CASCADE,
                FOREIGN KEY (customer_id) REFERENCES api_customers(id) ON DELETE CASCADE,
                UNIQUE KEY uq_sku_customer (sku, customer_id),
                INDEX idx_sku (sku),
                INDEX idx_customer_id (customer_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='Map SKU → vật liệu đóng gói. customer_id=NULL là default cho mọi customer.';
        `
    },
    {
        version: 52,
        name: 'add_pricing_columns_to_oms_orders',
        up: `
            ALTER TABLE oms_orders
                ADD COLUMN fulfillment_fee_detail JSON DEFAULT NULL
                    COMMENT 'Audit JSON: { heaviest_weight_gram, heaviest_weight_lbs, bracket, base_rate, total_items, extra_items, extra_fee }'
                    AFTER fulfillment_fee_selling,
                ADD COLUMN packaging_material_fee_selling DECIMAL(10,4) DEFAULT NULL
                    COMMENT 'Tổng phí vật liệu đóng gói tính vào selling'
                    AFTER fulfillment_fee_detail,
                ADD COLUMN packaging_material_fee_detail JSON DEFAULT NULL
                    COMMENT 'Audit JSON array: [{ sku, material_id, material_name, sell_price, quantity, subtotal }]'
                    AFTER packaging_material_fee_selling,
                ADD COLUMN additional_fee DECIMAL(10,4) DEFAULT NULL
                    COMMENT 'Phụ phí nhập tay — âm hoặc dương'
                    AFTER packaging_material_fee_detail,
                ADD COLUMN additional_fee_note TEXT DEFAULT NULL
                    COMMENT 'Ghi chú phụ phí'
                    AFTER additional_fee,
                ADD COLUMN needs_manual_pricing TINYINT(1) NOT NULL DEFAULT 0
                    COMMENT 'TRUE khi không tự động tính được fulfillment (>10 lbs hoặc weight thiếu)'
                    AFTER additional_fee_note;
        `
    }

];

async function runMigrations(fresh = false) {
    let connection;
    
    try {
        connection = await db.getConnection();
        
        logger.info('Starting database migration...');
        
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
            logger.warn('Running fresh migration - dropping all tables...');
            await connection.query('SET FOREIGN_KEY_CHECKS = 0');
            await connection.query('DROP TABLE IF EXISTS api_logs');
            await connection.query('DROP TABLE IF EXISTS carrier_labels');
            await connection.query('DROP TABLE IF EXISTS tracking_logs');
            await connection.query('DROP TABLE IF EXISTS cron_logs');
            await connection.query('DROP TABLE IF EXISTS orders');
            await connection.query('DROP TABLE IF EXISTS jobs');
            await connection.query('DROP TABLE IF EXISTS sessions');
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
                logger.info(`Running migration ${migration.version}: ${migration.name}`);
                
                await connection.query(migration.up);
                await connection.query(
                    'INSERT INTO migrations (version, name) VALUES (?, ?)',
                    [migration.version, migration.name]
                );
                
                logger.info(`Migration ${migration.version} completed`);
            } else {
                logger.info(`Migration ${migration.version} already executed`);
            }
        }
        
        logger.info('All migrations completed successfully!');
        
        // Show table summary
        const [tables] = await connection.query(`
            SELECT TABLE_NAME, TABLE_ROWS, 
                   ROUND(DATA_LENGTH/1024/1024, 2) as SIZE_MB
            FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME NOT IN ('migrations')
            ORDER BY TABLE_NAME
        `);
        
        logger.info('Database tables:');
        tables.forEach(table => {
            logger.info(`   - ${table.TABLE_NAME}: ${table.TABLE_ROWS} rows, ${table.SIZE_MB} MB`);
        });
        
    } catch (error) {
        logger.error('Migration failed:', error);
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
            logger.info('Migration script finished');
            process.exit(0);
        })
        .catch((error) => {
            logger.error('Migration script failed:', error);
            process.exit(1);
        });
}

module.exports = { runMigrations };