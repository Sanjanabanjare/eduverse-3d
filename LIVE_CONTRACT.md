# LIVE_CONTRACT.md — Live classroom & collaboration (Slice 3)

Work ONLY in `~/workspace/eduverse-current/`. Do not rename the app, do not restyle existing screens.
Backend agent owns `backend/server.js` (+ `backend/live.js` for signaling logic).
Frontend agent owns `app.js`, `styles.css`, `index.html`.
Add `ws` to package.json dependencies (pure JS, no native build). Run `npm install` to verify.

## Architecture (honest)

- **Signaling:** WebSocket server (path `/ws`) sharing the existing HTTP server. Auth via
  `?token=<session cookie>` on connect (read the `eduverse_session` cookie from the WS handshake).
- **Media:** WebRTC P2P mesh (no media server). Works for small groups; document that >6 peers
  need an SFU (upgrade path noted in README).
- **Recording:** MediaRecorder in the browser, teacher downloads a .webm. Server-side recording
  is out of scope.

## Backend

1. `GET /api/live-sessions/:id/classroom` — returns `{roomId, wsUrl, iceServers}` for enrolled/
   owning users; 403 otherwise. `roomId = 'live:' + sessionId`.
2. `POST /api/live-sessions/:id/classroom/end` — teacher ends → status='ended', WS room closed.
3. Attendance: extend existing join endpoint to also record `joinedAt` per attendee (already has
   attendees[] — add timestamps).
4. Signaling protocol (JSON over WS). Server routes by room, never stores media:
   - `hello` {roomId, name, role} → server replies `peers` [{clientId, name, role}] and broadcasts `peer-joined`
   - `signal` {to, kind: 'offer'|'answer'|'ice', payload} → relay to `to`
   - `chat` {text} → broadcast (sanitized, ≤500 chars, rate-limited 10/10s per client)
   - `hand` {raised} → broadcast
   - `poll-start` {pollId, question, options[]} (teacher) / `poll-vote` {pollId, option} / `poll-end` {pollId} → broadcast; server keeps no state
   - `qa-ask` {text} / `qa-answer` {qaId, text} → broadcast
   - `whiteboard` {stroke} → broadcast (stroke: {color, size, points[[x,y]...] normalized 0..1})
   - `slide` {index, total} (teacher) → broadcast
   - `breakout` {room} (teacher) → targeted client moves WS room
   - `mute-all` (teacher) → broadcast
   - `bye` → broadcast `peer-left`
5. Heartbeat/ping every 25s; drop dead peers.

## Frontend — new `live-classroom` screen

Entered from a live session's "Join classroom" button (replaces external meetingUrl when the
teacher enables "EduVerse classroom"). Layout:

- **Video grid:** local preview + remote peers (P2P mesh via RTCPeerConnection per peer, STUN:
  `stun:stun.l.google.com:19302`). Controls: mic on/off, camera on/off, **screen share**
  (getDisplayMedia, replaces video track), leave.
- **Side tabs:** Chat | Q&A | Polls | People.
  - Chat: live messages via WS.
  - Q&A: students post questions, teacher answers inline.
  - Polls: teacher creates (question + options), students vote, live result bars.
  - People: peer list with hand-raise indicators, teacher can mute-all.
- **Whiteboard:** shared canvas; strokes broadcast over WS and drawn on all peers. Teacher
  annotation mode draws over the screenshare area.
- **Hand raise:** button toggles, teacher sees raised hands in People.
- **Slides:** teacher uploads nothing — uses "present" mode: teacher's screen share + `slide` sync
  messages keep everyone on the same beat; plus simple text-slide editor (title+bullets) the
  teacher advances and students follow.
- **Breakout rooms:** teacher creates N rooms, assigns peers (round-robin or manual), peers'
  clients switch WS room + renegotiate mesh within the room; "bring everyone back" returns all.
- **Recording:** teacher toggles MediaRecorder on their local composite (their mic + their screen/
  camera); downloads .webm at end. Label clearly: "Records on this device only."
- **Attendance:** join/leave timestamps POSTed to the existing join endpoint; teacher sees a
  live attendance list.

## Privacy & honesty labels (UI copy, keep short)

- "Video/audio goes directly between participants (P2P). The server only relays connection setup."
- Recording: "Recording stays on the teacher's device unless they share the file."
- Mesh limit note: "Best with up to ~6 people."

## Tests (backend agent)

New `backend/live.test.js`: WS handshake rejects bad token; hello/peers flow between two clients;
signal relay reaches the right peer; chat rate-limit; non-member cannot get classroom credentials.
`npm test` stays green.
