# EduVerse 3D — Project Context

This file is the persistent project guide for Claude Code sessions. Treat the
checked-in application code as the implementation source of truth; this file
records the current verified architecture and known limits. Keep it aligned
with the code after every development task.

## Session and documentation rules

- Read this file at the beginning of every new session.
- Before editing, inspect the relevant existing implementation and trace its
  callers, API routes, data ownership, and UI behavior.
- Do not overwrite or remove existing functionality without approval.
- Prefer the existing dependency-light architecture; do not add a dependency
  unless it materially improves the feature and its maintenance cost is clear.
- Keep code readable, reusable, and consistent with adjacent code. The current
  app uses plain JavaScript, HTML, CSS, and a small Node server rather than a
  frontend framework.
- Run suitable checks for changes before calling a feature complete. Do not
  claim tests passed unless they were actually run; do not describe a feature
  as implemented unless the implementation exists.
- After completing work, update this file with changed architecture, decisions,
  completed items, limitations, and remaining priorities. Remove stale claims.
- If a fact cannot be established from the repository, mark it **Not yet
  decided** rather than guessing.
- Treat `backend/data/store.json` as local application data. Do not inspect,
  print, copy, reset, or commit its user records without a specific need and
  authorization. Back up data before any migration or destructive operation.

## 1. Project overview

**Name:** EduVerse 3D (the repository and npm package are named `eduverse-3d`).

**Purpose:** A browser-based learning platform with three distinct role-based
workspaces (Student, Teacher, Administrator), course and classroom workflows,
interactive learning activities, a Learning Twin, and an optional locally
processed Vision & Simulation Lab.

**Problem addressed:** The product aims to combine course delivery, class
management, practice, progress signals, and hands-on visual activities in one
learning environment, while giving each role its own tools and protecting
account and class data on the server.

**Objectives and outcomes:**

- Let students discover courses, enroll, complete lessons and assignments,
  and see their own progress and recorded lab activity.
- Let teachers manage their assigned classes, courses, attendance, assignments,
  grading, announcements, analytics, and vision-lab activities.
- Let administrators manage accounts, approvals, classes, enrollments,
  permissions, reports, platform settings, integrations, and audit records.
- Keep camera access opt-in, process webcam frames on the local machine, and
  offer non-camera alternatives for supported activities.
- Persist account and learning data locally so the application can be used
  without a cloud database service.

The repository does not currently implement a production multi-tenant cloud
service or real-time multi-user classroom. See **Known limits** below.

## 2. Technology stack

| Area | Current implementation |
| --- | --- |
| Frontend | Plain HTML (`index.html`), CSS (`styles.css`), browser JavaScript (`app.js`, `vision-hands.js`); no React/Vue/Angular or build step. |
| Backend | Node.js built-in `http`, `fs`, `path`, `crypto`, `util`, and `child_process` modules in `backend/server.js`; no Express or npm runtime dependencies. Node.js >=18 is declared. |
| Persistent data | Local JSON file at `backend/data/store.json` by default. `EDUVERSE_STORE_PATH` can override it. Writes are serialized, written to a mode-0600 temp file, fsynced, and atomically renamed; the prior snapshot is retained as `store.json.bak`. The default data directory is mode 0700. Uploaded course files live in a mode-0700 `course-uploads/` directory beside the configured store and each file is created mode 0600. Runtime store, backup, and upload files are Git-ignored. This is still not a production database or object store. |
| Retry safety | `backend/idempotency.js` stores user/operation-scoped replay records in the same JSON store for selected writes; default retention is 24 hours. |
| Sessions and passwords | In-memory server session map; random session IDs in HttpOnly, SameSite=Lax cookies (Secure in production); 12-hour sliding expiry. Passwords use Node scrypt with per-password salt. |
| Vision service | Optional Python `http.server` service on loopback port 4174; OpenCV and NumPy, with optional MediaPipe 0.10.21 in the Python 3.12 environment. The Node server attempts to start `.venv-mediapipe` automatically. |
| 3D / drawing | Canvas-based interactive campus and simulations, and 2D canvas drawing. No Three.js dependency or Three.js import is present in the current project. |
| External UI assets | Google Fonts (DM Sans, Space Grotesk) and course cover images from Unsplash are referenced by the page. |
| AI / email / SMS | Nova uses OpenAI when `OPENAI_API_KEY` is present and otherwise uses local guided responses; `NOVA_MODEL` selects the model. Email can use configured providers or the local outbox. Signup's demo OTP is not delivered by email/SMS. |
| Development checks | `npm test` runs Node idempotency unit tests and isolated local HTTP resilience tests; `node --check` checks JavaScript syntax; `python3 opencv-drawing/test_gestures.py` and `python3 scripts/check-parity.py` check Python/JavaScript gesture behavior. No frontend build/lint script is configured. |

`OPENAI_API_KEY`, `NOVA_MODEL`, and `APP_BASE_URL` are read by the current
application. Node does not load `.env` itself (there is no dotenv dependency);
environment variables must be supplied by the process manager or shell. `.env`
and `.env.*` are ignored, with `.env.example` exempted.

## 3. Project architecture

### Repository layout

```text
eduverse-3d/
├── index.html                    Static page shell and initial dashboard markup
├── app.js                        SPA screens, auth UI, API calls, labs, interactions
├── styles.css                    Global layout, role themes, responsive styles
├── vision-hands.js               Hand gesture math and Vision Lab playground plugin
├── backend/
│   ├── server.js                 Node HTTP API, auth, authorization, persistence, static allowlist
│   ├── data/course-uploads/      Private uploaded course files beside the configured JSON store (runtime data, ignored)
│   ├── idempotency.js            Single-process keyed request replay and conflict handling
│   ├── idempotency.test.js       Unit tests for concurrent/retried request behavior
│   ├── api-resilience.test.js    Isolated HTTP checks for enrollment, access, and cache headers
│   └── data/store.json           Local persisted application records; treat as private user data
├── opencv-drawing/
│   ├── server.py                 Local OpenCV HTTP service on 127.0.0.1:4174
│   ├── hands.py                  Optional MediaPipe hand-landmark tracker
│   ├── gestures.py               Python gesture classification/normalization math
│   ├── test_gestures.py          Gesture unit tests and synthetic landmarks
│   ├── requirements.txt          OpenCV and NumPy requirements
│   └── requirements-mediapipe.txt Python 3.12 MediaPipe environment requirements
├── scripts/check-parity.py       Compares Python and JavaScript gesture math
├── LICENSES/                     Third-party attribution/license text
├── .env.example                  Environment-variable template (not auto-loaded)
├── .gitignore                    Ignores env files and Python virtualenv/cache files
├── README.md                     User-facing setup and feature documentation (some auth details stale)
├── SECURITY_PROMPTS.md           Security audit prompt collection, not executable controls
└── package.json                  Minimal package metadata and `npm start` script
```

