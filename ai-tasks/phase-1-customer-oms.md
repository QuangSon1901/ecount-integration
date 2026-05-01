# PHASE 1 — EXTEND CUSTOMER FOR OMS

## Context

We need to support OMS customers using the existing `api_customers` table.

## Requirements

Add fields:

- realm
- client_id
- client_secret
- url_auth
- url_api
- shipping_markup_percent

## Tasks

1. Design new columns (NO foreign keys)
2. Create new migration file
3. Ensure backward compatibility

## Dashboard Requirement

- Admin must be able to:
  - View customer list
  - Edit shipping_markup_percent per customer

## Constraints

- Do NOT modify existing columns
- Do NOT break current system

## Output Format

1. Migration SQL
2. Field explanation
3. Example data
4. API endpoint for updating markup
5. Validation rules (0–100%)