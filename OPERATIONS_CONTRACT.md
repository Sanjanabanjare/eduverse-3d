# OPERATIONS_CONTRACT.md — Slice B: operations (fees, marketplace, workload, reports, import, analytics)

Work ONLY in `~/workspace/eduverse-current/`. Do not rename the app, do not restyle existing screens.
Backend agent owns `backend/server.js` (+ `backend/ops.js` for helpers if cleaner).
Frontend agent owns `app.js`, `styles.css`, `index.html`.
Depends on Slice A: `org.orgScope`, `org.can`, `institutionId` on users/courses.

## Data model (new store collections)

- `feeStructures[]`: `{id, institutionId, academicYearId, name, amount, currency:'INR', dueDate, grade|null, createdAt}`
- `feeRecords[]`: `{id, institutionId, studentId, feeStructureId, amountDue, amountPaid, status:'pending'|'partial'|'paid'|'overdue', dueDate, payments:[{at, amount, method, txnId}], createdAt}`
- `subscriptionPlans[]`: `{id, name, price, currency:'INR', billingCycle:'monthly'|'yearly', maxStudents, maxTeachers, features[], createdAt}`
- `institutionSubscriptions[]`: `{id, institutionId, planId, status:'active'|'cancelled'|'expired', startsAt, endsAt, createdAt}`
- `marketplaceListings[]`: `{id, courseId, institutionId, price, currency:'INR', status:'listed'|'unlisted', createdAt}` — course must be `published` and owned by the listing institution
- Extend `courses[]`: nothing (marketplace is a separate listing pointing at the course)

## Backend endpoints (all /api/admin unless noted; org-scoped via orgScope)

- Fees: `GET/POST /api/admin/fee-structures` (`?institutionId=&academicYearId=`), `PATCH/DELETE /api/admin/fee-structures/:id`
- `POST /api/admin/fee-structures/:id/assign` `{grade?|studentIds[]}` → creates feeRecords (idempotent: skip existing)
- `GET /api/admin/fee-records` (`?studentId=&status=&overdue=1`), `POST /api/admin/fee-records/:id/pay` `{amount, method}` → appends payment, updates status/amountPaid (never exceed amountDue)
- Student view: `GET /api/fees/mine` → my feeRecords with structure names
- Subscriptions: `GET/POST /api/admin/subscription-plans` (super_admin only for POST), `GET/POST /api/admin/institutions/:id/subscription` (assign plan), `PATCH` (cancel)
- Marketplace: `POST /api/admin/marketplace/listings` `{courseId, price}` (institution_admin for own courses), `DELETE /api/admin/marketplace/listings/:id`, `GET /api/marketplace/courses` (public: listed courses with institution name, price), `POST /api/marketplace/courses/:id/enroll` (student; creates enrollment + feeRecord for the price if > 0)
- Workload: `GET /api/admin/reports/teacher-workload` (`?institutionId=&semesterId=`) → per teacher: courses owned, live sessions, total students, hours (live sessions duration sum + courses×2h assumption documented)
- Enrollment reports: `GET /api/admin/reports/enrollments` (`?courseId=&semesterId=&institutionId=&format=csv`) → rows; CSV when `format=csv` (Content-Type text/csv, Content-Disposition attachment)
- Bulk import: `POST /api/admin/import/students`, `POST /api/admin/import/teachers` — body `{csv: "name,username,email,password,grade,section\n..."}`; validate each row (12+ char password, unique username/email); return `{created, skipped:[{row, error}]}`; teachers created as pending (require approval); all scoped to the admin's institution
- Usage analytics: `GET /api/admin/analytics/usage` (`?days=30`) → `{logins, activeUsers, enrollments, quizAttempts, liveSessions, novaCalls}` counted from existing stores (loginAudit if present else sessions, enrollments, quizAttempts, liveSessions, novaAttempts map size)

## Permissions

- New perms: `fees.manage`, `marketplace.manage`, `reports.view`, `import.manage`. Add to default matrix: super_admin all; institution_admin all four; teacher `reports.view` (own); student none.
- Marketplace enroll: any student; listing create: `marketplace.manage`.

## Frontend — admin screens

- **Fees** (`admin-fees`): fee structures table + create form (name, amount, due date, grade), "assign to grade/students" action, fee records table with filters (status, overdue), "record payment" per row, student "My fees" view in student portal showing dues + pay history.
- **Subscriptions** (`admin-subscriptions`, super_admin sees plans + all subscriptions; institution_admin sees own): plans table + create, institution subscription assign/cancel.
- **Marketplace** (`admin-marketplace`): my listings + "list a course" (course picker + price); public **Marketplace** screen (all roles) browsing listed courses with institution + price, enroll button.
- **Reports** (`admin-reports`): tabs for teacher workload table and enrollment report (filters + "Export CSV" download link).
- **Import** (`admin-import`): two paste/file-upload forms (students, teachers) with column help text, result summary (created count + per-row errors).
- **Analytics** (`admin-analytics`): usage cards (logins, active users, enrollments, attempts, sessions, Nova calls) for the last 30 days + simple bar visualization (divs, no chart lib).
- Add all to admin nav. Reuse existing styles.

## Tests (backend agent)

New `backend/ops.test.js`: fee assign idempotency; payment cannot exceed due; overdue detection; marketplace enroll creates enrollment; workload aggregates; CSV export content-type; bulk import row validation; analytics counts. `npm test` green.