Python virtualenv and bytecode cache directories may exist locally, but are
ignored and are not source files to commit.

### Frontend modules and behavior

- `index.html` provides `#authRoot`, the portal shell, modal, Nova chat panel,
  navigation containers, and loads `app.js` followed by `vision-hands.js`. Student, teacher, and administrator nav links are generated from role-specific `portalScreens`; `screenRole` also guards hash navigation to restricted pages.
- `app.js` owns role navigation (`portalScreens`, `screenRole`), auth views,
  page rendering, API calls, student and staff features, vision experiments,
  and canvas interactions. The app uses hash navigation and dynamically
  replaces the main content for many screens.
- `vision-hands.js` is loaded after `app.js`; it exposes `window.HandMath`,
  adds the Hand Tracking Playground experiment, renders the model-hand
  explorer, and communicates with the Python service for live landmarks.
- `styles.css` styles the single-page application, auth forms/modals, student
  theme, and separate teacher/admin workspace themes. The file is highly
  compressed/minified in places; make localized changes and preserve existing
  selectors and responsive behavior.
- Browser API calls use same-origin `/api/...` paths. Camera frame calls go to
  `http://127.0.0.1:4174` only after the user starts a camera activity.
- The shared topbar theme switch applies to all portals and stores the signed-in
  user's preference through `PATCH /api/profile` (`preferences.theme`). A local
  storage value is only a visual fallback before authenticated profile loading.

### Backend, data, and security boundaries

`backend/server.js` is a single-file Node HTTP server. It:

1. Reads the configured JSON store into memory at process startup and fills in
   defaults for newer store sections.
2. Parses JSON requests (64 KB general body limit) and dispatches exact route
   patterns.
3. Resolves the session cookie to a server-side user before protected routes.
   Admin and teacher route families perform role checks; course/class/assignment
   handlers also check ownership or membership.
4. Mutates in-memory data and queues an atomic JSON snapshot write. Before
   replacing the store, the last snapshot is retained as a mode-0600 `.bak`
   file. The default local data directory is mode 0700. These settings protect
   files from other local OS accounts; they do not encrypt data at rest.
5. Serves `/`, `/index.html`, `/app.js`, `/styles.css`, `/vision-hands.js`,
   `/404.html`, `/terms.html`, and `/privacy.html` from a narrow static
   allowlist. Unknown non-API GET/HEAD routes use the branded 404 HTML; unknown
   API routes remain JSON errors.
6. Attempts to start the local Python service if the configured local virtual
   environment exists.
7. Streams approved teacher course uploads to the private directory beside the
   JSON store and only serves them through a role, ownership, and enrollment
   checked download endpoint.
8. Uses `backend/idempotency.js` for course enrollment, administrator
   enrollment, and assignment submission when clients include an
   `Idempotency-Key`. It stores successful responses with the associated
   mutation in one JSON snapshot, replays identical requests for 24 hours, and
   rejects a reused key with a different body. Keys are scoped by signed-in
   user and operation. Authentication and role checks run before replay lookup.

Data is keyed by user or held in collections including users, courses, classes,
enrollments, assignment submissions, teacher workspaces, progress, notes,
notifications, feedback, vision events/assignments, organizations, settings,
permissions, and audit history. The data file is non-empty on the current
workspace; its account contents were intentionally not read for this analysis.

### Important workflows

- **Signup/sign-in:** Student signup uses name, username, 12+ character
  password, and terms acceptance; student OTP is not requested. Teacher signup
  requires the temporary demo OTP UI step and normally creates a pending
  account requiring administrator approval. Login accepts username or an
  existing email and password. After login, a modal asks for any missing Gmail
  or email, phone, age, and school/workspace; `PATCH /api/profile` persists
  those fields. Current demo OTP accepts any 4–8 digit code after the user
  selects the send-demo-code control; no real message is sent.
- **Administrator setup:** The first administrator can use the setup form
  (`POST /api/auth/setup-admin`) with a name, username, password, terms,
  temporary demo OTP, and setup code. The server's current fallback setup code
  is `123456` unless `EDUVERSE_ADMIN_SETUP_CODE` overrides it. An existing
  administrator can create additional accounts through the admin user flow.
  A separate optional bootstrap path reads
  `EDUVERSE_BOOTSTRAP_ADMIN_EMAIL` and
  `EDUVERSE_BOOTSTRAP_ADMIN_PASSWORD` when the server starts with no admin.
- **Role navigation:** Student navigation includes My class today and Timetable; teacher navigation includes a separate timetable plus webcam drawing and Vision & Simulation Lab. Those camera/lab screens are teacher-only at the client navigation guard. Student sign-in omits the authenticator code input; teacher/admin sign-in retains it.
- **Assignments:** Teachers can add up to 50 question/task prompts (10,000 characters total) as separate lines when publishing. The API stores them on the assignment, returns them only to assigned students and the owning teacher/admin, and the student assignment card renders them as an ordered list.
- **Timetables:** Teacher schedule records are persisted through the existing `/api/teacher/schedule` route. Student “My class today” filters their enrolled-class schedule records to the local date; student Timetable lists their upcoming/all saved sessions. Teacher Timetable displays assigned sessions and provides a form to add one.
- **Course learning:** Teachers create/manage owned courses, modules, lessons, and linked resources; students view published courses, enroll, complete lessons, submit work, and receive released grades. Server routes enforce relevant role and ownership checks. Course ratings are limited to enrolled students who complete every lesson, with one editable review per student/course. Uploads accept PDF, MP4, WebM, TXT, and Markdown, use the administrator-configured per-file limit (capped at 500 MB), and are served only through authenticated, enrollment/owner-authorized download routes.
- **Retry behavior:** `apiRequest` generates and retains a request key in
  `sessionStorage` for pending POST, PATCH, and DELETE calls. Successful
  responses clear the pending key. The selected enrollment and assignment
  routes persist keyed responses so a retry after a lost response does not
  repeat the write. Repeating identical assignment text without a key also
  preserves the original submission timestamp. There is no payment feature or
  payment endpoint in the project, so payment idempotency is not applicable.
