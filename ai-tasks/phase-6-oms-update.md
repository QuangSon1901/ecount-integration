# PHASE 6 — UPDATE OMS LOGISTIC INFO

## Context

After buying label, update OMS.

## Requirements

POST /ors/{orId}/logistic-info

## Tasks

1. Build update service
2. Send:
   - trackingCode
   - shippingLabel (proxy URL)
   - tplCode

## Constraints

- Must use correct customer token
- Retry on failure

## Output Format

1. Flow
2. API call code
3. Error handling