# DEPLOY1F_CONTRACT.md — Slice 1 frontend: accessibility + demo-content cleanup

Work ONLY in `~/workspace/eduverse-fixed/`. Do not rename the app, do not change
the visual design. Frontend agent owns `app.js`, `styles.css`, `index.html`.

## Context
The Nov 1 legal/accessibility audit flagged concrete gaps in the current
frontend. Fix the real ones below; verify each by reading the code, not by
assuming.

## 1. Unlabeled inputs
- Find every input/textarea/select that has no associated `<label>` or
  `aria-label` — the audit specifically names the Nova chat input
  (`#novaInput`) — and give each an accessible name. Do NOT change the visual
  layout. If an input is intentionally visually hidden behind a visible label,
  use `aria-label` instead of restructuring the markup.

## 2. Dead placeholder links
- Find every `href="#"` in `index.html` and `app.js`. Each one must either
  point at a real target (a screen, a legal page, a real section) or be
  replaced with a `<button>` that does something. No `href="#"` may remain.

## 3. Modal focus management
- `openModal`/`closeModal` in app.js: when a modal opens, move keyboard focus
  into it (first focusable element); Escape already closes it — confirm that
  still works; when it closes, return focus to the element that opened it.
  Keep the existing behaviour otherwise.

## 4. Demo content cleanup (be honest, don't invent data)
- The profile screen's skill map shows hard-coded concepts ("Sorted arrays
  88%", "Search boundaries 48%") for every student. That is demo data.
  Fix: render the skill map from real data when the backend provides it
  (`GET /api/student/analytics` is the existing endpoint — check what it
  actually returns first), and show an honest empty state ("Complete practice
  to see your skill map") when there is no real data. Do NOT invent
  percentages.
- Check the other hard-coded bits on the profile screen the same way
  ("Joined October 4, 2026", "Curious learner · Exploring programming and
  AI", "SB" avatar initials): each must either be overwritten by
  `loadProfileData` (verify — the name already is) or replaced with the
  logged-in user's real data / an empty state. Nothing may show one fixed
  person's details to every user.
- Do NOT touch the community screen's seeded discussion content in this slice
  (that is a separate content decision).

## Verification
- `node --check app.js` clean.
- jsdom smoke: boot the app, confirm 0 load errors and that the profile screen
  renders the logged-in user's name (not the placeholder) when profile data
  loads. Reuse the harness pattern from `/tmp/sg-smoke.cjs` if it still exists,
  otherwise write a small one under `/tmp/`.
- Report: each gap, what you changed (file + line-ish), and anything you found
  that is NOT actually a gap.
