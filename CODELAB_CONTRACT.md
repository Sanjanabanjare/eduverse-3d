# CODELAB_CONTRACT.md — Slice 1: Online Coding Lab

Work ONLY in `~/workspace/eduverse-current/`. Do not rename the app, do not restyle existing screens.
Backend agent owns `backend/server.js` (+ `backend/codelab.js` if cleaner).
Frontend agent owns `app.js`, `styles.css`, `index.html`.
Depends on Slice A org model. New perm: `codelab.manage` (teachers manage challenges).

## Data model

- `codeProjects[]`: `{id, studentId, title, language, code, createdAt, updatedAt}`
- `codeChallenges[]`: `{id, institutionId, title, description, language, starterCode, testCases[] {input, expectedOutput}, createdBy, createdAt}`
- `codeAttempts[]`: `{id, challengeId, studentId, language, code, results[] {input, expected, actual, passed}, passed, total, submittedAt}`

## Backend

- `POST /api/code/run` `{language, code, stdin?}` → executes and returns `{stdout, stderr, status}`.
  - **Judge0** (env-optional): `JUDGE0_API_URL` + `JUDGE0_API_KEY` (+ `JUDGE0_API_HOST` for
    RapidAPI). When set: submit to Judge0, poll for result (max ~15s), map to stdout/stderr.
    Languages: JS, Python, Java, C++, C, Go, Ruby, Rust (Judge0 language ids).
  - **Local fallback** (no keys): JavaScript only, via the existing `node:vm` sandbox pattern
    (2s timeout, no require/process/network) — reuse `backend/exam.js` `runCodeTests` style.
    Other languages return 501 with a clear message ("Set JUDGE0_API_URL to run Python/Java/...").
  - Rate limit: 20 runs/min per user. Max code 64KB, stdin 16KB.
- `GET/POST /api/code/projects`, `PATCH/DELETE /api/code/projects/:id` — student-owned.
- `GET/POST /api/teacher/challenges` (teacher/admin, `codelab.manage`), `DELETE`;
  `GET /api/code/challenges` (student list); `POST /api/code/challenges/:id/submit`
  `{language, code}` → runs code against each testCase (Judge0 or local JS), stores attempt,
  returns `{passed, total, results}` (never leaks expected outputs for hidden cases — all
  testCases here are visible to students by design; document that).
- Permissions: `codelab.manage` → super_admin + institution_admin + teacher.

## Frontend

- **Coding Lab** (`code-lab` screen, student/teacher): language picker, code editor
  (textarea with tab support + line numbers via a simple gutter), Run button → output panel
  (stdout / stderr / status), Save project (title), My projects list (open/delete).
- **Challenges** tab: challenge list → detail (description, starter code loaded in editor,
  Submit → per-test-case pass/fail table + score).
- **Teacher** `teacher-codelab` section: challenge CRUD (title, description, language,
  starter code, test cases as `input || expected` lines).
- Add to navs. Reuse existing styles. Honest labels: "Python/Java/C++ need Judge0 configured;
  JavaScript runs locally."

## Implemented response shapes (for the frontend agent)

- `POST /api/code/run` `{language, code, stdin?}` → 200 `{stdout, stderr, status: 'ok'|'error'|'timeout', provider: 'local'|'judge0', language}`; non-JS without Judge0 → 501 `{error}` mentioning `JUDGE0_API_URL`; unknown language → 400; rate limit → 429. 20 runs/min per user.
- Projects: `GET /api/code/projects` → `{projects: [{id, studentId, title, language, code, createdAt, updatedAt}], languages: ['javascript','python','java','cpp','c','go','ruby','rust']}`; `POST` → 201 `{project}`; `PATCH/DELETE /api/code/projects/:id` → `{project}` / `{deleted:true}`. Student + teacher roles only (403 otherwise); ownership enforced (other user's project → 404).
- Challenges (teacher/admin): `POST /api/teacher/challenges` `{title, description, language, starterCode, testCases: [{input, expectedOutput}]}` → 201 `{challenge}`; `GET /api/teacher/challenges` → `{challenges}` (own-only for teachers, institution-scoped for admins); `PATCH/DELETE` → `{challenge}` / `{deleted:true}`. Challenge shape: `{id, institutionId, title, description, language, starterCode, testCaseCount, testCases, createdBy, createdAt}`.
- `GET /api/code/challenges` → `{challenges: [...publicChallenge, attempts, bestScore]}` (test cases included — visible by design).
- `POST /api/code/challenges/:id/submit` `{language, code}` → 200 `{attemptId, passed, total, results: [{input, expected, actual, passed, error?}]}`; language must match the challenge (400 otherwise); student-only (403); challenge test cases count against the 20/min run budget (429 when exceeded).
- Note: `studentId` on projects holds the owner's user id; teachers may also save projects (the lab screen is shared student/teacher), even though the field is named `studentId`.

