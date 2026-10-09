# School operations — Phase 4

Production: `https://school.mchurch.online/`. Shared project: `aqanuwilmvdtlzuqlrau`, school schema `mschool`, private bucket `mschool-avatars`. The project's display name still contains `staging`; always check its ID. Legacy project `othgvewffvkkafbezejy` is a different project.

## Read-only health checks

`node operations/health.mjs` verifies twelve deployed asset hashes and three management endpoints refusing anonymous requests with HTTP 401. It performs only GET requests, needs no privileged key, and emits no response bodies or personal records. All failures return a failing exit code. The scheduled GitHub workflow runs hourly at minute 17 UTC, with a manual Actions entry. GitHub may delay scheduled runs; this is not a real-time uptime SLA.

Check the **School production health** Actions run on failure. The workflow has no LINE/email integration; GitHub notification delivery depends on repository subscriptions and account settings. Check the existing Church OS system monitor for daily school report and cron delivery status. That dashboard is authorized separately from school staff access.

When releasing frontend changes, regenerate `operations/release-manifest.json` from the exact reviewed twelve source files, record the release baseline, and release it together with the matching files. `tests/operations.test.mjs` rejects stale hashes. Do not accept drift by regenerating hashes from whatever the public server happens to return. API v18 is the recorded baseline, not a version verified by the HTTP probes.

The probes cannot verify an authenticated login, a saved operation, database consistency, real recognition accuracy, Safari, paper printing, third-party face-model availability or daily report delivery. Do not use a green workflow to claim these passed. Audit bounded backend error aggregates when investigating a specific incident; do not publish raw logs or credentials.

## Backup and recovery boundaries

The 2026-10-09 private recovery package is stored outside this public repository. It contains encrypted current school and legacy application rows, column/constraint/index/RLS/grant/function/trigger/sequence definitions and Storage metadata. The old bucket's 17 downloaded images were individually encrypted and round-trip verified. Current private media downloads and off-device custody remain outstanding. The owner's detailed report records exact counts and limitations.

`archive.mjs` provides authenticated AES-256-GCM encryption and a **local application-data drill**, using a fresh PGlite database. The drill verifies typed rows, NOT NULL, primary/unique keys, and all row hashes. It does not execute arbitrary catalog SQL. It does not recreate a working Supabase platform: defaults, sequence state, foreign/check constraints, policies, grants, triggers, functions, Church OS/Auth dependencies and Storage service are not exercised. Never point this drill at production. Never resurrect session/device credentials from an archive into a live project.

A complete disaster-recovery rehearsal still needs an isolated compatible Supabase/Postgres environment, a proper logical dump, actual private Storage files and approved provider/secret configuration. Download the backup and necessary media using authorized administrator access. Never make the private bucket public to facilitate export, put a service key in the browser, reset a production database password for convenience, or create a billable recovery project without approval.

[Supabase platform backups](https://supabase.com/docs/guides/platform/backups) exclude Storage file bytes and do not replace configuration/Edge source custody. Confirm the actual plan, latest backup status and retention in the Dashboard; these were not established by the application snapshot. Keep the encryption keys separately controlled from the archives. Two directories on one Mac are not an off-device backup. Restore to an isolated environment, verify schema, role/RLS checks, relationships, photos and API flows, and record RPO/RTO measurements before claiming disaster readiness. Daily backup automation is not configured by this change.

## Incident handling and rollback

1. Record time (Asia/Taipei), affected page/device, operation and error code. Do not copy student photos, face vectors, tokens or contact details into public issues.
2. Check the health workflow, deployment history, bounded API logs and Church OS system monitor. A 401 on the anonymous probe is expected; a user's 401 requires session investigation. HTTP 400/409 means a rejected operation, not a successful save. Diagnose before retrying.
3. Pause the affected operation locally. Do not bulk replay check-ins or reset balances. Keep request IDs when reporting retries; preserve legitimate subsequent data.
4. For this Phase 4 operations-only release, revert its commit through a reviewed PR and rerun safety checks. Application frontend, API and database behavior were not changed. Keep existing backups and the previous production source available.
5. For an earlier frontend/API incident, follow `PHASE2_RELEASE.md` recovery order. Never roll back by dropping audit/ledger tables or overwriting newer rows with old archives.

## Monday onsite acceptance (2026-10-12)

Record operator, actual device/OS/browser, expected result, actual result and time for each item. These are pending physical checks, not claims from Chrome emulation.

| Workflow | Acceptance |
| --- | --- |
| Public enrollment workstation | Manager provisions this browser; Church OS and management signed out; dedicated password unlocks only student enrollment; wrong password/rate limit, 15-minute idle lock, device disable and camera cancel behave correctly. |
| Student photo | With authorized student/guardian handling, one face; save photo and descriptor; reopen same student, verify persistence; retry must not create a duplicate. Do not enroll a fictional student in production. |
| Student attendance | One real daily arrival; repeat cannot become checkout or add another point. Barcode/QR and face route identify the correct student; unclear/multiple faces require another attempt. |
| Workstudy hours | Real first clock-in and later clock-out, immediate duplicate denied; monthly report distinguishes actual from planned hours, flags missing/reversed punches. Do not invent times or wait only a few seconds to simulate a shift. |
| Staff permissions | Existing authorized M/T/P users enter via Church OS; M manages access, T only allowed teaching tasks, P reads permitted views; disabled/unknown account denied. Teachers and workstudy must not enter enrollment-device management. |
| Daily administration | Attendance save/reload, stale revision conflict, points history, schedule preview, parent reply, care record and report loading retain real data. Retry rejected saves without duplicates. |
| iPhone / Safari / Mac | LINE/browser/login return, reopen and refresh, fixed header, three-column icons, dialogs with background scroll lock, keyboard/focus, cancellation and dirty-form preservation. |
| Print | Real Safari print preview and one authorized paper sample: correct date/student scope, no hidden controls or clipped data. |
| Notifications | Daily school report uses current project and real recipient; inspect scheduled delivery after a real operating day. Do not send a test broadcast without authorization. |

Device enforcement is currently compatibility mode (`require_device=false`, zero kiosk devices at this audit). Pair and accept the actual check-in computer before proposing strict enforcement. Phase 4 does not turn it on automatically.

## Legacy retirement gate

No legacy project deletion, pause or RLS change is included. Current readable application sources and 13 active cron commands had no runtime legacy reference; external LINE/LIFF/webhook settings, old installed shortcuts and onsite devices still require confirmation. A bounded log window without client events cannot prove all dependencies ended.

Archive missing legacy rows rather than overwrite newer production records. Complete current private media backup, platform restore, external-reference review and at least seven days including one full onsite operating cycle. Then present the exact legacy project ID, recovery evidence and deletion checklist for separate owner approval. Supabase project deletion permanently removes its managed backups too.
