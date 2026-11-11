# EduVerse 3D — Learning Lab

EduVerse is a browser-based learning platform with three genuinely separate
workspaces — Student, Teacher, and Administrator — a protected administrator
area, interactive course activities, and a local webcam Vision & Simulation
Lab. It uses plain HTML, CSS, and JavaScript with a dependency-free Node API.
No frontend build is required.

## Run the app

```bash
cd eduverse-3d
npm ci
npm start
```

Then open **http://127.0.0.1:4173**. The local server also serves the app
files; opening `index.html` directly redirects to this address so session
cookies and webcam permissions work consistently. The backend starts the local
OpenCV/MediaPipe service from `opencv-drawing/.venv-mediapipe` when that
environment exists and port 4174 is free.

Requires Node.js 18 or newer. `npm ci` installs the locked `ws` dependency
used by the live classroom; the rest of the server uses Node built-ins.

## The three portals

After sign-in, the server-verified role decides the portal. Frontend
navigation complements backend enforcement — it never replaces it.

- **Student Portal** — learning, courses, assignments, 3D labs, Vision &
  Simulation Lab, Learning Twin, community, and personal progress. Students
  see only their own records, their assigned classes, and published courses.
  Students can enroll in a published course from the Course catalog and mark
  lessons complete; teachers and administrators see that completion.
- **Teacher Portal** (teal workspace) — Dashboard, My classes, Students,
  Attendance, Courses, Assignments, Grading, Learning analytics,
  Announcements, Vision lab assignments, Classroom & whiteboard, Vision &
  Simulation Lab, Teaching library, Profile, Account security, Notifications,
  Send feedback. Teachers only see classes assigned to them, only grade
  submissions from those classes, and draft grades stay hidden from students
  until released.
- **Administrator Portal** (dark control-center workspace) — Overview,
  Users & approvals, Teachers, Students, Classes & enrollment, Courses,
  Institutions & terms, Enrollments, Roles & permissions, Reports, Audit log,
  Security & MFA, Platform settings, Integrations, My account, Notifications.
  Administrators never gain access merely by visiting an `/admin` URL;
  every `/api/admin/*` endpoint checks the server-side role.

## Authentication and role access

- Student accounts can be created from the welcome screen with a 12-character
  minimum password and terms acceptance. Passwords are stored as salted
  scrypt hashes, never in browser storage.
- In local development, teacher sign-ups use a demo OTP and create a pending
  request (unless the administrator turns that approval switch off in Platform
  settings). The demo OTP is not real verification. Teacher self-signup is
  disabled when `NODE_ENV=production`; administrators create teacher accounts.
