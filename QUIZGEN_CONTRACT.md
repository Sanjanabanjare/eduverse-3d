# QUIZGEN_CONTRACT.md — Slice 1: AI Quiz Generator completion (upload → generate → save as quiz)

Work ONLY in `~/workspace/eduverse-current/`. Do not rename the app, do not restyle existing screens.
Backend agent owns `backend/server.js` (+ `backend/quizgen.js` if cleaner).
Frontend agent owns `app.js`, `styles.css`, `index.html`.

## Current state (verified 2026-11-10)
- Nova already has a `quizgen` tool (`backend/nova.js`): takes pasted text, returns MCQs
  (OpenAI when a key is set, local sentence/keyword generation otherwise). It does NOT
  accept file uploads and its output is NOT saved as a usable quiz.
- Quiz engine exists: teachers create quizzes, students take them, auto-grading, question bank.

## Backend
- `POST /api/quizgen/upload` (teacher or student) — accepts `{filename, mimeType, data}` base64
  (TXT/MD/PDF-text — PDF text extraction: PDFs are binary; extract what we can from the
  text layer via a simple stream parser, honest limits apply) OR reuses `/api/upload`.
  Returns `{text, charCount}`. Cap 100KB of text.
- `POST /api/quizgen/generate` `{text, count, courseId?}` → runs the Nova `quizgen` tool
  server-side, returns `{questions: [{prompt, options[4], correctIndex, explanation}], provider}`.
- `POST /api/quizgen/save` (teacher) `{title, courseId?, questions[]}` → validates questions
  (4 options, correctIndex 0–3), creates a real quiz in `store.quizzes[]` (same shape as
  teacher-created quizzes), returns `{quiz}`. Student variant: `POST /api/quizgen/save-practice`
  saves as a personal practice quiz (student-owned, not in the shared bank).
- `GET /api/quizgen/history` → the requester's generated quizzes (teacher: created by them).

## Frontend
- **Quiz Generator** (`quiz-generator` screen, teacher + student): upload notes file
  (TXT/MD/PDF, 5MB) OR paste text → question count picker → Generate → preview list
  (prompt, options, correct answer highlighted, explanation) → Edit (fix a prompt/option
  inline) → Save as quiz (teacher: pick course + title; student: save as practice quiz).
- Add to navs (teacher: TEACHING; student: LEARN). Reuse existing styles. Honest labels:
  "Generated with OpenAI when configured, otherwise from your notes locally" + "PDF text
  extraction reads the text layer only — scanned/image PDFs won't work."

## Tests (backend agent)
New `backend/quizgen.test.js`: upload TXT extracts text; generate from text returns valid
questions (local provider, no key); save validates + creates a quiz students can take;
student cannot save to the shared bank (403); practice save works. `npm test` green.
