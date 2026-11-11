# PARENT_CONTRACT.md — Slice 1: parent portal + announcements

Work ONLY in `~/workspace/eduverse-current/`. Do not rename the app, do not restyle existing screens.
Backend agent owns `backend/server.js` (+ `backend/family.js` for helpers if cleaner).
Frontend agent owns `app.js`, `styles.css`, `index.html`.
Depends on Slice A: `org.orgScope`, `org.can`. New role: `parent`. New perm: `family.manage`.

## Data model

- `parentLinks[]`: `{id, parentId, studentId, relation:'father'|'mother'|'guardian'|'other', createdAt}`
  - Unique on `(parentId, studentId)`; a student may have multiple parents.
- `announcements[]`: `{id, institutionId, title, body, audience:'all'|'students'|'parents'|'teachers', createdAt, authorId}`
- `studentLinkCodes[]`: `{studentId, code, createdAt}` — 8-char code per student for parent self-linking
  (regenerate on demand; codes are single-institution).

## Backend

- Role `parent`: creatable via signup (`role:'parent'`, no approval needed) and via
  `POST /api/admin/users` (admin). Add to `ADMIN_ROLES`? No — parent is NOT an admin role.
  Add `parent` to `roleHome`/portal handling (frontend).
- `POST /api/admin/parent-links` `{parentId, studentId, relation}` — `family.manage` perm;
  both users must exist, student role must be `student`, same institution (or super_admin).
  409 on duplicate.
- `DELETE /api/admin/parent-links/:id` — `family.manage`.
- `GET /api/admin/parent-links` (`?studentId=&parentId=`) — `family.manage`, org-scoped.
- `GET /api/student/link-code` — student gets/creates their 8-char code.
- `POST /api/parent/link` `{code}` — parent links themselves to the student (validates code,
  same institution not required — the code IS the authorization; sets parent's institutionId
  to the student's on first link).
- `GET /api/parent/children` → `[{student: publicUser, progress: {coursesEnrolled, coursesCompleted, avgQuizScore, xp, level}, attendance: {present, total}}]`
  - Progress from enrollments + quizAttempts; attendance from live session `attendance[]` + class attendance records where available.
- `GET /api/parent/children/:id/results` → recent quiz attempts (graded) + certificates.
- `GET /api/parent/announcements` → announcements where `audience in ('all','parents')` + institution scope.
- `POST /api/admin/announcements` `{title, body, audience}` — `family.manage` or super_admin;
  `GET /api/admin/announcements`, `PATCH/DELETE /api/admin/announcements/:id`.
- Students/teachers see announcements too: `GET /api/announcements` (own role's audience + 'all').
- Permissions: add `family.manage` to matrix (super_admin + institution_admin).

## Frontend

- **Parent portal**: `roleHome('parent')` → parent dashboard; nav: Dashboard, Announcements, (profile).
- **Parent dashboard** (`parent-dashboard`): child cards (name, avatar, XP/level), per-child
  progress bars (courses completed/enrolled), average quiz score, attendance %, recent results
  list, certificates.
- **Linking UI**: parent "Link a child" form (enter code); student profile shows "Parent link code"
  with copy button + regenerate.
- **Announcements** (`announcements` screen, all roles): feed filtered by audience; admin
  `admin-announcements`: create form (title, body, audience picker), list, delete.
- Admin users screen: "link parent" action per student (picker of parent accounts).
- New role styling: parent portal uses the student-like light theme (no new design system).

## Tests (backend agent)

New `backend/family.test.js`: link create/duplicate-409/cross-institution-403; parent sees only
own children (no leak); link-code self-link sets institution; announcements audience filtering
(parent doesn't see teacher-only); admin announcements CRUD perm-gated. `npm test` green.