- Administrator accounts cannot be created from the public sign-up form.
  The easiest first-admin method is the in-app **Set up administrator
  account** button on the welcome screen (see "Creating administrator
  accounts" below). The terminal method below also works when starting
  a fresh local store:

```bash
cd eduverse-3d
export EDUVERSE_BOOTSTRAP_ADMIN_EMAIL='admin@your-school.example'
read -s EDUVERSE_BOOTSTRAP_ADMIN_PASSWORD
export EDUVERSE_BOOTSTRAP_ADMIN_PASSWORD
npm start
unset EDUVERSE_BOOTSTRAP_ADMIN_PASSWORD
```

Enter a unique password of at least 12 characters when prompted. The bootstrap
credentials are read only when no administrator exists, then the initial
account is stored as a salted scrypt hash. Do not publish the local API or
commit real credentials. If the store already has an administrator, the
bootstrap step will not create another one.

- Sessions use a random server-side ID in an HttpOnly, SameSite=Lax cookie;
  the browser never stores a password or bearer token. Sessions expire after
  12 hours or a server restart. Login is throttled to 8 attempts per minute
  per email/IP.
- Public registration can never create an administrator, and profile updates
  can never change a role. Role changes are recorded in the audit log.

## Password recovery (local build)

Email delivery is **not** configured, so the app does not pretend to send a
recovery email. The working flow is:

1. A user opens **Forgot password?** on the sign-in screen.
2. An administrator opens **Users & approvals**, clicks **Recovery code**
   for that account, and shares the one-time code securely, out of band.
   It expires in 15 minutes and is shown once.
3. The user enters the code and a new 12+ character password on the
   Forgot password screen.

Signed-in users can also change their own password from Teacher **Account
security** or Administrator **Security & MFA**.

## Creating administrator accounts

Administrator accounts can **never** be created through public
registration — that block is intentional, and the sign-up screen and the
API both enforce it (403). There are three working ways instead:

1. **First administrator (fresh install, no admin yet):** open the
   app, click **Set up administrator account** on the welcome screen
   (or **Create the first administrator account** on the administrator
   sign-in screen), fill in a name, username, 12+ character password, and the
   local demo OTP/setup code, then submit. This one-time setup only works while no administrator
   exists at all — once the first administrator is created, the same
   form returns 403 and the setup path closes. No terminal steps are
   needed for this local development method. In production, set
   `EDUVERSE_ADMIN_SETUP_CODE` to a random secret at least 32 characters long
   and set `APP_BASE_URL` to the public HTTPS origin.
2. **First administrator, terminal method (alternative):** stop the
   server, then start it with `EDUVERSE_BOOTSTRAP_ADMIN_EMAIL` set to
   your email and `EDUVERSE_BOOTSTRAP_ADMIN_PASSWORD` set to a 12+
   character password, then sign in with those credentials.
   If the server already has an administrator, bootstrap does nothing
   for a new email — use method 3.
3. **Additional administrators:** sign in as an existing
   administrator, open **Users & approvals**, use the **Create an
   account** form, choose the **Administrator** role, and confirm the
   dialog. The new administrator can sign in immediately, and the
   creation is recorded in the audit log. A student or teacher can
   never use this form (403), and the form is only visible to
   administrators.

## Three separate interfaces

Signing in as a different role opens a different workspace, not the
same screen with a different menu heading:

- **Student — LEARNING SPACE.** Workspace: "<name>'s learning space".
  Sidebar groups LEARN and YOUR SPACE. Home is the learning dashboard
  (own courses, assignments, progress, labs, notes, learning twin).
  Account screen: Progress & profile.
- **Teacher — TEACHING WORKSPACE (teal).** Workspace: "<name>'s
  teaching workspace". Sidebar groups TEACHING and CLASSROOM &
  SUPPORT. Home is the teaching dashboard (assigned classes, scheduled
  lessons, assessments, grading queue, attendance, analytics).
  Account screen: Account security. The student Vision & simulation
  lab and student Profile screens are not in the teacher sidebar —
  teachers use Vision lab assignments and Account security instead.
- **Administrator — ADMINISTRATION CONSOLE (dark navy).** Workspace:
  "<name>'s administration console". Sidebar groups CONTROL CENTER
  and GOVERNANCE & REPORTS. Home is the admin dashboard (user counts,
  pending approvals, classes, recent audit activity). Account screen:
  Security & MFA (password, MFA, account deletion).

The brand line, workspace card, help card, top-bar avatar, and page
breadcrumb all change with the role. Classroom & whiteboard and the
library are deliberately shared teaching/learning tools, and
Notifications and Send feedback are personal to the signed-in account;
every other screen is role-specific. Opening another role's screen
directly (for example a teacher opening the student catalog, or a
student opening the teacher dashboard) redirects to that account's own
home instead of showing the other role's screen, and the backend still
enforces the same boundaries with 403 responses.

## Security checks applied (before launch)

The five checks from the AI app builder security guide were run against
this codebase, not just pasted in. What each one found, and what was
changed as a result:

1. **Secret leak prevention.** No hardcoded API keys, passwords, or
   tokens were found in code, and there are no Supabase, Stripe, or
   third-party keys in this app at all. The first administrator is
   created through the one-time in-app setup, or from
   `EDUVERSE_BOOTSTRAP_ADMIN_EMAIL` /
   `EDUVERSE_BOOTSTRAP_ADMIN_PASSWORD` environment variables (see
   `.env.example`), and `.env` is in `.gitignore`. If a secret was ever
   hardcoded in an earlier version of this project, rotate it
   immediately — old values survive in git history. Server logs never
   print passwords, tokens, or hashes.
2. **Personal data flow.** Emails, names, passwords, notes, submissions,
   and vision attempts are stored only in the local JSON store, sent to
   no third-party service, and never logged. Passwords are stored as
   scrypt hashes only; API responses use a filtered public user/profile
   shape that never returns a password hash. Cookies are HttpOnly with
   SameSite=Lax (and Secure when `NODE_ENV=production`); no password or
   token is kept in localStorage (localStorage holds only offline notes,
   board drafts, reading-list IDs, and theme settings). Users can now
   permanently delete their own account from Profile (student),
   Account security (teacher), or Security & MFA (administrator):
   it removes their notes, progress, vision history, enrollments, and
   submissions, removes them from classes, and signs out all their
   sessions. The last administrator account cannot be deleted this way.
3. **Pre-deploy production audit.** Every API and static response now
   carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
   a Content-Security-Policy, and a no-referrer policy (plus HSTS in
   production). The old wildcard CORS header was removed — this is a
   same-origin app and does not need it. Error responses are generic
   (no stack traces or file paths). Rate limits now cover login
   (8/min per email and 30/min per IP), signup (10/hour per IP),
   password recovery requests (3/hour per IP and per email), reset
   attempts (10/hour per IP), password changes (10/hour per user), and
   MFA attempts (10/10 min per user). There are no debug, test, or
   backdoor endpoints, and no default administrator account.
4. **Deep audit (auth and logic).** There are no payments and no JWTs
   in this app, so those sections do not apply — the server uses
   random, server-side session IDs, and logout deletes the session.
   Every protected endpoint checks the session server-side; roles are
   never trusted from the client. Password-reset tokens are random,
   hashed before storage, tied to one user, single-use, and expire in
   15 minutes. Changing or resetting a password now signs out all of
   that user's sessions. A dead, unreachable profile-update handler
   that would have allowed a role field was removed. Resubmitting an
   assignment after its grade has been released is now rejected, so a
   graded submission cannot be overwritten.
5. **Attacker's perspective.** This found the most serious issue: the
   static file server used to serve *any* file under the project root,
   so anyone on the machine could fetch `/backend/data/store.json`
   (password hashes and personal data once accounts exist) and
   `/backend/server.js` over plain HTTP. That is now fixed — only
   `/`, `/index.html`, `/app.js`, `/styles.css`, and
   `/vision-hands.js` are served; everything else returns 404.
   Ownership is enforced on every ID-based endpoint and was tested
   with a second teacher and a second student: neither can read,
   edit, grade, or submit for another user's courses, classes, or
   assignments. Notification read state is now per user, not shared.
   Login errors are generic for wrong credentials; pending/suspended
   status is only revealed after the correct password, so it cannot be
   used to enumerate accounts.

This audit is not a substitute for a professional security review if
the app ever handles real money or sensitive data at scale. For a
production deployment, serve over HTTPS with `NODE_ENV=production`,
move the JSON store to a real database with TLS, move MFA secrets to
proper secret storage, and never commit a `store.json` that contains
real user accounts.

## Optional administrator MFA

Administrator **Security & MFA** can generate an authenticator-app secret.
Add the secret to an authenticator app, verify a 6-digit code to enable MFA,
and sign-in then requires that code. MFA is a standard TOTP code (30-second
steps, ±1 step tolerance). Keep the secret private; disabling MFA also
requires the current code.

## What each portal can actually do

### Teacher

- **Courses:** create drafts, add modules, lessons, and resources
  (video/document/link/practice), publish or unpublish, archive, and track
  enrollment and lesson completion per course. Drafts stay hidden from
  students. Publishing can be switched off for all teachers from
  Roles & permissions, and the backend enforces it.
- **Classes & attendance:** view only assigned classes and rosters, record
  present/absent/late attendance, schedule sessions, create practice
  questions and tests.
- **Assignments & grading:** create assignments for assigned classes, view
  submission status, grade with marks and feedback, save draft grades, or
  release them to the student.
- **Students & analytics:** per-student assignment completion, attendance
  totals, submission and grading rates — all calculated from stored records,
  never invented.
- **Vision lab assignments:** assign an existing lab experiment
  (webcam drawing, air keyboard, gesture training, physics, chemistry, …)
  to a class with objectives, difficulty, and a due date, and review
  recorded student attempts for assigned experiments only.
- **Announcements:** post a class notice; enrolled students see it in
  Notifications.

### Administrator

- **Users:** search and filter all accounts, approve/reject teacher
  requests, suspend/activate/restore accounts, create student and teacher
  accounts (never administrator accounts through the form), and issue
  recovery codes. Sensitive actions ask for confirmation. Passwords, hashes,
  and recovery tokens are never displayed except for a freshly issued
  recovery code shown once to the administrator.
- **Teachers / Students:** dedicated lists with class memberships and
  course enrollments.
- **Classes & enrollments:** create classes with approved teachers and
  active students, edit class membership, enroll a student in a class or a
  course. Duplicates are rejected by the server.
- **Courses:** publish, draft, archive, and reassign any course to an
  approved teacher.
- **Institutions, departments, terms:** create the organisational records
  classes and reports refer to.
- **Roles & permissions:** toggle granular teacher and student permissions
  (course creation, publishing, assignments, grading, vision assignments,
  analytics, enrollment, submission). The backend checks these on every
  matching endpoint; hiding a button is not the security model.
- **Reports:** user, enrollment, course-completion, assignment, attendance,
  and vision-event figures from stored data, with CSV exports for users,
  enrollments, and completion.
- **Audit log:** actor, action, target, and timestamp for account, class,
  course, permission, settings, and recovery actions (most recent 300).
- **Platform settings:** platform name, institution, timezone, locale,
  default theme, maintenance message, max upload size, and the two
  registration switches. The switches change real signup behaviour.
  Sensitive configuration stays on the server; the public settings endpoint
  returns only the non-secret subset.
- **Integrations / Security:** live API and OpenCV service status, active
  session count, session policy, login throttle, and MFA controls.

## Student features that still work

- **3D Campus:** draggable, orbiting WebGL campus with portals into courses,
  the lab, and classroom; the 2D map toggle is available for simpler devices.
- **Virtual classroom:** editable shared-board preview, pen/erase controls,
  sticky notes, quick poll, raise hand, and participant/chat panel. Saving
  the board adds it to Notes.
- **Notes Studio:** edit and save notes through `POST /api/notes`.
- **Coding paths:** module outlines for web development, DSA, and backend
  engineering, with capstone project ideas.
- **Vision & Simulation Lab:** 20 activities, grouped into computer vision,
  virtual science, and applied learning — webcam drawing, air keyboard,
  gesture presentation and training, chemistry, projectile physics, cell
  biology, circuits, gear ratios, object color hunt, board cleanup,
  accessibility dwell selection, body framing, 3D molecule interaction, a
  movement game, coding controls, avatar motion, face/environment
  interaction, and Teach EduVerse. Simulations include objectives, live
  controls, quick checks, and saved progress where applicable.
- **Learning Twin:** progress, streak, and concept mastery from recorded
  attempts, not invented numbers. For new accounts, empty states explain
  how to enroll in a course.

## New: video lectures, quizzes, certificates, payments, live classes

- **Video lecture player:** teachers attach an MP4 or YouTube URL to any
  lesson. Students get a custom player (play/pause, seek, 0.5–2× speed,
  fullscreen) that resumes where they left off and marks the lesson complete
  at 90% watched.
- **Video learning upgrades:** quality selector (teacher adds MP4 variants as
  `1080p|https://…` lines), WebVTT captions/subtitles with a CC toggle,
  picture-in-picture, full transcript with clickable `[mm:ss]` timestamps that
  seek the video, and timestamp-based notes ("＋ Note at current time" saves a
  note pinned to that second; time chips seek back to it).
- **Course structure:** every course shows its overview, learning objectives,
  and prerequisites. Lessons carry a type — video lesson, reading material,
  interactive activity, PDF resource, coding practice, quiz, assignment — shown
  as badges in the course outline. Teachers can flag one quiz per course as the
  **final assessment** (shown distinctly; required for the certificate).
- **Quizzes & examinations:** teachers build quizzes (multiple choice,
  true/false, short answer) with time limits, attempt limits, question/option
  shuffling, and a passing score. Objective questions auto-grade; written
  answers go to the teacher for manual grading with per-question feedback.
  Students never see the answer key.
- **Certificates:** issued automatically when a student finishes every lesson
  and passes every quiz in a course. Printable, with a public verification
  code (`GET /api/certificates/verify/:code` needs no login).
- **Payments & subscriptions (test mode):** courses can have a price, and
  there are Free / Monthly (₹499) / Yearly (₹4,999) plans, managed under
  Admin → Plans & pricing. Checkout and billing pages are fully working, but
  payments are simulated — no real money moves. `POST /api/payments/webhook`
  is a documented stub for wiring a real gateway (Razorpay/Stripe) later.
  Paid courses block enrollment with a clear checkout prompt until paid.
- **Live classes:** teachers schedule sessions with a meeting link; students
  see upcoming classes on their dashboard and join in one click. Joining
  records attendance.
- **Live classroom (EduVerse classroom):** when a teacher enables it on a live
  session, participants join a real-time classroom instead of an external
  meeting link. Video/audio/screen-share run peer-to-peer over WebRTC (no
  media server); the EduVerse server only relays connection setup and
  collaboration messages over a WebSocket (`/ws`, session-cookie auth).
  Includes live chat, hand raising, polls with live results, Q&A, a shared
  whiteboard, teacher slide sync, breakout rooms, mute-all, and join/leave
  attendance timestamps. Recording is done in the teacher's browser via
  MediaRecorder and downloads as a .webm file — it never uploads to the
  server. Best with up to ~6 participants; larger classes need an SFU media
  server (e.g. LiveKit) in front of the same signaling protocol.
- **Discussions:** every course has a forum — threads, replies, teacher pinning.
- **Gamification:** XP for lessons, videos, quizzes, assignments, discussions
  and live attendance; levels, daily streaks, six badges, and a leaderboard.
  The student dashboard shows XP, streak, continue-learning, and certificates.


## New: advanced exams, Nova AI tools, live classroom

### Advanced examination & assessment
- **8 question types:** multiple choice, multiple select (partial credit),
  true/false, fill-in-the-blanks (`___`), match-the-following, essay (manual
  grading, optional rubric), coding tests (JavaScript runs in a 2-second
  server sandbox via `solve(input)`; other languages go to manual grading),
  short answer. Every question supports an explanation, difficulty
  (easy/medium/hard), and topic tag.
- **Question bank:** teachers save, filter (topic/difficulty/type), edit, and
  reuse questions; quizzes can pull a random selection from the bank, and Nova
  can generate questions straight into the bank.
- **Exam controls:** negative marking (0–100%), per-question time tracking,
  server-enforced time limits with auto-submit (30s grace), attempt numbers,
  solutions policy (immediate / after passing / never), adaptive exams that
  step difficulty up/down as the student answers.
- **Proctoring (consent-based, privacy-first):** optional per exam. Students
  see an explicit consent screen; the webcam takes small stills (≤320px, max
  20) shown back to the student in a filmstrip — nothing secret. Tab-switch
  count is logged. **No facial recognition or identity matching, ever.**
- **Exam analytics:** per-quiz attempts, average score, pass rate, score
  distribution, and per-question correct rate / average points / average time.
- **Rubric grading:** assignments (and essay questions) accept a rubric of
  criteria with max points; grading shows per-criterion inputs with a live
  total.

### Nova AI tools
The Nova panel now has **Chat** and **AI Tools** tabs (the old rule-based
chat still works unchanged). 14 tools: personal tutor, doubt solver, notes
generator, quiz generator, flashcards (flippable cards), summarizer, study
planner (built from real enrollments), assignment assistant (hints only —
never full answers), coding mentor, writing assistant, research assistant,
learning recommendations (from real weak topics in quiz attempts), teacher
assistant (teachers/admins only), performance analyzer.
- **AI mode:** set `OPENAI_API_KEY` in the environment before `npm start`
  and Nova answers via OpenAI (default model `gpt-4o-mini`, override with
  `NOVA_MODEL`). The key is read from the environment only — never stored in
  files or the database.

### Nova chat — ChatGPT-style (2026-11-11)
The chat itself used to be a keyword matcher with no memory. It now works
like a real AI chat when a key is set, and stays honest when it isn't:
- **Real AI replies** via OpenAI chat completions (`POST /api/chat`, LLM path
  in `backend/nova.js`), with a tutor system prompt. No key, no credits, or
  any OpenAI failure → the previous keyword answers, labelled `Local`.
- **Conversation memory**: per-user history (`store.novaChats`, last 20
  messages) is sent with every turn, so follow-ups work. Survives restarts.
  `GET /api/chat/history`, `POST /api/chat/clear`,
  `POST /api/chat/regenerate` (re-runs the last user message).
- **Streaming**: `stream:true` returns SSE deltas + a final `done` event;
  the panel renders the reply live, with a typing state until the first token.
- **Chat UI**: safe markdown (bold, italic, code, code blocks with copy,
  lists, links — all HTML escaped first), per-message copy, regenerate, New
  chat, `AI`/`Local` badge, history restored on open. Tests:
  `backend/nova2.test.js` (13). Verified live against a stub OpenAI server
  (15/15: streaming, history sent to the LLM, regenerate, clear, local
  fallback); a real funded key still needs a live check.
- **Built-in mode:** with no key (or if the API fails / has no credits),
  every tool falls back to local logic automatically. Each answer is labeled
  **AI** or **Built-in** so you always know which served you.

### Live classroom (built-in video)
Teachers can tick **"Use EduVerse classroom"** when scheduling a live class
instead of pasting an external meeting link. Joining opens an in-app
classroom:
- **Video/audio** via WebRTC peer-to-peer mesh (mic/camera toggles, screen
  share), **live chat**, **hand raising**, **Q&A** queue, **polls** with live
  result bars, **people** list with teacher mute-all.
- **Collaborative whiteboard** (strokes sync live), teacher annotation mode,
  **text slides** the teacher advances for everyone, **breakout rooms**
  (auto-assign, manual recall, bring everyone back).
- **Recording** via the teacher's browser (downloads a `.webm`, stays on
  their device), **attendance** with join timestamps.
