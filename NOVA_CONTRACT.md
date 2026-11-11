# NOVA_CONTRACT.md — Nova AI learning ecosystem (Slice 2, frontend)

Work ONLY in `~/workspace/eduverse-current/`. Do not rename the app, do not restyle existing screens.
Backend is DONE: `POST /api/nova` `{tool, input}` → `{tool, provider: 'openai'|'local', result}`,
`GET /api/nova/tools` → `{tools: [{id, desc}], provider}`. Tool ids:
`tutor, doubt, notes, quizgen, flashcards, summarizer, planner, assignment,
codementor, writing, research, recommend, teacher, performance`.
The `teacher` tool is teachers-only (backend 403s for students).

## What to build

Extend the existing Nova panel (`#novaPanel`, opened via `openNovaChat()`):
add a tab bar at the top of the panel: **Chat** (existing `POST /api/chat` flow, keep as-is)
| **AI Tools** (new).

### AI Tools tab

1. On open, `GET /api/nova/tools` → render a grid of tool cards (icon + name + 1-line desc).
   Show a small provider badge: "AI" when provider=openai, "Built-in" when local.
2. Tapping a card opens that tool's form. Inputs per tool:
   - tutor: topic text input
   - doubt: question textarea (+ optional "use current lesson" checkbox → pass lessonText)
   - notes: topic + lesson text textarea
   - quizgen: study-material textarea + count (1-10)
   - flashcards: textarea OR quiz picker (from `/api/quizzes`) — result renders as flippable cards
   - summarizer: long text textarea
   - planner: days number (1-30)
   - assignment: assignment picker (from `/api/assignments`)
   - codementor: language select (javascript/python/java/other) + code textarea
   - writing: text textarea
   - research: textarea (one reference/note per line)
   - recommend: no input (uses real data) — render weakTopics + continueLessons nicely
   - teacher: topic + kind select (lesson-outline/quiz/worksheet) — hide for students
   - performance: no input (or student picker for teachers) — render topics table with accuracy bars
3. Results render in the panel below the form: markdown-ish (headings, bullets, bold — reuse a
   tiny renderer, escape HTML first), provider badge per result ("Answered by AI" / "Built-in logic").
4. quizgen results: each generated question gets an "Add to question bank" button
   (`POST /api/teacher/question-bank`) — teachers only.
5. flashcards: click-to-flip cards, prev/next.
6. Keep everything inside the existing Nova panel visual language (check styles.css `.nova-*`).

## Notes

- All calls via existing `apiRequest` helper. Handle 429/400 with the error message shown in-panel.
- Do not break the existing Chat tab. New code in the LMS-expansion section of app.js.
- `node --check app.js` before finishing.

## ChatGPT-style chat (2026-11-11, `NOVA2_CONTRACT.md`)

- `backend/nova.js`: `chatCompleteMessages(messages, {maxTokens, onToken})`
  (SSE streaming when `onToken` is given, same `no-key` / `openai-http-<status>` /
  `openai-empty` errors, 45s abort); `chatComplete` is now a thin wrapper.
  `CHAT_SYS` is the chat system prompt. `OPENAI_BASE_URL` may override the API
  base (tests / OpenAI-compatible endpoints); default is api.openai.com.
- Per-user history in `store.novaChats[userId].messages`, capped at the last 20
  (10 turns), persisted after each write. History is per-user only.
- `POST /api/chat` (30/min, ≤2000 chars, optional `stream:true`): appends the
  user message first, then LLM (JSON or SSE deltas + final `done` event) when a
  key is set, else the existing keyword `novaReply` with `provider:'local'`.
  Any LLM failure falls back to local. LLM replies have `screen:null`.
- `GET /api/chat/history`, `POST /api/chat/clear`, `POST /api/chat/regenerate`
  (drops the last assistant message, re-runs the last user message).
- Tests: `backend/nova2.test.js` (local mode, history cap/isolation, clear,
  regenerate, rate limit, and SSE shape against a stubbed OpenAI server).
