# LANG_CONTRACT.md — Slice 4: language learning + multi-language UI + accessibility

Work ONLY in `~/workspace/eduverse-current/`. Do not rename the app, do not restyle existing screens.
Backend agent owns `backend/server.js` (+ `backend/lang.js` if cleaner).
Frontend agent owns `app.js`, `styles.css`, `index.html`.
Depends on Slice A org model. New perm: `lang.manage`.

## Data model

- `vocabSets[]`: `{id, institutionId, title, language, words[] {word, meaning, example}, createdBy}`
- `vocabAttempts[]`: `{id, setId, studentId, score, total, completedAt}` (reuse aptitude attempt pattern)
- `speakingExercises[]`: `{id, institutionId, title, language, prompt, targetPhrase, createdBy}`
- `speakingAttempts[]`: `{id, exerciseId, studentId, transcript, score, completedAt}` — score from
  word-overlap with targetPhrase (honest: browser speech recognition does the listening)
- `uiStrings` (static, frontend): key→translation dictionaries for `en`, `hi`, `ta`, `bn`, `mr`
  covering nav labels, common buttons, and auth screens (not the whole app — honest scope).

## Backend

- `GET/POST /api/admin/vocab` (teacher or lang.manage), `PATCH/DELETE`; `GET /api/vocab`
  (student list), `POST /api/vocab/:id/start` (no meanings? meanings are the study material —
  send them, grade on word→meaning), `POST /api/vocab/:id/submit` → score.
- `GET/POST /api/admin/speaking`, `PATCH/DELETE`; `GET /api/speaking`; `POST /api/speaking/:id/submit` `{transcript}` → overlap score.
- `GET /api/profile/language` / `POST /api/profile/language` `{lang}` — persist user's UI language.
- Permissions: `lang.manage` → super_admin + institution_admin; teachers manage vocab/speaking.

## Frontend

- **Language lab** (`language-lab` screen): vocab sets (study cards → quiz mode), speaking
  practice (prompt + "record" via Web Speech API `SpeechRecognition` with honest fallback
  message when unsupported; manual transcript entry fallback), scores history.
- **UI language switcher** (header/profile): en/hi/ta/bn/mr for nav + common buttons + auth;
  persisted via API; honest label that deeper pages stay in English for now.
- **Accessibility pass**: skip-to-content link, `aria-label`s on nav + icon buttons, focus-visible
  styles, keyboard navigation for the header search (already exists — verify), `lang` attribute
  updates with UI language, captions already exist on video player (verify + note).
- Teacher `teacher-language` section: vocab set + speaking exercise CRUD.
- Add to navs. Reuse existing styles.

## Tests (backend agent)

New `backend/lang.test.js`: vocab CRUD org-scoped; attempt grading; speaking overlap scoring;
language pref persist; perms. `npm test` green.

## Response shapes (for frontend agent)

- `POST /api/admin/vocab` → 201 `{vocabSet: {id, institutionId, title, language, wordCount, createdBy, createdAt, words: [{id, word, meaning, example}]}}` — words with ids (answers keyed by word id)
- `GET /api/admin/vocab` → `{vocabSets: [...]}` (no word details; teachers see own, admins see institution)
- `PATCH/DELETE /api/admin/vocab/:id` → `{vocabSet}` / `{deleted: true}`; other-teacher edit/delete → 404
- `GET /api/vocab` (student) → `{vocabSets: [{..., words: [full with meanings — study material], attempts, bestScore}]}`
- `POST /api/vocab/:id/start` → 201 `{attemptId, startedAt, wordCount, words: [{id, word, meaning, example}]}` (student only)
- `POST /api/vocab/:id/submit` `{attemptId, answers: {wordId: meaning}}` → `{score, total, correct, passed}` (score 0-100, pass ≥ 60; exact match after case/punctuation normalization)
- `POST /api/admin/speaking` → 201 `{exercise: {id, institutionId, title, language, prompt, targetPhrase, createdBy, createdAt}}`
- `GET /api/admin/speaking` → `{exercises: [...]}` (own-only for teachers, org-scoped for admins)
- `GET /api/speaking` (student) → `{exercises: [{..., attempts, bestScore}]}` — targetPhrase IS included (it's the practice goal)
- `POST /api/speaking/:id/submit` `{transcript}` → `{score, matched, total, attemptId}` (word-overlap vs target phrase, 0-100)
- `GET /api/profile/language` → `{lang}` (default `'en'`); `POST /api/profile/language` `{lang}` → `{lang}`; codes: `en hi ta bn mr`
- Student management attempts → 403 (global `/api/admin/` gate, except teachers get a carve-out for vocab/speaking paths).