- Honest limits, shown in the UI: media goes directly between participants —
  the server only relays connection setup; best with ~6 people (larger
  classes need a media server / SFU, documented as an upgrade path).


## Institution-ready administration

- **Multi-institution & campuses:** create institutions, campuses, and departments;
  every user/course is scoped to an institution. Existing data auto-migrates into a
  "Default Institution" on first boot.
- **Academic calendar:** academic years and semesters per institution, with one-click
  "set current" (exclusivity enforced).
- **Roles & permissions:** `super_admin`, `institution_admin`, `teacher`, `student`
  with an editable permission matrix (`org.manage`, `fees.manage`, `marketplace.manage`,
  `reports.view`, `security.view`, `backup.manage`, `integrations.manage`, …).
  Existing `admin` accounts keep working as super_admins.
- **Custom branding:** per-institution logo, primary color, and favicon — applied
  live via the public `/api/institution/branding` endpoint.
- **Fees & subscriptions:** fee structures per institution/year/grade, bulk assign to
  students, payment recording (partial/paid/overdue), student "My fees" view;
  subscription plans with per-institution assignment.
- **Course marketplace:** list published courses with a price, public browse, student
  enrollment (creates a fee record when priced).
- **Reports & import:** teacher workload report, enrollment reports with CSV export,
  bulk student/teacher CSV import with per-row validation.
