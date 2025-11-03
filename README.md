# YunExpress Integration API

API tích hợp đa nhà vận chuyển với tự động hóa ERP (ECount) và tracking tự động.

## 🚀 Tính năng

- ✅ Tích hợp đa nhà vận chuyển (YunExpress, dễ dàng mở rộng)
- ✅ Tự động cập nhật tracking vào ERP (ECount) qua Puppeteer
- ✅ Lưu trữ đơn hàng trong MySQL database
- ✅ Tracking tự động theo lịch (cron job)
- ✅ Tự động cập nhật ERP khi đơn hàng delivered
- ✅ RESTful API để bên thứ 3 gọi vào
- ✅ Validation dữ liệu đầy đủ
- ✅ Logging chi tiết
- ✅ Kiến trúc module hóa

## 📋 Yêu cầu

- Node.js >= 16.x
- MySQL >= 5.7 hoặc MariaDB >= 10.2
- NPM hoặc Yarn

## 🔧 Cài đặt

### 1. Clone và install dependencies
```bash
git clone <repository-url>
cd yun-express-integration
npm install
```

### 2. Setup database
```bash
# Tạo database
mysql -u root -p
CREATE DATABASE yunexpress_integration CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
exit;
```

### 3. Configure environment
```bash
cp .env.example .env
# Sửa thông tin trong .env
```

### 4. Run migrations
```bash
# Run migrations
npm run migrate

# Hoặc fresh migration (xóa toàn bộ data)
npm run migrate:fresh
```

## 🏃 Chạy ứng dụng
```bash
# Development mode (with auto-restart)
npm run dev

# Production mode
npm start

# Run cron job riêng (optional)
npm run cron
```

## 📡 API Endpoints

### 1. Health Check
```http
GET /health
```

### 2. Get Available Carriers
```http
GET /api/orders/carriers
```

### 3. Create Order (Full Flow) - Từ Extension
```http
POST /api/orders
Content-Type: application/json
```

**Request body:**
```json
{
  "carrier": "YUNEXPRESS",
  "productCode": "S1002",
  "packages": [
    {
      "length": 10,
      "width": 10,
      "height": 10,
      "weight": 0.5
    }
  ],
  "receiver": {
    "firstName": "Nguyen",
    "lastName": "Van A",
    "countryCode": "VN",
    "city": "Ho Chi Minh",
    "addressLines": ["123 Le Loi Street"],
    "postalCode": "700000",
    "phoneNumber": "+84901234567"
  },
  "erpOrderCode": "THG-EX-000011",
  "erpStatus": "Đã hoàn tất",
  "ecountLink": "#menuType=MENUTREE_000004&menuSeq=MENUTREE_000030&groupSeq=MENUTREE_000030&prgId=C000030"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Order processed successfully",
  "data": {
    "orderId": 123,
    "orderNumber": "ORD169900000012345",
    "trackingNumber": "YT2024110300001",
    "carrier": "YUNEXPRESS",
    "erpUpdated": true,
    "ecountLink": "#menuType=..."
  }
}
```

### 4. Get Order Info
```http
GET /api/orders/:orderId
```

### 5. Get Statistics
```http
GET /api/orders/statistics
```

## 🤖 Cron Job - Tracking Tự Động

Cron job sẽ:
1. Tự động tracking orders có status: `pending`, `created`, `in_transit`
2. Cập nhật status vào database
3. Lưu tracking logs
4. Tự động cập nhật ERP khi order delivered

**Cấu hình trong .env:**
```env
CRON_TRACKING_ENABLED=true
CRON_TRACKING_SCHEDULE=*/30 * * * *  # Chạy mỗi 30 phút
CRON_UPDATE_ERP_ENABLED=true
```

**Schedule format (cron syntax):**
```
*/30 * * * *  # Mỗi 30 phút
0 */2 * * *   # Mỗi 2 giờ
0 9 * * *     # 9:00 AM mỗi ngày
```

## 📊 Database Schema

### Table: orders
```sql
- id (PK)
- order_number (unique)
- customer_order_number
- platform_order_number
- erp_order_code
- carrier
- product_code
- tracking_number
- status (pending, created, in_transit, delivered, cancelled, failed)
- erp_status
- erp_updated (boolean)
- ecount_link (TEXT) - Hash link từ ECount
- order_data (JSON)
- carrier_response (JSON)
- tracking_info (JSON)
- created_at, updated_at
- carrier_created_at, delivered_at
```

### Table: tracking_logs
```sql
- id (PK)
- order_id (FK)
- tracking_number
- carrier
- status
- location
- description
- tracking_data (JSON)
- event_time
- created_at
```

### Table: cron_logs
```sql
- id (PK)
- job_name
- status (started, completed, failed)
- orders_processed
- orders_success
- orders_failed
- error_message
- execution_time_ms
- started_at, completed_at
```

## 🔌 Luồng hoạt động

### 1. Extension gọi API tạo order
```
Extension (ECount) 
  → POST /api/orders (with ecountLink)
  → NodeJS tạo đơn YunExpress
  → Lưu vào MySQL
  → Puppeteer update ECount với ecountLink
  → Trả về tracking number
```

### 2. Cron tracking tự động
```
Cron Job (mỗi 30 phút)
  → Lấy orders chưa delivered
  → Gọi YunExpress tracking API
  → Cập nhật status vào DB
  → Lưu tracking logs
  → Nếu delivered → Update ERP
```

## 🛠️ Scripts hữu ích
```bash
# Migrations
npm run migrate          # Run migrations
npm run migrate:fresh    # Fresh migration (drop all)

# Development
npm run dev             # Start with nodemon

# Production
npm start               # Start server
npm run cron            # Start only cron jobs

# Testing
curl http://localhost:3000/health
curl http://localhost:3000/api/orders/statistics
```

## 📁 Cấu trúc Project
```
├── src/
│   ├── config/              # Configuration
│   ├── controllers/         # Request handlers
│   ├── database/            # Database connection & migrations
│   ├── jobs/                # Cron jobs
│   ├── middlewares/         # Express middlewares
│   ├── models/              # Database models
│   ├── routes/              # API routes
│   ├── services/
│   │   ├── carriers/        # Carrier integrations
│   │   └── erp/             # ERP automation
│   └── utils/               # Helper functions
├── logs/
│   ├── screenshots/         # Puppeteer error screenshots
│   ├── error.log
│   └── combined.log
├── .env                     # Environment variables
└── server.js                # Entry point
```

## 🐛 Debug & Monitoring

### Logs
- `logs/error.log` - Errors only
- `logs/combined.log` - All logs
- `logs/screenshots/` - Puppeteer error screenshots

### Database monitoring
```sql
-- Check order status
SELECT status, COUNT(*) FROM orders GROUP BY status;

-- Check recent tracking logs
SELECT * FROM tracking_logs ORDER BY created_at DESC LIMIT 10;

-- Check cron job history
SELECT * FROM cron_logs ORDER BY started_at DESC LIMIT 10;

-- Check orders cần tracking
SELECT * FROM orders 
WHERE status IN ('pending', 'created', 'in_transit') 
AND tracking_number IS NOT NULL;
```

## 📝 License

ISC