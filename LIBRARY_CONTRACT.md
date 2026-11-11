# LIBRARY_CONTRACT.md — Slice 2: library + offline learning

Work ONLY in `~/workspace/eduverse-current/`. Do not rename the app, do not restyle existing screens.
Backend agent owns `backend/server.js` (+ `backend/library.js` if cleaner).
Frontend agent owns `app.js`, `styles.css`, `index.html`.
Depends on Slice A org model. New perm: `library.manage`.

## Data model

- `libraryItems[]`: `{id, institutionId, kind:'book'|'ebook'|'journal', title, author, isbn, subject, description, fileUrl|null (for ebooks via /api/upload), coverUrl|null, totalCopies (books), availableCopies (books), createdAt}`
- `bookLoans[]`: `{id, itemId, studentId, borrowedAt, dueAt, returnedAt|null}`
- `readingLists[]`: `{id, institutionId, courseId|null, teacherId, title, itemIds[], createdAt}`
- Offline: lessons already have content; add `lessonDownloads[]` (tracking only):
  `{id, studentId, lessonId, downloadedAt}` — the actual files are served by existing
  static/lesson endpoints. Progress sync: existing progress endpoints already accept
  updates; add `POST /api/offline/sync` `{progress: [{lessonId, positionSec, completed}], downloads: [lessonId]}` → applies progress, returns `{applied, conflicts}`.

## Backend

- `GET/POST /api/admin/library` (`?kind=&q=`), `PATCH/DELETE /api/admin/library/:id` — `library.manage`, org-scoped. Ebook upload via existing `/api/upload` (store fileUrl).
- `GET /api/library` (`?kind=&q=&subject=`) — org-scoped browse for students/teachers/parents.
- `POST /api/library/:id/borrow` (student, books only) → decrements availableCopies, creates loan (14-day due); 409 if none available or already borrowed. `POST /api/library/loans/:id/return` → increments, stamps returnedAt.
- `GET /api/library/loans/mine` — student's active + history.
- `GET/POST /api/teacher/reading-lists` (`?courseId=`), `POST` `{title, courseId?, itemIds[]}`, `DELETE /api/teacher/reading-lists/:id`; `GET /api/reading-lists` (student: lists for enrolled courses + institution-wide).
- `POST /api/offline/sync` as above (student).
- `GET /api/library/stats` (admin): totals, loans active/overdue.
- Permissions: `library.manage` → super_admin + institution_admin + teacher (teachers manage reading lists; only admins manage catalog — enforce: catalog POST/PATCH/DELETE requires admin role).

## Frontend

- **Library** (`library` screen, all roles): search/filter (kind, subject, text), item cards
  (cover, title, author, availability), borrow/return buttons for books, "Read" for ebooks
  (opens fileUrl), "My loans" section.
- **Admin library** (`admin-library`): catalog CRUD table + form (kind, title, author, ISBN,
  subject, copies, file upload for ebooks, cover URL), loans overview (active/overdue),
  stats cards.
- **Reading lists** (teacher): create/list/delete in a `reading-lists` section; students see
  lists on course pages + a library tab.
- **Offline** (student): "Download" button on lessons (saves `lessonDownloads` record +
  triggers browser download of the lesson content); "Sync" button uploads queued progress
  via `/api/offline/sync`; honest label: "Downloads work per-lesson; full offline mode
  needs the mobile app."
- Add to navs. Reuse existing styles.

## Tests (backend agent)

New `backend/library.test.js`: catalog CRUD org-scoped; borrow decrements + 409 when none;
return restores; overdue detection; reading list course scoping; offline sync applies progress;
teacher cannot delete catalog item (403). `npm test` green.
