# EduVerse 3D — LMS Expansion Contract

Both builders MUST follow this contract exactly. Backend owns `backend/server.js`
+ `backend/lms-features.test.js`. Frontend owns `app.js`, `styles.css`,
`index.html` (only if a nav item is needed). Do not touch each other's files.

## Conventions (match existing code)
- Routes: `send(res, status, payload)`; auth via `req.auth` ({id, role, name,
  email}); admin guard: `url.pathname.startsWith('/api/admin/')` → role check;
  teacher guard pattern already in file — follow it.
- Store init: `store.X ||= ...` next to the other inits. Persist with `await persist()`.
- IDs: `randomUUID()`. Timestamps: `new Date().toISOString()`.
- Errors: `send(res, 4xx, {error:'Human message.'})`. Never expose correct quiz
  answers to students before grading is final.
- Existing tests (`npm test` → `node --test backend/*.test.js`) must keep passing.

## Data model

```js
store.quizzes ||= [];            // {id, courseId, ownerId, title, description, timeLimitMin (0=none),
                                 //  maxAttempts (0=unlimited), shuffleQuestions, shuffleOptions,
                                 //  passingScore (0-100), status:'draft'|'published',
                                 //  questions:[{id, type:'mcq'|'truefalse'|'short', prompt,
                                 //    options:[], correctIndex, correctBoolean, acceptedAnswers[], points}],
                                 //  createdAt, updatedAt}
store.quizAttempts ||= [];       // {id, quizId, studentId, startedAt, submittedAt,
                                 //  answers:{questionId: answer}, autoScore, manualScore,
                                 //  finalScore (0-100), passed, status:'in-progress'|'submitted'|'graded',
                                 //  questionGrades:{questionId:{points, feedback}}}
store.videoProgress ||= {};      // key `${studentId}:${courseId}:${lessonId}` →
                                 // {positionSec, watchedSec, completed, updatedAt}
store.certificates ||= [];       // {id, code (12-char), userId, userName, courseId,
                                 //  courseTitle, issuedAt, scoreAvg}
store.plans ||= [];              // seeded: {id, name, priceCents, currency:'INR',
                                 //  interval:'one-time'|'monthly'|'yearly', features[], active}
store.subscriptions ||= [];      // {id, userId, planId, status:'active'|'cancelled'|'expired',
                                 //  startedAt, endsAt, cancelledAt}
store.orders ||= [];             // {id, userId, kind:'course'|'plan', refId, amountCents,
                                 //  currency, status:'pending'|'paid'|'failed', testMode:true,
                                 //  createdAt, paidAt}
store.discussions ||= [];        // {id, courseId, authorId, authorName, title, body,
                                 //  pinned, createdAt, replyCount}
store.discussionReplies ||= [];  // {id, discussionId, authorId, authorName, body, createdAt}
store.liveSessions ||= [];       // {id, courseId, ownerId, title, description,
                                 //  startsAt, durationMin, meetingUrl, status:'scheduled'|'live'|'ended',
                                 //  attendees:[userId], createdAt}
store.userXp ||= {};             // userId → {xp, level, streakDays, lastActiveDate}
store.userBadges ||= {};         // userId → [{badgeId, awardedAt}]
```

Seeded badges (`BADGES` const in server.js):
`first-steps` (complete first lesson), `week-warrior` (7-day streak),
`quiz-master` (quiz score ≥ 90), `scholar` (1000 XP), `helper` (5 discussion replies),
`graduate` (first certificate).

XP awards: lesson complete +10, video lesson completed +15, quiz passed +50,
quiz taken +10, assignment submitted +20, discussion thread +5, reply +3,
live session attended +25, certificate +100.

Lesson extension (existing lesson object gains optional fields):
`{videoUrl, videoType:'mp4'|'youtube', videoDurationSec}`.

Course extension: `{priceCents (0=free), currency:'INR'}`.

## API endpoints

### Quizzes
- `POST /api/teacher/quizzes` (teacher/admin) — body: {courseId?, title,
  description?, timeLimitMin?, maxAttempts?, shuffleQuestions?, shuffleOptions?,
  passingScore?, status?, questions:[{type, prompt, options?, correctIndex?,
  correctBoolean?, acceptedAnswers?, points?}]}. Validate: title 3–120 chars,
  ≥1 question, mcq needs ≥2 options + valid correctIndex, points ≥1.
  Returns 201 {quiz} (WITH answers — teacher owns it).
