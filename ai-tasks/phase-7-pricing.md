# PHASE 7 — COST & PRICING

## Context

We calculate profit from ITC cost.

## Requirements

- Use markup % from customer

## Tasks

1. Define fields:

- shipping_fee_purchase
- shipping_fee_selling
- fulfillment_fee_purchase
- fulfillment_fee_selling
- gross_profit

2. Store in DB

## Additional Requirements

Pricing must be editable:

- shipping_fee_purchase → readonly
- shipping_fee_selling → editable
- fulfillment_fee → optional editable
- gross_profit → auto

## Rules

- If selling price changes → recalculate profit

## Constraints

- Keep formula simple

## Output Format

1. Pricing logic
2. DB fields
3. Example calculation
4. Editable logic
5. Recalculation rules