- **Vision lab:** The browser requests webcam access only after explicit user
  action, captures reduced-size JPEG frames, and posts them to the local Python
  service. The service returns hand landmarks, contour pointers, color
  estimates, sketch/board transforms, or perception results. Browser canvas
  logic maps hand coordinates to drawing, keyboard, gesture, and lab controls.
- **Nova:** `POST /api/chat` dispatches intent/keyword-based guided responses
  using app/course/account records. It is not an external model call. Answers
  outside supported EduVerse topics are explicitly deflected.

### API endpoint map

The following are implemented route groups and representative routes; inspect
`backend/server.js` before changing request/response details.

| Area | Routes |
| --- | --- |
| Health/settings | `GET /api/health`, `GET /api/settings`, `GET /api/auth/bootstrap-status` |
| Authentication | `POST /api/auth/signup`, `/login`, `/logout`, `/setup-admin`, `/change-password`, `/forgot-password`, `/reset-password`; `GET /api/auth/me`; `DELETE /api/auth/account` |
| Administrator MFA | `POST /api/auth/mfa/setup`, `/verify`, `/disable` |
| User profile/progress | `GET/PATCH /api/profile`, `GET /api/progress`, `POST /api/attempts` |
| Student analytics/activity | `GET /api/student/analytics`, `POST /api/student/activity`; analytics are scoped to the authenticated student and include course progress, tracked foreground learning time, streaks, released assignment marks, and teacher-scored quiz attempts |
| Student community | `GET /api/community/feed`; `POST /api/community/posts`, `/api/community/posts/:id/comments`, `/api/community/posts/:id/like`, `/api/community/posts/:id/bookmark`, `/api/community/follow/:studentId`, `/api/community/reports`; report queue and moderation are under `/api/admin/community/reports` |
| Vision learning | `GET /api/vision/progress`, `POST /api/vision/events`, `GET /api/vision-assignments` |
| Courses/enrollment/reviews | `GET /api/courses`, `POST /api/courses/:id/enroll`, `POST /api/courses/:id/lessons/complete`, `GET /api/my-courses`, `GET/POST /api/courses/:id/reviews`; reviews require enrollment and full lesson completion |
| Notes/resources/notifications | `GET/POST/PATCH /api/notes` (owner-scoped); `GET /api/resources` and `/api/resources/:id`; `GET /api/notifications`, `POST /api/notifications/:id/read`; user-targeted notifications cover course publishing, assignment lifecycle, teacher announcements, tests, and upcoming assignments/live sessions |
| Assignments | `GET/POST /api/assignments`, `POST /api/assignments/:id/submit` |
| Teacher workspace | `GET /api/teacher`, `/api/teacher/attendance?classId=&date=`, `/analytics`, `/courses`, `/grading`, `/course-progress`, `/vision-assignments`, `/vision-results`; course/module/lesson/resource mutations; `POST /api/teacher/courses/:id/resources/upload`; schedule, date-keyed attendance, practice, tests; announcements; grading release; `PATCH /api/teacher/tests/:testId/attempts/:attemptId/grade` |
| Administrator | `/api/admin/*`: users/approvals, teachers, students, `PATCH /api/admin/students/:id/record` for registration/roll/grade/section/guardian details, classes, courses, org, enrollments, permissions, settings, reports/export, audit, services; corresponding POST/PATCH routes for mutations |
| Feedback/Nova | `POST /api/feedback`, `POST /api/chat`, `GET /api/syllabus` |

The Python service on port 4174 exposes `GET /health`, `GET /hands/status`,
and POST routes `/track`, `/hands`, `/scan`, `/stylize`, `/analyze`,
`/perceive`, `/learn`, `/classify`, `/reset`.

## 4. Development decisions

- **No frontend framework/build step:** Keep the app directly runnable as
  static files served by Node. There is no bundler, component framework, or
  package dependency to preserve.
- **Single-origin frontend/API:** Browser API requests use same-origin paths;
  the server has a narrow static allowlist and restrictive response headers.
- **Local-first persistence:** JSON-file persistence and loopback-only camera
  processing support a local educational prototype without hosted services.
  Store writes now use atomic replacement and retain one prior snapshot. This
  still trades multi-process/concurrent database capabilities for simplicity
  and is not a production persistence design.
- **Retry and cache boundaries:** Selected mutation routes use expiring,
  actor/operation-scoped idempotency keys. The JSON store and in-process lock
  coordinate only one Node process; a database transaction or shared
  idempotency store is needed for multi-instance deployments. API JSON uses
  `Cache-Control: no-store`; HTML, JS, and CSS require revalidation. No CDN is
  configured in this project.
- **Server-verified roles:** The signed-in server user is authoritative. UI
  navigation hides/restricts screens, while backend endpoints enforce access.
- **Separate workspaces:** Student, teacher, and admin have different sidebar
  and dashboard structures; role-specific flows are intentional.
- **Privacy/consent:** Camera starts only from an explicit activity action;
  frames are processed locally and are not intended to be saved.
- **Fallback learning modes:** Simulations and model-hand explorers provide
  non-camera interaction; the campus has a 2D-map fallback.
- **Temporary verification only:** Any-code teacher/admin demo OTP is a
  prototype convenience, not identity verification. Do not present it as
  secure or connect real accounts to it without replacing it with a real
  verification provider and server-issued one-time codes.
- **No documented rejected alternatives:** Not yet decided beyond the
  current dependency-light/local-first choices above.

## 5. Completed work present in the codebase

The following features have corresponding UI/API implementation. Exact
behavior can still have limitations noted later in this document.

