# M+ School takeover — Phase 1 audit

Date: 2026-09-29
Branch: `codex-takeover`
Scope: repository history/source review and read-only Supabase metadata inventory.

## Production impact check

The audit did not edit or deploy `index.html`, contact application tables for row data, or issue SQL writes. Production database checks were limited to schema/catalog metadata, grants, policy definitions, migration listing, project health/version metadata, backup listing, and the `avatars` bucket settings. There were no schema, policy, Storage, restore, or data mutations. Repository changes are documentation, an offline test harness, and a GitHub Actions workflow; they do not affect the deployed site or database.

The Supabase metadata did expose a critical live security condition: 15 public tables have RLS disabled, public roles have full table grants on those tables, `schedules` policies permit all operations for `public`, and the `avatars` bucket is public with public read/upload/update/delete policies. This audit records the condition but does not change it. Toggling RLS without a compatible policy set could break the live workflows and is expressly outside this Phase 1 change.

## Repository and history

- Repository: `https://github.com/mschurch-app/m-shcool`
- The requested branch exists and is checked out locally as `codex-takeover`.
- `codex-takeover` is based on `origin/main` at `87de63c` and adds the takeover rules and three baseline documents; no runtime files differ from `origin/main`.
- Since the baseline, history is dominated by direct edits to `index.html` (many same-day edits; recent diffs include hundreds to over a thousand changed lines per commit). Before this takeover work there was no automated test suite, package manifest, CI workflow, or database migration history in the repository. This Phase 1 audit adds offline Node tests and a CI workflow on the takeover branch.
- `index.html` is 1,923 lines / 144,384 bytes. Tracked `index2.html` is byte-identical. It is unclear which copy the production hosting configuration serves; verify that before changing either.
- External runtime assets load Tailwind, Supabase JS v2, QR scanning, face recognition, icons/fonts, and confetti from CDNs.
- GitHub Pages settings confirm `https://mschurch-app.github.io/m-shcool/` is live and serves the `main` branch root over HTTPS, with no custom domain. The current Pages deployment is successful at commit `87de63c` (Actions run #72, Sep 29, 2026, 9:19–9:20 PM GMT+8); run #71 at `9dec373` also completed successfully at 9:16 PM. Deployment history shows 72 published revisions.
- The source branch has no repository-defined CI/test workflow, custom deploy workflow, CNAME, package manifest, or build configuration. GitHub's built-in `pages-build-deployment` workflow automatically publishes changes to the `main` root. GitHub settings show no classic branch protection rules and no rulesets, so direct pushes and force pushes to `main` are not blocked by repository configuration. Pages and branch settings were inspected read-only: [Pages](https://github.com/mschurch-app/m-shcool/settings/pages), [branch protection](https://github.com/mschurch-app/m-shcool/settings/branches), [rulesets](https://github.com/mschurch-app/m-shcool/settings/rules), and [deployment history](https://github.com/mschurch-app/m-shcool/deployments?environment=github-pages).
- A safe code rollback is possible by reverting the offending commit on a rollback branch, reviewing it, then merging it to `main`; the merge should trigger another Pages deployment. This is a proposed procedure from the observed deployment model, not a tested recovery. Supabase data/schema recovery is separate and remains unverified.

## Functional and data access inventory

| Area | Current behavior from source | Risk / audit note |
|---|---|---|
| Supabase data layer | One browser client uses the publishable key; direct `.from(...).select('*')` and writes are interwoven with UI functions. `users` is loaded in several unrelated flows. | No application data-access boundary; broad `users.*` reads expose fields to every caller allowed by current database policy. |
| Login / permissions | Login queries `users` by ID or name. Password is required in the form but is not read by the handler. The entire returned row is persisted in `localStorage`. Most tabs check only whether any row is stored; print/import gates inspect whether the ID contains `M`. | Client-side state/ID pattern is not authentication or server-side authorization. Current permissive Supabase grants make this especially urgent. No abrupt auth replacement in Phase 1. |
| People / student PII | Roster reads all `users`; includes IDs, names, guardian contact, family and health notes. Edit payload writes ID card, address, guardian data, family/health notes, points, avatar URL. CSV import upserts these fields. A report prints ID card, DOB, address, contact and family/health notes. | Highly sensitive child/family data is broadly fetched and rendered. Review access and export paths before any UI change. |
| Face data / avatars | Face matcher loads all users and descriptors. Camera captures a face descriptor into a hidden input, but roster save omits that field; matching later reads it from `users`. JPEGs upload to public `avatars` storage and public URLs are saved. | Biometric template/photo exposure is critical; enrollment path appears internally inconsistent. No face data moves or production storage changes in Phase 1. |
| Check-in | QR and face paths look up `users`, read same-day `check_in_logs`, and insert student/staff logs. Student scans also update `users.points` and insert `points_logs`; staff scans toggle in/out text based on log count. | A multi-write workflow lacks transaction/atomicity handling. Face recognition uses a 0.48 distance threshold. Test/rework only in isolation. |
| Scheduling | Reads full roster and schedules; creates batches of schedule rows. Renders worker hours and monthly work-hour report. UI has edit/delete affordances but no schedule update/delete database implementation is present in this snapshot. | `schedules` is the only referenced business table with RLS enabled, but its policies are unrestricted. |
| Roll call | Reads roster and `roll_calls`, builds a daily sheet, inserts the full class roster with attendance, homework, contact-book status and notes. | Duplicate saves are possible; no upsert/idempotency handling was seen. Notes can carry sensitive information. |
| Counseling | Reads full `counseling_logs`; delete operation is present. Add form currently reports success and reloads without inserting a row. | Care records are sensitive; actual schema currently has RLS disabled. Confirm UI/DB behavior with owner before changing. |
| Parent messages | Reads all `parent_messages`; reply updates `reply_content`. | Parent/child communications are readable via an RLS-disabled table and write permissions are broad. |
| Reports/import | Reports query roster, check-in and schedules. CSV path maps and upserts users. | Export/import can move large sets of sensitive data; retain manual confirmation and isolate tests. |

### Current front-end access gates and decisions still needed

| Current gate | Code behavior | What must be decided before a secure replacement |
|---|---|---|
| Public check-in | Check-in tab is available without a staff login and accepts a typed/QR code or face match. | Confirm the intended public-device use, abuse controls, and which minimum fields the anonymous check-in path may access/write. |
| General tabs | Schedules, roll call, people, counseling, and parent messages require only a truthy `currentUser`; the value is restored from editable browser `localStorage`. | Define named roles and view/edit/delete rights by domain, including who can see health/family and care records. |
| Print and import | UI checks `currentUser.id.includes('M')`. | Define explicit report/export and bulk-import permissions; avoid inferring authority from identifier format. |
| Data API | The browser key is publishable; live grants/policies currently allow anonymous CRUD across app data as documented in `DATABASE.md`. | Choose an authenticated identity source and compatible RLS policy model before a staged migration. |

The access matrix cannot safely be inferred from current ID formats. Owner decisions are needed for staff, teachers, part-time workers, counselors, report/export users, and the shared check-in device. The access model must be validated against ordinary daily flows before any policy change.

The exact referenced business table set and current schema/policy snapshot are recorded in `DATABASE.md`.

## Phase 1 execution checklist

1. **Done — establish safe branch and read governing documents.** `codex-takeover` checked out; `AGENTS.md`, `README.md`, `ARCHITECTURE.md`, `DATABASE.md` and Git history reviewed.
2. **Done — static feature/auth/privacy audit.** Findings above; no runtime changes made.
3. **Done — read-only Supabase metadata inventory.** Actual schemas, RLS flags, policy rules, grants, Storage settings, migrations and catalog triggers/functions documented in `DATABASE.md`. No row data read or writes performed.
4. **Done — offline safety and behavior baseline.** Node built-in tests check documented Supabase tables/Storage and exercise six check-in cases using an in-memory Supabase mock. The harness extracts the app's inline script and injects the mock client; it does not load CDN code, install dependencies, or contact any Supabase project.
5. **Done — identify production hosting and draft the code rollback route.** GitHub Pages publishes `main`/`/`; latest known-good source is `87de63c`, with `9dec373` as the immediately preceding successful deployment. See the proposed runbook below. Runbook has not been exercised; Supabase rollback remains unknown.
6. **Done — document the safe test and synthetic-data plan.** See `TESTING.md`. Offline check-in behavior tests are in place; browser-level tests still need controlled stubs for face/QR/camera and a verified external-request block.
7. **Done — add and run CI on the takeover branch.** `.github/workflows/phase1-checks.yml` uses read-only repository permissions, pinned GitHub-maintained action SHAs, Node 20, and `node --test`. GitHub Actions run [#1](https://github.com/mschurch-app/m-shcool/actions/runs/36589537929) succeeded on commit `45063aa`. A push to `codex-takeover` does not trigger Pages deployment. Its `pull_request` trigger targets `main`, but GitHub will only run that trigger after the workflow file exists on the default branch.
8. **In progress — map authorization requirements and backup/recovery process.** Read-only dashboard inspection found an active/healthy project, seven visible daily physical backups dated Sep 22–28, 2026 (UTC), and no enabled PITR add-on. The dashboard and official backup guide say Storage objects are excluded from database backups, and restoring a project makes it inaccessible during the restore. See `ACCESS_RECOVERY.md`. Owner decisions, an independent Storage backup, and a non-production restore rehearsal are still outstanding. Do not enable RLS until policies preserve all current workflows and a staged rollback is tested.
9. **Next — choose a low-risk read boundary.** Only after steps 7–8 and regression checks, propose one read-heavy extraction on a focused feature branch; no auth, biometric, roster-schema, attendance-write, or production policy migration first.

## Proposed code rollback runbook

1. From the GitHub Pages deployment history, identify the failed deployment commit and the last known-good published commit. The current snapshot confirms `87de63c` and prior successful `9dec373` as examples, not a permanent rollback target.
2. Create a focused rollback branch from the current `main` and use `git revert <bad-commit>` for the specific faulty code commit(s). Preserve later unrelated changes and avoid reset/force-push.
3. Review the revert diff and run Phase 1 checks before opening a pull request to `main`. Current repository settings do not enforce pull requests or CI; a human review step must be arranged until protection is configured.
4. After an approved merge, verify the new `pages-build-deployment` run succeeds, confirm the public URL serves the intended commit, and smoke-check critical workflows.
5. Treat Supabase schema/policy/data rollback as a separate operation. A Git revert does not restore database state; the current project has no recorded Supabase migrations and no verified backup/restore procedure.

## Phase 1 guardrails

- No edits to `index.html`/`index2.html`, application data, schema, RLS, Storage policies, or production deployment in this audit.
- Keep further Phase 1 work on `codex-takeover` or a focused child branch; never develop directly on `main`.
- Keep checks offline and synthetic unless an explicitly read-only production metadata check is necessary.
- Stop before any live policy/schema/auth/storage/data change. Those require a complete compatibility and rollback plan and a separate owner-reviewed production action.

## Offline test

Run from the repository root with Node.js 20 or later:

```sh
node --test
```

The suite parses source text only. It does not load the app or initialize the Supabase client.
