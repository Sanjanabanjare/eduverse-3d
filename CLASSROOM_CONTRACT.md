# CLASSROOM_CONTRACT.md — Slice 3: virtual classroom gaps (Agora provider option + verification)

Work ONLY in `~/workspace/eduverse-current/`. Do not rename the app, do not restyle existing screens.
Backend agent owns `backend/server.js` (+ `backend/classroom.js` if cleaner).
Frontend agent owns `app.js`, `styles.css`, `index.html`.

## Current state (verified 2026-11-10 — do NOT rebuild)
- Live sessions: schedule (`POST /api/teacher/live-sessions`), join (`POST /api/live-sessions/:id/join`),
  list, PATCH/DELETE. Live classroom: WebRTC P2P mesh (video/audio/screenshare), `ws` signaling,
  chat, hand raise, Q&A, polls, whiteboard, slides, breakout rooms, recording, attendance.
- This slice adds ONLY the gaps below + a verification pass.

## Backend
- **Video provider setting**: `GET /api/settings/video-provider` (public-ish, auth'd) →
  `{provider: 'webrtc' | 'agora', agoraConfigured: bool}`. Provider chosen by env:
  `VIDEO_PROVIDER=agora` + `AGORA_APP_ID` (+ `AGORA_APP_CERT` for token generation).
- **Agora token endpoint**: `POST /api/live/token` `{channel, role}` (auth'd, only when Agora
  configured) → `{token, appId, channel, uid}`. Token built with the standard Agora
  HMAC-SHA256 algorithm (implement in `backend/classroom.js`, no new deps). When Agora is
  not configured → 501 with a clear message.
- **Attendance report**: `GET /api/teacher/live-sessions/:id/attendance` → `{session, attendees,
  present, total}` (from join records + live-classroom attendance). Teacher owner or admin.
- **Session reminders**: `GET /api/live-sessions/upcoming` (auth'd) → sessions starting in the
  next 60 min for the requester (student: enrolled/open; teacher: own). Used by the frontend
  "starting soon" banner.

## Frontend
- **Provider-aware classroom**: `live-classroom` checks the provider setting on load. When
  `agora` + configured: show the Agora mode — join via the Agora Web SDK (loaded from CDN
  only when needed; if the SDK fails to load, fall back to WebRTC with a notice). Honest label:
  "Agora mode needs your administrator to configure AGORA_APP_ID."
  When `webrtc` (default): existing behaviour, unchanged.
- **Starting-soon banner**: on the student/teacher dashboards, show live sessions starting
  within 60 min with a Join button.
- **Attendance**: teacher live-session list shows present/total per session (from the new endpoint).

## Tests (backend agent)
New `backend/classroom.test.js`: Agora token generation is deterministic and verifies
(known test vector — build token, verify its signature with the same code); token endpoint
501 when unconfigured; attendance report scoping (other teacher 404); upcoming filter.
`npm test` green.

## Implemented response shapes (backend, 2026-11-10)
- `GET /api/settings/video-provider` → `{provider: 'webrtc'|'agora', agoraConfigured: bool}`.
  `provider` is `'agora'` only when `VIDEO_PROVIDER=agora` and `AGORA_APP_ID` are set;
  `agoraConfigured` is true only when both `AGORA_APP_ID` and `AGORA_APP_CERT` are set.
- `POST /api/live/token` `{channel, role?: 'publisher'|'subscriber' (default publisher),
  expireInSec?: 60..86400 (default 3600)}` → `{token, appId, channel, uid, role, expiresAt}`.
  Token is an Agora RTC v006 token (`"006" + base64(...)`); `uid` is a stable per-user
  number derived from the user id. 501 `{error}` when Agora is not configured; 400 on a
  bad channel/role; 401 when unauthenticated. No session-membership check on the channel.
- `GET /api/teacher/live-sessions/:id/attendance` → `{session: {id, title, startsAt,
  durationMin, status, courseId}, attendees: [{userId, name, joinedAt|null}], present, total}`.
  `present` = joiners; `total` = enrolled students when the session is course-linked,
  otherwise `present`. Owner teacher or admin; anyone else gets 404.
- `GET /api/live-sessions/upcoming` → `{sessions: [...]}` — sessions with `startsAt` in
  [now, now+60min], status `scheduled`/`live`, sorted by start time; same shape as
  `GET /api/live-sessions` (meetingUrl stripped, `attendeeCount` added). Student: enrolled
  courses + published/open sessions. Teacher: own sessions only. Admin/others: all.