- Improved contrast for muted text across student dashboards, community and
  profile cards, teacher workspace panels, vision progress rows, hand-tracking
  details, and the classroom modal in light and dark themes. Long modal content
  now scrolls within the viewport. The teacher sidebar uses a deep teal
  background with high contrast light text, a light active item, and readable
  help/workspace surfaces. Application pages and authentication screens have
  a back control; application navigation keeps an in-session screen history.
  Signing out opens an explicit Yes/No confirmation dialog.
- Classroom chat now requests a guided response from the existing `/api/chat`
  service and falls back to the local guided reply if the API is unavailable.
  Webcam drawing clamps normalized fingertip coordinates to the canvas edge
  and preserves a stroke briefly across short tracking dropouts.

- Default account and learning data now persists at `backend/data/store.json`
  across server restarts. JSON writes are serialized and use a mode-0600 temp
  file, fsync, and atomic rename; the prior snapshot is kept in `store.json.bak`.
  The default data directory is mode 0700. Store and backup files are ignored
  by Git so private records are not accidentally committed.

- Authentication, role selection, signup, login/logout, password hashing,
  password recovery codes, password change, account deletion, admin MFA, and
  server-side session cookies.
- Student, teacher, and administrator workspace navigation and role-specific
  dashboards/screens.
- Student catalog/enrollment, course lesson progress, assignments, notes,
  progress, notifications, feedback, and account/profile screens.
- Assignment creation accepts separate question/task prompts and students see those prompts on their assignment cards. Student MFA input is omitted from sign-in while teacher/admin MFA remains available. Notification and assignment text/cards receive higher-contrast dark-theme colors.
- Teacher classes, date-specific attendance with full-roster status validation
  and editable saved records, sessions, practice questions, tests, courses,
  modules/lessons/resources, assignments, grading and grade release,
  announcements, analytics, and vision-lab assignments/results.
- Admin user management/teacher approvals, class and course management,
  enrollment, student registration numbers, grade-specific roll numbers, grade/
  section and guardian contact records, institution/department/term records,
  role permissions, reports
  and CSV exports, audit events, settings, service status, and MFA controls.
- Learning Twin/progress and Vision Lab event recording with attempts, scores,
  mistakes, skills, XP, completion, and badges where the implemented events
  provide those signals.
- Canvas-based 3D-style campus, 2D map option, classroom/whiteboard demo,
  interactive binary-search learning, and browser drawing tools.
- Vision & Simulation Lab cards and activities for webcam drawing, hand
  tracking, air keyboard, gesture interactions/training, science simulations,
  and additional computer-vision/accessibility demos.
- Local OpenCV endpoints for fingertip tracking, MediaPipe landmarks,
  experimental feature-vector gesture classification, color estimation,
  image cleanup/sketch styles, and face/body-region perception.
- Classroom whiteboard ink layer in `app.js`: optional local MediaPipe hand
  tracking draws with a stabilized one-index-finger gesture and uses open palm
  as cursor-only movement. Mouse/touch drawing, pen/eraser, color/width,
  undo/redo, clear, PNG download and explicit local board save are available.
  Camera frames are sent at reduced size to the local OpenCV service only;
  webcam streams stop when the user stops the camera or leaves the classroom.
  This classroom remains a local demo; whiteboard ink is not synchronized to
  other participants in real time.
- Python and JavaScript gesture implementations plus a parity script and
  Python unit tests.
- Keyed retry protection for course enrollment, administrator enrollment, and
  assignment submission; identical assignment retries preserve their original
  submit time. Node tests cover simultaneous retry, lost-response replay,
  payload mismatch, actor/operation scoping, failed-operation retry, and TTL.
- API responses are non-cacheable; HTML, JavaScript, and CSS require cache
  revalidation. Local HTTP tests cover concurrent enrollment, role denial, and
  these cache headers. No CDN is configured.
- Branded 404 and prototype-accurate Terms/Privacy pages are served from the
  static allowlist. Signup and initial-admin setup require scrolling through
  the inline notice before the consent checkbox is enabled. The legal pages
  explicitly state that operator, jurisdiction, dates, and legal review are
  undecided; they are not production-ready legal advice.
- A source-based privacy, legal, accessibility, tracker, data-minimization,
  DPDP and asset-provenance audit is recorded in
  `LEGAL_ACCESSIBILITY_AUDIT.md`. It adds no application changes and makes no
  legal or WCAG conformance claim. The draft notices remain drafts pending
  verified operator/deployment facts and qualified legal review.

Do not infer from a visible card that a feature uses a trained AI model or
production-grade recognition. See limitations.

## 6. Current development status

**Latest feature:** Teacher attendance loads the assigned class roster by date,
requires a status for every active learner, supports bulk status selection, and
updates the same class/date record on resave. Administrators can assign unique
registration numbers, roll numbers unique within grade/section, grade, section,
and optional guardian details from the Students page. These changes are syntax
checked, and the refreshed browser loaded the new versioned assets. The
authenticated roster and save flows have not yet been exercised end to end.

**Latest UI maintenance:** Sign-out confirmation and back controls are implemented.
The teacher sidebar uses a high-contrast deep teal palette. These updates were
syntax-checked. Browser rendering confirmed the current portal loads the new
back control; logout confirmation interaction was not automated.

**Current status:** The repository contains a broad working prototype with
three role portals, local persistence, a local vision service, and many
interactive learning screens. Retry protection and focused resilience tests
for course/class enrollment and assignment submission are implemented. A
branded 404 and scroll-gated signup legal consent are implemented and covered
by the local HTTP suite for their server routes. A requirement-by-requirement
readiness matrix is in `PRODUCTION_READINESS.md`; the privacy/accessibility and
legal gap assessment is in `LEGAL_ACCESSIBILITY_AUDIT.md`. Both reports are
source-based and do not certify production readiness, legal compliance, or
WCAG conformance. Broad browser journey and operational testing remains
pending.

### Known documentation drift

- `README.md` describes email-based signup and email-based first-admin setup,
  but current `app.js` uses username signup and asks for contact details after
  sign-in. It also omits the current temporary OTP/setup-code flow. Update the
  README when appropriate; do not copy those outdated instructions into new
  feature work.
- README's run command says to change into `backend`, but the only checked-in
  `package.json` is at the project root. Use `npm start` from the project root.
