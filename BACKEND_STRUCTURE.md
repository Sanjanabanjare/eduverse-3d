# BACKEND_STRUCTURE.md — Proposed structure vs actual EduVerse layout (2026-11-10)

The proposed `eduverse-3d/` structure maps to the real files as follows. Nothing was
rebuilt; this is the map.

## Layout

| Proposed | Actual | Notes |
|---|---|---|
| `frontend/src/`, `public/` | `app.js`, `styles.css`, `index.html` (+ `security-utils.js`, `vision-hands.js`) | Single-page app, no build step, no `src/` split |
| `backend/app.js`, `server.js` | `backend/server.js` | One server file (~2000+ lines) + modules below |
| `backend/config/db.js` | `backend/server.js` `initStoreCollections()` + `backend/storage.js` | JSON store; PG schema in `migrations/001_initial.sql` |
| `backend/controllers/*` | `backend/*.js` modules | One module per domain, store-injected helpers |
| `backend/models/*` | Store collections in `server.js` (no ODM) | Validated inline at the route handlers |
| `backend/routes/*` | Route handlers inside `backend/server.js` | Grouped by domain with section comments |
| `backend/middleware/*` | Inline in `server.js` | `authUser()` (session or Bearer), rate limits, perms |
| `backend/services/*` | `backend/nova.js`, `email.js`, `payments.js`, `search.js`, `cache.js`, `notify.js`, `monitor.js` | Env-optional external services with local fallbacks |
| `backend/sockets/*` | `ws` signaling in `backend/live.js` + `server.js` | Live classroom rooms, chat, whiteboard sync |
| `backend/utils/*` | `backend/jwt.js`, `backend/google.js`, `backend/csv.js`, `backend/idempotency.js` | Small helpers |
| `backend/.env` | Env vars at runtime | `JWT_SECRET`, `OPENAI_API_KEY`, `GOOGLE_*`, `JUDGE0_*`, `AGORA_*`, `S3_*`, `REDIS_URL`, `SENTRY_DSN`, `EDUVERSE_STORE_PATH`, `PORT` |

## Controllers → modules

| Proposed controller | Actual module | Domain |
|---|---|---|
| `authController.js` | `server.js` auth section + `backend/jwt.js` + `backend/google.js` | Signup/login, JWT, Google, verify/reset |
| `userController.js` | `server.js` users/profile section + `backend/org.js` | Profile, roles, permissions |
| `courseController.js` | `server.js` courses/lessons section | Courses, lessons, enrollments |
| `assignmentController.js` | `server.js` assignments section | Assignments, submissions, grading |
| `quizController.js` | `backend/exam.js` + `server.js` quizzes section | Quizzes, exams, question bank |
| `classroomController.js` | `backend/live.js` + `backend/classroom.js` | Live sessions, WebRTC/Agora, attendance |
| `progressController.js` | `server.js` progress/gamification section | XP, badges, progress, certificates |
| `notificationController.js` | `backend/notify.js` | Triggers + unread badge |

## MongoDB collections → JSON store collections

| Collection | Store key | Notes |
|---|---|---|
| `users` | `users[]` | + `refreshTokens[]`, `emailVerifications[]` |
| `courses` | `courses[]` | modules/lessons embedded |
| `lessons` | embedded in `courses[].modules[].lessons[]` | |
| `enrollments` | `enrollments[]` | |
| `assignments` | `assignments[]` | submissions embedded per student |
| `submissions` | `assignments[].submissions{}` | |
| `quizzes` | `quizzes[]` | + `quizAttempts[]`, `exams[]` via `exam.js` |
| `results` | `quizAttempts[]`, `aptitudeAttempts[]` | graded attempts |
| `classrooms` | `liveSessions[]` | + `classSessionRecords[]` (2026-11-10) |
| `attendance` | `liveSessions[].attendees[]` / `attendance[]` | + class attendance records |
| `discussions` | `discussions[]` | + `discussionReplies[]` |
| `comments` | `discussionReplies[]` | |
| `notifications` | `notifications[]` | |
| `certificates` | `certificates[]` | public verify by code |
| `progress` | `courseLessonProgress{}`, `lessonPositions{}` | + gamification |
| `messages` | live-classroom chat (ws, in-memory per room) | not persisted |
| — | `parentLinks[]`, `announcements[]`, `libraryItems[]`, `bookLoans[]`, `readingLists[]`, `calendarEvents[]`, `careerPaths[]`, `internships[]`, `vocabSets[]`, `speakingExercises[]`, `codeProjects[]`, `codeChallenges[]`, `ltiConsumers[]`, `scormPackages[]`, `xapiStatements[]` | Feature slices (see README) |
