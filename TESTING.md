# Phase 1 test plan

## Safety boundary

- Use an in-memory Supabase client mock or an isolated test project with synthetic-only data. Never point test code at `othgvewffvkkafbezejy`.
- Add a network guard that rejects every request to `*.supabase.co`; assert the test run makes zero requests to the production host.
- Keep fixtures in memory or under `tests/fixtures/`. Do not import them to any connected database.
- Use generated placeholder images only. Do not use student or staff photographs, face templates, names, contact details, or notes.
- `node --test` includes an in-memory app harness for check-in/login/role-gate behavior and static source validation. The harness injects an in-memory Supabase client, rejects `fetch` and `XMLHttpRequest`, and does not load CDNs or connect to Supabase.

## Synthetic records for future mocked UI tests

Create in-memory records with IDs `S-QA-001` and `M-QA-001`, names `Synthetic Student` and `Synthetic Staff`, generic phone/address values, and no real dates or human data. Use an all-zero 128-number descriptor only if a mocked face-matcher test requires the shape. Keep mocked files as generated colored placeholders and do not upload them.

## Workflow matrix

| Area | Cases | Current baseline / expected evidence |
|---|---|---|
| Startup and navigation | Initial check-in view; stop QR/face streams when navigating away; logged-out tab gate | Local fixture only; assert mocked backend calls and media APIs stay local/stubbed. |
| Login and role gates | Unknown ID; synthetic student; synthetic staff; print/import gate; reload/logout | Current offline checks confirm login accepts an arbitrary password value, stores the full returned profile, any current user can open general tabs, and ID substring `M` drives privileged nav. Logout removes the local profile. New auth work must replace these with explicit, server-enforced rules on a separate plan. |
| People / PII | Roster filters, details, edit payload, CSV preview/import mapping, report rendering | Assert exact mock payloads. Use fake contact/health fields. Never render a production export in test artifacts. |
| Face and avatar | Camera permission denied; no face; successful mocked enrollment; matcher load; upload URL | Current descriptor capture is omitted from roster save payload. Mock upload and face APIs; assert there are no real camera or Supabase Storage requests. |
| Check-in | Unknown code; first and duplicate student scan; staff first/second scan; recent duplicate staff scan; write failure at each step | Current mock smoke tests cover unknown code, first/duplicate student scan, staff first scan, staff cooldown, and checkout after cooldown. Extend with error handling and partial-write cases. Verify exact `users`, `points_logs`, and `check_in_logs` writes. Do not attempt real rows. |
| Scheduling | Monthly view, worker filter, multi-date batch, overnight shift calculation, missing staff | Verify generated payloads and totals against mock data; edit/delete affordances currently have no matching database write path. |
| Roll call | Load a date, change status/note, save twice, failed insert | Assert the exact batch payload and characterize duplicate-save behavior. |
| Counseling | Load records, submit add form, delete record | Current submit handler only displays success and reloads; assert no insert until product behavior is explicitly scoped. |
| Parent messages | Load parent text, empty reply, save reply, reply failure | Verify mock update payload. Current handler updates `reply_content` only. |
| Reports | Attendance/month work-hour/roster reports, empty result, month boundary | Use fake records only; assert output totals, date ranges, and included columns without printing or exporting real PII. |

## Rollout gate for behavior tests

The current Node VM harness extracts the inline app script and injects a mock `createClient`, so no Supabase or CDN library executes. It blocks `fetch` and `XMLHttpRequest`, and characterizes six check-in cases and four login/role-gate cases with synthetic values. Before a browser smoke suite runs, add a deterministic local harness that replaces face/QR/camera dependencies with controlled stubs and blocks external requests. Review the harness to ensure the app's live Supabase URL cannot receive a request even if the mock is misconfigured. Run the suite on `codex-takeover` and any focused feature branch before considering merge. No application extraction or production deployment is part of this test-plan change.

## CI

The workflow in `.github/workflows/phase1-checks.yml` runs the same tests on pushes to `codex-takeover`, `feature/**`, and `fix/**`. It also declares a pull request trigger for `main`; GitHub only runs that trigger once the workflow exists on the default branch. Since `main` is the production branch and this takeover has not been merged there, only the push trigger is currently available. It requests only `contents: read`, pins the two GitHub-maintained actions to commit SHAs, and installs no application dependencies. The first remote run succeeded on `codex-takeover` ([run #1](https://github.com/mschurch-app/m-shcool/actions/runs/36589537929), commit `45063aa`).
