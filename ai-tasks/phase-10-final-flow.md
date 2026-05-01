# PHASE 10 — FINAL FLOW & SAFETY

## Context

Combine everything into final system.

## Flow

1. Cron pulls OMS orders
2. Store in DB
3. Show in dashboard
4. Admin edits order
5. Admin creates label
6. System calls ITC
7. Save:
   - tracking
   - cost
   - label
8. Update OMS
9. Tracking continues

## Additional Requirements

Include:

- Editing flow
- Pricing recalculation
- Markup per customer

## Tasks

1. Define full system flow
2. Add error handling
3. Add retry logic
4. Identify failure points

## Constraints

- Do NOT rewrite previous phases

## Output Format

1. Full flow
2. Edit flow diagram
3. Failure scenarios
4. Best practices