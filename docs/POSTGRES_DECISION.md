# Postgres decision — launch now, migrate later (recommendation)

## Recommendation

**Launch on the JSON store + Render persistent disk.** Don't migrate to
Postgres for the first launch.

Why: the JSON store is already built, tested (213 tests), and crash-safe
(atomic writes). With the disk, it survives deploys and restarts. For a
first launch — one school, one class, up to roughly 100 active users — it
is enough. A Postgres migration is a large rewrite of the data layer with
real regression risk right before you go live.

## When to migrate

Migrate when any of these becomes true:

- More than ~100 active users, or the store file grows past ~50 MB.
- You need a second server (Render won't run two instances on one disk).
- You need real reporting queries, or a second app reading the same data.

## What the migration involves

`migrations/001_initial.sql` is the target schema (users, courses, lessons,
quizzes, attempts, enrollments, fees, subscriptions, marketplace,
notifications, security events). `docs/POSTGRES.md` is the full guide.

The work itself is: replace the in-memory `store` object's read/write paths
in `backend/server.js` with SQL, migrate the existing `store.json` data into
Postgres once, and re-run the full test suite against a real database. That
is a multi-day job, not a config change — which is why it waits until the
launch proves the product out.

## If you want Postgres on Render anyway

Render offers managed Postgres (free tier exists, with limits). The steps
would be: create the Postgres service, run `migrations/001_initial.sql`
against it, then do the data-layer rewrite above. **Don't create the
database until the rewrite is planned** — an empty Postgres next to a live
JSON store helps nobody.
