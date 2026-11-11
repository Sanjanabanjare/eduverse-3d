# CAREER_CONTRACT.md — Slice 3: calendar + career center + placement prep

Work ONLY in `~/workspace/eduverse-current/`. Do not rename the app, do not restyle existing screens.
Backend agent owns `backend/server.js` (+ `backend/career.js` if cleaner).
Frontend agent owns `app.js`, `styles.css`, `index.html`.
Depends on Slice A org model. New perm: `calendar.manage`.

## Data model

- `calendarEvents[]`: `{id, institutionId, title, kind:'holiday'|'exam'|'deadline'|'event', startsAt, endsAt|null, description, createdBy}`
  - Auto-generated views (not stored): exams from `exams[]`, quiz deadlines from `quizzes[]`,
    live sessions from `liveSessions[]` — the unified GET merges stored + derived events.
- `careerPaths[]`: `{id, institutionId, title, description, skills[], courses[] (courseIds), createdBy}`
- `internships[]`: `{id, institutionId, company, role, description, location, stipend|null, applyUrl|null, deadline|null, postedBy, createdAt}`
- `aptitudeTests[]`: `{id, institutionId, title, questions[] {q, choices[], answer}, timeMin, createdBy}` — answer never sent to students (reuse exam pattern)
- `mockInterviews[]`: `{id, institutionId, title, kind:'hr'|'technical', questions[] (strings), scheduledFor|null, studentId|null, interviewerId|null, status:'open'|'scheduled'|'done', feedback|null}`

## Backend

- `GET/POST /api/admin/calendar` (`?from=&to=&kind=`), `PATCH/DELETE /api/admin/calendar/:id` — `calendar.manage`, org-scoped.
- `GET /api/calendar` (`?from=&to=`) — merged stored events + derived (exams/quizzes/live sessions) for the requester's institution; role-filtered (students see enrolled-course exams).
- Career paths: `GET/POST /api/admin/career-paths`, `PATCH/DELETE`; `GET /api/career-paths` (all roles).
- Internships: `GET/POST /api/admin/internships`, `PATCH/DELETE`; `GET /api/internships`; `POST /api/internships/:id/apply` (student, records application `{studentId, appliedAt}` on the internship).
- Aptitude tests: teacher/admin CRUD `/api/teacher/aptitude` (reuse quiz-attempt pattern:
  `POST /api/aptitude/:id/start` → questions without answers; `POST /api/aptitude/:id/submit` → score); store `aptitudeAttempts[]`.
- Mock interviews: `POST /api/teacher/mock-interviews` (create with questions); `GET /api/mock-interviews` (student: open + own); `POST /api/mock-interviews/:id/book` (student books open slot → status scheduled); teacher `POST .../feedback` → status done.
- Permissions: `calendar.manage` → super_admin + institution_admin.

## Frontend

- **Calendar** (`calendar` screen, all roles): month view, kind filter (holiday/exam/deadline/event),
  event dots + detail panel; admin `admin-calendar`: create/edit/delete form.
- **Career center** (`careers` screen): career path cards (title, description, skills, linked courses with enroll links); internships board (company, role, stipend, deadline, Apply button + applied state).
- **Placement prep** (`placement` screen): aptitude test list (start → timed attempt UI → score),
  mock interview list (book open slots, view feedback).
- Admin `admin-careers`: CRUD for paths + internships; teacher placement section for aptitude + mock interviews.
- Add to navs. Reuse existing styles.

## Tests (backend agent)

New `backend/career.test.js`: calendar CRUD org-scoped; merged view includes derived exam event;
internship apply idempotent; aptitude answers never leak; mock interview book→feedback flow;
perms (student cannot POST admin calendar). `npm test` green.