- **Usage analytics:** logins, active users, enrollments, quiz attempts, live sessions,
  Nova calls over 7/30/90 days.
- **Security monitoring:** auto-logged events (failed logins, brute-force escalation,
  rate-limit hits, forbidden admin access), login activity table, severity dashboard.
- **Backup & restore:** one-click JSON download, guarded restore (super_admin + typed
  CONFIRM), backup info. `BACKUP_API_KEY` env allows automated cron backups.
- **Integrations manager:** store webhook/email/payment/storage credentials (secrets
  never returned by the API), per-integration test button.

## Production technical upgrades (env-optional, local fallbacks)

Every external service works WITHOUT keys via a local fallback and activates via env vars:

| Service | Env vars | Fallback |
|---|---|---|
| Email | `EMAIL_PROVIDER=resend\|sendgrid`, `RESEND_API_KEY` / `SENDGRID_API_KEY` | Dev outbox (`store.emailOutbox`) |
| Payments | `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` or `STRIPE_SECRET_KEY` | Test-mode orders |
| Storage | `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Local `backend/uploads/` |
| Cache | `REDIS_URL` | In-memory Map |
| Monitoring | `SENTRY_DSN` | stderr + admin-viewable error log |
| AI | `OPENAI_API_KEY` (`NOVA_MODEL` to override) | Built-in local logic per tool |

- **PostgreSQL:** `migrations/001_initial.sql` is the full relational schema (migration
  target); `docs/POSTGRES.md` documents the path. The JSON store remains the runtime
  default — honest limit: `DATABASE_URL` has no effect yet; a data-layer rewrite is still needed.
- **Full-text search:** in-memory inverted index over courses/lessons/quizzes,
  `GET /api/search?q=`, header search box with keyboard navigation.
- **Notifications:** fee assigned, quiz graded, live class scheduled, marketplace purchase —
  in-app with unread badge, email hook when a provider is configured.
- **Deployment:** `docs/DEPLOYMENT.md` (HTTPS via Caddy/nginx, systemd, CI/CD workflow,
  cron backups, env reference, production checklist). `scripts/load-test.mjs`
  (`npm run load-test`; built-in Node HTTP probe, no benchmark dependency).
- **Honest limits:** S3/Resend/Stripe/Redis/Sentry code paths are not live-tested (no keys
  here) — only fallback selection is asserted. WebRTC mesh suits ~6 peers (SFU upgrade path
  documented). Code execution is JavaScript-only.

## Deploy readiness (2026-11-11)

Ready to deploy on Render (`render.yaml` blueprint in the project root). Slice 1:

- **Sessions survive restarts.** Sessions are mirrored into `store.sessions` and
  reloaded on boot (capped at 5000, expired rows pruned). A restart no longer logs
  everyone out. Tests: `backend/deploy1.test.js`.
- **Code-runner kill switch.** `CODE_EXEC_ENABLED=false` disables all server-side
  code execution (`POST /api/code/run` → 503 after auth; exam code questions grade
  0 with a note instead of executing; Judge0 path too). Default is enabled.
- **Backups.** `scripts/backup.sh` copies the live store to `backups/` with a
  timestamp, verifies the copy parses as JSON, keeps the newest 30. Cron example
  in the script header. `backups/` is gitignored.
- **Production pre-flight.** `npm run check:prod` (`scripts/check-production.mjs`)
  checks Node ≥ 18, production secrets, data-dir writability, and a free port —
  no server start, no writes.
- **`.env.example`** lists all 37 variables with placeholders only, no real values.
- **Accessibility + demo data.** 84 unlabeled inputs got `aria-label`s, all
  `href="#"` links now point somewhere real (or became buttons), modals move
  keyboard focus in and back out. The profile skill map and the overview
  dashboard (date, streak, learning-twin concepts, welcome name) now render
  from real `/progress` / `/gamification` data with honest empty states; the
  overview challenge/resume buttons work after navigation (delegated listeners).
- **Render notes.** HTTPS and `PORT` are automatic. The blueprint mounts a 1 GB
  persistent disk on `backend/data` — without it the JSON store is wiped on every
  deploy (Render's filesystem is ephemeral). Uploads still vanish on redeploy
  unless S3 is configured. Set your real URL in `APP_BASE_URL`.

Still open for a full public launch: a real database (Postgres schema exists as a
migration target only), real email delivery, finalised legal pages (operator,
jurisdiction, contact), and service keys (OpenAI, Google, Razorpay, Judge0) —
the app runs without them in local/demo modes.

## Audit fixes (2026-11-10)

A full audit of this exact build found two real bugs, both fixed here:

- **File uploads over ~48 KB failed** even though the UI promises 5 MB. `/api/upload`
  and `/api/quizgen/upload` used the default 64 KB JSON body cap. The body reader now
  takes a per-route limit: 8 MB for file uploads (a 5 MB file is ~6.8 MB base64),
  2 MB for bulk CSV imports, 50 MB for super-admin backup restores. The 5 MB
  decoded-file limit and the mime allowlist are unchanged, and ordinary routes still
  reject bodies over 64 KB. Tests: `backend/audit-fixes.test.js`.
- **Admin library loans list was missing.** The admin library page calls
  `GET /api/admin/library/loans`, which did not exist. Added, gated by the same
  `library.manage` permission as the catalog, org-scoped, returning each loan with
  the book title and student name the panel renders.

The audit also first flagged the teacher timetable form and the community Follow
button as broken — both were wrong calls: the timetable posts to the generic
`POST /api/teacher/:kind` handler and Follow has its own route. Both are covered by
regression tests in `backend/audit-fixes.test.js` so they stay working.

## Advanced features (2026-11-10): quiz generator, session records, study groups

Most of the "advanced features" list already existed (Nova AI assistant/planner/
recommendations/performance, Vision Lab gestures, certificates, live classroom). The three
genuine gaps were built; the proposed stack (React, MongoDB, Express, Socket.IO, Python/
FastAPI, Cloudinary) is mapped in `TECH_STACK.md` and `BACKEND_STRUCTURE.md` — deliberate
differences, no rebuild.

- **AI Quiz Generator** (student + teacher, `quiz-generator` screen): upload notes (TXT/MD/
  PDF text layer, 5MB) or paste text → generate MCQs via Nova (`quizgen`, OpenAI when a key
  is set, local otherwise) → edit questions inline → save as a real quiz (teacher, optional
  course) or a personal practice quiz (student, private). `POST /api/quizgen/upload|generate|
  save|save-practice`, `GET /api/quizgen/history`.
- **Classroom session records** (teacher + student, `past-sessions` screen): ending a live
  class saves a server record — participants, join/leave times, hand-raise counts, chat/Q&A/
  poll counts, poll results. `POST /api/live-sessions/:id/end-classroom` (idempotent),
  `GET /api/teacher/session-records`, `GET /api/session-records[/:id]`.
- **Study groups** (student + teacher, `study-groups` screen): persistent groups with shared
  notes (last-writer-wins), group chat, 8-char invite codes. `POST /api/study-groups`,
  `/join-by-code`, notes + messages CRUD, members-only (non-members get 404).
- **Honest limits:** PDF extraction reads the text layer only (scanned/image PDFs fail with
  a clear message); local quiz generation is sentence/keyword-based, not LLM-quality;
  session activity counts are client-reported from the teacher's client (clamped) — the
  server guarantees who joined; group chat refreshes on open (no live push); shared notes
  have no conflict merge.

## Webcam Drawing Studio and Hand Tracking (OpenCV + MediaPipe)

The backend starts the Python service automatically when you run `npm start`,
if its local Python 3.12 environment is installed. To set it up on a new
computer, install the MediaPipe hand landmarks in the isolated environment
first:

```bash
cd "eduverse-3d/opencv-drawing"
python3.12 -m venv .venv-mediapipe
.venv-mediapipe/bin/python -m pip install -r requirements-mediapipe.txt
```

To run the camera service separately for development, start it from
`opencv-drawing` with `.venv-mediapipe/bin/python server.py`. The service
listens at `http://127.0.0.1:4174`.

