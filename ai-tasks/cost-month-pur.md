```markdown
# OMS Warehouse Billing — Monthly Summary Tổng Quan Spec

## Context
Đã có sẵn:
- `oms_warehouse_billing_slips` + `oms_warehouse_billing_rows` — phiếu phí kho
- `oms_orders` — đơn hàng OMS:
  - **Selling**: đã tính và lưu vào DB (`shipping_fee_selling`, `fulfillment_fee_selling`,
    `packaging_material_fee_selling`, `additional_fee`)
  - **Cost**: tính realtime khi có yêu cầu, không lưu DB, vì `fulfillment_fee_purchase`
    phụ thuộc vào `monthly_total` từ `system_configs.oms_monthly_order_totals`
- `system_configs` key `oms_monthly_order_totals`:
  ```json
  {
    "2026-04": { "total": 1230, "updatedAt": "2026-04-30T18:05:00Z" },
    "2026-05": { "total": 87,   "updatedAt": "2026-05-06T10:30:00Z" }
  }
  ```
- `fulfillment-cost-calculator.service.js` — đã có, nhận `items` + `tier` → trả về cost

---

## Luồng tính cost cho Summary tháng

Vì cost không lưu DB, khi render Summary cần:

```
1. Đọc year_month từ query param
2. Đọc system_configs → lấy monthly_total của year_month đó → xác định tier
3. Query tất cả oms_orders của tháng đó (kèm items JSON)
4. Với mỗi order: gọi fulfillmentCostCalculator.compute(order.items, tier)
   → ra fulfillment_fee_purchase realtime
5. shipping_fee_purchase đã có sẵn trên order (từ ITC)
6. packaging_material_fee_cost: tính realtime từ items × cost_price của mapping
7. Aggregate tất cả theo customer_id
```

> **Lưu ý hiệu năng:** nếu tháng có nhiều đơn (vài nghìn), bước 4-6 chạy in-memory
> trên Node sau khi đã query DB 1 lần. Không gọi DB per-order.
> Tier là hằng số cho cả tháng nên chỉ lookup 1 lần.

---

## API

### `GET /api/v1/admin/oms-warehouse-billing/summary/monthly`

Query params:
- `year_month`: bắt buộc, định dạng `YYYY-MM`
- `customer_id`: tùy chọn

### Response shape

```json
{
  "year_month": "2026-05",
  "oms_context": {
    "monthly_total": 87,
    "tier": 1,
    "tier_label": "0–1000 đơn/tháng",
    "has_incomplete_pricing": true,
    "incomplete_order_count": 3
  },
  "grand_total": {
    "oms_orders": {
      "order_count": 320,
      "revenue": {
        "shipping": 1800.00,
        "fulfillment": 1500.00,
        "packaging_material": 400.00,
        "additional": -100.00,
        "total": 3600.00
      },
      "cost": {
        "shipping": 1400.00,
        "fulfillment": 980.00,
        "packaging_material": 200.00,
        "total": 2580.00
      },
      "profit": 1020.00
    },
    "warehouse_billing": {
      "slip_count": 34,
      "total_revenue": 850.00,
      "total_cost": 620.00,
      "total_profit": 230.00
    },
    "combined": {
      "total_revenue": 4450.00,
      "total_cost": 3200.00,
      "total_profit": 1250.00,
      "margin_percent": 28.1
    }
  },
  "by_customer": [
    {
      "customer_id": 12,
      "customer_code": "lup",
      "customer_name": "Levelup",
      "oms_orders": {
        "order_count": 45,
        "has_incomplete_pricing": false,
        "revenue": {
          "shipping": 310.00,
          "fulfillment": 250.00,
          "packaging_material": 40.00,
          "additional": 20.00,
          "total": 620.00
        },
        "cost": {
          "shipping": 260.00,
          "fulfillment": 180.00,
          "packaging_material": 0.00,
          "total": 440.00
        },
        "profit": 180.00
      },
      "warehouse_billing": {
        "slip_count": 5,
        "total_revenue": 120.00,
        "total_cost": 90.00,
        "total_profit": 30.00,
        "breakdown_by_section": [
          {
            "section_id": 2,
            "section_label": "Inspection Fee",
            "total_revenue": 75.00,
            "total_cost": 60.00
          },
          {
            "section_id": 3,
            "section_label": "Storage Fee",
            "total_revenue": 45.00,
            "total_cost": 30.00
          }
        ]
      },
      "combined": {
        "total_revenue": 740.00,
        "total_cost": 530.00,
        "total_profit": 210.00,
        "margin_percent": 28.4
      }
    }
  ]
}
```

---

## Logic trong Controller / Model

### Bước 1 — Lấy tier từ system_configs

```javascript
// src/controllers/oms-warehouse-billing.controller.js

