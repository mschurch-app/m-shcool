# Phase 2 release candidate — 2026-10-09

## Current state and approval boundary

- Production baseline: frontend `514c1c9`, `mschool-api` v17, shared Church OS Supabase project, `mschool` schema.
- First frontend batch: draft PR #20 (`c7042ce`). This full candidate is based on that batch, on `fix/school-phase2-data-integrity-20261009`.
- No production schema, business rows, function deployment, main merge or old database deletion has been performed for this candidate.
- School `AGENTS.md` requires isolated testing, a recovery plan and approval before production schema execution. Approve the concrete release package before rollout. Prior approval of the five-file public draft did not approve this expanded database/API package.

## Inventory and additive changes

Current affected tables: `users`, `roll_calls`, `points_logs`, `check_in_logs`, `schedules`. Read-only inventory found 142 roll calls, 25 point entries and 66 schedules. Roll-call timestamps: 135 after-school entries at UTC 16:00, one at 09:00; six interaction-course entries at 14:00/22:00/23:00. Therefore no blanket date backfill is justified.

Migration: `supabase/migrations/20261009113711_school_daily_data_integrity.sql` (filename created by Supabase CLI).

- Add nullable date/audit fields and indexes to roll calls; audit/source/balance fields and index to the point ledger.
- Add private RLS-enabled day revision, idempotent-operation, kiosk device/policy/rate tables. Browser roles receive no access. New privileged functions use an empty search path and explicitly revoke PUBLIC/anon/authenticated execution.
- Preserve existing rows, timestamps, duplicates, orphan identities, point totals and plans. No old database changes.
- The legacy personnel validator becomes a private core; its existing API signature is retained behind a wrapper protecting balances. Dedicated operations revalidate the current server session.
- Kiosk enforcement starts false and the device list empty. This allows staged onsite provisioning.

## Approved rollout order

1. Recheck main and deployed API against the baseline, migration history and columns. Record schema/function definitions and aggregate counts in private release evidence. Ensure an existing database backup/recovery point is available; do not export personal records into the public repo.
2. Rerun the isolated suite and both entrypoints; review the exact diff. Obtain explicit owner approval for the schema/API/frontend release and any expanded public repository publication.
3. Apply the additive migration. If it fails, its transaction rolls back. Do not mark it applied or continue to the API on failure.
4. Verify function privileges, RLS, new columns, unchanged historical aggregates and unchanged initial enforcement. Deploy the reviewed `mschool-api` source with its existing `verify_jwt=false` setting; authorization remains inside the API and SQL.
5. Release index/index2/enrollment and the first-batch stylesheet together through the reviewed PR. Do not deploy the new frontend before the migration/API.
6. Perform read-only smoke checks: anonymous management denial, API preflight, login/session, report loading, kiosk policy. No artificial production attendance, points, plans or student enrollment.
7. Observe errors and real authorized daily operations. Record deployment version/hash and stop on unexpected differences.
8. On 10/12, pair the real public check-in browser, test camera and attendance with the owner’s onsite authorization, then consider enabling strict device enforcement. Never enable it automatically.

## Recovery without deleting data

- A failed migration transaction restores the pre-migration state automatically.
- After successful migration, prefer a forward correction. Keep all added columns/tables/ledger entries; do not drop audit history, remove new rows, reset points or undo real punches.
- If the new UI fails, restore the previous frontend while retaining the new API. Its compatibility adapter supports old point-sheet and schedule writes; legacy point edits fail closed with a refresh message. Old clients do not have optimistic revisions. This is a temporary degraded mode, not full acceptance.
- If the API itself must return to v17, restore its recorded source and the matching previous frontend together. New schema fields and data remain intact. The personnel wrapper still prevents stale point overwrites; legacy point buttons may be unavailable until the forward fix. Do not restore the old unguarded point writer just to suppress the error.
- If device enforcement blocks an accepted workstation, use the manager endpoint to restore compatibility mode. If that endpoint is unavailable, an approved operator may run `update mschool.kiosk_policy set require_device=false where id=true;`. This does not grant management permissions.
- A data issue requires a reviewed correction referencing ledger/request IDs, never a blanket delete or silent balance replacement. No destructive down migration is supplied.

## Test evidence and limits

Latest results: **126/126** full checks, **61/61** index2 frontend/static checks, four isolated Chrome scenarios passed. The final production API still matched the captured v17 baseline and the aggregate counts remained 142 roll calls / 25 point entries / 66 schedules. No release mutation was performed.

Run `npm ci --prefix tests --ignore-scripts`, then `node --test`. Repeat frontend tests with `MSCHOOL_FRONTEND_FILE=index2.html node --test tests/check-in-smoke.test.mjs`.

The PGlite suite uses synthetic schemas/personnel only, covering additive legacy preservation, stale revisions, retries, partial import outcomes, point ledger transactions, overnight overlaps, eligibility, private privileges, rate boundaries and device revocation. Browser checks intercept every business API and never write to production. Node camera tests use synthetic streams and descriptors.

These do not certify real recognition accuracy, real iPhone/Safari behavior, camera permissions on the physical public computer, concurrent transactions on the production database, production deployment or real attendance. Those remain explicit acceptance gates.

## Onsite 2026-10-12

- Pair the check-in browser; verify separate password-protected enrollment access; sign out Church OS and school management on the public machine.
- Student: one daily attendance/point; repeats never create checkout or extra points. Withdrawn/graduated student denied.
- Workstudy/staff: first clock-in, second clock-out after at least 60 seconds and observed camera absence; third denied. Retry an uncertain request without creating checkout.
- Test denied permission, late permission after cancellation, model/CDN failure, offline/retry, tab/background/exit cleanup, one vs several faces, poor light and similar faces. Record the actual device/browser and result.
- Check actual workhours against cards; incomplete and cross-day cases remain pending.
- Enable strict pairing only after these checks pass and the operator confirms the device list.