- `GET /api/teacher/quizzes` — own quizzes (full, with answers).
- `GET /api/teacher/quizzes/:id` — own quiz with answers.
- `PATCH /api/teacher/quizzes/:id` — update fields incl. questions/status.
- `DELETE /api/teacher/quizzes/:id` — also deletes its attempts.
- `GET /api/quizzes` (student) — published quizzes for enrolled courses
  (+ teacher/admin see all). Each WITHOUT correct answers/acceptedAnswers.
- `GET /api/quizzes/:id` — single quiz for taking, WITHOUT answers; 403 if not
  published or (student) not enrolled in its course (courseId optional → public).
- `POST /api/quizzes/:id/start` — creates attempt {id, startedAt}, enforces
  maxAttempts; returns {attemptId, startedAt, timeLimitMin, questionCount}.
- `POST /api/quizzes/:id/attempts/:attemptId/submit` — body {answers:{qid:answer}}.
  Server checks time limit (late → still accept but flag `late:true`).
  Auto-grades mcq/truefalse; short answers → status 'submitted' pending manual
  grading, autoScore computed on objective part. Returns {attempt} (no answer key).
- `GET /api/quizzes/:id/my-attempts` — student's attempts (no answer key until graded).
- `GET /api/teacher/quizzes/:id/attempts` — all attempts WITH answers given
  (for grading).
- `POST /api/teacher/quiz-attempts/:attemptId/grade` — body
  {grades:{questionId:{points, feedback?}}} → recompute finalScore, passed,
  status 'graded'. Awards XP.
- `DELETE /api/teacher/quiz-attempts/:attemptId` (teacher/admin).

### Video
- Lesson create/update (existing routes) accept `videoUrl` (≤2000 chars, must be
  http(s) or YouTube watch/embed URL), `videoType` auto-detected, `videoDurationSec`.
- `POST /api/video/progress` (student, enrolled) — {courseId, lessonId,
  positionSec, watchedSec}. Upserts; if watchedSec ≥ 0.9×videoDurationSec (or
  body.completed===true) → mark lesson complete in courseLessonProgress + XP.
  Returns {saved, completed}.
- `GET /api/video/progress?courseId=` — map lessonId → {positionSec, watchedSec}.

### Certificates
- Eligibility: enrolled + every lesson complete + every published quiz of the
  course has a passing attempt (if course has quizzes).
- `POST /api/certificates/issue` — {courseId} → 400 if ineligible (list missing
  items); else create {code: 12-char base32, ...}, award XP + `graduate` badge.
- `GET /api/certificates` — my certificates.
- `GET /api/certificates/verify/:code` — PUBLIC (no auth): {valid, certificate?}.
- `GET /api/teacher/certificates` — certificates for own courses.

### Payments & subscriptions (TEST MODE — real gateway is a documented future step)
- `GET /api/plans` — public active plans. Seed on boot if empty:
  Free (₹0), Monthly (₹499/mo), Yearly (₹4,999/yr), each with features[].
- `POST /api/admin/plans` — create/update plan. `PATCH /api/admin/plans/:id`,
  `DELETE /api/admin/plans/:id` (soft: active=false).
- `GET /api/admin/orders` — all orders. `GET /api/admin/subscriptions` — all subs.
- `POST /api/checkout` (auth) — {kind:'plan', planId} or {kind:'course', courseId}
  → validate price, create order status 'pending', return
  {order, testMode:true, message:'Test mode: confirm to simulate payment.'}.
- `POST /api/checkout/:orderId/confirm` — test-mode "payment succeeds":
  order → paid; plan → subscription active (endsAt per interval); course →
  entitlement recorded on order (refId=courseId, status paid).
- `POST /api/checkout/:orderId/cancel` — mark failed/cancelled.
- `GET /api/billing` — {subscription (active or null), orders[]}.
- `POST /api/billing/cancel` — cancel active subscription (stays valid till endsAt).
- `POST /api/payments/webhook` — stub: requires header `x-webhook-secret` to match
  `PAYMENTS_WEBHOOK_SECRET` env (if unset → 503 "not configured"); validates
  shape, logs, returns {received:true}. Documented as integration point.
- ENROLLMENT GATE: modify existing `POST /api/my-enrollments` (backend agent must
  read it): if course.priceCents > 0, require paid order for that course OR
  active subscription (any paid plan). Return 402 {error, checkout:{kind:'course', courseId}}
  when payment required. Free courses unchanged. Teachers/admins bypass.

### Discussions
- `GET /api/courses/:courseId/discussions` — pinned first, then newest. (Student:
  enrolled or public course.)