async monthlySummary(req, res, next) {
    const { year_month, customer_id } = req.query;

    // 1. Đọc monthly_total từ system_configs
    const configRow = await SystemConfigModel.get('oms_monthly_order_totals');
    const monthlyTotals = configRow ? JSON.parse(configRow.config_value) : {};
    const monthlyEntry  = monthlyTotals[year_month] || null;
    const monthlyTotal  = monthlyEntry?.total ?? 0;
    const tier          = fulfillmentCostCalculator.getTier(monthlyTotal);
    // getTier: ≤1000→1, ≤3000→2, ≤5000→3, >5000→4

    // 2. Query OMS orders
    const orders = await OmsOrderModel.listForSummary({ yearMonth: year_month, customerId: customer_id });
    // listForSummary: SELECT id, customer_id, items, shipping_fee_purchase,
    //   shipping_service_name, shipping_fee_selling, fulfillment_fee_selling,
    //   packaging_material_fee_selling, additional_fee, internal_status
    // WHERE DATE_FORMAT(created_at, '%Y-%m') = ? AND internal_status NOT IN ('cancelled','failed')

    // 3. Query packaging material mappings 1 lần cho tất cả SKUs có trong orders
    const allSkus = [...new Set(orders.flatMap(o => this._parseItems(o.items).map(it => it.sku).filter(Boolean)))];
    const materialMappings = await PackagingMaterialModel.findMappingsBySkus(allSkus);
    // trả về Map<sku, { cost_price, sell_price, material_name }>

    // 4. Tính cost realtime per order, aggregate theo customer
    const customerMap = {};
    let incompleteCount = 0;

    for (const order of orders) {
        const items = this._parseItems(order.items);
        const custId = order.customer_id;
        if (!customerMap[custId]) customerMap[custId] = this._emptyCustomerAgg();

        // Shipping cost
        const shippingCost = ['Standard USPS', 'Priority USPS'].includes(order.shipping_service_name)
            ? Number(order.shipping_fee_purchase || 0)
            : 0;

        // Fulfillment cost (realtime)
        const fulfillResult = fulfillmentCostCalculator.compute(items, tier);
        const fulfillmentCost = fulfillResult.fee_purchase ?? 0;

        // Packaging material cost (realtime)
        let packagingCost = 0;
        for (const item of items) {
            const mapping = materialMappings.get(item.sku);
            if (mapping?.cost_price != null) {
                packagingCost += Number(mapping.cost_price) * Number(item.quantity || 1);
            }
        }

        // Check incomplete: selling fields có NULL không
        const isIncomplete = order.fulfillment_fee_selling === null
            || order.shipping_fee_selling === null;
        if (isIncomplete) incompleteCount++;

        // Aggregate revenue (từ DB)
        customerMap[custId].revenue.shipping        += Number(order.shipping_fee_selling || 0);
        customerMap[custId].revenue.fulfillment      += Number(order.fulfillment_fee_selling || 0);
        customerMap[custId].revenue.packaging        += Number(order.packaging_material_fee_selling || 0);
        customerMap[custId].revenue.additional       += Number(order.additional_fee || 0);

        // Aggregate cost (realtime)
        customerMap[custId].cost.shipping            += shippingCost;
        customerMap[custId].cost.fulfillment         += fulfillmentCost;
        customerMap[custId].cost.packaging           += packagingCost;

        customerMap[custId].order_count++;
        if (isIncomplete) customerMap[custId].has_incomplete = true;
    }

    // 5. Query billing slips
    const billingAgg     = await OmsWarehouseBillingModel.monthlyAggregate(year_month, customer_id);
    const billingSection = await OmsWarehouseBillingModel.monthlyBillingSectionBreakdown(year_month, customer_id);

    // 6. Merge + build response
    // ...
}
```

### `OmsOrderModel.listForSummary()`

Chỉ SELECT các cột cần thiết, không SELECT raw_data để tránh payload nặng:

```javascript
static async listForSummary({ yearMonth, customerId }) {
    let sql = `
        SELECT id, customer_id, items, shipping_service_name,
               shipping_fee_purchase, shipping_fee_selling,
               fulfillment_fee_selling, packaging_material_fee_selling,
               additional_fee, internal_status
        FROM oms_orders
        WHERE DATE_FORMAT(created_at, '%Y-%m') = ?
          AND internal_status NOT IN ('cancelled', 'failed')
    `;
    const params = [yearMonth];
    if (customerId) { sql += ' AND customer_id = ?'; params.push(customerId); }
    const conn = await db.getConnection();
    try {
        const [rows] = await conn.query(sql, params);
        return rows;
    } finally { conn.release(); }
}
```

---

## Queries Billing (không thay đổi so với spec trước)

```sql
-- Aggregate billing theo customer
SELECT
    s.customer_id,
    COUNT(DISTINCT s.id)  AS slip_count,
    SUM(s.total_revenue)  AS total_revenue,
    SUM(s.total_cost)     AS total_cost,
    SUM(s.total_profit)   AS total_profit
