# STUDYGROUP_CONTRACT.md — Slice 3: collaborative learning — study groups

Work ONLY in `~/workspace/eduverse-current/`. Do not rename the app, do not restyle existing screens.
Backend agent owns `backend/server.js` (+ `backend/studygroups.js` if cleaner).
Frontend agent owns `app.js`, `styles.css`, `index.html`.

## Current state (verified 2026-11-10)
- Collaborative pieces exist: per-course discussions + replies, live-classroom shared whiteboard
  + chat + polls. **Missing**: a persistent student-owned collaboration space — a group with
  members, shared notes, and group chat that lives beyond a single live session.

## Data model
- `studyGroups[]`: `{id, name, description, courseId|null, ownerId, members[] {userId, name, role:'member'|'admin', joinedAt}, inviteCode, createdAt}`
- `groupNotes[]`: `{id, groupId, authorId, title, content, updatedAt}` (shared, any member can edit; last-writer-wins with updatedAt)
- `groupMessages[]`: `{id, groupId, authorId, authorName, text, createdAt}` (last 200 per group kept)

## Backend
- `POST /api/study-groups` `{name, description?, courseId?}` (student/teacher) → creates group,
  creator is owner+admin, invite code generated.
- `GET /api/study-groups` → groups the requester belongs to.
- `POST /api/study-groups/:id/join` `{inviteCode}` → member. `POST /api/study-groups/:id/leave`.
- `DELETE /api/study-groups/:id` (owner/admin) — removes group + notes + messages.
- `GET /api/study-groups/:id/notes` / `POST` (member) `{title, content}` / `PATCH /api/study-groups/:id/notes/:noteId` (member) / `DELETE` (author/owner).
- `GET /api/study-groups/:id/messages` / `POST` (member) `{text}` (500 chars max).
- All group routes: members-only (others 404, so existence doesn't leak).
- Teachers can create groups for a course they own; students can create course-free groups.

## Frontend
- **Study groups** (`study-groups` screen, student + teacher): my groups list (name, member count,
  course) → group detail (shared notes list + editor, group chat with live-ish refresh on open).
- Create group form (name, description, optional course). Invite code shown with copy button;
  join-by-code form.
- Add to navs (student YOUR SPACE, teacher TEACHING). Reuse existing styles. Honest label:
  "Notes are shared — last edit wins. Chat refreshes when you open the group."

## Tests (backend agent)
New `backend/studygroups.test.js`: create/join-by-code/leave; non-member 404 on notes/messages;
member notes CRUD + last-writer-wins; message cap; owner delete removes everything.
`npm test` green.
