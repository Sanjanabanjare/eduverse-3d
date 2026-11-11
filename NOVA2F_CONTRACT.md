# NOVA2F_CONTRACT.md — ChatGPT-style Nova chat (frontend)

Work ONLY in `~/workspace/eduverse-fixed/`. Do not rename the app, do not
restyle the rest of the app. Frontend agent owns `app.js` (Nova panel code
only, lines ~1–20 area), `index.html` (Nova panel markup only), `styles.css`
(Nova panel styles only).

## Today (verified)
- Panel `#novaPanel`, tabs Chat / AI Tools, `#novaMessages`,
  `#novaSuggestions`, form `#novaForm` + `#novaInput` (maxlength 2000,
  aria-label exists). `novaAppend(text, who, screen)` sets `textContent`
  (no markdown). `sendNovaMessage()` posts `{message}` to `/api/chat`,
  shows a `'…'` thinking bubble, appends `data.reply` + screen button +
  suggestions; on failure uses client-side `localNovaReply(text)`.
  `sendRoomChat()` also posts to `/api/chat` and reads `result.reply` —
  do not break it. `openNovaChat()` greets once (`novaOpened` flag).

## 1. Streaming
- `sendNovaMessage()` posts `{message, stream:true}` and reads the SSE
  stream with a `ReadableStream` reader: create one Nova bubble immediately,
  append each `delta` to it as it arrives, replace the `'…'` thinking state
  on the first token. On the final `done` event, attach the provider badge,
  screen button (if any), and suggestions. If streaming fails or the
  response isn't SSE, fall back to a single non-streaming `/api/chat` call,
  and if that fails, to `localNovaReply(text)` as today.

## 2. Markdown-lite rendering (safe)
- Nova messages render a small safe subset: `**bold**`, `*italic*`,
  `` `inline code` ``, ` ```code blocks``` ` (with a copy button),
  `- ` / `1. ` lists, and `[text](https://…)` links (http/https only).
- Escape ALL HTML first (reuse `safeText`), then apply the markdown
  transforms — user/assistant content must never inject markup. Keep user
  messages as plain text (no markdown).

## 3. Chat controls
- Each Nova message gets a small **copy** button (copies the raw text).
- A **regenerate** button under the last Nova message: calls
  `POST /api/chat/regenerate` (streaming too) and replaces that message.
- A **New chat** button in the panel header: calls `POST /api/chat/clear`,
  empties `#novaMessages`, and shows the greeting again.
- A small provider badge on Nova messages: `AI` when `provider==='openai'`,
  `Local` when `'local'`.

## 4. History on open
- When the panel opens, load `GET /api/chat/history` once per session and
  render the saved messages (user plain, Nova markdown) instead of only the
  greeting. If history is empty, keep today's greeting behaviour. Don't
  re-fetch on every open.

## Verification
- `node --check app.js` clean.
- jsdom smoke (write under `/tmp/`, don't leave harness files in the tree):
  boot with a stubbed fetch returning canned `/api/chat` + `/api/chat/history`
  responses (one streaming, one plain); assert 0 load errors, a streamed
  reply assembles in order, markdown renders bold + a code block, copy /
  regenerate / new-chat buttons exist, and an `<img onerror>` in a Nova
  reply renders as escaped text, not an element.
- Report: what changed (file + line-ish), and anything that turned out not
  to be a gap.