Open EduVerse, choose **Webcam drawing**, select **Hand drawing**, press
**Start camera**, and allow camera access. The MediaPipe tracker returns 21
points per detected hand. Raise only your index finger to draw; show an open
palm to lift the pen. Two fingers cycle the pen color, a fist toggles the
eraser, and thumbs up/down adjust brush size.

The studio smooths the fingertip with an adaptive One Euro filter, debounces
the pen gesture over several frames so landmark flicker can't shatter a
stroke into dots, and renders strokes as quadratic curves instead of straight
segments — hold a steady pose for about a quarter second when you start or
stop writing. The service falls back to OpenCV contour tracking if MediaPipe
cannot initialize. Camera access is requested only after Start. Frames are
processed locally and never stored.

On this Mac, the Python 3.13 MediaPipe Tasks build can crash in its native
graphics layer. The supplied setup uses MediaPipe 0.10.21's stable hand graph
in Python 3.12. If `/hands/status` reports that the tracker is unavailable,
the drawing studio retains its contour fallback and the Playground explains
the setup state.

The two sketch filter recipes were adapted from the user-provided
`livecam-sketching` example by Yashwant (2019) and
`Live-Video-Sketching-through-webcam-using-OpenCv-Python` by Kaushik Jadhav.
The first archive's MIT notice is preserved in
[`LICENSES/livecam-sketching-MIT.txt`](LICENSES/livecam-sketching-MIT.txt).
The second archive did not include a license file; only its described Canny
settings were used as a reference.

## API routes (highlights)

- `POST /api/auth/signup` (student registration or pending teacher request)
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `POST /api/auth/change-password`, `POST /api/auth/forgot-password`,
  `POST /api/auth/reset-password`, `DELETE /api/auth/account`
