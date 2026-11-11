# DEPLOY1_CONTRACT.md — Slice 1 backend: deploy readiness (no external services)

Work ONLY in `~/workspace/eduverse-fixed/`. Do not rename the app, do not restyle
existing screens. Backend agent owns `backend/server.js`, `backend/codelab.js`,
`backend/exam.js`, `scripts/backup.sh`, `scripts/check-production.mjs`,
`package.json` (scripts only), `docs/DEPLOYMENT.md` (append a go-live checklist).

## 1. Session persistence (the big one)
Sessions live in an in-memory `Map` (`sessions`, 12h sliding expiry, created in
`startSession` + two inline sites at server.js ~831 and ~906, read by `sessionUser`,
deleted on logout). A restart logs everyone out.

- Mirror sessions into the JSON store as `store.sessions[]`:
  `{id, userId, expiresAt}`. Same `Map` stays the hot path (the live module holds
  a reference to it — do NOT replace the Map object).
- On boot (after the store loads, before listening): hydrate the Map from
  `store.sessions`, dropping expired rows; prune the stored list to expired-free.
- On session create (all three sites — route the two inline sites through the
  shared helper): add to Map + `store.sessions`, then `persist()`.
- On logout / expiry cleanup: remove from Map + `store.sessions`, then persist.
- Cap: if stored sessions exceed 5000, drop the oldest expired-first, then oldest.
- Security unchanged: session ids stay `randomBytes(32)` base64url; expiry still
  12h sliding; logout still invalidates. Never log or return session ids.

## 2. Code-runner kill switch
`node:vm` is not a security boundary, so a public deploy needs an off switch.

- Env `CODE_EXEC_ENABLED`: when set to `false` (case-insensitive, trimmed),
  code execution is disabled. Default (unset/anything else): enabled — current
  behaviour preserved.
- `POST /api/code/run` → 503 `{error:'Code execution is disabled on this server.'}`
  (before auth? No — keep the existing auth + rate-limit order; the 503 comes
  after auth, so unauthenticated callers still get 401 first).
- Exam code questions: when disabled, `runCodeTests` must NOT execute code.
  Return a per-question result of 0 marks with a clear note ("code execution
  disabled") so the attempt still submits and grades instead of crashing.
- Judge0 path: when disabled, the Judge0 route also 503s (same message).

## 3. Backup script — `scripts/backup.sh`
- Copies the live store (`$EDUVERSE_STORE_PATH` or `backend/data/store.json`)
  to `backups/eduverse-store-YYYY-MM-DD-HHMMSS.json` (project root `backups/`).
- Verifies the copy parses as JSON before keeping it; on failure, deletes the
  bad copy and exits non-zero.
- Keeps the newest 30 backups, deletes older ones. Prints what it did.
- Safe while the server runs (the server writes atomically via temp+rename).
- Add a cron example in the script header + in DEPLOYMENT.md
  (`0 2 * * * /abs/path/scripts/backup.sh`). Restore note: stop the server,
  copy a backup over `backend/data/store.json`, start again (or use the admin
  backup-restore endpoint).

## 4. Production pre-flight check — `scripts/check-production.mjs`
- Run with `node scripts/check-production.mjs`; add `"check:prod"` to
  package.json scripts. Exits 0 when deployable, non-zero with readable errors.
- Checks (no server start, no writes): Node >= 18; `NODE_ENV=production`
  requires `JWT_SECRET` >= 32 chars and a valid absolute http(s)
  `APP_BASE_URL`; in production `EDUVERSE_ADMIN_SETUP_CODE` must be >= 32
  chars if set (warn that the `123456` default is refused); data directory
  exists and is writable; port from `PORT` (default 4173) is free; `.env`
  is NOT committed (warn if a `.git` repo exists and `.env` is tracked —
  skip silently when there is no repo).
- Append a short go-live checklist to `docs/DEPLOYMENT.md` covering: env vars,
  HTTPS reverse proxy, backups cron, `npm run check:prod`, `npm test`.

## Tests (backend agent)
New `backend/deploy1.test.js` (follow the `audit-fixes.test.js` harness pattern):
login → restart the server process on the SAME store file → the same session
cookie still authenticates (200 on `/api/auth/me`); logout → restart → the old
cookie is rejected (401); expired stored sessions are dropped on boot;
`CODE_EXEC_ENABLED=false` → `/api/code/run` 503s (after auth) and a code exam
question grades 0 with the disabled note instead of executing; default (unset)
→ code run still works. `npm test` green.
