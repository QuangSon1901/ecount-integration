# PHASE 4 — OMS ORDER STORAGE STRATEGY

## Context

We must store OMS orders WITHOUT breaking existing system.

## Problem

Existing `orders` table is used by:
- ECOUNT
- Tracking cron
- Other modules

## Requirements

- Store OMS orders safely
- Avoid triggering existing cron jobs

## CRITICAL REQUIREMENTS

### Field Mapping Rule

- Data source:
  - OMS response (order info)
  - ITC response (label, cost)

- Structure MUST follow existing `orders` table naming

### Mapping Example

- receiver_name → customerName
- receiver_address_line1 → shippingFullAddress
- tracking_number → barcode (ITC)
- declared_value → OMS price
- items → details[]

### Editable Fields

Admin can edit:

- receiver_name
- receiver_address
- phone
- pricing fields
- internal status

### Readonly Fields

- orId
- OMS raw data
- createdDate

## Tasks

1. Decide strategy:

Recommended:
- Create new table: `oms_orders`

2. Add fields:

- raw_data (JSON from OMS)
- editable_data (normalized fields)

3. Prevent:

- ECOUNT cron picking OMS orders
- tracking conflict

## Constraints

- MUST NOT break existing cron logic
- MUST isolate OMS flow

## Output Format

1. Chosen strategy
2. Schema design
3. Field mapping table
4. Editable vs readonly fields
5. Insert logic
6. Safety rules