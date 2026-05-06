```markdown
# OMS Orders Export Excel — Implementation Spec

Cần tạo tính năng export oms order theo bộ lọc với **2 mode**:
- **Mode "Báo giá" (Selling only):** gửi khách hàng, không có cột cost và profit
- **Mode "Kế toán" (Full):** có đầy đủ selling + cost + profit, gửi nội bộ

---

## 1. Cấu trúc file Excel xuất ra

### Sheet layout
- **1 sheet = 1 ngày** (tên sheet: `DD.MM` — VD: `06.05`)
- Thứ tự sheet: theo ngày tăng dần
- Thêm 1 sheet cuối: **`Tổng hợp`** — summary theo ngày

### Header row — cố định, freeze pane tại row 1

#### Mode Báo giá (Selling only)

| Cột | Tên cột | Nguồn dữ liệu |
|-----|---------|---------------|
| A | # | STT, tự tăng per sheet |
| B | Ngày tạo | `oms_orders.oms_created_at` format `DD/MM/YYYY` |
| C | Mã OR | `oms_orders.oms_order_number` |
| D | Mã OR đối tác | `oms_orders.customer_order_number` |
| E | Trạng thái | `oms_orders.internal_status` (map sang tiếng Việt) |
| F | SKU | `items[i].sku` |
| G | Tên sản phẩm | `items[i].productName` |
| H | Số lượng | `items[i].quantity` |
| I | Phí xử lý ($) | `oms_orders.fulfillment_fee_selling` — chỉ điền ở dòng đầu của OR |
| J | Phí bao bì ($) | `oms_orders.packaging_material_fee_selling` — chỉ dòng đầu |
| K | Phí ship ($) | `oms_orders.shipping_fee_selling` — chỉ dòng đầu |
| L | Additional ($) | `oms_orders.additional_fee` — chỉ dòng đầu, có thể âm |
| M | **Tổng ($)** | `=I+J+K+L` — chỉ dòng đầu |
| N | Tracking | `oms_orders.tracking_number` — chỉ dòng đầu |
| O | Label URL | `${process.env.BASE_URL}/api/labels/${oms_orders.label_access_key}` — hyperlink, text "Xem label" — chỉ dòng đầu |
| P | Tên người mua | `oms_orders.receiver_name` |
| Q | SĐT | `oms_orders.receiver_phone` |
| R | Địa chỉ | full address: line1, line2, city, state, postal, country |

#### Mode Kế toán (Full) — thêm các cột sau vào sau cột M

| Cột | Tên cột | Nguồn dữ liệu |
|-----|---------|---------------|
| N | Phí ship COST ($) | `oms_orders.shipping_fee_purchase` — chỉ dòng đầu |
| O | Phí xử lý COST ($) | tính realtime từ `fulfillment-cost-calculator` — chỉ dòng đầu |
| P | Phí bao bì COST ($) | tính realtime — chỉ dòng đầu |
| Q | **Tổng COST ($)** | `=N+O+P` — chỉ dòng đầu |
| R | **Profit ($)** | `=M-Q` (Tổng selling - Tổng cost) — chỉ dòng đầu |
| S | Tracking | (đẩy sang sau) |
| T | Label URL | (đẩy sang sau) |
| U | Tên người mua | (đẩy sang sau) |
| V | SĐT | (đẩy sang sau) |
| W | Địa chỉ | (đẩy sang sau) |

---

## 2. Quy tắc merge / grouping dòng

Mỗi `oms_order_number` có thể có nhiều items → nhiều dòng trong sheet.

### Dòng đầu tiên của mỗi OR (index = 0):
- Điền đầy đủ tất cả các cột
- Các cột phí: điền giá trị thực

### Dòng thứ 2 trở đi của cùng OR:
- Cột A (#): để trống
- Cột B (Ngày tạo): để trống
- Cột C (Mã OR): để trống — visual grouping
- Cột D (Mã OR đối tác): để trống
- Cột E (Trạng thái): để trống
- Cột F (SKU): điền
- Cột G (Tên sản phẩm): điền
- Cột H (Số lượng): điền
- Cột I-M (Phí): để trống — phí đã tính ở dòng đầu
- Cột N-R (Tracking, Label, Receiver): để trống

### Visual grouping — dùng màu nền xen kẽ theo OR:
- OR lẻ: background trắng `FFFFFF`
- OR chẵn: background xám nhạt `F5F5F5`
- Áp dụng cho toàn bộ dòng của cùng 1 OR

---

## 3. Sheet "Tổng hợp"

| Cột | Nội dung |
|-----|---------|
| A | Ngày |
| B | Số đơn |
| C | Số items |
| D | Tổng Phí xử lý ($) |
| E | Tổng Phí bao bì ($) |
| F | Tổng Phí ship ($) |
| G | Tổng Additional ($) |
| H | **Tổng Selling ($)** |
| I | Tổng COST ($) | ← chỉ có ở mode Kế toán |
| J | **Profit ($)** | ← chỉ có ở mode Kế toán |

Dòng cuối: **Grand Total** — SUM tất cả các cột số.

---

## 4. Formatting

### Header row
- Font: Arial 10, Bold
- Background: `1E5BC6` (xanh đậm), chữ trắng `FFFFFF`
- Freeze pane: row 1
- Auto filter: bật trên header row

### Cột số (phí, tổng)
- Format: `$#,##0.00`
- Alignment: right
- Cột Profit (mode kế toán):
  - Profit > 0: chữ xanh `16A34A`
  - Profit < 0: chữ đỏ `DC2626`
  - Profit = 0: chữ đen