- `POST /api/auth/mfa/setup|verify|disable` (administrators)
- `GET /api/auth/bootstrap-status`, `GET /api/settings`
- `GET /api/admin/users|teachers|students|classes|courses|org|permissions|settings|reports|audit|services`
- `POST /api/admin/users`, `PATCH /api/admin/users/:id`,
  `POST /api/admin/users/:id/recovery`, `PATCH /api/admin/permissions`,
  `PATCH /api/admin/settings`, `POST /api/admin/org`,
  `POST /api/admin/classes`, `PATCH /api/admin/classes/:id`,
  `PATCH /api/admin/courses/:id`, `POST /api/admin/enrollments`,
  `GET /api/admin/reports/export?type=users|enrollments|completion`
- `GET /api/teacher`, `GET /api/teacher/analytics`,
  `GET|POST /api/teacher/courses`, `PATCH /api/teacher/courses/:id`,
  `POST /api/teacher/courses/:id/modules`,
  `POST /api/teacher/courses/:id/modules/:moduleId/lessons`,
  `POST /api/teacher/courses/:id/resources`,
  `GET|POST /api/teacher/vision-assignments`,
  `GET /api/teacher/vision-results`, `GET /api/teacher/course-progress`,
  `GET /api/teacher/grading`, `PATCH /api/teacher/grading/:assignmentId/:studentId`
- `GET /api/courses`, `POST /api/courses/:id/enroll`,
  `POST /api/courses/:id/lessons/complete`, `GET /api/my-enrollments`
- `GET /api/health`, `GET /api/profile`, `PATCH /api/profile`,
  `GET /api/progress`, `POST /api/attempts`, `GET /api/vision/progress`,
  `POST /api/vision/events`, `GET|POST /api/notes`,
  `GET|POST /api/assignments`, `POST /api/assignments/:id/submit`

The local server binds to loopback and is not a production deployment.
Account sessions are in memory and expire after 12 hours or a server
restart. Account and learning data is stored persistently in
`backend/data/store.json` by default. Writes replace the file atomically and
keep the previous version in `backend/data/store.json.bak`; both files are
restricted to the current operating-system account. Keep this directory on
persistent local storage and do not set `EDUVERSE_STORE_PATH` to a temporary
directory if the data must survive restarts.

## Data and storage

The store is initialized on first run and then updated as accounts and learning
records are created. The app reloads it at server startup, so account data is
available after a restart. `EDUVERSE_STORE_PATH` can point to a different
persistent JSON file when needed. The store and its `.bak` backup are local
private application data and are excluded from Git. This provides persistence
on this machine; it does not provide off-device backups, encryption at rest,
or multi-server database guarantees.

## Production technical upgrades (Slice D)

Every external service is **env-optional with a working local fallback** — the
app runs fully without any keys. Set env vars only when you want the real service.

- **File storage** (`backend/storage.js`): local disk `backend/uploads/` served at
  `/uploads/` by default; S3-compatible when `S3_ENDPOINT`/`S3_BUCKET`/`S3_ACCESS_KEY`/
  `S3_SECRET_KEY` are set (hand-rolled SigV4, no new deps). Upload via
  `POST /api/upload` (base64 JSON, 5MB cap, mimetype allowlist, teacher/admin only).
- **Email** (`backend/email.js`): dev outbox (`store.emailOutbox`) by default;
  Resend or SendGrid when `EMAIL_PROVIDER` + key are set. Wired into password reset.
- **Payments** (`backend/payments.js`): test-mode by default; Razorpay
  (`RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`) or Stripe (`STRIPE_SECRET_KEY`) when
  configured. `POST /api/fee-records/:id/order` creates an order;
  `POST /api/payments/webhook` verifies signatures (HMAC for Razorpay/test,
  timestamped HMAC for Stripe).
- **Search** (`backend/search.js`): in-memory inverted index over courses, lessons,
  quizzes. `GET /api/search?q=` (min 2 chars, 20 results, org-scoped). Rebuilds
  on writes (debounced 5s).
- **Cache** (`backend/cache.js`): in-memory by default; Redis via raw RESP over
  `node:net` when `REDIS_URL` is set (no new deps). Used for branding (60s),
  marketplace browse (30s), usage analytics (60s).
- **Notifications** (`backend/notify.js`): triggers on fee assigned, quiz graded,
  live class scheduled, marketplace purchase. Email also queued when configured.
- **Monitoring** (`backend/monitor.js`): Sentry when `SENTRY_DSN` is set, else
  stderr + `store.errorLog` (admin-viewable at `GET /api/admin/monitoring/errors`).
  Wraps uncaught exceptions/rejections.
- **PostgreSQL**: `migrations/001_initial.sql` is the migration-target schema;
  see `docs/POSTGRES.md` (honest: JSON store remains the runtime default).
- **Deploy**: `docs/DEPLOYMENT.md` (HTTPS via Caddy/nginx, systemd, CI/CD,
  automated backups with `BACKUP_API_KEY`, full env table).
- **Load test**: `npm run load-test` (built-in Node HTTP concurrency probe).

## Tests executed

- `node --check backend/server.js` and `node --check app.js` — pass.
- A 44-check API script (run against a throwaway store copy) covering:
  admin bootstrap and login, public admin signup rejected (403), student
  signup/login, student blocked from admin and teacher endpoints (403),
  teacher pending → admin approval → login, admin class creation, teacher
  course draft → module → lesson → publish, student sees published course,
  enrolls, completes a lesson, teacher sees course progress, assignment
  publish → student submit → teacher grade → release → student sees the
  released grade, vision assignment → student attempt → teacher results,
  institution creation, settings save and persistence, permission toggle
  blocking teacher publishing (then re-enabled), reports, CSV export,
  services, audit log, admin recovery code resetting a password, login
  with the new password, teacher blocked from admin user creation, and
  unauthenticated access blocked. **44 passed, 0 failed.**
- A 39-check security script (throwaway store, separate port)
  covering: static-file exposure blocked for the store, server source,
  package file, `.env`, and Python service while the four frontend
  files still serve; security headers on API responses and no
  wildcard CORS; second-teacher/second-student ownership isolation
  (course edit, assignment creation, submission, grading);
  resubmission blocked after a released grade; per-user
  notification read state; password change signing out old sessions;
  admin recovery tokens expiring in 15 minutes; account deletion
  (wrong password rejected, deleted account cannot log in, last
  administrator protected); and password-recovery rate limiting.
  **39 passed, 0 failed.** A separate signup rate-limit check
  confirmed 10 signups per hour per IP pass and the 11th is rejected
  with 429.