- `POST /api/courses/:courseId/discussions` — {title 3–120, body ≤5000} → XP+5.
- `GET /api/discussions/:id` — {discussion, replies[]}.
- `POST /api/discussions/:id/replies` — {body ≤5000} → XP+3, replyCount++.
- `POST /api/discussions/:id/pin` (teacher of course/admin) — toggle.
- `DELETE /api/discussions/:id` (author/teacher/admin) — removes replies too.

### Live classes
- `POST /api/teacher/live-sessions` — {courseId?, title, description?, startsAt
  (ISO, future), durationMin 15–480, meetingUrl (https ≤2000)} → status scheduled.
- `GET /api/live-sessions` — upcoming+live (student: enrolled courses or public).
- `GET /api/teacher/live-sessions` — own sessions.
- `PATCH /api/teacher/live-sessions/:id` — update; {status} transitions.
- `POST /api/live-sessions/:id/join` — student: adds to attendees, returns
  {meetingUrl}; if first join → XP+25. Teacher owner can always join.
- `DELETE /api/teacher/live-sessions/:id`.

### Gamification
- `GET /api/gamification` — {xp, level, streakDays, badges:[{badgeId, name,
  description, awardedAt}], nextLevelXp}.
  Level = floor(sqrt(xp/100)) + 1. Streak: consecutive active days (any XP event).
- `GET /api/leaderboard` — top 20 {name, xp, level} (exclude admins).
- XP events are awarded server-side inside the existing/new routes listed above
  (lesson complete, video complete, quiz submit/pass, assignment submit,
  discussion post/reply, live join, certificate). One helper: `awardXp(userId, n, reason)`.

## Frontend screens (new `screens.*` entries + loaders)
Name → purpose:
- `video-player` — plays lesson video (mp4 via <video>, youtube via iframe embed),
  custom controls (play/pause, seek, speed 0.5–2x, fullscreen), resume from saved
  position, heartbeat progress POST every 10s + on pause/ended, "Mark complete"
  when ≥90% watched, next-lesson button. Opened from course detail lesson lists.
- `quizzes` — student: published quizzes w/ best score, attempts left, start button.
- `quiz-take` — take quiz: timer countdown, one question at a time or all,
  shuffle honored, submit → result screen (score, pass/fail, per-question
  correct/incorrect WITHOUT revealing correct answers for failed ones unless
  teacher allows — keep simple: show correct/incorrect only).
- `teacher-quizzes` — teacher: quiz list, builder (add/edit questions: mcq with
  options + correct pick, true/false, short answer with accepted answers),
  publish toggle, attempts view + manual grading UI for short answers.
- `certificates` — my certificates: cards with download/print (print CSS),
  verify-code display; public verify box (code → result).
- `billing` — plans cards, current subscription, order history, cancel.
- `checkout` — order summary + big TEST MODE banner + Confirm/Cancel.
- `discussions` — course forum: thread list, new thread, thread view + replies,
  pin (teacher).
- `live-classes` — upcoming/live sessions with Join buttons; teacher: schedule form.
- `leaderboard` — top learners + my rank.
- Dashboard widgets (student `overview`): XP/level/streak card, "Continue learning"
  (resume video positions), upcoming live classes, certificates count.
  Teacher dashboard: add links to quizzes, live sessions.
- Course detail: lesson rows show video duration + ▶; quiz tab lists course quizzes;
  discussion tab; teacher course editor: lesson video URL field, course price field.
- Catalog: price badges (Free / ₹X), enroll button becomes "Buy & Enroll" for paid.
- Nav: add screens to `screenNames` + role nav lists (student: Video/Quizzes/
  Certificates/Discussions/Live/Billing/Leaderboard; teacher: +Quizzes/Live;
  admin: Plans/Orders under admin screens `admin-plans`, `admin-orders`).
- Styles: new CSS for player, quiz, certificate (print), pricing cards, forum,
  leaderboard. Keep the existing aesthetic.

## Test file (backend agent)
`backend/lms-features.test.js` (node:test, same harness style as
api-resilience.test.js): quiz CRUD + student take/grade flow, video progress +
auto-complete, certificate issue + verify, checkout confirm + enrollment gate
(402 → paid → enroll OK), discussion thread+reply+pin, live session create+join,
gamification XP/level/leaderboard. Use unique temp store + free port.

## Non-goals
- Real payment gateway (test mode only, clearly labeled).
- Video upload/storage (URL-based: mp4 or YouTube).
- Changing existing auth, security, or vision-lab behavior.
