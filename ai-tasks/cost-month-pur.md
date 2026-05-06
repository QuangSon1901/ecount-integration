```markdown
# OMS Warehouse Billing — Implementation Spec

## Context
Đây là tính năng quản lý phiếu phí kho US (warehouse billing slips) phục vụ kiểm toán
cuối tháng. Hiện tại có 1 prototype React dùng `window.storage` (localStorage artifact),
cần chuyển thành backend thật với DB + API + UI tích hợp vào hệ thống THG.

Hệ thống đã có sẵn:
- Bảng `api_customers` — danh sách khách hàng (dùng `id`, `customer_code`, `customer_name`)
- Pattern controller/model/router đã có, theo đúng chuẩn hiện tại của dự án
- Auth session middleware đã có

---

## 1. Cấu trúc nghiệp vụ

### Khái niệm "Phiếu phí" (Billing Slip)
Mỗi phiếu ghi nhận các khoản phí phát sinh tại kho US cho 1 khách hàng trong 1 ngày.
1 khách có thể có nhiều phiếu trong tháng (mỗi lần nhập hàng, kiểm kho,... là 1 phiếu).

### Các mục phí (Sections) — cố định, hardcode
| Section ID | Tên | Ghi chú |
|-----------|-----|---------|
| 1 | Inbound Receiving | Luôn Free |
| 2 | Inspection Fee | Nhiều loại, có thể thêm dòng |
| 3 | Storage Fee | Nhập tay sp/cost |
| 6 | Return Handling | Luôn Free |
| 8 | Return Export Fee | |
| 9 | Phí Khác | Tự do nhập tên + giá |

### Các item mặc định trong mỗi section
Hardcode ở tầng service/constant, không lưu vào DB.
Khi tạo phiếu, chỉ lưu các dòng user đã chọn/nhập.

```javascript
// src/constants/warehouse-billing-sections.js
const SECTIONS = [
  { id: 1, label: "Inbound Receiving", items: [
    { id: "inb_01", name: "Inbound Receiving", unit: "/shipment", default_sp: 0, default_cost: 0, free: true },
  ]},
  { id: 2, label: "Inspection Fee", items: [
    { id: "ins_01", name: "Small parcels (<20 items/carton)", unit: "/carton", default_sp: 0,    default_cost: 0,    free: true },
    { id: "ins_02", name: "Single product type, quick check",  unit: "/carton", default_sp: 2.5,  default_cost: 2.0,  free: false },
    { id: "ins_03", name: "Mixed carton, multiple product types", unit: "/carton", default_sp: 6.25, default_cost: 5.0,  free: false },
    { id: "ins_04", name: "Large items packed by CBM",          unit: "/CBM",    default_sp: 38,   default_cost: 30,   free: false },
    { id: "ins_05", name: "Periodic inventory check (on request)", unit: "/hr or /1500pcs", default_sp: 30, default_cost: 20, free: false, note: "Cost $20–$25 tuỳ hàng" },
    { id: "ins_06", name: "Other cases", unit: "", default_sp: null, default_cost: null, free: false, note: "Quoted per specific case" },
  ]},
  { id: 3, label: "Storage Fee", items: [
    { id: "sto_01", name: "Storage Fee", unit: "/pc/month or /CBM", default_sp: null, default_cost: null, free: false,
      note: "Selling: $0.1/pc/month hoặc $20/CBM | Cost: $600/tháng cố định" },
  ]},
  { id: 6, label: "Return Handling", items: [
    { id: "ret_01", name: "Return Handling", unit: "/shipment", default_sp: 0, default_cost: 0, free: true, note: "Merchandise only" },
  ]},
  { id: 8, label: "Return Export Fee", items: [
    { id: "rex_01", name: "Return Export Fee", unit: "/carton", default_sp: 2.5, default_cost: 2.0, free: false, note: "Quoted trước khi xử lý" },
  ]},
  { id: 9, label: "Phí Khác", items: [] }, // user tự nhập tên + giá
];
module.exports = SECTIONS;
```

---

## 2. Database

### Bảng `oms_warehouse_billing_slips` — phiếu phí

```sql
CREATE TABLE oms_warehouse_billing_slips (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    customer_id     INT NOT NULL,
    slip_date       DATE NOT NULL,
    note            TEXT DEFAULT NULL,
    total_revenue   DECIMAL(10,4) NOT NULL DEFAULT 0,
    total_cost      DECIMAL(10,4) NOT NULL DEFAULT 0,
    total_profit    DECIMAL(10,4) NOT NULL DEFAULT 0,
    created_by      VARCHAR(100) DEFAULT NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES api_customers(id)
);
```

### Bảng `oms_warehouse_billing_rows` — từng dòng phí trong phiếu

```sql
CREATE TABLE oms_warehouse_billing_rows (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    slip_id         INT NOT NULL,
    section_id      INT NOT NULL,
    section_label   VARCHAR(100) NOT NULL,
    item_id         VARCHAR(50) DEFAULT NULL,   -- NULL nếu là dòng custom (section 9)
    name            VARCHAR(255) NOT NULL,
    unit            VARCHAR(100) DEFAULT NULL,
    is_free         TINYINT(1) NOT NULL DEFAULT 0,
    selling_price   DECIMAL(10,4) DEFAULT NULL, -- NULL nếu is_free hoặc quoted
    cost_price      DECIMAL(10,4) DEFAULT NULL,
    quantity        DECIMAL(10,4) NOT NULL DEFAULT 1,
    note            TEXT DEFAULT NULL,
    sort_order      INT NOT NULL DEFAULT 0,
    FOREIGN KEY (slip_id) REFERENCES oms_warehouse_billing_slips(id) ON DELETE CASCADE
);
```

> **Lý do tách 2 bảng:** 1 phiếu có nhiều dòng phí, mỗi dòng cần lưu riêng để
> query aggregate theo section, theo tháng, theo khách hàng. Không dùng JSON column
> vì cần GROUP BY / SUM trực tiếp trên DB.

---

## 3. Model

### `src/models/oms-warehouse-billing.model.js`

Methods cần có:

```javascript
// Tạo phiếu + các dòng trong 1 transaction
static async create(payload, rows, createdBy)
// payload: { customer_id, slip_date, note, total_revenue, total_cost, total_profit }
// rows: [{ section_id, section_label, item_id, name, unit, is_free,
//           selling_price, cost_price, quantity, note, sort_order }]

