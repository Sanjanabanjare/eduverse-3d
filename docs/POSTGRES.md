# PostgreSQL migration guide

## Honest status

The runtime **still uses the local JSON store** (`backend/data/store.json`) by default.
`migrations/001_initial.sql` is the **migration target schema** — a full relational design
for the core domain (institutions → campuses → departments, academic years/semesters,
users, courses/lessons, quizzes/questions/attempts, enrollments, fees, subscriptions,
marketplace, notifications, security events).

A data-layer rewrite (replacing the JSON store's read/write paths with SQL) has **not**
been done. That is a large, careful migration: every endpoint in `backend/server.js`
currently reads/writes the in-memory `store` object. Do not point production traffic at
Postgres until that rewrite is complete and tested.

## What the schema gives you today

- A reviewed, production-shaped target to build the rewrite against.
- A place to run analytics/reporting queries against exported data.
- Proper PKs (UUID v4 via `pgcrypto`), FKs with sensible `ON DELETE` behavior, indexes
  on every foreign key, `created_at` defaults, and CHECK constraints that mirror the
  backend validators (username format, role enum, question types, etc.).

## Applying the schema

```bash
# 1. Create the database
createdb eduverse

# 2. Apply the migration
psql "$DATABASE_URL" -f migrations/001_initial.sql

# 3. Verify
psql "$DATABASE_URL" -c "\dt"
```

## Pointing the app at Postgres (after the data-layer rewrite)

```bash
DATABASE_URL=postgres://user:password@localhost:5432/eduverse npm start
```

The app reads `DATABASE_URL` from the environment. Until the rewrite lands, setting it
has **no effect** on the runtime — the JSON store remains authoritative. This is
intentional: no silent half-migrations.

## Suggested rewrite order (when you do it)

1. Read-only paths first: search, analytics, marketplace browse (low write risk).
2. Users + sessions (needs a sessions table — add `sessions` with `id`, `user_id`,
   `expires_at`; the current in-memory sessions vanish on restart).
3. Courses/lessons/enrollments, then quizzes/attempts (highest write volume).
4. Fees/payments last (money — needs transactions + idempotency keys in SQL).

## Notes

- Money is stored as integer minor units (`*_cents`) — never floats.
- `questions.bank_owner` vs `quiz_id`: a question belongs to a quiz OR to a teacher's
  bank, enforced by CHECK.
- `fee_records.payments` and `quizzes.config` are JSONB: semi-structured payloads that
  don't need relational queries today. Promote to tables if reporting needs it.
