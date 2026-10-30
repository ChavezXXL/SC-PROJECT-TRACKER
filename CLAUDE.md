# FabTrack IO — notes for every Claude session working on this repo

Several Claude sessions (desktop and cloud) work on this app. These rules keep
them from undoing each other's fixes. Read before changing anything.

## Before you edit
- Get the latest first: `git fetch origin && git merge --ff-only origin/main`.
  Other sessions merge to `main` through PRs; editing an old copy re-breaks
  what they fixed.
- Look at `git log -15` for recent fixes in the area you're touching.

## Shipping
- Work on `master`. The live site (Netlify) deploys from `main`:
  release = `git push origin master` **and** `git push origin master:main`.
- Batch deploys — at most 1–2 a day. Every deploy reloads every open screen,
  and the database is on Firebase's free plan (50k reads / 20k writes a day).
- Run tests with `npm test` only (it swaps the database for a stub).
  Never run a test file some other way — the raw config points at the live
  database.

## The owner runs the shop from a phone
- Check every screen you change at 375–430px wide.
- **Jobs list on phones is a card per job** (`max-sm:grid` on each <tr>): due
  date on top, the job at full width, then one row of action buttons (Start /
  next stage / Done / Print / ⋯). Keep the due date and the buttons visible
  without sideways scrolling. A squeezed table hid both off the right edge.
- Don't hide a control on phones (`hidden sm:flex`) without giving it a
  phone-sized home elsewhere. Burying an everyday action in the ⋯ menu
  doesn't count.
- No hover-only buttons: phones have no hover. If a control fades in with
  `opacity-0 group-hover:opacity-100`, also add `[@media(hover:none)]:opacity-100`.
- Wide tables become cards on phones (`max-sm:grid` on the `<tr>`; see the
  Jobs and Logs lists) rather than scrolling sideways.
- Printing goes through `utils/printFrame` (a hidden frame). Never
  `window.open` to print: phones block it.

## Data rules
- Due dates: one rule, in `utils/dueDates.ts`. No date math elsewhere.
- Money math: `utils/jobBudget`.
- Editors save only the fields that changed (`utils/changedFields`); never
  rewrite a whole document.
- Never put state that your own save changes (sync status, pending writes, a
  doc you write) in the dependencies of an effect that saves. That loop used
  up the whole daily write quota once.
- Never read a whole collection on a timer (client or cron).