// Lấy 1 phiếu kèm rows + thông tin customer
static async findById(id)

// List phiếu với filter
// filters: { customer_id, year_month (YYYY-MM), date_from, date_to, limit, offset }
static async list(filters)
static async count(filters)

// Tổng hợp theo tháng, group by customer
// Trả về: [{ customer_id, customer_name, slip_count, total_revenue, total_cost, total_profit }]
static async monthlySummary(yearMonth)

// Tổng hợp theo tháng + section (để biết mục nào phát sinh nhiều nhất)
// Trả về: [{ section_id, section_label, total_revenue, total_cost, row_count }]
static async monthlySummaryBySection(yearMonth, customerId?)

// Xoá phiếu (cascade xoá rows)
static async deleteById(id)
```

---

## 4. Controller

### `src/controllers/oms-warehouse-billing.controller.js`

```
POST   /api/v1/admin/oms-warehouse-billing          — tạo phiếu mới
GET    /api/v1/admin/oms-warehouse-billing           — list phiếu (filter: customer_id, year_month, limit, offset)
GET    /api/v1/admin/oms-warehouse-billing/:id       — chi tiết 1 phiếu
DELETE /api/v1/admin/oms-warehouse-billing/:id       — xoá phiếu

GET    /api/v1/admin/oms-warehouse-billing/summary/monthly          — tổng hợp tháng theo customer
GET    /api/v1/admin/oms-warehouse-billing/summary/monthly-by-section — tổng hợp tháng theo section
```

### Request body — Tạo phiếu (POST)

```json
{
  "customer_id": 12,
  "slip_date": "2026-05-06",
  "note": "Nhập hàng đợt 3",
  "rows": [
    {
      "section_id": 1,
      "section_label": "Inbound Receiving",
      "item_id": "inb_01",
      "name": "Inbound Receiving",
      "unit": "/shipment",
      "is_free": true,
      "selling_price": null,
      "cost_price": null,
      "quantity": 1,
      "note": null,
      "sort_order": 0
    },
    {
      "section_id": 2,
      "section_label": "Inspection Fee",
      "item_id": "ins_02",
      "name": "Single product type, quick check",
      "unit": "/carton",
      "is_free": false,
      "selling_price": 2.5,
      "cost_price": 2.0,
      "quantity": 3,
      "note": null,
      "sort_order": 1
    },
    {
      "section_id": 9,
      "section_label": "Phí Khác",
      "item_id": null,
      "name": "Phí dán nhãn đặc biệt",
      "unit": "/carton",
      "is_free": false,
      "selling_price": 5.0,
      "cost_price": 3.5,
      "quantity": 2,
      "note": "Hàng fragile",
      "sort_order": 2
    }
  ]
}
```

Controller tự tính `total_revenue`, `total_cost`, `total_profit` từ rows trước khi lưu:

```javascript
// Tính totals từ rows — không tin client gửi lên
function computeTotals(rows) {
    let revenue = 0, cost = 0;
    for (const r of rows) {
        if (r.is_free) continue;
        const qty = Number(r.quantity) || 1;
        revenue += (Number(r.selling_price) || 0) * qty;
        cost    += (Number(r.cost_price)    || 0) * qty;
    }
    return {
        total_revenue: Math.round(revenue * 10000) / 10000,
        total_cost:    Math.round(cost    * 10000) / 10000,
        total_profit:  Math.round((revenue - cost) * 10000) / 10000,
    };
}
```

### Response — chi tiết 1 phiếu (GET /:id)

```json
{
  "id": 42,
  "customer_id": 12,
  "customer_code": "lup",
  "customer_name": "Levelup",
  "slip_date": "2026-05-06",
  "note": "Nhập hàng đợt 3",
  "total_revenue": 12.50,
  "total_cost": 9.00,
  "total_profit": 3.50,
  "created_by": "admin",
  "created_at": "2026-05-06T10:30:00Z",
  "rows": [
    {
      "id": 101,
      "section_id": 2,
      "section_label": "Inspection Fee",
      "item_id": "ins_02",
      "name": "Single product type, quick check",
      "unit": "/carton",
      "is_free": false,
      "selling_price": 2.5,
      "cost_price": 2.0,
      "quantity": 3,
      "subtotal_revenue": 7.5,
      "subtotal_cost": 6.0,
      "subtotal_profit": 1.5,
      "note": null,
      "sort_order": 0
    }
  ]
}
```

> `subtotal_revenue/cost/profit` tính runtime trong `_formatSlip()`, không lưu DB.

### Response — monthly summary (GET /summary/monthly?year_month=2026-05)

```json
{
  "year_month": "2026-05",
  "grand_total": {
    "total_revenue": 850.00,
    "total_cost": 620.00,
    "total_profit": 230.00,
    "slip_count": 34
  },
  "by_customer": [
    {
      "customer_id": 12,
      "customer_code": "lup",
      "customer_name": "Levelup",
      "slip_count": 5,
      "total_revenue": 120.00,
      "total_cost": 90.00,
      "total_profit": 30.00,
      "margin_percent": 25.0
    }
  ]
}
```

---

## 5. Validation

Controller validate trước khi lưu:

- `customer_id`: bắt buộc, phải tồn tại trong `api_customers`
- `slip_date`: bắt buộc, định dạng DATE hợp lệ
- `rows`: array, tối thiểu 1 phần tử
- Mỗi row:
  - `section_id`: bắt buộc, phải thuộc `[1, 2, 3, 6, 8, 9]`
  - `name`: bắt buộc, không được rỗng
  - `quantity`: số dương, mặc định 1 nếu không truyền
  - `selling_price` / `cost_price`: cho phép NULL (quoted case), nếu có thì phải là số >= 0

---

## 6. Frontend

### Trang mới: `/extensions/warehouse-billing`

Gồm 3 tab giống prototype React:

**Tab 1 — Tạo phiếu mới:**
- Chọn khách hàng (dropdown từ `api_customers`)
- Chọn ngày phát sinh
- Ghi chú phiếu
- Chip picker chọn sections
- Bảng nhập liệu từng section (giống prototype)
- Totals + nút Submit gọi `POST /api/v1/admin/oms-warehouse-billing`

**Tab 2 — Danh sách phiếu:**
- Filter: tháng + khách hàng
- Table list, click vào xem detail modal
- Nút xoá trong modal

**Tab 3 — Tổng hợp tháng:**
- Filter: tháng
- Stats cards: Total Revenue / Cost / Profit / Margin
- Table by customer (gọi `GET /summary/monthly`)

### File cần tạo:
- `public/views/warehouse-billing.html` — page layout
- `public/js/warehouse-billing.js` — logic tương tự `oms-order-detail.js`

---

## 7. Files cần tạo / cập nhật

### Tạo mới
- `src/constants/warehouse-billing-sections.js` — hardcode sections + default items
- `src/models/oms-warehouse-billing.model.js`
- `src/controllers/oms-warehouse-billing.controller.js`
- `src/routes/oms-warehouse-billing.routes.js`
- Migration file: tạo 2 bảng `oms_warehouse_billing_slips` + `oms_warehouse_billing_rows`
- `public/views/warehouse-billing.html`
- `public/js/warehouse-billing.js`

### Cập nhật
- `src/routes/index.js` — đăng ký router mới
- Navigation / sidebar — thêm link đến trang warehouse billing
```