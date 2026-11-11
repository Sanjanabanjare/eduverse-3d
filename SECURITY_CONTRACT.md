# SECURITY_CONTRACT.md — Slice C: security monitoring, backup/restore, integrations

Work ONLY in `~/workspace/eduverse-current/`. Do not rename the app, do not restyle existing screens.
Backend agent owns `backend/server.js` (+ `backend/sec.js` for helpers if cleaner).
Frontend agent owns `app.js`, `styles.css`, `index.html`.
Depends on Slice A: `org.orgScope`, `org.can`. New perm: `security.view`, `backup.manage`, `integrations.manage`.

## Data model

- `securityEvents[]`: `{id, institutionId|null, type, severity:'low'|'medium'|'high'|'critical', actor, detail, ip, at}` — capped at 5000 (drop oldest)
- `integrations[]`: `{id, institutionId, kind:'email'|'payment'|'storage'|'webhook', name, config:{...redacted secrets}, status:'active'|'disabled', createdAt, updatedAt}`
  - Secrets (api keys) stored in `configSecret` (never returned by GET; only set via POST/PATCH)
- Backup is file-based (no new collection): `GET /api/admin/backup/download` streams the store JSON;
  `POST /api/admin/backup/restore` `{backup: {...}}` replaces the store (super_admin only, requires `confirm:true`)

## Backend

- **Login activity:** `loginEvents[]` already exists (Slice B). Add `GET /api/admin/security/logins` (`?days=7&userId=`) → recent logins with ip/userAgent, org-scoped.
- **Security incidents:** log automatically:
  - failed logins (in login handler, `type:'login_failed'`, severity medium; 5+ fails from one IP in 10 min → high + `type:'brute_force'`)
  - rate-limit hits (`type:'rate_limited'`, low)
  - 403s on admin endpoints (`type:'forbidden_admin'`, medium)
  - proctor tab-switch spikes are NOT security events (leave in attempts)
  - `GET /api/admin/security/events` (`?severity=&type=&days=7`) org-scoped; `GET /api/admin/security/summary` → counts by severity/type for dashboard
- **Backup/restore:**
  - `GET /api/admin/backup/download` → attachment `eduverse-backup-YYYY-MM-DD.json` (super_admin or `backup.manage`)
  - `POST /api/admin/backup/restore` `{backup, confirm:true}` → validate it has `users` array, replace store, re-run `org.migrateOrg()`, audit log. Super_admin only.
  - `GET /api/admin/backup/info` → `{sizeBytes, collections:{users: N, ...}, lastBackupAt}` (track last download in settings)
- **Integrations:**
  - `GET /api/admin/integrations` → list with `configSecret` stripped (show `hasSecret:true/false`)
  - `POST /api/admin/integrations` `{kind, name, config, secret}` → validate kind; store secret separately
  - `PATCH /api/admin/integrations/:id` (update config/status/secret), `DELETE`
  - `POST /api/admin/integrations/:id/test` → kind-specific smoke test: `webhook` → POST a ping payload to the URL (5s timeout, report status); `email`/`payment`/`storage` → validate config shape + report "credentials stored (not live-tested)" honestly
- Permissions: add `security.view`, `backup.manage`, `integrations.manage` to matrix (super_admin all; institution_admin `security.view` + `integrations.manage`).

## Frontend — admin screens

- **Security** (`admin-security`): tabs —
  - *Login activity*: table (time, user, role, IP, user agent) with day filter
  - *Incidents*: severity pills, type filter, summary cards at top (critical/high/medium/low counts)
- **Backup** (`admin-backup`): info card (size, collections, last backup), Download button, Restore (file upload + typed CONFIRM + warning that it replaces everything)
- **Integrations** (`admin-integrations`): table (name, kind, status, hasSecret), add/edit form (kind picker, name, config JSON textarea, secret password field), Test button per row showing result, enable/disable toggle
- Add to admin nav. Reuse existing styles.

## Tests (backend agent)

New `backend/sec.test.js`: failed-login event logged; brute-force escalation; rate-limit event; forbidden_admin on 403; backup download content-type + restore round-trip (with confirm guard); integration secret never leaked in GET; webhook test handles bad URL gracefully. `npm test` green.
