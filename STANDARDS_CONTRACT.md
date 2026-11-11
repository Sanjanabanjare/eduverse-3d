# STANDARDS_CONTRACT.md — Slice 5: LMS integrations (LTI, SCORM, xAPI) + PDF/Excel export

Work ONLY in `~/workspace/eduverse-current/`. Do not rename the app, do not restyle existing screens.
Backend agent owns `backend/server.js` (+ `backend/standards.js` if cleaner).
Frontend agent owns `app.js`, `styles.css`, `index.html`.
Depends on Slice A org model. New perm: `standards.manage`.

Scope note: full LTI 1.3 OIDC is heavy; implement what's genuinely useful:
- **LTI 1.1-style tool consumer launch**: EduVerse can BE a tool provider — `POST /lti/launch`
  accepts OAuth1-signed launch (consumer key/secret per institution), creates/provisions the
  user, enrolls in the linked course, returns a session. Document as LTI 1.1-compatible.
- **SCORM**: course package import — accept a SCORM 1.2/2004 zip upload, parse `imsmanifest.xml`,
  create lessons from `<resource>` items (SCOs launch in an iframe player); track
  `cmi.core.lesson_status` via a simple `POST /api/scorm/:lessonId/commit` endpoint.
  Honest: package import + launch + basic status tracking, not full RTE.
- **xAPI**: `POST /api/xapi/statements` accepts xAPI-style statements `{actor, verb, object, result}`,
  stores in `xapiStatements[]`; `GET /api/admin/xapi/statements` for review. Also EMIT
  statements internally for key events (lesson completed, quiz graded) so the store is
  populated even without external LRS.
- **PDF/Excel export**: extend existing CSV export — `GET /api/reports/enrollments.pdf`
  and `.xlsx`? Excel without deps: generate a real `.xlsx`? That's a zip — doable but fiddly.
  Simpler honest approach: PDF via printable HTML (print-to-PDF), Excel via
  SpreadsheetML XML (`.xls` opens in Excel). Document honestly.

## Data model

- `ltiConsumers[]`: `{id, institutionId, key, secret, courseId, createdAt}` — secrets never returned by GET
- `scormPackages[]`: `{id, institutionId, courseId, title, manifest, items[] {identifier, title, href}, uploadedAt}`
- `xapiStatements[]`: `{id, institutionId, actor {name, account}, verb {id, display}, object {id, definition}, result, stored}`
- `ltiLaunches[]`: `{id, consumerId, userId, at}` (audit)

## Backend

- `GET/POST /api/admin/lti/consumers`, `DELETE` — `standards.manage`; `POST /lti/launch`
  (OAuth1 HMAC-SHA1 signature check, nonce/timestamp replay guard) → provisions user +
  enrolls + sets session cookie + redirects to course.
- `POST /api/admin/scorm/import` (multipart zip, `standards.manage`) → parse manifest →
  create lessons; `GET /api/scorm/packages`, `POST /api/scorm/:lessonId/commit` `{status}`.
- `POST /api/xapi/statements` (auth'd, any role) → validate + store; internal emits on
  lesson-complete + quiz-graded; `GET /api/admin/xapi/statements` (`?verb=&since=`).
- `GET /api/reports/enrollments.pdf` → printable HTML with print CSS; `GET /api/reports/enrollments.xls`
  → SpreadsheetML. Both reuse the existing enrollment report query.
- Permissions: `standards.manage` → super_admin + institution_admin.

## Frontend

- **Integrations** (`admin-integrations` extension or new `admin-standards`): LTI consumer
  CRUD (shows key, secret shown once), SCORM package upload + package list, xAPI statement
  viewer (filter by verb), export buttons (CSV existing + PDF + Excel).
- **SCORM player** (`scorm-player` screen): iframe launches SCO href, "Mark complete" commits
  status via `/api/scorm/:lessonId/commit`.
- Add to admin nav. Reuse existing styles.

## Tests (backend agent)

New `backend/standards.test.js`: LTI launch with valid/invalid signature; SCORM manifest parse
(unit test with a sample manifest); xAPI statement validation + internal emit on quiz grade;
PDF/XLS endpoints return correct content types; perms. `npm test` green.

## Response shapes (for the frontend agent)

- `GET /api/admin/lti/consumers` → `{consumers: [{id, institutionId, key, label, courseId, createdAt, launchCount}]}` (no secret ever)
- `POST /api/admin/lti/consumers` `{label, courseId}` → 201 `{consumer: {..., secret}, secretShownOnce: true}` — secret shown ONCE
- `DELETE /api/admin/lti/consumers/:id` → `{deleted: true}`
- `POST /lti/launch` (form-urlencoded, public) → 302 redirect; sets `eduverse_session` cookie. Rejects with 401 + `{error}` on bad signature/nonce/timestamp.
- `POST /api/admin/scorm/import` (multipart `package` file OR JSON `{filename, data: base64, courseId?, title?}`) → 201 `{package: {id, institutionId, courseId, title, itemCount, items: [{identifier, title, href, lessonId}], uploadedAt}, courseId, lessonsCreated}`
- `GET /api/scorm/packages` → `{packages: [...]}` (teacher/admin)
- `POST /api/scorm/:lessonId/commit` `{status: completed|passed|failed|incomplete|browsed}` → `{committed}` (student, enrolled)
- SCO files served at `/scorm-content/:packageId/<path>` (e.g. `/scorm-content/<id>/sco1/index.html`) — iframe src for the player
- `POST /api/xapi/statements` `{actor, verb, object, result?, context?}` → 201 `{stored: true, id}`
- `GET /api/admin/xapi/statements?verb=&since=` → `{statements: [{id, institutionId, actor, verb, object, result, stored, source}], count}`
- `GET /api/admin/reports/enrollments.pdf` → printable HTML (`text/html`, has Print button + `@media print` CSS; user prints to PDF)
- `GET /api/admin/reports/enrollments.xls` → SpreadsheetML XML (`application/vnd.ms-excel`)
- New perm `standards.manage` (super_admin + institution_admin). PDF/XLS use existing `reports.view`.
- Lesson `kind: 'scorm'` with `scormHref` + `scormPackageId` on imported lessons.
