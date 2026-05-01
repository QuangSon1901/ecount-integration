# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common commands

```bash
npm run dev              # API server with nodemon (server.js → src/app.js, port 3000)
npm run dev:worker       # Worker process with nodemon (worker.js — crons + queue workers)
npm start                # Production API server
npm run worker           # Production worker process
npm run migrate          # Run pending DB migrations (idempotent)
npm run migrate:fresh    # DROP all tables then re-run all migrations (DESTRUCTIVE)
npm run cron <job-name>  # One-shot run of a cron job: `update-status` or `tracking`
node scripts/create-admin.js <username> <password> [full_name] [email]
```

There is no test runner (`npm test` is a placeholder). Deployment is `make deploy` (stash, pull, rebuild+restart docker-compose). The `make push` target commits with a hardcoded message — avoid running it from Claude.

## Two-process architecture

`server.js` and `worker.js` are independent entry points that share the same codebase, MySQL pool, and session store:

- **`server.js`** — boots Express (`src/app.js`). HTTP only; does not run crons or queue workers.
- **`worker.js`** — boots `WorkerManager` + all node-cron schedulers. Does not listen on HTTP.

In docker-compose they run as separate containers (`yunexpress-app`, `yunexpress-worker`) sharing `.env`, `./logs`, and `./public/uploads/pod`. The worker container needs `shm_size: 2gb` and `seccomp:unconfined` because it runs Chromium via Playwright/Puppeteer.

Both processes call `db.testConnection()` on boot and exit on failure.

## Job queue (MySQL-backed)

Jobs are not Redis/BullMQ — they live in the `jobs` table and are claimed with `SELECT … FOR UPDATE SKIP LOCKED`.

- **Producers** call typed factories on `src/services/queue/job.service.js` (`addCreateOrderJob`, `addUpdateTrackingNumberJob`, `addPodCreateOrderJob`, `addLookupDocNoJob`, `addWebhookDeliveryJob`, etc.). Each writes a row with `job_type`, JSON `payload`, `available_at`, `max_attempts`.
- **Consumers** extend `src/jobs/workers/base.worker.js`. `BaseWorker` polls every `intervalMs` (default 5s), claims up to `concurrency` jobs of its `jobType`, and calls subclass `processJob(job)`. Failures are retried until `attempts >= max_attempts`; stuck `processing` rows older than 30 min are auto-reset.
- **Wiring** is in `src/jobs/workers/manager.js` — the `this.workers = [ … ]` array is the source of truth for which workers actually run. **Many workers are intentionally commented out** here as a runtime feature flag; do not "tidy up" by deleting them. To enable/disable a worker, uncomment/comment its line.

When adding a new background task: create the worker class extending `BaseWorker`, add a `addXxxJob` factory to `job.service.js`, and register the worker in `manager.js`.

## Cron jobs

Started by `worker.js` via `node-cron`:

| File | Schedule | Purpose |
|------|----------|---------|
| `fetch-tracking.cron.js` | `*/1 * * * *` | Pull tracking events from carriers, queue ERP updates |
| `update-status.cron.js` | `*/5 * * * *` | Drive Playwright batches that push status to ECount |
| `pod-fetch-tracking.cron.js` | `*/5 * * * *` | Same loop for POD warehouse orders |
| `sync-orders-ecount.cron.js` | `0 6,18 * * *` | Twice-daily Playwright scrape of ECount order list |
| `cleanup-sessions.cron.js` | `0 */6 * * *` | Delete expired rows from `sessions` |

`src/cli/run-cron.js` allows manual invocation of `update-status` and `tracking` for debugging without waiting for the schedule.

## External integrations (factory pattern)

Two parallel factories, both auto-registered at module load based on `enabled` flags:

