# INSTITUTION_CONTRACT.md — Slice A: institution-ready core

Work ONLY in `~/workspace/eduverse-current/`. Do not rename the app, do not restyle existing screens.
Backend agent owns `backend/server.js` (+ new `backend/org.js` for org helpers if cleaner).
Frontend agent owns `app.js`, `styles.css`, `index.html`.

## Data model (new store collections)

- `institutions[]`: `{id, name, slug, status:'active'|'suspended', branding:{logoUrl, primaryColor, faviconUrl}, createdAt}`
- `campuses[]`: `{id, institutionId, name, city, address, createdAt}`
- `departments[]`: `{id, institutionId, campusId|null, name, headUserId|null, createdAt}`
- `academicYears[]`: `{id, institutionId, name, startsAt, endsAt, isCurrent}` — only one `isCurrent` per institution (setting one unsets others)
- `semesters[]`: `{id, academicYearId, institutionId, name, startsAt, endsAt, isCurrent}` — only one `isCurrent` per academic year
- Extend: `users[]` += `institutionId|null, campusId|null, departmentId|null`; `courses[]` += `institutionId|null, campusId|null, departmentId|null, semesterId|null`

## Roles & permissions

- New role `super_admin`. Existing `admin` keeps working and is treated as `super_admin`
  for backward compatibility (do not break existing logins).
- New creatable roles: `institution_admin`, plus existing `teacher`, `student`.
- `store.rolePermissions = { super_admin:[...all], institution_admin:[...], teacher:[...], student:[...] }`
  with permission strings like `org.manage`, `users.manage`, `courses.publish`, `fees.manage`,
  `reports.view`, `settings.manage`, `branding.manage`. `GET /api/admin/role-permissions` +
  `PATCH` (super_admin only) to edit. Enforce via `can(user, perm)` helper on the new endpoints
  (do not retrofit every old endpoint — scope to new ones).

## Org isolation

- Helper `orgScope(req)`: returns `{institutionId}` — super_admin → null (sees all),
  others → their `institutionId`. New list endpoints filter by it; 403 when accessing another
  institution's resource by id.
- **Migration:** on server startup, if `store.institutions` is empty, create
  `{name:'Default Institution', slug:'default'}` and set `institutionId` on all existing
  users/courses that lack one. Existing single-org behavior must keep working.

## Backend endpoints (all under /api/admin unless noted)

- `GET/POST /api/admin/institutions`, `PATCH/DELETE /api/admin/institutions/:id`
  (suspend instead of hard delete when it has users — set status; DELETE only when empty)
- `GET/POST /api/admin/institutions/:id/campuses`, `PATCH/DELETE /api/admin/institutions/:id/campuses/:cid`
- `GET/POST /api/admin/departments` (filter `?institutionId=`), `PATCH/DELETE /api/admin/departments/:id`
- `GET/POST /api/admin/academic-years` (filter `?institutionId=`), `PATCH` (incl. `isCurrent`), `DELETE`
- `GET/POST /api/admin/academic-years/:yid/semesters`, `PATCH/DELETE`
- `GET /api/institution/branding` (public, no auth) → `{name, logoUrl, primaryColor, faviconUrl}` of the default/current institution
- `GET/PATCH /api/admin/role-permissions`
- Validation: names 2–120 chars, slug `^[a-z0-9-]{2,40}$` unique, colors `^#[0-9a-fA-F]{6}$`,
  logoUrl/faviconUrl https or relative path, dates valid ISO with endsAt > startsAt.

## Frontend — admin screens

- **Institutions** (`admin-institutions`): table of institutions + create/edit (name, slug,
  status), per-institution tabs or sections for campuses and departments CRUD, branding
  editor (logo URL, color picker, favicon URL) with live preview.
- **Academic calendar** (`admin-calendar`): academic years list per institution, semesters
  nested under each year, "set current" buttons.
- **Roles & permissions** (`admin-roles`): matrix of roles × permissions with checkboxes,
  save via PATCH. Hide from non-super_admin.
- Add the three screens to the admin nav. Reuse existing `.screen-panel`, `.filter-select`,
  table styles. On app boot, fetch `/api/institution/branding` and apply
  `--brand` CSS var + document title + favicon (do not break when offline — fail silent).
- Course create/edit forms gain optional institution/campus/department/semester selects
  (admin only; scoped to their org).

## Tests (backend agent)

New `backend/org.test.js`: migration creates Default Institution; org isolation (institution
admin cannot list another institution's departments); isCurrent exclusivity; slug validation;
branding endpoint public; role-permissions PATCH 403 for institution_admin. `npm test` green.
