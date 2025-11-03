# YunExpress Integration API

API tích hợp đa nhà vận chuyển với tự động hóa ERP (ECount) sử dụng Puppeteer.

## 🚀 Tính năng

- ✅ Tích hợp đa nhà vận chuyển (hiện tại: YunExpress, dễ dàng mở rộng)
- ✅ Tự động cập nhật tracking vào ERP (ECount) qua Puppeteer
- ✅ RESTful API để bên thứ 3 gọi vào
- ✅ Validation dữ liệu đầy đủ
- ✅ Logging chi tiết
- ✅ Error handling toàn diện
- ✅ Kiến trúc module hóa, dễ mở rộng

## 📋 Yêu cầu

- Node.js >= 16.x
- NPM hoặc Yarn

## 🔧 Cài đặt
```bash
# Clone project
git clone <repository-url>
cd yun-express-integration

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env với thông tin của bạn
nano .env
```

## 🏃 Chạy ứng dụng
```bash
# Development mode
npm run dev

# Production mode
npm start
```

## 📡 API Endpoints

### 1. Health Check
```
GET /api/orders/health
```

### 2. Get Available Carriers
```
GET /api/orders/carriers
```

Response:
```json
{
  "success": true,
  "message": "Available carriers retrieved",
  "data": {
    "carriers": ["YUNEXPRESS"]
  }
}
```

### 3. Create Order (Full Flow)
```
POST /api/orders
Content-Type: application/json
```

Request body:
```json
{
  "carrier": "YUNEXPRESS",
  "productCode": "S1002",
  "customerOrderNumber": "ORD-2024-001",
  "platformOrderNumber": "PLATFORM-001",
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
    "phoneNumber": "+84901234567",
    "email": "customer@example.com"
  },
  "declarationInfo": [
    {
      "name_en": "T-Shirt",
      "quantity": 2,
      "unit_price": 15.99,
      "unit_weight": 0.2
    }
  ],
  "erpOrderCode": "THG-EX-000011",
  "erpStatus": "Đã hoàn tất"
}
```

Response:
```json
{
  "success": true,
  "message": "Order processed successfully",
  "data": {
    "trackingNumber": "YT2024110300001",
    "carrier": "YUNEXPRESS",
    "carrierResponse": {...},
    "erpUpdated": true,
    "erpResult": {...}
  }
}
```

### 4. Create Order Only (Skip ERP)
```
POST /api/orders/create-only
Content-Type: application/json
```

### 5. Update ERP Only
```
POST /api/orders/update-erp
Content-Type: application/json
```

Request body:
```json
{
  "erpOrderCode": "THG-EX-000011",
  "trackingNumber": "YT2024110300001",
  "status": "Đã hoàn tất"
}
```

## 🔌 Thêm nhà vận chuyển mới

### Bước 1: Tạo service class

Tạo file `src/services/carriers/dhl.service.js`:
```javascript
const BaseCarrier = require('./base.carrier');

class DHLService extends BaseCarrier {
    constructor(config) {
        super(config);
        this.name = 'DHL';
        // Add DHL config
    }

    async createOrder(orderData) {
        // Implement DHL API logic
    }

    validateOrderData(orderData) {
        // Validate DHL specific fields
    }

    async trackOrder(trackingNumber) {
        // Implement tracking
    }
}

module.exports = DHLService;
```

### Bước 2: Cập nhật config

File `src/config/carriers.config.js`:
```javascript
DHL: {
    name: 'DHL',
    code: 'DHL',
    enabled: true
}
```

### Bước 3: Register trong factory

File `src/services/carriers/index.js`:
```javascript
const DHLService = require('./dhl.service');

if (carriersConfig.DHL.enabled) {
    this.carriers.set('DHL', new DHLService(config));
}
```

### Bước 4: Thêm env variables
```env
DHL_API_KEY=your-dhl-key
DHL_API_SECRET=your-dhl-secret
```

## 📁 Cấu trúc Project
```
├── src/
│   ├── config/           # Configuration files
│   ├── controllers/      # Request handlers
│   ├── services/         # Business logic
│   │   ├── carriers/     # Carrier integrations
│   │   └── erp/          # ERP automation
│   ├── routes/           # API routes
│   ├── middlewares/      # Express middlewares
│   └── utils/            # Helper functions
├── logs/                 # Log files
├── .env                  # Environment variables
└── server.js             # Entry point
```

## 🐛 Debug

Logs được lưu trong thư mục `logs/`:
- `error.log` - Chỉ errors
- `combined.log` - Tất cả logs

Screenshots lỗi Puppeteer được lưu ở root với tên `ecount-error-[timestamp].png`

## 📝 License

ISC