- **Carriers** (`src/services/carriers/index.js`) — `getCarrier('YUNEXPRESS' | 'YUNEXPRESS_CN')`, configured in `src/config/carriers.config.js`. Each carrier has its own `productCodes` whitelist; tracking crons union them and only act on orders whose `product_code` is in the list.
- **POD warehouses** (`src/services/pod/index.js`) — `getWarehouse('ONOS' | 'S2BDIY' | 'PRINTPOSS')`, configured in `src/config/pod-warehouses.config.js`. The `hasWebhook` flag indicates whether the warehouse pushes updates to `/api/webhooks/pod` (verified with HMAC) vs. requiring polling.

When adding a new carrier or warehouse: implement the service, add it to the corresponding config, and register it in the factory's `initialize…()`.

## ECount ERP integration

ECount has no public API for our use case. Integration is **browser automation** via Playwright (preferred, `playwright-ecount.service.js`) and Puppeteer (legacy, `ecount.service.js`). Cookies are persisted to the `sessions` table so the worker can survive restarts without re-logging in.

There are **two distinct ECount accounts** with separate session managers:
- **Express** account (`config.ecount`, session_key `ecount:main`) — used by carrier order workers.
- **POD** account (`config.ecount_pod`, session_key `ecount:pod`) — used by `pod-*` workers.

`ECountSessionManager` (`src/services/erp/ecount-session.manager.js`) is account-aware — its `accountConfig` is stored in session metadata and validated when reloading from DB to prevent cross-account contamination. When touching ERP code, always confirm which account the call belongs to.

`addLookupDocNoJob` takes an `accountType: 'express' | 'pod'` param for this reason.

## Database migrations

All migrations live as a single in-memory array in `src/database/migrate.js` (versioned 1…N). The `src/database/migrations/` directory exists but is not currently used by the runner. To add a migration: append a new `{ version, name, up }` object to the array — never edit existing entries (already-applied versions are skipped via the `migrations` table).

The `orders.status` ENUM has been expanded across migrations 9, 34, 37 to unify Express and POD lifecycles. Adding a new status requires another `ALTER TABLE … MODIFY COLUMN status ENUM(…)` migration that re-lists every existing value.

## Two authentication systems

Do not confuse them — they target different routes and use different middleware:

1. **Public REST API** (`/api/v1/**`) — OAuth-style Bearer tokens.
   - Tables: `api_customers`, `api_credentials`, `api_access_tokens`, `api_audit_logs`, `api_rate_limits`.
   - Middleware chain: `apiAuditMiddleware` (always) → `apiAuthMiddleware` → `apiRateLimitMiddleware`.
   - Tokens issued by `/api/v1/auth/*` and verified in `src/middlewares/api-auth.middleware.js`.

2. **Admin/customer portal** (`/extensions/**`, login at `/`) — HMAC-signed `app_session` cookie.
   - Table: `admin_users`; customers reuse `api_customers.portal_password_hash`.
   - Middleware: `requireAuth` / `requireAdmin` / `requireCustomer` from `src/middlewares/session-auth.middleware.js`.
   - Secret comes from `APP_SESSION_SECRET` — must be set in production.

Inbound POD webhooks (`/api/webhooks/pod`) use a third scheme (HMAC over raw body). `src/app.js` captures `req.rawBody` only for paths under `/api/webhooks/`; do not move that check without updating webhook verification middleware.

## Logging side-effect

`src/utils/logger.js` monkey-patches `logger.error` to fire a Telegram notification when `TELEGRAM_ON_ERROR=true` and the message matches keywords (`Failed`, `Error`, `Lỗi`, or `meta.critical === true`). Loud or noisy errors will spam the Telegram channel — use `logger.warn` for expected/recoverable conditions.

## Conventions

- The codebase is bilingual: identifiers and route paths in English, comments and log messages in Vietnamese. Match the surrounding style.
- Timezone is hard-pinned to `Asia/Ho_Chi_Minh` (Dockerfile + `.env`). Use server-local time in cron schedules; do not switch to UTC without coordinating.
- Uploads/labels are served from `public/uploads` (mounted as a volume); `url_proxies` table provides short-key indirection for long carrier/POD URLs (see migration 40 and `src/utils/key-generator.js`).