- Full feature audit (2026-10-25, throwaway store): 66 checks covering auth (bootstrap-status, login, logout, profile patch with a role-change attempt ignored), student features (courses, enroll, lesson completion, progress, attempts, resources, syllabus, notes, vision events, feedback, notifications, public settings), teacher workspace (class schedule, attendance, practice, tests, student test attempts, announcements, analytics, course progress), admin features (teachers, students, courses, org/terms, enrollments, permissions, settings, reports, all 3 CSV exports, services, audit, class patch), and MFA end-to-end (setup, real TOTP verify, login without a code rejected, login with a code accepted, disable). **66 passed, 0 failed.** A simulated-browser render check also confirmed `app.js` loads without throwing, the welcome/sign-in screen renders, and the Nova panel opens from both the floating button and the sidebar guide button. The only initial audit failures were wrong expectations in the test script itself (enroll returns 201, duplicate enroll is idempotent 200, admin enrollment takes one student at a time) — the product behaved correctly in each case.
- Chatbot checks (throwaway store): unauthenticated chat rejected (401), empty message rejected (400), student questions about the midpoint, assignments and the Vision Lab each return a real, section-linked answer with suggestions, an off-topic question gets an honest deflection instead of a guess, and an administrator question about pending approvals returns the real pending count.
- A live automated browser check could **not** reach this local
  address (the browser tool rejects private/local addresses), so the
  welcome page and all three portals were not visually verified by
  that tool. Open `http://127.0.0.1:4173` in your own browser to
  check them visually; the API checks above are what verify the
  functionality.

## Honest limitations (not hidden behind working-looking controls)

- **Live multi-user classes are not implemented.** Scheduled sessions and
  the classroom board are single-browser demos; there is no real-time
  video, chat sync, or multi-user whiteboard networking. The Integrations
  page says this plainly.
- **Email delivery is not configured.** There is no email verification and
  no emailed password reset; recovery uses administrator-issued codes
  (above). Push/email notifications are not sent.
- **Production database:** persistence is a local JSON file with a serialized
  write queue, atomic replacement, and one previous-version backup. It is not
  a production database; there is no automated off-device backup, migration
  framework, encryption at rest, or multi-process coordination.
- **File uploads:** course resources are links (video/document/link/
  practice) validated as http(s) URLs. Binary file upload, storage quotas
  enforcement on upload, and virus scanning are not implemented; the
  max-upload setting is stored and displayed but has no upload endpoint
  to enforce against yet.
- **Nova** is a guided assistant, not a live AI connection: tap **Ask Nova**, the sidebar **Ask learning guide** button, or **Open learning assistant** on the Feedback page to open a real chat panel with a message thread, tap-to-send suggestions, and an "Open this section" button on relevant answers. It answers from the app's own content and your account (binary search, courses, assignments, Vision Lab, attendance, account help, and role-specific teacher/admin topics) via `POST /api/chat`, with an offline fallback if the API is not running. It will say so rather than guess on topics outside EduVerse. Vision-lab
  gesture classifications are geometry estimates, not sign-language
  recognition; the scavenger hunt estimates center-frame color and does
  not identify object names; the scanner enhances contrast locally and
  does not perform OCR.
- **MFA secrets** are stored in the local JSON store. That is acceptable
  for a local build and is not a production secret-management story.

## Missing-features round (2026-11-04)

Five slices added on the existing stack (name/UI unchanged). `npm test` → **144/144**.

### Slice 1 — Parent portal (`PARENT_CONTRACT.md`)
- New `parent` role (signup, no approval). Parents link to children two ways: admin links
  them directly (`POST /api/admin/parent-links`), or parents self-sign up and enter a
  student link code (`POST /api/parent/link` — the code IS the authorization).
- Parent dashboard: child cards with progress (courses enrolled/completed, avg quiz score,
  XP/level), attendance %, recent results, certificates.
- Announcements with audience targeting (`all`/`students`/`parents`/`teachers`); role-filtered feeds.

### Slice 2 — Library + offline learning (`LIBRARY_CONTRACT.md`)
- Library catalog: books, e-books, journals with search/filters; book borrowing (14-day
  loans, copy counts, overdue flags); e-book reading; teacher reading lists.
- Offline: lesson downloads (self-contained HTML), progress queued in localStorage when
  offline, `POST /api/offline/sync` applies it. Honest label: per-lesson downloads;
  full offline mode needs the mobile app.

### Slice 3 — Calendar + careers (`CAREER_CONTRACT.md`)
- Unified calendar: stored events (holidays/exams/deadlines) + derived live-session events,
  month view with kind filters.
- Career center: career paths (skills + linked courses), internships board with idempotent apply.
- Placement prep: aptitude tests (timed, server-side, answers never leak), mock interviews
  (book → feedback). Note: quizzes carry no deadline field, so the calendar derives only
  live-session events; exams go on as stored events.

### Slice 4 — Language + i18n + accessibility (`LANG_CONTRACT.md`)
- Language lab: vocabulary sets (study flashcards + quiz), speaking practice (Web Speech API
  with manual fallback; word-overlap scoring, honestly labeled).
- UI language switcher: English, Hindi, Tamil, Bengali, Marathi for nav + common buttons +
  auth screens (deeper pages stay in English — labeled). Translations are best-effort;
  Tamil/Bengali/Marathi need a native-speaker pass before production.
- Accessibility: skip-to-content link, aria-labels, focus-visible, `lang` attribute updates,
  verified video captions and header-search keyboard nav.

### Slice 5 — LMS integrations (`STANDARDS_CONTRACT.md`)
- **LTI 1.1** tool-provider: `POST /lti/launch` (OAuth 1.0a signature, nonce replay guard)
  provisions the user, enrolls in the linked course, starts a session. LTI 1.3/OIDC not implemented.
- **SCORM**: zip import parses `imsmanifest.xml`, extracts to `backend/uploads/scorm/`,
  creates lessons; iframe player + `POST /api/scorm/:lessonId/commit`. Import + launch +
  basic status — not a full RTE.
- **xAPI**: `POST /api/xapi/statements` stores statements; internal emits on lesson completion
  and quiz grading; no external LRS forwarding.
- **Exports**: enrollment report now in CSV + PDF (print-ready HTML) + Excel (SpreadsheetML `.xls`).

### Honest limits for this round
- Certificate verification and CSV import/export already existed — not rebuilt; PDF/Excel added.
- Offline is per-lesson downloads + progress sync, not a full offline app.
- LTI is 1.1 only; SCORM is not a full runtime; xAPI has no external LRS.
- UI translations cover nav/buttons/auth only; deeper pages remain English.

## Authentication & authorization (2026-11-10)

JWT + Google login added alongside the existing session-cookie auth. `npm test` → **153/153**.

