# PHASE 5 — ITC LABEL INTEGRATION

## Context

We buy shipping labels via ITC API.

## Requirements

- Create order → get:
  - tracking number (barcode)
  - cost (usd)
  - sid

- Fetch label PDF

## Tasks

1. Build ITC service
2. Map OMS order → ITC request
3. Store:
   - tracking_number
   - cost
   - label_url (via proxy)

## Additional Requirements

After label creation:

- Update order fields:
  - tracking_number
  - label_url
  - cost

- Must reflect immediately in dashboard

## Constraints

- Use existing `url_proxies`
- Do NOT break carrier_labels

## Output Format

1. Service design
2. API mapping
3. Example request/response
4. DB update flow
5. UI update strategy