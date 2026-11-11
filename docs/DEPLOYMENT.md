# Deployment guide — EduVerse 3D

## 1. HTTPS (reverse proxy)

Never expose Node directly. Put Caddy (or nginx) in front:

```caddy
# /etc/caddy/Caddyfile
eduverse.example.com {
    reverse_proxy 127.0.0.1:4173
}
```

Caddy handles TLS automatically (Let's Encrypt). With nginx:

```nginx
server {
    listen 443 ssl;
    server_name eduverse.example.com;
    ssl_certificate /etc/letsencrypt/live/eduverse.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/eduverse.example.com/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:4173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";   # required for /ws live classroom
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

The WebSocket upgrade headers are required for the live-classroom `/ws` endpoint.

## 2. Process management

```bash
# systemd unit: /etc/systemd/system/eduverse.service
[Unit]
Description=EduVerse 3D
After=network.target

[Service]
User=eduverse
WorkingDirectory=/opt/eduverse/eduverse-3d
EnvironmentFile=/opt/eduverse/.env
Environment=NODE_ENV=production
Environment=APP_BASE_URL=https://eduverse.example.com
ExecStart=/usr/bin/node backend/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now eduverse
```

## 3. CI/CD (GitHub Actions)

`.github/workflows/ci.yml` runs on every push: `npm ci`, `npm test`, and a zip
build check. Extend it with a deploy job for your host (SSH + rsync example in
comments).

## 4. Automated backups

The app exposes `GET /api/admin/backup/download` (requires `backup.manage`
permission, or the service key below). Schedule it with cron:

```bash
# /etc/cron.d/eduverse-backup — nightly at 02:30, keep 14 days
30 2 * * * eduverse /usr/bin/curl -fsS -H "X-Backup-Key: $BACKUP_API_KEY" \
  https://eduverse.example.com/api/admin/backup/download \
  -o /var/backups/eduverse/backup-$(date +\%F).json \
  && find /var/backups/eduverse -name 'backup-*.json' -mtime +14 -delete
```

**`BACKUP_API_KEY`**: set this env var and the download endpoint also accepts
`X-Backup-Key: <key>` without a session cookie — for cron/service use. Without
the env var, only a logged-in admin with `backup.manage` can download.

Restore is a manual, super-admin-only step: `POST /api/admin/backup/restore`
with `{confirm:true, backup:{...}}`. Test restores on a staging copy first.

## 5. Environment variable reference

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | 4173 | HTTP listen port |
| `EDUVERSE_STORE_PATH` | no | `backend/data/store.json` | JSON store location |
| `DATABASE_URL` | no | — | Postgres URL (migration target; see `docs/POSTGRES.md` — no effect until the data-layer rewrite) |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` | no | local disk | S3-compatible file storage (`S3_REGION`, `S3_PUBLIC_BASE` optional) |
| `EMAIL_PROVIDER` | no | outbox | `resend` or `sendgrid` |
| `RESEND_API_KEY` / `SENDGRID_API_KEY` | no | — | Email provider keys |
| `EMAIL_FROM` | no | noreply@eduverse.local | Sender address |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | no | test-mode | Real Razorpay orders |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | no | test-mode | Real Stripe PaymentIntents |
| `REDIS_URL` | no | in-memory | `redis://[:pass@]host:port/db` cache backend |
| `SENTRY_DSN` | no | local errorLog | Sentry error reporting |
| `BACKUP_API_KEY` | no | — | Service key for automated backup downloads |
| `OPENAI_API_KEY` | no | local built-in responses | Nova OpenAI integration |
| `NOVA_MODEL` | no | gpt-4o-mini | Nova model override |
| `APP_BASE_URL` | production | local URL | Canonical public HTTPS origin used for auth/CSRF checks and emailed links |
| `JWT_SECRET` | production | random per-process fallback in development | Private signing secret, at least 32 characters; required at startup in production |
| `EDUVERSE_ADMIN_SETUP_CODE` | production for browser setup | 123456 in development only | At least 32 characters; required for first-admin browser setup in production |

Local development has fallbacks for optional services. Production must set
`NODE_ENV=production`, HTTPS `APP_BASE_URL`, a private 32+ character
`JWT_SECRET`, and a private 32+ character
`EDUVERSE_ADMIN_SETUP_CODE` if using the browser's first-admin setup. Teacher
self-signup is disabled in production until real email verification is
configured; administrators can create teacher accounts. The demo OTP is not a
real verification channel.

## 6. Production checklist

- [ ] Set `EDUVERSE_ADMIN_SETUP_CODE` to a random secret of at least 32 characters
- [ ] Set `APP_BASE_URL` to the public HTTPS origin, a private 32+ character `JWT_SECRET`, and `NODE_ENV=production`
- [ ] Create teacher accounts from administrator tools; the demo OTP is not a production verification mechanism
- [ ] Set `EMAIL_FROM` to a real domain; verify DNS (SPF/DKIM) with your provider
- [ ] Sessions persist in `store.sessions` across restarts (12h sliding
      expiry, 5000 cap) — for multi-instance deployments you still need
      sticky sessions or the Postgres sessions table (see `docs/POSTGRES.md`)
- [ ] Backups: cron job above + off-site copy (e.g. `rclone` to S3)
- [ ] Set `SENTRY_DSN` so crashes reach you
- [ ] Run `npm run load-test` against staging before launch
- [ ] Review `docs/POSTGRES.md` before outgrowing the JSON store

## 7. Go-live checklist (deploy readiness, 2026-11-11)

Run through this in order on the deploy machine. Every item is checkable
with the commands below — no guessing.

- [ ] **Environment** — copy `.env.example` to `.env` and fill in real values:
  `NODE_ENV=production`, `JWT_SECRET` (random, 32+ characters),
  `APP_BASE_URL` (public HTTPS origin, e.g. `https://eduverse.example.com`),
  `EDUVERSE_ADMIN_SETUP_CODE` (random, 32+ characters, for first-admin setup).
  Never commit `.env` (see `.gitignore`).
- [ ] **Pre-flight check** — `npm run check:prod` exits 0. It verifies Node >= 18,
  the production secrets above, that the data directory is writable, that the
  port is free, and that `.env` is not tracked in git. Fix every `FAIL` line.
- [ ] **HTTPS reverse proxy** — put the app behind Caddy or nginx terminating
  TLS and proxying to `http://127.0.0.1:4173`. The session cookie is `Secure`
  only in production, so plain-HTTP serving breaks sign-in. Point
  `APP_BASE_URL` at the public origin.
- [ ] **Backups** — schedule the local backup script, nightly at 02:00:
  `0 2 * * * /abs/path/to/eduverse-3d/scripts/backup.sh`
  It copies the live store to `backups/eduverse-store-YYYY-MM-DD-HHMMSS.json`,
  verifies the copy parses as JSON, and keeps the newest 30. Add an off-site
  copy (e.g. `rclone` to S3). The `GET /api/admin/backup/download` cron in
  section 4 is the remote alternative. Test a restore on a staging copy first.
- [ ] **Tests** — run `npm test` and confirm the full suite passes, including
  `backend/deploy1.test.js`.
- [ ] **Code execution** — the in-process code runner (`node:vm`) is not a
  security boundary. On a public deploy, either connect Judge0
  (`JUDGE0_API_URL`) or disable execution entirely with
  `CODE_EXEC_ENABLED=false`: `/api/code/run` then 503s and exam code questions
  grade 0 with a "code execution is disabled" note instead of running code.
- [ ] **Sessions** — sign-ins now survive a restart: sessions are mirrored
  into `store.sessions` (12h sliding expiry, 5000 cap). The store file holds
  session ids, so keep it `0600`, backed up, and never shared.
- [ ] **Email / payments** — optional for launch, local fallbacks apply:
  without a provider, email goes to the admin outbox and payments stay in
  test mode. Set `RESEND_API_KEY`/`SENDGRID_API_KEY` + `EMAIL_FROM` for real
  mail, `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` (or Stripe) for real payments.
- [ ] **After launch** — watch the admin error log / `SENTRY_DSN`, confirm the
  first nightly backup appears in `backups/`, and re-run
  `npm run check:prod` after any environment change.