- The signup demo OTP is not a real verification channel. Production teacher
  self-signup is disabled; create teacher accounts through administrator tools.
- Production browser-based first-admin setup requires a private setup code of
  at least 32 characters. Use `APP_BASE_URL` for canonical HTTPS Origin checks
  behind a reverse proxy.
- Some static starter/dashboard content in `index.html` is hard-coded as a
  visual shell; runtime auth and rendering should be traced in `app.js` before
  assuming those initial example values are live learner data.
- Initial dashboard/profile markup includes hard-coded identity and progress
  examples. Verify that these are replaced or clearly presented as sample
  content in all relevant runtime paths before commercial use.
- `index.html` contains placeholder `href="#"` links (“How it works” and
  “Explore circles”); verify or replace these unfinished destinations before
  claiming all navigation works.
- Static Nova input is placeholder-only without an associated label. The
  modal has dialog semantics and Escape handling, but focus trapping,
  background isolation, initial focus, and focus restoration have not been
  verified.
- Browser `localStorage` includes learning/activity keys. Determine whether
  personal content persists after sign-out and document/implement account-aware
  cleanup only after tracing expected behavior; shared-device leakage is a
  privacy risk.

### Known limits and risks

- JSON store is a local single-process persistence mechanism: no schema
  migration framework, transactional database, multi-instance coordination,
  automated off-device backup, encryption at rest, or production durability
  guarantees. One local prior-version snapshot is kept at `store.json.bak`.
- Idempotency replay records are stored in the same JSON file and coordinated
  by an in-process map. They protect retries handled by one running process;
  multiple Node workers/instances can still race. A database transaction and
  shared idempotency store are required before horizontally scaled use. The
  current 24-hour replay retention is not configurable through the UI.
- Sessions are persisted in the JSON store and restored at startup. The app binds
  to `127.0.0.1` in development by default; production binds to `0.0.0.0` (or
  `HOST`) for the configured deployment platform. Storage remains single-process.
- Community notifications and reports share the local JSON store; moderation
  controls are administrator-only. Notification freshness depends on an open,
  signed-in app polling the API, so a closed browser receives no background
  alert. Learning-time summaries are estimates from foreground heartbeats, not
  proof of attention or active study.
- The first-admin UI's setup code defaults to `123456` unless overridden.
  Override `EDUVERSE_ADMIN_SETUP_CODE` before use and do not expose the local
  server to untrusted networks. Demo OTP verification is client-controlled and
  accepts any 4–8 digits after its UI send step; it is not secure verification.
- Email and phone are profile fields only; there is no email/phone verification
  or delivery provider. Password recovery uses an administrator-issued,
  one-time code because email delivery is absent.
- The new Terms and Privacy pages describe the local prototype only. Operator
  identity, jurisdiction, effective date, data retention, legal review, and
  production deployment details remain undecided. The pages must be reviewed
  and finalized before production use.
- Nova is guided keyword/rule-based assistance, not ChatGPT or a live LLM.
- No Three.js usage is present. The current 3D-style scenes and visualizations
  use canvas/browser code. Do not claim a Three.js environment exists.
- Classroom and scheduled-session features are local demos/records, not live
  multi-user video, synchronized chat, or networked collaborative whiteboard.
- Binary file upload, upload virus scanning, OCR, and recognition of named
  everyday objects are not implemented. Board cleanup is image enhancement;
  object color hunt estimates center-frame color. Gesture labels are geometric
  estimates/nearest-neighbor samples, not sign-language recognition.
- MediaPipe requires the supplied Python environment to be installed and may
  be unavailable on unsupported runtimes. OpenCV contour tracking is fallback
  functionality, not equivalent to 21-landmark tracking.
- `opencv-drawing/server.py` restricts CORS to loopback origins and rejects
  untrusted origins in the audited code. Keep the service loopback-only and
  revisit request hardening before exposing it beyond the local
  browser/service boundary.
- `npm test` now runs focused idempotency unit tests plus an isolated local API
  tests for enrollment, role denial, and cache headers. The latest documented
  security pass recorded 16 Node tests and 16 Python tests passing, plus 84
  Python/JavaScript parity cases with no mismatches; rerun commands before
  relying on those results. Comprehensive browser journeys, broad endpoint
  authorization/ownership coverage, and production security tests remain
  absent. `PRODUCTION_READINESS.md` has the test evidence and limitations.
- The classroom hand-writing feature passed `node --check app.js` and the
  current `npm test` suite (**16 passed**). The app server started on an
  isolated temporary store, but the browser preview was blocked by the
  browser's localhost URL policy. Webcam gestures and actual device-camera
  performance have not been verified with a physical webcam; do not claim
  tested real-camera behavior until that is done.
- No CDN, hosted database, email/SMS delivery, analytics, error monitor, or
  configured automated backup exists. See `PRODUCTION_READINESS.md` for the
  audited status and prioritized release blockers. The Cloudflare security
  audit skill has not been run because its required isolated sandbox/output
  environment is unavailable here.
- Google Fonts and Unsplash-hosted course images cause third-party browser
  requests. No analytics, advertising pixels, hosted AI, or embedded video/map
  service was found in the reviewed source; deployment network behavior and
  third-party cookie behavior remain unverified. See
  `LEGAL_ACCESSIBILITY_AUDIT.md` before introducing trackers or consent UX.
- No cookie policy, cookie banner, or refund policy exists. Current source has
  an essential first-party HttpOnly session cookie and no payment flow. Decide
  legal disclosure/consent requirements from deployed network behavior and
  jurisdiction; reassess refunds if payment features are added.
- DPDP applicability, operator/Data Fiduciary roles, deployment jurisdiction,
  retention, grievance contact, processor terms, and child-user handling are
  not yet decided. Official-law staging must be reassessed before launch with
  qualified Indian privacy counsel.
- Accessibility has not been verified to WCAG 2.2 AA. No contrast audit,
  keyboard-only flow, assistive-technology review, or complete responsive
  reflow test has been performed. The focused source findings are documented
  in `LEGAL_ACCESSIBILITY_AUDIT.md`.

## 7. Development rules