### Cột Tổng selling (cột M)
- Background: `FEF9C3` (vàng nhạt) — nổi bật
- Font bold

### Cột Profit (mode kế toán)
- Background: `DCFCE7` nếu > 0, `FEE2E2` nếu < 0

### Cột Label URL
- Hyperlink, display text: `Xem label`
- Màu link: `2563EB`

### Column widths (px tương đương)

| Cột | Width |
|-----|-------|
| A (#) | 5 |
| B (Ngày) | 12 |
| C (Mã OR) | 20 |
| D (Mã OR đối tác) | 20 |
| E (Trạng thái) | 18 |
| F (SKU) | 22 |
| G (Tên SP) | 30 |
| H (SL) | 8 |
| I-L (Phí) | 14 mỗi cột |
| M (Tổng) | 14 |
| N (Tracking) | 28 |
| O (Label) | 12 |
| P (Tên NMua) | 22 |
| Q (SĐT) | 15 |
| R (Địa chỉ) | 45 |

---

## 5. Mapping trạng thái (internal_status → tiếng Việt)

```javascript
const STATUS_LABEL = {
    'pending':          'Chờ xử lý',
    'selected':         'Đã chọn',
    'label_purchasing': 'Đang tạo label',
    'label_purchased':  'Đã tạo label',
    'oms_updated':      'Đã tạo label',
    'shipped':          'Đã bàn giao vận chuyển',
    'delivered':        'Đã giao hàng',
    'cancelled':        'Đã huỷ',
    'failed':           'Thất bại',
    'error':            'Lỗi',
};
```

---

## 7. API Endpoint

```
GET /api/v1/admin/oms-orders/export
```

Query params:
- `customer_id`: bắt buộc (có All)
- `date_from`: `YYYY-MM-DD`
- `date_to`: `YYYY-MM-DD`
- `mode`: `selling` | `full` (default: `selling`)
- `include_statuses`: comma-separated, default bỏ qua `cancelled,failed`

Response: file download `.xlsx`
- Content-Type: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- Content-Disposition: `attachment; filename="OMS_{customer_code}_{date_from}_{date_to}_{mode}.xlsx"`

---

## 8. Files cần tạo / cập nhật

### Tạo mới
- `src/services/export/oms-order-excel.service.js`
  - `generateExcel(orders, mode, tier, materialMappings)` → `Buffer`
  - Dùng `openpyxl` (Python script) hoặc `exceljs` (Node.js)
  - **Khuyến nghị: dùng `exceljs`** — đã phổ biến trong Node ecosystem,
    hỗ trợ hyperlink, conditional formatting, freeze pane tốt

- Migration hoặc note: không cần thêm bảng DB, chỉ query + generate

### Cập nhật
- `src/controllers/oms-order.controller.js`
  - Thêm method `exportOrders(req, res, next)`
- `src/routes/oms-order.routes.js`
  - Thêm `GET /export` route

### Frontend (trang public/views/dashboard.html và public/js/sections/oms-orders.js) 
- Thêm button **"Xuất Excel"** với dropdown 2 option:
  - 📊 Xuất báo giá (Selling)
  - 📋 Xuất kế toán (Full)
- Khi click → gọi API với đúng params theo bộ lọc → browser tự download file
- Lưu ý không được viết js inline vào file html
```