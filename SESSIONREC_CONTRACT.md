# SESSIONREC_CONTRACT.md — Slice 2: classroom session records (save sessions + participation)

Work ONLY in `~/workspace/eduverse-current/`. Do not rename the app, do not restyle existing screens.
Backend agent owns `backend/server.js` (+ `backend/live.js` if cleaner).
Frontend agent owns `app.js`, `styles.css`, `index.html`.

## Current state (verified 2026-11-10)
- Live classroom exists: WebRTC/Agora, chat, hand raise, Q&A, polls, whiteboard, slides,
  breakout rooms, browser recording (.webm, local only), attendance (join records).
- **Missing**: no server-side record of a completed classroom session — nothing persists
  who participated, what happened (chat/Q&A/polls), or when it ran. Recording files stay
  in the browser only (honest limit stays).

## Data model
- `classSessionRecords[]`: `{id, sessionId, title, courseId|null, teacherId, startedAt, endedAt,
  durationMin, participants[] {userId, name, joinedAt, leftAt|null, raisedHand, chatCount, qaCount, pollVotes},
  chatCount, qaCount, polls[] {question, options, votes[]}, recordingNote: 'Browser recording (.webm) is saved locally by the teacher — not uploaded.'}`

## Backend
- `POST /api/live-sessions/:id/end-classroom` (teacher owner or admin) `{summary}` →
  creates a `classSessionRecords` entry from the live session's join/attendance data +
  the summary payload the classroom client sends on leave
  (`{participants, chatCount, qaCount, polls}` — client-reported, server-validated shapes).
  Marks the live session `ended`.
- `GET /api/teacher/session-records` (`?courseId=`) — teacher's own records.
- `GET /api/session-records` (student) — records for sessions the student joined.
- `GET /api/session-records/:id` — detail (participant must be in the record or be the teacher/admin).
- `GET /api/admin/session-records` — admin, org-scoped.

## Frontend
- **Past sessions** (`past-sessions` screen, teacher + student): list of records (title, date,
  duration, participants count) → detail view (participant table with join/leave times,
  hand raises, chat/Q&A counts, poll results, recording note).
- **Classroom end flow**: when the teacher leaves/ends the classroom, the client POSTs the
  summary to `/api/live-sessions/:id/end-classroom` (best-effort, failures logged not blocking).
- Add to navs. Reuse existing styles.

## Tests (backend agent)
New `backend/sessionrec.test.js`: end-classroom creates a record (participants merged,
teacher-only, other teacher 404); student sees only joined sessions; detail scoping;
admin org-scoped list. `npm test` green.