- Read this file and the relevant implementation before changing behavior.
- Read `LEGAL_ACCESSIBILITY_AUDIT.md` before changing data collection, browser
  storage, analytics/third-party integrations, camera data flow, or legal UX.
- Keep role authorization in the backend even when the UI already hides a
  control. Verify ownership for every ID-based data operation.
- Preserve the static file allowlist, safe response filtering, password hash
  handling, session cookie properties, rate limits, and data ownership checks.
- Never put real credentials, OTP secrets, passwords, hashes, recovery tokens,
  or personal account data in source, logs, docs, screenshots, or commits.
- Never use `backend/data/store.json` as a disposable fixture. Use a temporary
  copy/path for tests that write data, and protect the real local store.
- Keep camera capture opt-in. Do not store or upload camera frames unless the
  user explicitly asks and the privacy/data flow is documented.
- Treat the OpenCV process as local-only unless its exposure, authentication,
  CORS, payload limits, and error behavior are intentionally redesigned.
- Keep server/API, browser, and Python dependency choices documented. Verify
  environment variables against runtime usage before treating them as active.
- Use the existing checks where relevant:

  ```bash
  node --check app.js
  node --check backend/server.js
  npm test
  python3 opencv-drawing/test_gestures.py
  python3 scripts/check-parity.py
  ```

- Do not modify or remove unrelated portal features as part of a focused task.
  Update `README.md` when user-facing run/setup instructions change, and update
  this `CLAUDE.md` after every completed feature or architecture change.

## 8. Future roadmap and priorities

The following are improvement opportunities from current gaps and prior
product direction. They are not all committed or in progress; sequencing is
**Not yet decided**.

1. Replace temporary teacher/admin OTP with a real server-issued, time-limited
   code and email/SMS provider; make the setup code mandatory and rotate the
   insecure fallback. Add throttling/expiry/replay protection for OTP.
2. Decide whether usernames or verified email addresses are the canonical
   login identifier, and align signup, recovery, admin setup, README, and
   account contact changes to that policy.
3. Replace JSON persistence with a transactional database and migrations if
   multi-user deployment is intended; add backup/restore and data migration.
4. Harden the Python service (restrict CORS, validate image and JSON inputs,
   limit payloads consistently, and provide structured errors) before any
   non-loopback deployment.
5. Decide whether Nova should remain a guided content assistant or connect to
   an LLM. If an LLM is added, implement server-side key handling, privacy
   boundaries, prompt/data minimization, cost/rate limits, and clear UX
   labeling; do not pass account data or camera frames unnecessarily.
6. If a true 3D educational-object experience is required, evaluate adding a
   maintained 3D library (for example Three.js) as a deliberate architecture
   decision; the current implementation is canvas-based.
7. Improve accessibility, keyboard operation, reduced-motion support, low-end
   device behavior, and consistent 2D alternatives across all experiments.
8. Add reproducible end-to-end tests for auth/profile completion, role access,
   ownership boundaries, course/assignment workflows, persistent storage,
   Vision Lab event recording, and Python service failure/fallback states.
9. Update `README.md` to reflect current username signup, post-login profile
   completion, demo OTP and setup-code limitations, and the root-level run
   command.
10. Before production use, establish HTTPS deployment, secret management,
    database operations, observability without PII, backup/recovery, dependency
    update policy, and an independent security review.
11. Complete the details in `PRODUCTION_READINESS.md`, including email/OTP
    delivery, legal review, CDN/CI choices, account-deletion coverage, and
    browser/security/load validation.
12. Resolve the operator, jurisdiction, school/minor use, data retention,
    grievance process, hosting/providers, and asset licenses documented in
    `LEGAL_ACCESSIBILITY_AUDIT.md`; then obtain qualified legal review and
    complete a WCAG 2.2 AA assessment before making compliance claims.
13. If Classroom is intended to be genuinely live across participants, design
    and test authorized real-time whiteboard synchronization; the current
    hand-writing ink layer is local to this browser/device.
14. Add a searchable country and calling-code selector to post-login profile
    completion; the current mobile field remains a free-text input.


## Audit fixes — 2026-11-01 (deep verification round)

A full audit (16/16 unit+resilience tests, 73-endpoint live probe, three-portal
jsdom boot, end-to-end journeys for admin/teacher/student) found and fixed:

1. **`GET /api/teacher/vision-assignments` was dead code** — the handler sat
   after a `//` comment on the same line, so the teacher's "Vision lab
   assignments" page got `Route not found`. Restored as its own statement.
2. **`GET /api/courses` (and `POST /api/teacher/courses`) crashed with 500 on
   a fresh store** — `store.courses` was never initialized. Startup now
   initializes all collection keys (`courses`, `classes`, `assignments`,
   `notes`, `feedback`, `resources`, `notifications`) and map keys
   (`userAttempts`, `userProgress`, `userVision`, `notificationReads`,
   `teacherWorkspaces`).
3. **`parseCookies` threw on malformed cookie values** (500 on every request).
   Now skips undecodable pairs and tolerates `=` inside values.
4. **README run instructions** corrected: `npm start` runs from the project
   root (`cd eduverse-3d`), not `eduverse-3d/backend`.

Verified after the fixes: 16/16 tests pass; all 60 frontend API paths resolve
to a server route; admin MFA works with a real TOTP code; course publish →
student enroll (idempotent) → lesson complete; assignment submit → grade →
release (drafts stay hidden); admin-issued recovery code → password reset;
path traversal and `backend/data/store.json` stay unreachable (404);
malformed cookies, oversized bodies, and forged origins are rejected.

## Webcam handwriting smoothness — 2026-11-01

Emi reported the webcam handwriting "not working perfectly". Root causes were
all in the drawing studio's per-frame pipeline (`trackWebcamFrame` in
`app.js`); the Python service and its gesture tests (14/14) were fine:

1. **Pen flicker (main cause):** the pen went down/up on a single frame's
   gesture with no debouncing, so MediaPipe landmark noise shattered strokes
   into dots and dashes. The pen now uses vote hysteresis — 2 consecutive
   one-finger frames to engage, 2–3 non-one-finger frames to release — plus a
   0.45 gesture-confidence gate.
