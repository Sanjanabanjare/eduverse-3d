# EXAM_CONTRACT.md — Advanced examination & assessment (Slice 1)

Work ONLY in `~/workspace/eduverse-current/`. Do not rename the app, do not restyle it.
Backend agent owns `backend/server.js` (+ new `backend/exam.js` if cleaner, required from server.js).
Frontend agent owns `app.js`, `styles.css`, `index.html`.
Run `node --check` on edited files and `npm test` (backend) before finishing.

## 1. New question types (extend the quiz engine)

Existing types stay: `mcq`, `truefalse`, `short`. Add:

| type | teacher fields | student payload | grading |
|---|---|---|---|
| `multiselect` | `options[2..10]`, `correctIndices[]` (≥1) | `options` (shuffled if enabled) | partial credit = points × (correct picked − wrong picked) / total correct, floored at 0 |
| `fillblank` | `template` with `___` blanks (1..8), `blankAnswers: string[][]` (accepted per blank) | `template` | per blank: case-insensitive trim match → points × correct/total |
| `match` | `pairs: [{left,right}]` (2..8 pairs) | `lefts[]`, `rights[]` (rights shuffled) | per correct pair → points × correct/total |
| `essay` | `maxWords` (0=none), `rubric: [{criterion, maxPoints}]` optional | `maxWords` | manual only (0 auto, goes to grading queue) |
| `code` | `language` ('javascript' only for auto-run), `starterCode`, `testCases: [{input, expectedOutput, points}]` | `starterCode`, test case count (NOT expected outputs) | server runs JS in `vm` sandbox, 2s timeout, compares stdout; other languages → manual |

Common new fields on EVERY question type: `explanation` (detailed solution, ≤2000 chars),
`difficulty` ('easy'|'medium'|'hard', default 'medium'), `topic` (≤80 chars).

**Answer-key stripping** (critical): `publicQuestion` and `stripQuizForStudent` must NEVER leak
`correctIndices`, `blankAnswers`, `pairs[].right` mapping, `testCases[].expectedOutput`, `explanation`
(unless solutions are due — see §4). Extend the existing leak test.

## 2. Quiz/exam config (new fields on quiz create/PATCH)

