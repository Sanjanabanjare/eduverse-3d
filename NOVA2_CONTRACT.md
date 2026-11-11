# NOVA2_CONTRACT.md — ChatGPT-style Nova chat (backend)

Work ONLY in `~/workspace/eduverse-fixed/`. Do not rename the app, do not touch
the 14 Nova tools (`POST /api/nova`) except to reuse their provider helpers.
Backend agent owns `backend/nova.js`, `backend/server.js` (chat routes only),
`backend/nova2.test.js`, `NOVA_CONTRACT.md` (append a short section).

## Today (verified)
- `POST /api/chat` (server.js ~4130): rate limit 30/min per user
  (`chatAttempts`), message ≤2000 chars, returns `novaReply(user, message)` —
  a keyword matcher in server.js. No history, no LLM, no streaming. The reply
  shape is `{reply, screen, suggestions}` and `sendRoomChat` in app.js also
  uses it — keep that shape working.
- `backend/nova.js`: `chatComplete(system, user, maxTokens)` — single user
  message, non-streaming, throws `no-key` / `openai-http-<status>` /
  `openai-empty`. `provider()` returns `'openai'` when `OPENAI_API_KEY` is
  set, else `'local'`. `ai()` tries OpenAI then falls back to local on ANY
  failure. Model via `NOVA_MODEL` (default `gpt-4o-mini`).

## 1. Streaming LLM chat in `backend/nova.js`
- Add `chatCompleteMessages(messages, {maxTokens, onToken})` where `messages`
  is a full `[{role:'system'|'user'|'assistant', content}]` array.
  - When `onToken` is given, call OpenAI with `stream:true` and parse the
    SSE stream (`data: {...}` lines, `choices[0].delta.content`), invoking
    `onToken(delta)` per chunk and returning the full assembled text.
  - Without `onToken`, behave like `chatComplete` (non-streaming).
  - Same 45s abort, same error strings (`no-key`, `openai-http-<status>`,
    `openai-empty`). Never log the key. Keep `chatComplete` as a thin wrapper.
- System prompt for chat (new const `CHAT_SYS`): Nova, the EduVerse AI study
  companion. Concise, warm, concrete, short steps and examples. Never invent
  grades, records, or personal data. If asked about something outside
  learning/EduVerse, answer briefly and steer back. Markdown allowed.

## 2. Per-user chat history in the store
- `store.novaChats` — object keyed by user id:
  `{messages: [{role:'user'|'assistant', content, at}], updatedAt}`.
- Cap at the last 20 messages (10 turns); prune older on write. History is
  per-user only: a user can read/clear only their own. Never include other
  users' data. Persist with the existing `persist()` after each write.

## 3. `POST /api/chat` — new flow, old shape preserved
- Same rate limit (30/min/user), same 2000-char validation, same auth.
- Request body gains optional `stream: true`.
- Flow: append the user message to that user's history (before calling the
  LLM, so a retry keeps it). Build `messages = [CHAT_SYS, ...history, user]`.
  - If `OPENAI_API_KEY` is set: try the LLM.
    - `stream: true` → respond `Content-Type: text/event-stream`, send
      `data: {"delta":"..."}` per chunk, then a final
      `data: {"done":true,"reply":"<full>","provider":"openai","screen":null,"suggestions":[...]}`.
      On stream failure mid-way, send `data: {"error":"..."}` and end.
    - No stream → JSON `{reply, screen, suggestions, provider:'openai'}`.
    - Append the assistant reply to history + persist. `screen` stays null
      for LLM replies (the LLM doesn't navigate); `suggestions` are 3 short
      follow-ups derived from the reply (or the existing default list when
      empty).
  - If no key, or the LLM call fails for ANY reason (no credits 429, network,
    empty): fall back to the existing `novaReply(user, message)` and return
    its `{reply, screen, suggestions}` plus `provider:'local'`. Do NOT append
    a second user message in the fallback path (it was already appended).
    The local reply text must keep saying it is a guided assistant, not a
    live AI service — update the wording only where it claims otherwise.
- `GET /api/chat/history` → `{messages, provider}` (the user's own history,
  latest 20). `POST /api/chat/clear` → clears the user's history
  (`{cleared:true}`). `POST /api/chat/regenerate` → drops the last assistant
  message (if any), re-runs the last user message through the same flow
  (stream flag honoured), returns the same shapes as `/api/chat`.
- `sendRoomChat` compatibility: it calls `/api/chat` without `stream` and
  reads `result.reply` — must keep working unchanged.

## Tests (`backend/nova2.test.js`, follow the audit-fixes harness pattern)
- Local mode (no key): message → provider `'local'`, keyword answer still
  works (binary search, assignments), history has 2 messages after one turn.
- Multi-turn: two messages → history holds 4; a follow-up ("why?") is sent
  with history (assert the history array the route built contains the first
  turn — test via the history endpoint, not by mocking OpenAI).
- History cap: 12 turns → only the last 20 messages remain.
- Clear: history empties. Regenerate: assistant message replaced, user
  message kept once. History isolation: user B cannot read user A's history.
- Rate limit still 429s after 30/min. `npm test` green.
- Streaming: test the SSE shape with a stubbed OpenAI fetch if you can
  inject one cleanly; if not, test the non-streaming path thoroughly and
  state clearly that streaming was verified live by the parent, not in tests.