2. **Weak smoothing:** the 0.45/0.55 lerp barely filtered jitter, and the
   filter state survived pen-up, causing jump-streaks at stroke starts.
   Replaced with an adaptive One Euro filter (per axis), reset on pen-up,
   pause, stop, and tracking loss.
3. **Polygonal strokes:** sparse tracking frames (~10 fps) were joined with
   straight `lineTo` segments. Strokes now render as quadratic midpoint
   curves.
4. **Per-frame canvas allocation** in the tracking loop replaced with a
   reused scratch canvas (less GC jank).

Also shipped the previously missing `opencv-drawing/` service folder
(`server.py`, `hands.py`, `gestures.py`, requirements, README) so the zip is
a complete project — the Node server auto-starts it from
`.venv-mediapipe/bin/python` as documented.

Verified: targeted jsdom tests — pen engages at 2 frames, survives
single/double-frame flicker, releases after sustained misses; filter residual
0.005 under ±0.02 jitter while tracking a real 0.3 step to 0.799; stroke
renderer emits 3 quadratic segments and 0 straight lines for 4 points. Full
suite still 16/16; all three portals boot with 0 JS errors. Real-camera feel
still needs emi's eyeball check in a real browser.

## LMS expansion — 2026-11-02

Emi picked "Add these features to EduVerse 3D" for the 10-area LMS spec.
Built via a written contract (`LMS_CONTRACT.md`, kept in the project) with a
backend agent and a frontend agent working in parallel.

Backend (`backend/server.js`, +494 lines): 12 new store collections; ~40 new
routes — quiz CRUD/take/grade (answer keys stripped from every student
payload), video progress with 90% auto-complete, certificates (eligibility
checked, public verify), test-mode payments (plans, checkout, billing,
webhook stub), paid-course enrollment gate (402 → checkout), discussions,
live sessions, gamification (XP/levels/streaks/6 badges/leaderboard).
`backend/lms-features.test.js`: 11 new tests. One real bug caught in review:
cancelled subscriptions lost access immediately instead of at period end —
fixed (`activeSubscription` now honors endsAt for cancelled subs).

Frontend (`app.js` + `styles.css`): 12 new screens — video-player (mp4 +
YouTube IFrame tracking, resume, heartbeat), quizzes, quiz-take (renders the
server-shuffled questions from POST /start), teacher-quizzes (builder +
manual grading), certificates (print CSS + public verify), billing, checkout
(test-mode banner), discussions, live-classes, leaderboard, admin-plans,
admin-orders; dashboard XP/continue-learning/live widgets; catalog price
badges + Buy & Enroll; lesson video URL + course price fields in the teacher
editor. One real bug caught by the frontend agent: ~52 `apiRequest` calls had
been written with a double `/api/` prefix — fixed and re-verified.

Verified: 27/27 tests (16 pre-existing + 11 new); a 28-step live-server
journey (priced course → 402 gate → test checkout → enroll → video complete →
quiz take/grade → certificate → verify → discussions → live join → XP/badges →
subscription → cancel) all passing; jsdom boot 0 errors. Honest limits:
payments are simulated (no real gateway), video is URL-based (no
upload/storage), final visual feel needs emi's browser.


## ZIP merge — 2026-11-10

Merged `EduVerse-3D-fixed.zip` into the project. Imported LMS/backend modules,
contracts, SQL migration, deployment and CI docs, and expanded the app and
styles while preserving existing student community, activity analytics, course
reviews, theme toggle, and prior local work. Restored their server routes and
helpers where the archive's server version omitted them. Notification listing
and read actions now enforce recipient or class-membership visibility. Public
auth requests skip student-only feed/analytics checks safely.

Dependencies are locked in `package-lock.json`; `npm test` runs serially because
the suites start isolated local HTTP/WebSocket servers. `npm run load-test` is a
small built-in Node probe and needs no extra package.

Verified after merge: `npm ci` succeeded; all **195 backend tests passed** with
`node --test --test-concurrency=1 backend/*.test.js`; `node --check` passed for
`app.js`, `backend/server.js`, and `scripts/load-test.mjs`; `git diff --check`
passed. Integration credentials/providers remain environment-dependent as
described in the deployment docs.


## Theme contrast follow-up — 2026-11-10

Improved text contrast for staff empty states, assignment submission text, live
class cards, and calendar weekday/day labels. Their surfaces now follow the
active theme: dark surfaces with light text in dark mode and light surfaces with
dark text in light mode. This covers the teacher grading, class roster,
attendance, timetable, quizzes, question bank, announcements, assigned vision,
marketplace, live classes, and calendar screens. Verified with `git diff --check`.


## Admin setup pages — 2026-11-10

Fixed admin API calls that incorrectly included the `/api` prefix even though
`apiRequest` already adds it. This restored institution and academic-year
options on the academic calendar and fee-structure forms, and made the Roles &
permissions matrix load and save through its existing backend endpoint.
Institution selectors for fees/subscriptions are now populated before dependent
academic-year options are requested, avoiding an empty-select race.


## Auth, student notebook, and theme follow-up — 2026-11-10

Auth signup and administrator setup screens retain a visible Back control and
the auth container now scrolls smoothly when long forms exceed the viewport.
The sign-in entry points first ask users to select Student, Parent, Teacher, or
Administrator, then open the selected role's sign-in form. Removed broken raw
template interpolation that exposed administrator setup prompts on sign-in.
Corrected malformed legal-consent markup on signup forms.

Student notes now load into a visible notebook list, can be opened from that
list, and are saved/updated through owner-scoped API routes; browser-local
fallback notes also appear in the notebook. The quiz generator is now limited
to the teacher role and no longer appears in student navigation. Dark-theme
student dashboard, lesson, profile, billing, and notebook cards now use dark
surfaces with light readable text, while existing light-theme surfaces retain
dark text.

Validation for this follow-up: JavaScript syntax checks and whitespace/diff
checks passed. Full tests were not run.


## Cross-role publishing and grading follow-up — 2026-11-10

