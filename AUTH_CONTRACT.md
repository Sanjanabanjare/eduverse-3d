# AUTH_CONTRACT.md — JWT auth + Google login + email verification/reset hardening

Work ONLY in `~/workspace/eduverse-current/`. Do not rename the app, do not restyle existing screens.
Backend agent owns `backend/server.js` (+ `backend/jwt.js`, `backend/google.js` if cleaner).
Frontend agent owns `app.js`, `styles.css`, `index.html`.
Depends on everything existing. **Backward compatibility is a hard requirement: all 144 existing
tests must keep passing — session-cookie auth stays, JWT is added alongside it.**

## Current state (verified 2026-11-10)
- Session auth via httpOnly cookies exists; roles admin/teacher/student/parent (+ super/institution admin).
- Email verification (24h) + password reset (1h, no enumeration) exist via session flow + dev outbox.
- **Missing**: JWT tokens, Google login. This slice adds both.

## Backend

### `backend/jwt.js` (new, no new deps — HS256 via node:crypto)
- `sign(payload, expiresInSec)` / `verify(token)`; secret from `JWT_SECRET` env (dev fallback
  warning logged, never committed); `iss:'eduverse'`, `aud:'eduverse-api'`.
- Access token: 1h. Refresh token: 7d, stored hashed in `store.refreshTokens[]`
  `{id, userId, hash, createdAt, expiresAt, revoked}`.
- `POST /api/auth/refresh` `{refreshToken}` → new access token (rotates refresh token);
  `POST /api/auth/logout` revokes refresh token + clears session.

### Auth middleware (server.js)
- Accept **either** session cookie (existing) **or** `Authorization: Bearer <jwt>` on every
  protected route. JWT payload → `req.auth` in the same shape as session auth
  (`{id, username, role, institutionId, ...}`), so all existing permission checks keep working.
- JWT payload: `{sub, username, role, institutionId, iat, exp}`. Role comes from the user record
  at sign time; a changed role invalidates old tokens only at refresh (document).

### Login / signup (extend existing endpoints, do not break them)
- `POST /api/auth/signup` and `POST /api/auth/login` keep their current responses AND add
  `{accessToken, refreshToken, tokenType:'Bearer', expiresIn:3600}` on success.
  Student/teacher registration rules unchanged (teacher pending approval, OTP, terms).
- `POST /api/auth/verify-email` — check existing flow; ensure the response also returns
  JWT tokens (so a verified user is immediately logged in via token too). If the existing
  endpoint is named differently, wire tokens into it instead of renaming.
- `POST /api/auth/forgot-password` / `POST /api/auth/reset-password` — verify they work;
  reset response also returns JWT tokens on success.

### Google login (`backend/google.js`, env-optional)
- Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
  (default `http://127.0.0.1:4173/api/auth/google/callback`).
- `GET /api/auth/google` → 302 to Google authorize URL with `state` (signed, 10-min, CSRF).
- `GET /api/auth/google/callback` → exchange code for tokens (server-side fetch), fetch profile
  from `https://www.googleapis.com/oauth2/v2/userinfo`, find-or-create user by Google `sub`
  (store `googleId` on user; match by verified email if no googleId yet), set session cookie,
  issue JWT pair, redirect to `/?google=ok` (or `?google=error` on failure).
- `POST /api/auth/google` `{idToken}` → verify via `https://oauth2.googleapis.com/tokeninfo`
  (check `aud === GOOGLE_CLIENT_ID`, `exp`, `email_verified`) → same find-or-create → JWT pair.
- New Google users default to role `student` (teachers must be approved by admin afterwards —
  same rule as normal signup; document it).
- When env vars are missing: `GET /api/auth/google` returns 501 with a clear message
  ("Google login is not configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET").
  The UI hides the button in that case (frontend checks `/api/auth/google/status`).

### Role-based access (JWT)
- `GET /api/auth/me` → current user from either auth method (proves JWT works).
- All existing role gates must work identically for Bearer tokens (test: admin-only endpoint
  with student JWT → 403; teacher endpoint with student JWT → 403).

### Profile management (JWT)
- Existing `PATCH /api/profile` must accept Bearer tokens (it will, via the middleware).
- Add `GET /api/profile` returning the full editable profile (for API clients).

## Frontend
- **Google button**: "Continue with Google" on sign-in and signup screens (links to
  `/api/auth/google`); hidden when `/api/auth/google/status` says unconfigured. Handle
  `?google=ok` / `?google=error` on load (show a toast/message).
- **Token display**: profile page gets an "API access" section showing the current JWT
  (from the login response, stored in localStorage as `eduverse.jwt`) with Copy + Regenerate
  (calls refresh) + Revoke (calls logout). Honest label: tokens are for API access; the web
  app itself uses the secure session cookie.
- **Profile management**: verify the existing profile screen works; no redesign.
- After login/signup, store the returned JWT in localStorage for API use; API helper sends
  `Authorization: Bearer` when no session cookie path is used (keep cookie-first behaviour).

## Tests (backend agent)
New `backend/auth.test.js`: signup/login return JWTs; Bearer token authenticates
(`/api/auth/me`); expired/tampered token → 401; role gates enforced for Bearer tokens;
refresh rotates + old refresh rejected; logout revokes; Google status endpoint when
unconfigured (501 on launch); Google idToken path with a mocked fetch (inject a fetch stub
or test the verify helper directly); email verify + reset return tokens. `npm test` green.

## Response shapes (backend implemented — for the frontend agent)

- Login/signup success: `{user, accessToken, refreshToken, tokenType:'Bearer', expiresIn:3600}`
  (signup: `{created:true, user, message, ...pair}`; pending teacher: `{pending:true}` — no tokens).
- `POST /api/auth/refresh` `{refreshToken}` → `{user, accessToken, refreshToken, tokenType:'Bearer', expiresIn:3600}` (rotates; old refresh token is dead afterwards). 401 on invalid/revoked/expired.
- `POST /api/auth/logout` `{refreshToken?}` → `{ok:true}`; revokes the given token, or ALL of the
  caller's refresh tokens when no token is given; clears the session cookie.
- `POST /api/auth/token` (auth'd) → fresh pair for the current user (used after the Google
  redirect, which cannot carry tokens in the URL).
- `GET /api/auth/me` → `{user}` via session cookie OR `Authorization: Bearer <jwt>`.
- `GET /api/profile` already exists and now accepts Bearer tokens; `PATCH /api/profile` likewise.
- `POST /api/auth/send-verification` (auth'd) → `{ok:true, message}`; requires an email on the
  profile; sends a 24h link `/#verify-email?token=…` via email (dev outbox when unconfigured).
- `POST /api/auth/verify-email` `{token}` → `{ok:true, user, ...pair}`; single-use token.
- `POST /api/auth/reset-password` `{token, password}` → `{ok:true, user, ...pair}` (also starts a
  session and revokes all pre-reset refresh tokens).
- `GET /api/auth/google/status` → `{configured: bool}`.
- `GET /api/auth/google` → 302 to Google when configured, else 501
  `{error:'Google login is not configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.'}`.
- `GET /api/auth/google/callback` → 302 to `/?google=ok` or `/?google=error` (session cookie set).
- `POST /api/auth/google` `{idToken}` → `{user, ...pair}` when configured, else 501.
- Notes: `publicUser` now includes `emailVerified`. Role changes apply immediately to Bearer
  tokens (the user is re-resolved from the store on every request). Google users default to
  `student`; Google never attaches to a pending/non-active account. No `JWT_SECRET` env →
  random per-process secret (tokens don't survive a restart) + a startup warning.