- `negativeMarking`: 0..1 (fraction of the question's points deducted for a wrong OBJECTIVE answer; default 0)
- `showSolutions`: 'immediate' | 'after_pass' | 'never' (default 'after_pass')
- `adaptive`: boolean (default false) — see §7
- `randomSelect`: `{count, difficulty?, topic?}` — at attempt start, replace the quiz's question list with `count` random questions drawn from the owner's question bank matching filters (fallback: quiz's own questions)
- `proctoring`: `{enabled, snapshotIntervalSec}` (default disabled) — consent-based, see §6
- `antiCheat`: `{detectTabSwitch, disableCopy}` (default both false)

## 3. Question bank

`store.questionBank[]`: `{id, ownerId, type, prompt, points, explanation, difficulty, topic, tags[], options?, correctIndex?, correctIndices?, correctBoolean?, acceptedAnswers?, template?, blankAnswers?, pairs?, maxWords?, rubric?, language?, starterCode?, testCases?, createdAt, updatedAt}`.

- `GET /api/teacher/question-bank?topic=&difficulty=&type=` — owner (or admin) only
- `POST /api/teacher/question-bank` — same validation as quiz questions
- `PATCH /api/teacher/question-bank/:id`, `DELETE /api/teacher/question-bank/:id`
- Quiz create/PATCH accepts `bankQuestionIds[]` — copies those bank questions into the quiz (new ids)

## 4. Attempts: hardening, auto-submit, solutions

- Attempt stores: `tabSwitches` (count + timestamps), `proctor: {consentedAt, snapshots: [{at}]}`,
  `autoSubmitted` (bool), `perQuestionSec: {qid: sec}`.
- **Server-side time enforcement:** on submit/grade, if `now > startedAt + timeLimitMin*60 + 30s grace`
  → grade anyway but set `autoSubmitted=true`. The `start` endpoint returns `serverNow` + `expiresAt`
  so the client timer is honest.
- **Solutions:** `GET /api/quizzes/:id/attempts/:attemptId/solutions` returns per-question
  `{correct, explanation}` only when policy allows: 'immediate' → after submit; 'after_pass' → only if
  `passed`; 'never' → 403. Explanations never appear in any other student payload.
- **Retakes:** `maxAttempts` already exists — surface `attemptsLeft` (exists) and add per-attempt
  `attemptNumber`.

## 5. Exam analytics

`GET /api/teacher/quizzes/:id/analytics` (owner/admin): `{attempts, avgScore, passRate,
scoreDistribution[10 buckets], avgDurationSec, perQuestion: [{questionId, prompt, type, difficulty,
correctRate, avgPoints, avgSec}]}`. All from real attempt records.

## 6. Proctoring (optional, consent-based, privacy-first)

- Quiz with `proctoring.enabled` → student sees a consent screen BEFORE start: what is captured
  (periodic webcam snapshots as small stills + tab-switch count), where it goes (attached to the
  attempt, visible to the teacher), and an explicit Accept/Decline. Decline → cannot start proctored exam.
- Snapshots: client captures via webcam at `snapshotIntervalSec`, downscaled (≤320px), shown to the
  student as a filmstrip (no hidden capture). Stored as data URLs on the attempt (cap 20 snapshots).
- **No facial recognition, no identity matching** — snapshots are for human review only.
- Teacher attempt view shows snapshot count + filmstrip + tab-switch log.

## 7. Difficulty-based & adaptive selection

- Quiz builder can set per-difficulty counts: `difficultyMix: {easy, medium, hard}` — attempt start
  draws that many from the bank (or quiz questions) per difficulty.
- `adaptive: true` — attempt starts at 'medium'; after each answered question the next question's
  difficulty steps up on correct, down on wrong (easy↔medium↔hard). Implement as:
  `POST /api/quizzes/:id/attempts` returns `{attemptId, currentDifficulty}` and
  `GET /api/quizzes/:id/attempts/:attemptId/next` returns the next question (one at a time);
  answers POST to `.../answer` `{questionId, answer}`. Final grade on `.../submit`.

## 8. Rubric-based assignment grading

- Assignment create/PATCH accepts `rubric: [{criterion (≤120 chars), maxPoints (1..100)}]` (≤10 criteria).
- Grading endpoint accepts `rubricScores: {rubricCriterionId: points}`; server validates
  0 ≤ points ≤ maxPoints and computes total. Feedback per criterion optional.

## 9. Code execution sandbox (backend)

- `backend/exam.js` (or server.js): `runCodeTests(starterCode, testCases)` using `node:vm`
  `runInNewContext` with `timeout: 2000`; sandbox exposes a capturing `console` and nothing else
  (no `require`, no `process`). Each test case: run code with `input` provided as the program's
  stdin-equivalent — simplest honest protocol: the student's code must define `function solve(input)`
  and test cases call `solve(input)` comparing `String(result).trim()` to `expectedOutput.trim()`.
- Points per test case; syntax/runtime errors → 0 for that case, error message stored for teacher.

## 10. Frontend (agent)

- Quiz builder: editors for the 5 new types, explanation/difficulty/topic fields, negative marking,
  solutions policy, adaptive toggle, difficulty mix, proctoring + anti-cheat toggles, bank picker
  ("add from bank", "save to bank").
- New `question-bank` screen: table with filters, CRUD.
- Take-exam UI: renderers for new types (checkboxes, blank inputs, match dropdowns, essay textarea
  with word count, code textarea), countdown with auto-submit at 0, proctor consent modal + filmstrip,
  tab-switch warning toast (counted, not blocking).
- Results: score, pass/fail, per-question solutions (per policy), negative-marking breakdown.
- Teacher analytics screen: distribution bars, per-question correct-rate table.
- Assignment grading: rubric criterion inputs.
- Reuse existing CSS classes/palette; add minimal new styles in the same visual language.

## 11. Tests (backend agent)

Extend `backend/lms-features.test.js` (or new `backend/exam.test.js`):
new types validate + grade correctly, answer keys never leak (multiselect/fillblank/match/code),
negative marking math, bank CRUD + random select, solutions policy gating, server time enforcement,
analytics shape, rubric validation, code sandbox runs solve() cases and times out infinite loops.
`npm test` must stay green.
