# ASSIGN_CONTRACT.md — Slice 2: assignment deadline enforcement + file uploads

Work ONLY in `~/workspace/eduverse-current/`. Do not rename the app, do not restyle existing screens.
Backend agent owns `backend/server.js`.
Frontend agent owns `app.js`, `styles.css`, `index.html`.

## Current state (verified 2026-11-10)
- Assignments exist: teacher create (`POST /api/assignments`), student submit
  (`POST /api/assignments/:id/submit`, text up to 8000 chars), teacher grade + feedback,
  `dueDate` field stored but **never enforced**.
- File upload exists: `POST /api/upload` (base64 JSON, 5MB cap, mimetype allowlist) — used by
  library ebooks; **not wired to assignment submissions**.
- MCQ auto-evaluation, exam results, and grading already exist — do not rebuild.

## Backend (small, surgical — do not rewrite the assignment handlers)
- **Deadline enforcement** in the submit handler: if `dueDate` has passed, reject with 400
  ("Submission deadline has passed") UNLESS the assignment has `allowLate: true`, in which
  case accept and store `late: true` on the submission.
- **File uploads**: accept `fileUrl` (from `/api/upload`) and/or `fileName` alongside `text`
  in submit; store on the submission. Submission requires text OR a file (not necessarily both).
- **allowLate flag**: teacher create/PATCH accepts `allowLate` boolean (default false);
  include it in assignment payloads.
- Teacher view of submissions: include `late` + `fileUrl`/`fileName` per submission.
- Student view: include `late` + file fields on their own submission.

## Frontend (small, surgical)
- Assignment submit form: add file upload (via existing `/api/upload`, PDF/DOC/DOCX/TXT,
  5MB) with the uploaded file shown + removable; show the deadline and a "late submissions
  allowed/not allowed" note; on deadline-passed + not allowed, disable submit with a clear message.
- Teacher submissions list: show "LATE" badge + file download link per submission.
- Student assignment view: show their file link + late flag.

## Tests (backend agent)
New `backend/assign.test.js`: on-time submit ok; late submit rejected (400) when allowLate
false; late submit accepted with `late:true` when allowLate true; fileUrl submit works;
text-only still works; graded submission still blocks resubmission. `npm test` green.
