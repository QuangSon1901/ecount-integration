# PHASE 3 — OMS ORDER SYNC (CRON)

## Context

We need to pull orders from OMS.

## Requirements

- Cron every 10 minutes
- Query:
  - Status = New
  - Date range = last 7 days
- Handle pagination

## Tasks

1. Design cron job
2. Fetch all pages
3. Normalize response

## Constraints

- Do NOT insert into DB yet
- Only fetch + transform

## Output Format

1. Cron flow
2. API calling logic
3. Pagination handling