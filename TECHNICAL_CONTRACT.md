# TECHNICAL_CONTRACT.md — Slice D: production technical upgrades

Work ONLY in `~/workspace/eduverse-current/`. Do not rename the app, do not restyle existing screens.
Backend agent owns backend + `migrations/`, `docs/`, `scripts/`. Frontend agent owns `app.js`/`index.html` search UI.

**Guiding rule (from emi): env-optional with working local fallbacks.** Every external service
(Postgres, S3, email, payments, Redis, monitoring) must work WITHOUT keys via a local fallback,
and activate via env vars. Never hard-require a key. State honest limits in docs.

## Backend

1. **PostgreSQL schema** — `migrations/001_initial.sql`: full relational schema for the core
   domain (institutions, campuses, departments, academic_years, semesters, users, courses,
   lessons, quizzes, questions, attempts, enrollments, fee_structures, fee_records,
   marketplace_listings, institutions' subscriptions). Proper PKs/FKs, indexes on foreign keys,
   `created_at` defaults. `docs/POSTGRES.md`: migration guide (how to point `DATABASE_URL` at
   Postgres, what still needs a data-layer rewrite — be honest: the JSON store remains the
   runtime default; this schema is the migration target).
2. **Storage abstraction** — `backend/storage.js`: `saveFile({buffer, mimeType, folder})` →
   `{url}`; `getFile(path)`; `deleteFile(path)`. Default: local disk `backend/uploads/`
   (served at `/uploads/`). If `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`
   are set: S3-compatible PUT via signed fetch (no new npm deps — hand-rolled SigV4).
   Wire into the existing image-upload endpoint (HORLOGE pattern: validate mimetype, 5MB cap).
3. **Email provider** — `backend/email.js`: `sendEmail({to, subject, html})`. Default: dev outbox
   (existing behavior — log + store in `store.emailOutbox`). If `EMAIL_PROVIDER=resend` +
   `RESEND_API_KEY`: POST to Resend API. If `sendgrid` + key: SendGrid API. Wire into password
   reset (already exists) so it actually sends when configured.
4. **Payments** — extend test-mode: `backend/payments.js`: `createOrder({amount, currency})`,
   `verifyWebhook(payload, signature)`. If `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET`: real
   Razorpay orders API + HMAC webhook verify. Else if `STRIPE_SECRET_KEY`: Stripe PaymentIntent
   + webhook verify. Else: test-mode (existing). Wire into fee payment endpoint as an option.
5. **Full-text search** — `backend/search.js`: in-memory inverted index built at startup over
   courses (title/description), lessons (title/content), quizzes (title). `GET /api/search?q=`
   (min 2 chars, max 20 results, org-scoped). Rebuild index on course/lesson/quiz writes
   (debounced 5s).
6. **Cache abstraction** — `backend/cache.js`: `get/set/del` with TTL. Default: in-memory Map.
   If `REDIS_URL`: use Redis via raw RESP over `node:net` (no new deps) — implement minimal
   GET/SET/DEL with expiry. Use for: branding endpoint (60s), marketplace browse (30s),
   usage analytics (60s).
7. **Notifications** — extend `store.notifications`: `notify(userId, {kind, title, body, link})`
   helper; triggers on: fee assigned, quiz graded, live class scheduled, marketplace purchase.
   `GET /api/notifications` already exists (check). Email hook: if email configured, also queue
   email for `kind:'email'` notifications.
8. **Monitoring** — `backend/monitor.js`: `captureError(err, ctx)`; if `SENTRY_DSN` set: POST
   to Sentry envelope API (minimal); else: log to stderr + `store.errorLog` (capped 200,
   admin-viewable at `GET /api/admin/monitoring/errors`). Wrap the server's uncaught handler.
9. **Load test** — `scripts/load-test.mjs`: uses `autocannon` (add to devDependencies) to hit
   `/api/health`, `/api/marketplace/courses`, login flow; print p50/p99. Document in README.
10. **Deploy docs** — `docs/DEPLOYMENT.md`: HTTPS (reverse proxy example: Caddy), CI/CD
    (extend `.github/workflows` if present, else create), automated backups (cron example
    hitting `/api/admin/backup/download` with a service key — add `BACKUP_API_KEY` env support),
    env var reference table for all of the above.

## Frontend

- **Search UI**: header search box (all roles) → `GET /api/search?q=` → results dropdown/page
  with course/lesson/quiz groupings, keyboard accessible.
- **Notifications**: extend existing notifications UI (check what exists) to show new kinds
  with links; unread badge.
- No other UI changes.

## Tests (backend agent)

New `backend/tech.test.js`: storage local save/get/delete; email falls back to outbox without
keys; payments test-mode order; search returns org-scoped results; cache set/get/TTL expiry;
notification created on fee assign; monitor captures without DSN. `npm test` green.
Note: S3/Resend/Stripe/Redis/Sentry paths are NOT live-tested (no keys) — assert the fallback
selection logic only, and document honestly.
