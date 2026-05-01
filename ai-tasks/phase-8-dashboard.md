# PHASE 8 — DASHBOARD (OUTBOUND REQUEST)

## Context

Admin UI to manage OMS orders.

## Requirements

### 1. Order List

- Show OMS orders
- Table view

### 2. Bulk Actions

- Select multiple orders
- Create label

### 3. Order Editing

Admin must be able to edit:

- receiver_name
- receiver_address
- phone
- pricing fields
- internal status

### 4. Field Rules

- Structure: follow `orders` table
- Data:
  - OMS → base data
  - ITC → shipping data

### 5. Customer View

- Show:
  - shipping_markup_percent
- Allow:
  - Edit markup %

## API Requirements

- GET /oms-orders
- PUT /oms-orders/:id
- POST /oms-orders/create-label
- PUT /customers/:id/markup

## Constraints

- Separate OMS UI from ECOUNT UI
- Use server-rendered HTML + JS

## Output Format

1. API design
2. UI structure
3. Interaction flow
4. Example request/response