### JWT (`backend/jwt.js`, HS256 via node:crypto, zero new deps)
- Login/signup/verify-email/reset-password responses include
  `{accessToken, refreshToken, tokenType:'Bearer', expiresIn:3600}`.
- Access token: 1h. Refresh token: 7d, opaque, SHA-256-hashed at rest, **rotated on every
  refresh** (old token can never be reused).
- Every protected route accepts **either** the session cookie **or**
  `Authorization: Bearer <jwt>`; Bearer tokens re-resolve the user from the store on each
  request, so role/status changes apply immediately.
- `POST /api/auth/refresh` (rotate), `POST /api/auth/logout` (revokes refresh token(s) +
  clears session), `POST /api/auth/token` (fresh pair for an already-authenticated user —
  the bridge after the Google redirect, which can't carry tokens in a URL),
  `GET /api/auth/me` (works with either auth method), `GET /api/profile`.
- Secret: `JWT_SECRET` env. Without it, a random per-process secret is generated (tokens
  don't survive a restart) and a warning is logged — **set JWT_SECRET in production**.

### Google login (`backend/google.js`, env-optional)
- `GET /api/auth/google` → 302 to Google (signed 10-min state, CSRF-protected);
  `GET /api/auth/google/callback` → code exchange → profile → find-or-create (by `googleId`,
  then verified email) → session → redirect `/?google=ok` (or `?google=error`).
  The frontend then exchanges the session for a JWT pair via `POST /api/auth/token`.
- `POST /api/auth/google` `{idToken}` → verified via Google tokeninfo (`aud`, `exp`,
  `email_verified`) → JWT pair. `GET /api/auth/google/status` reports configured or not.
- New Google users default to role `student`; teachers need admin approval afterwards
  (same rule as normal signup; Google can never bypass approval).
- Setup: create OAuth 2.0 credentials in Google Cloud Console (APIs & Services →
  Credentials), set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
  `GOOGLE_REDIRECT_URI` (default `http://127.0.0.1:4173/api/auth/google/callback` —
  register this exact URI in Google Cloud). Without them the Google button is hidden
  and `GET /api/auth/google` returns 501 with a clear message.
- **Not live-tested against Google** — no credentials configured; the flow is code-complete
  with unit-tested verify helpers, but the real OAuth round-trip needs real credentials.

### Email verification (new)
- `POST /api/auth/send-verification` (auth'd, 24h single-use token, hashed at rest,
  3/hour rate limit) → link emailed via the configured provider or the dev outbox.
  Requires an email on the profile first. `POST /api/auth/verify-email` `{token}` →
  marks `emailVerified`, returns a JWT pair + starts a session.
- Login is **not** gated on verification (existing users have no email on file).
- Password reset (`POST /api/auth/forgot-password` / `reset-password`) now returns a JWT
  pair on success and revokes all pre-reset refresh tokens (same on change-password and
  account delete).

### Role-based access
- Admin / Teacher / Student (+ parent, super/institution admin) gates are enforced
  identically for Bearer tokens and session cookies — verified by tests
  (student JWT → admin/teacher endpoints 403).

### Frontend
- "Continue with Google" button on sign-in/signup (hidden when unconfigured).
- Profile "API access" section: current JWT with Copy / Regenerate / Revoke.
- Login responses store the JWT pair in localStorage (`eduverse.jwt` / `eduverse.refresh`);
  API calls attach `Authorization: Bearer` when a token is stored, with a cookie-only
  retry on 401 so an expired token can never lock the user out.

## Virtual classroom, assignments & coding lab (2026-11-10)

`npm test` → **175/175**.

### Virtual classroom — mostly already built, gaps filled (`CLASSROOM_CONTRACT.md`)
- Already existed: live classes (schedule/join), WebRTC video/audio, screen sharing, live chat,
  hand raise, Q&A, polls, whiteboard, slides, breakout rooms, recording, attendance.
- **New**: video provider setting (`GET /api/settings/video-provider`) — `webrtc` by default;
  set `VIDEO_PROVIDER=agora` + `AGORA_APP_ID`/`AGORA_APP_CERT` to switch to Agora.
  `POST /api/live/token` mints Agora RTC tokens (v006, HMAC-SHA256, no new deps); 501 when
  unconfigured. The classroom loads the Agora Web SDK from CDN only in Agora mode and falls
  back to WebRTC on any failure.
- **New**: `GET /api/live-sessions/upcoming` (starting within 60 min) + "starting soon" banner
  on student/teacher dashboards with a Join button.
- **New**: `GET /api/teacher/live-sessions/:id/attendance` → present/total per session.
- **Fixed**: scheduling a live session no longer requires a meeting URL when "Use EduVerse
  classroom" is checked (the form said optional, the backend 400'd without one). A bad URL
  is still rejected when no classroom is used.
- Honest limits: Agora is **not live-tested against Agora's servers** (no credentials); token
  format is standard v006 and verifies, but a real Agora join needs real credentials. The
  token endpoint doesn't check session membership for the channel.

### Assignments — gaps filled (`ASSIGN_CONTRACT.md`)
- Already existed: teacher create, student text submit, grading + feedback, MCQ auto-evaluation,
  exam results.
- **New**: deadline enforcement — submissions past `dueDate` are rejected (400) unless the
  assignment has `allowLate: true`, in which case they're accepted and flagged `late: true`
  (date-only due dates count as end-of-day).
- **New**: file uploads on submissions — PDF/DOC/DOCX/TXT via `POST /api/upload`
  (`folder:'assignments'`, students allowed for that folder only, 5MB cap); submission
  requires text OR a file. Teacher grading view shows LATE badges + file links.
- **New**: `PATCH /api/assignments/:id` (teacher owner/admin) to flip `allowLate`/due date.

### Online Coding Lab (`CODELAB_CONTRACT.md`)
- **New**: code editor (tab support, line-number gutter, stdin field) + Run (stdout/stderr/status).
- **Execution**: JavaScript runs locally in a `node:vm` sandbox (2s, no require/process/network).
  Python/Java/C++/C/Go/Ruby/Rust run via **Judge0** when `JUDGE0_API_URL` is set
  (+ `JUDGE0_API_KEY`/`JUDGE0_API_HOST` for RapidAPI); without it those languages return 501
  with a clear message. Rate limit: 20 runs/min per user.
- **Projects**: save/open/delete your code (`GET/POST/PATCH/DELETE /api/code/projects`).
- **Challenges**: teachers create challenges with test cases; students submit and get
  per-test-case pass/fail + score. Challenge code in JavaScript must define
  `function solve(input)` — the editor says so. Test cases are visible to students by design
  (practice exercises, not hidden-answer exams).
- Honest limits: Judge0 is **not live-tested** (no Judge0 configured); local execution is
  JS-only in a vm sandbox, not container-level isolation.
