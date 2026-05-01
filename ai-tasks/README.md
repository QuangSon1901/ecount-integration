# AI TASK RUNNER — OMS + ITC INTEGRATION

You are working on a production Node.js system.

This system already has:
- Existing order flow (ECOUNT)
- Cron jobs (tracking, update ERP)
- Job queue system
- Dashboard admin

Your task is to ADD new OMS + ITC modules WITHOUT breaking existing system.

---

# 🚨 CRITICAL RULES

1. DO NOT break existing ECOUNT flow
2. DO NOT modify existing cron logic unless explicitly required
3. DO NOT reuse `orders` table blindly
4. ALWAYS isolate OMS logic from current system
5. When unsure → ASK before coding

---

# 🧠 EXECUTION RULES

1. Read `rules.md`
2. Read `STATE.md`
3. Execute ONLY current phase
4. After finishing:
   - Summarize output
   - WAIT for confirmation

---

# 📍 CURRENT PHASE

PHASE 8

---

# 📦 PHASE ORDER

1. phase-1-customer-oms.md
2. phase-2-oms-auth.md
3. phase-3-oms-sync.md
4. phase-4-order-storage.md   ← CRITICAL
5. phase-5-itc-label.md
6. phase-6-oms-update.md
7. phase-7-pricing.md
8. phase-8-dashboard.md
9. phase-9-tracking.md
10. phase-10-final-flow.md

---

# 🧱 SYSTEM CONTEXT

## Existing Tables (IMPORTANT)

- api_customers → will be extended
- orders → already used heavily
- jobs → async processing
- cron_logs → cron tracking
- api_logs → API logging
- url_proxies → label proxy
- carrier_labels → label storage

---

# ⚠️ SPECIAL NOTES

## OMS Orders

- MUST NOT conflict with:
  - ECOUNT orders
  - Tracking cron
- Prefer isolation (new table)

## Label Flow

- ITC returns:
  - barcode → tracking_number
  - usd → cost
  - sid → label fetch
- Label must go through `url_proxies`

## Cron Sync

- Runs every 10 minutes
- Pull orders status = New
- Date range = last 7 days

---

# 🔁 EXPECTED FINAL FLOW

1. Cron pulls OMS orders
2. Store safely in system
3. Show in dashboard (Outbound Request)
4. Admin selects orders
5. System calls ITC → buy label
6. Save:
   - tracking
   - cost
   - label
7. Update OMS
8. Tracking cron continues

---

# 🧨 FAILURE RISKS (AVOID)

- OMS orders triggering ECOUNT cron
- Duplicate orders
- Token spam (OMS auth)
- Label not accessible (missing proxy)
- Wrong customer mapping

---

# 🧠 YOUR ROLE

- Think like a senior backend engineer
- Prioritize safety over speed
- Keep code simple, scalable

---

# ▶️ START

Read the current phase file and begin.