Assignments are visible to enrolled students and to teachers assigned to the
class, including assignments created by an administrator. Those submissions
now appear in the class teacher's grading and assignment views, and assigned
students receive a notification when the work is published. A released grade
appears on the student's assignment card and creates a grade notification;
draft marks remain private. The grading view includes all submitted work,
newest first, with counts and filters for ungraded work, drafts, and released
grades. Teacher class announcements are included in the student Announcements
screen. Administrator announcements continue to follow their audience and
institution scope and now create recipient notifications. Class sessions,
tests, and practice activities created by teachers notify enrolled students;
student timetable, teacher class roster/timetable, and live class lists can
refresh those additions. Published courses continue to use the existing
student catalog visibility rules. Shared assignments, announcements,
notifications, catalog/marketplace listings, live classes, teacher class lists,
grading, and quiz/question-bank views refresh when the tab returns and poll
every 25 seconds while visible; focused fields and edited grade forms are left
alone. This is periodic refresh, not push delivery.

Question-bank form spacing was increased and quiz question cards now use
theme-aware contrast. Validation: `node --check app.js`, `node --check
backend/server.js`, and `git diff --check` passed; full tests were not run.

## Student profile results and readability — 2026-11-10

The profile performance report now uses spaced metric cards and readable,
separate course completion and result rows. It includes up to 20 of the
student's submitted assignments and class test attempts, showing marks and
feedback only after teacher release. The analytics API returns those
student-owned assignment results, and the open profile report refreshes with
the shared 25-second polling cycle. Parent link codes use theme-aware contrast
instead of the low-contrast fixed pale text style.

API bearer-token display and refresh/revoke controls were removed from the
student Profile & Progress page to keep access tokens private from the UI.

Authenticator-code input is shown only on teacher and administrator sign-in;
parent and student sign-in omit it. The auth language selector now preserves
the active option through auth rerenders, and language changes apply locally
before the optional server preference save completes.

## Repository audit and production hardening — 2026-11-10

The full Node backend suite passes **200/200** when run with loopback access;
the sandbox otherwise blocks test servers from binding to `127.0.0.1`. JavaScript
syntax checks, `git diff --check`, CI workflow YAML parsing, and offline
production-dependency audit also pass (0 reported vulnerabilities). Python
gesture checks passed **14/14** and JS/Python gesture parity passed **84/84**.

Production startup now fails closed unless `JWT_SECRET` is at least 32
characters and `APP_BASE_URL` is a valid public HTTPS origin. Origin checks use
that canonical public origin, which supports TLS termination at the documented
reverse proxy. The first-administrator browser setup also requires a private
32+ character setup code in production; development retains the documented
`123456` fallback. Teacher self-signup is disabled in production while its OTP
is still demo-only. See `.env.example` and `docs/DEPLOYMENT.md` for required
settings. JWT parsing now rejects malformed/non-canonical base64url tokens and
headers that do not declare HS256/JWT, avoiding signature ambiguity.

Removed the locally installed `opencv-drawing/.venv-mediapipe` environment and
`.DS_Store` files from Git's index; their local files remain untouched and are
ignored. CI zip packaging excludes local virtual environments, `.DS_Store`,
and `.env` files. This removes **6,307 tracked generated/local files** from the
pending index without deleting the developer's local OpenCV environment.

Known deployment limits remain: teacher signup does not have a real email OTP
provider; JSON persistence and in-memory sessions are single-process prototype
storage; external provider integrations require deployment credentials. No
live third-party provider credentials were exercised by this audit.


## Deploy-ready archive merge and browser feedback — 2026-11-11

Merged the user-provided `EduVerse-3D-deploy-ready (1).zip` application,
documentation, and Nova changes into the existing checkout while keeping local
runtime data and environment secrets out of the merge. Preserved the existing
community idempotency regression coverage, hardened backup permissions, the
correct deployment checklist, and the production bind-host behavior. Added the
archive's Nova2 contract notes and backend module coverage.

The app server binds to loopback during development and to `0.0.0.0` in
production by default; `HOST` can override the bind address. Successful sign-ins
record up to 365 calendar dates per user in `store.loginHistory`; calendar
responses return only the signed-in user's dates. Account deletion removes this
history. Calendar dates now distinguish recorded sign-in days from days without
a recorded sign-in, and event times request a 24-hour clock.

Student notes can be deleted from the notebook; the API enforces note ownership.
The coding syllabus modules are interactive and their completion marks persist
in browser local storage. The classroom includes a local PDF viewer with page
navigation and an optional pen/highlight overlay; the chosen PDF is not uploaded
by this control. PDF annotations are retained per page while the app remains loaded, but are
not persisted after a browser reload or PDF replacement. “Other” feedback includes
a required subject field, stored separately from the feedback message. SCORM
navigation and its route are now staff-only.

Teacher-created vocabulary sets are already visible in Language Lab and student
attempts are graded by the existing vocabulary quiz endpoints. The current
language switch localizes navigation and authentication strings, but does not
translate all deep-page content. Full-site translations remain pending; do not
claim the language comment is completely resolved. Native PDF rendering/page
count behavior varies by browser. The UI permits page numbers to be entered
without knowing the document's actual final page.

For this merge, `node --check app.js`, `node --check backend/server.js`, and
`git diff --check -- eduverse-3d` passed. The full test suite was not run in this
turn. Continue updating this section after implementing or verifying remaining
items.


## Classroom PDF and feedback polish — 2026-11-11

Moved the PDF reader below the whiteboard/camera controls so it follows normal
document flow and no longer overlaps the whiteboard stage. Its viewer stays
hidden until a PDF is chosen. Added a CSP `frame-src blob:` allowance for the
local object URL used to render the user-selected PDF; PDF bytes remain local.
The feedback subject field now has a one-line label and a full-width, themed
input with consistent focus spacing.

## Classroom PDF upload reliability — 2026-11-11

- Replaced the nested file-input label with a visible `Choose PDF` button that opens the PDF picker directly, improving click and keyboard interaction.
- The selected local filename and page are shown in the status text; resize operations no longer replace that status.
- Added an `Open PDF separately` browser link as a fallback for browsers that do not render PDF blobs inline. PDF bytes remain local to the browser and page annotations remain in-memory for the current session.
- Browser verification confirmed that choosing a PDF enables paging and annotation and updates the filename. The embedded browser did not visually render the PDF page, so inline rendering still depends on the browser's built-in PDF support; a bundled PDF.js renderer is not present in this project.
