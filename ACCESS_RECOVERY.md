# Access and recovery decisions — Phase 1

Date: 2026-09-29
Branch: `codex-takeover`

This document records the observed access model and the read-only recovery inventory. It proposes no production policy, schema, billing, or application changes. The role model and recovery targets remain owner decisions.

## Current access behavior from the app

| Area | Observed behavior | Required owner decision before redesign |
|---|---|---|
| Public check-in | The check-in view is available without staff login; code and face paths read users and check-in history, then write attendance (and student points). | Which shared devices and users may check in? What fields and writes are essential for the anonymous path? What abuse and duplicate controls are required? |
| General administration | Any `currentUser` value unlocks schedules, roll call, roster, counseling, and parent messages. It is restored from editable browser `localStorage`. | Which named roles may view, create, update, and delete each area? |
| Roster and child/family data | The browser loads broad `users` rows, including contacts, address, family/health notes, and face descriptor fields. | Separate ordinary roster access from health/family and biometric access. Which staff need each field? |
| Counseling records | Counseling rows can be read and deleted by the app; the add form currently does not insert. | Who may see, add, correct, export, and delete a care record? What is the retention and correction process? |
| Parent messages | The app reads parent messages and updates reply content. | Who may read each conversation and author replies? Should access be scoped to assigned students? |
| Reports and CSV import | Print and import UI gates check whether the current ID contains `M`. | Name the authorized roles for each report/export and bulk import; define an approval or audit trail for exports/imports. |
| Staff and schedule | UI recognizes ID prefixes `M`, `T`, and `P`, and role labels include `同工`, `老師`, and `工讀生`. | Confirm the full staff roster/role vocabulary, including volunteers, counselors, and former staff; define schedule and payroll access. |

The profile form exposes `學生`, `同工`, `老師`, and `工讀生`. Code also infers staff from IDs containing `M`, `T`, or `P`. These are observed values and heuristics, not an approved authorization model. Do not use client-side role labels or ID patterns as a security boundary.

Before implementing auth/RLS, the owner should approve an explicit matrix covering at least: check-in device, student roster, sensitive health/family fields, face data and photos, scheduling/payroll, roll call, counseling, parent messages, reports/exports, imports, and account administration. Each role needs a separate view/create/update/delete/export decision, with a named owner for access reviews and offboarding.

## Read-only recovery snapshot

The Supabase dashboard was inspected without opening any restore action or changing settings:

- Project `mschool` (`othgvewffvkkafbezejy`) showed `ACTIVE_HEALTHY`, PostgreSQL `17.6.1.166`, and a PRO plan label in the dashboard.
- The scheduled backup page showed seven daily physical backup entries dated Sep 22–28, 2026 (UTC). The newest displayed entry was `2026-09-28 17:23:57 +0000`; the oldest was `2026-09-22 17:23:59 +0000`. This is a point-in-time dashboard snapshot, not a guarantee that future backups will succeed or remain available.
- The Point in Time page showed an “Enable the add-on” prompt. PITR was therefore not enabled at inspection time. Do not enable it until the owner reviews cost and retention needs.
- Supabase database backups do **not** include Storage object bytes. The `avatars` bucket needs an independently verified export/backup and restore method.
- The project has no Supabase development branches. No isolated database was available, and no branch or project was created for rehearsal.

Supabase documents that Pro daily backups retain the last seven days, that a project restore makes the project inaccessible during the restore, and that Storage objects are excluded. See [Database Backups](https://supabase.com/docs/guides/platform/backups). Production restore has not been tested and must not be used as a rehearsal.

## Recovery plan to approve and test

1. Set acceptable recovery point objective (RPO: maximum data loss) and recovery time objective (RTO: maximum service interruption) for attendance, roll call, points, schedules, counseling, parent messages, and avatars.
2. Name the incident lead and approver who can authorize a production restore; record how staff will be notified and how daily operations continue during an outage.
3. Verify scheduled database backups continue appearing and choose an off-site retention strategy. Assess PITR only after cost, retention, and operational ownership are approved.
4. Define a separate `avatars` Storage backup, including private access to the archive, object/key mapping, integrity checks, and a restore test. A database restore alone cannot recover deleted photos.
5. Rehearse restoration into a separate non-production project using synthetic data. Measure restore duration and verify schema, counts, policies, Auth behavior, and Storage recovery without pointing the app at production.
6. Write a production restore runbook that identifies the incident window and restore point, expected downtime/data loss, post-restore integrity checks, and rollback/forward recovery. Only an owner-approved incident should invoke the dashboard’s restore action.

Until these decisions and a rehearsal are complete, database recovery time, effective RPO, Storage recoverability, and production rollback remain unverified.