FROM oms_warehouse_billing_slips s
WHERE DATE_FORMAT(s.slip_date, '%Y-%m') = ?
GROUP BY s.customer_id;

-- Breakdown theo section
SELECT
    s.customer_id,
    r.section_id,
    r.section_label,
    SUM(CASE WHEN r.is_free = 0 THEN r.selling_price * r.quantity ELSE 0 END) AS total_revenue,
    SUM(CASE WHEN r.is_free = 0 THEN r.cost_price    * r.quantity ELSE 0 END) AS total_cost
FROM oms_warehouse_billing_slips s
JOIN oms_warehouse_billing_rows r ON r.slip_id = s.id
WHERE DATE_FORMAT(s.slip_date, '%Y-%m') = ?
GROUP BY s.customer_id, r.section_id, r.section_label;
```

---

## Frontend — Tab Tổng hợp tháng

### Grand total cards (2 hàng)

```
Hàng 1 — OMS Orders:
┌────────────────┬────────────────┬────────────────┬────────────────┐
│ OMS Revenue    │ OMS Cost       │ OMS Profit     │ Đơn hàng       │
│ $3,600         │ $2,580         │ $1,020         │ 320 đơn        │
└────────────────┴────────────────┴────────────────┴────────────────┘

Hàng 2 — Warehouse + Combined:
┌────────────────┬────────────────┬────────────────┬────────────────┐
│ WH Revenue     │ WH Cost        │ Total Revenue  │ Total Profit   │
│ $850           │ $620           │ $4,450         │ $1,250 (28.1%) │
└────────────────┴────────────────┴────────────────┴────────────────┘
```

### Context bar — hiển thị tier đang dùng

```
ℹ️ Tháng 05/2026: 87 đơn toàn hệ thống → Tier 1 (0–1000 đơn) · Cost tính realtime
⚠️ 3 đơn chưa có đủ thông tin giá → [Xem danh sách]
```

### Table per customer — expandable

```
┌──────────────┬─────────┬─────────┬──────────────┬──────────────┬──────────┬────────┐
│ Khách hàng   │ OMS     │ Phiếu   │ Total Rev    │ Total Cost   │ Profit   │ Margin │
│              │ (đơn)   │ Kho     │              │              │          │        │
├──────────────┼─────────┼─────────┼──────────────┼──────────────┼──────────┼────────┤
│ [+] Levelup  │ 45      │ 5       │ $740.00      │ $530.00      │ $210.00  │ 28.4%  │
├──────────────┴─────────┴─────────┴──────────────┴──────────────┴──────────┴────────┤
│ [expand]                                                                            │
│  OMS Orders                   Revenue          Cost                                │
│  ├─ Shipping                  $310.00          $260.00                             │
│  ├─ Fulfillment               $250.00          $180.00  (Tier 1, bracket ≤4 lbs)  │
│  ├─ Packaging Material        $40.00           $0.00                               │
│  └─ Additional                $20.00           —                                   │
│                                                                                    │
│  Warehouse Billing            Revenue          Cost                                │
│  ├─ Inspection Fee            $75.00           $60.00                              │
│  └─ Storage Fee               $45.00           $30.00                              │
└────────────────────────────────────────────────────────────────────────────────────┘
```

> Trong expand row của Fulfillment cost, hiển thị thêm "Tier X, bracket Y lbs"
> để admin biết cost đang tính theo thông số nào.

---

## Files cần cập nhật

### Backend
- `src/models/oms-order.model.js`
  - Thêm `listForSummary({ yearMonth, customerId })` — query nhẹ chỉ lấy cột cần thiết

- `src/models/oms-warehouse-billing.model.js`
  - Không đổi query billing, chỉ tách thành 2 methods riêng:
    `monthlyAggregate()` và `monthlyBillingSectionBreakdown()`

- `src/controllers/oms-warehouse-billing.controller.js`
  - Cập nhật `monthlySummary()` theo luồng mới:
    đọc tier → query orders → tính cost realtime in-memory → merge billing → build response

- `src/services/pricing/fulfillment-cost-calculator.service.js`
  - Đảm bảo export thêm `getTier(monthlyTotal)` — dùng trong controller

- `src/models/oms-packaging-material.model.js`
  - Thêm `findMappingsBySkus(skus)` — bulk lookup, trả về `Map<sku, { cost_price, ... }>`
    để controller dùng mà không query per-order

### Frontend
- `public/js/sections/warehouse-billing.js`
  - Cập nhật render tab Summary theo layout mới
  - Thêm grand total 2 hàng (OMS row + WH/Combined row)
  - Thêm context bar hiển thị tier + warning incomplete
  - Expandable row per customer với breakdown OMS và WH riêng

- `public/views/dashboard.html`
  - Không được viết js inline vào html
```