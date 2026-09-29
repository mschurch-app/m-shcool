# Access and recovery decisions — Phase 1

Date: 2026-09-30
Branch: `codex-takeover`

This document records the owner-provided broad role matrix, RPO/RTO targets, observed access model, and read-only recovery inventory. The matrix is an accepted target for design; identity mapping and operational boundaries remain to be specified. It proposes no production policy, schema, billing, or application changes.

## Owner-provided access target (2026-09-30)

The owner specified `M = full access`, `T = read/create/update, no delete`, and `P = read`. The table below records that across the app's data domains; no per-domain exceptions were provided.

| Data domain | M | T | P |
|---|---|---|---|
| `users` roster and profile fields | Read / create / update / delete | Read / create / update | Read |
| Schedules and work-hour/pay fields | Read / create / update / delete | Read / create / update | Read |
| Check-in and points logs | Read / create / update / delete | Read / create / update | Read |
| Classroom roll-call records | Read / create / update / delete | Read / create / update | Read |
| Counseling and care records | Read / create / update / delete | Read / create / update | Read |
| Parent messages and replies | Read / create / update / delete | Read / create / update | Read |
| `avatars` Storage objects | Read / upload / update / delete | Read / upload / update | Read |
| CSV import | Allowed | Create/update only | Not allowed |
| Reports | All operations | Read | Read |

For implementation, “read across all domains” includes the current schema's sensitive fields (family/health notes and face descriptors in `users`, work/pay fields in `schedules`, counseling notes, parent messages, and avatar photos). This follows the broad role rule as given. The app's print/report feature is treated as read access under the supplied matrix; owner confirmation is still needed on whether printing/downloading roster PII should require a distinct export permission. “Other” is currently unspecified; until named, it receives no administrative role in the design. The public check-in kiosk is a separate unauthenticated operational path and is not an admin role.

This matrix is a target for server-enforced authorization, not a claim that today's frontend gates provide it. It does not settle staff identity provisioning, student/parent login, or the kiosk's minimal server-side read/write boundary.

## Current access behavior from the app

| Area | Observed behavior | Implementation note / remaining decision |
|---|---|---|
| Public check-in | The check-in view is available without staff login; code and face paths read users and check-in history, then write attendance (and student points). | Preserve the operational kiosk as a separate server-enforced path. Its minimum fields, write limits, device trust, and abuse controls still need design. |
| General administration | Any `currentUser` value unlocks schedules, roll call, roster, and parent messages. Counseling now has M/T/P-specific UI controls on `codex-takeover`. The session is restored from editable browser `localStorage`. | These are frontend affordances only. Apply the owner's M/T/P matrix only after each staff identity maps to a trusted Supabase Auth identity and roles are server-enforced. |
| Roster and child/family data | The browser loads broad `users` rows, including contacts, address, family/health notes, and face descriptor fields. | The supplied matrix grants T and P read access across domains, including these fields. No field-level exception was specified. |
| Counseling records | The `feature/counseling-records` branch now reads, creates, updates, filters, summarizes, and renders `counseling_logs`; only M has a delete control and T/P are read-only in the UI. | Matrix target: M full access, T read/create/update, P read. This is not server-side authorization: RLS remains disabled, so do not deploy these controls as a security boundary. |
| Parent messages | The app reads parent messages and updates reply content. | Matrix target: M full access, T read/create/update, P read. Add row ownership/assignment constraints only if confirmed as an exception. |
| Reports and CSV import | Print and import UI gates check whether the current ID contains `M`. | Matrix target: M all; T read and create/update import; P read. Confirm whether roster PII print/download follows read access or needs a separate export permission. |
| Staff and schedule | UI recognizes ID prefixes `M`, `T`, and `P`, and role labels include `同工`, `老師`, and `工讀生`. | Matrix target: M full access, T read/create/update, P read. Identity mapping and staff offboarding remain open; do not use ID prefixes for authorization. |

The profile form exposes `學生`, `同工`, `老師`, and `工讀生`. Code also infers staff from IDs containing `M`, `T`, or `P`. These are observed values and heuristics, not an approved authorization model. Do not use client-side role labels or ID patterns as a security boundary.

Before implementing auth/RLS, map the approved M/T/P matrix to Supabase Auth identities, define the anonymous kiosk boundary, and confirm the separate export/print decision. Name owners for account provisioning, periodic access review, and staff offboarding. Enforce roles using trusted server-side identity and database policies; do not trust `localStorage`, ID prefixes, or user-editable metadata. Keep only a publishable key in browser code. PostgreSQL RLS controls rows, not individual columns; if a field exception is later required, use a tested narrow view or server endpoint. `UPDATE` policies need compatible `SELECT`, `USING`, and `WITH CHECK` rules. The current `avatars` bucket is public, so public URL reads bypass read policies; changing it to private requires a staged URL/download compatibility plan. The unauthenticated kiosk must not inherit broad table access: design a minimal server-side boundary for its required lookup and writes before changing any grants or RLS.

## Owner-provided recovery targets (2026-09-30)

- **RPO = 24 hours:** recover to a point no more than 24 hours before the incident; accepted writes inside that window may be lost.
- **RTO = 4 hours:** restore the core service within four hours.

The daily database backups may be sufficient for the 24-hour RPO target, but the available evidence does not yet verify the maximum backup interval or a successful restore:

- The live project showed daily physical backup snapshots and no verified alternative recovery path, so an incident between snapshots could lose close to a day's writes. The observed backup dates alone do not prove that every interval stays within 24 hours.
- PITR was not enabled. Supabase's current documentation describes a default two-minute WAL backup interval and a worst-case PITR RPO of two minutes. PITR would provide a much tighter database recovery point than the 24-hour target, but its documented two-minute worst case is not zero loss. PITR is a paid add-on and requires at least a Small compute add-on; no billing change has been made.
- The documented restore process makes the project inaccessible during restoration. Duration depends on database size, which has not been measured in a non-production restore. Four-hour RTO is therefore a target, not a verified capability.
- Database backups exclude Storage object bytes, and no separate `avatars` backup/restore process is verified. Full-system RPO/RTO cannot be claimed until this is covered too.

Apply the 24-hour RPO target to check-in, points, roll-call, schedules, counseling, parent messages, and Storage writes. Database backups exclude Storage object bytes, so the overall target cannot be claimed until avatar recovery is covered too. Do not describe RPO 24 hours or RTO 4 hours as met until a supported recovery path is approved and a timed rehearsal verifies both.

## Read-only recovery snapshot

The Supabase dashboard was inspected without opening any restore action or changing settings:

- Project `mschool` (`othgvewffvkkafbezejy`) showed `ACTIVE_HEALTHY`, PostgreSQL `17.6.1.166`, and a PRO plan label in the dashboard.
- The scheduled backup page showed seven daily physical backup entries dated Sep 22–28, 2026 (UTC). The newest displayed entry was `2026-09-28 17:23:57 +0000`; the oldest was `2026-09-22 17:23:59 +0000`. This is a point-in-time dashboard snapshot, not a guarantee that future backups will succeed or remain available.
- The Point in Time page showed an “Enable the add-on” prompt. PITR was therefore not enabled at inspection time. It is not required solely to meet a 24-hour database RPO if daily backups are verified, but may reduce data loss further. Do not enable it until the owner reviews cost and retention needs. It is not required solely to meet a 24-hour database RPO if daily backups are verified, but may reduce data loss further. Do not enable it until the owner reviews cost and retention needs.
- Supabase database backups do **not** include Storage object bytes. The `avatars` bucket needs an independently verified export/backup and restore method.
- The project has no Supabase development branches. No isolated database was available, and no branch or project was created for rehearsal.

Supabase documents that Pro daily backups retain the last seven days, that a project restore makes the project inaccessible during the restore, and that Storage objects are excluded. See [Database Backups](https://supabase.com/docs/guides/platform/backups). Production restore has not been tested and must not be used as a rehearsal.

## Recovery plan to approve and test

1. Translate the accepted targets (RPO 24 hours / RTO 4 hours) into failure scenarios and acceptance checks for attendance, roll call, points, schedules, counseling, parent messages, and avatars. Daily backups may meet the database portion of RPO 24 hours, but the maximum interval, restore result, avatar recovery, and RTO 4 hours have not been verified.
2. Name the incident lead and approver who can authorize a production restore; record how staff will be notified and how daily operations continue during an outage.
3. Verify scheduled database backups continue appearing and choose an off-site retention strategy. Evaluate PITR as a tighter recovery point if needed. Review add-on and compute costs before any billing change.
4. Define a separate `avatars` Storage backup, including private access to the archive, object/key mapping, integrity checks, and a restore test. A database restore alone cannot recover deleted photos.
5. Rehearse restoration into a separate non-production project using synthetic data. Measure restore duration and verify schema, counts, policies, Auth behavior, and Storage recovery without pointing the app at production.
6. Write a production restore runbook that identifies the incident window and restore point, expected downtime/data loss, post-restore integrity checks, and rollback/forward recovery. Only an owner-approved incident should invoke the dashboard’s restore action.

Supabase currently has no development branches for this project. Its documented database branching creates a data-less environment, which can validate schema/policy migrations after a baseline is available but cannot measure restoration time for production-sized data. A branch must not be created until its cost is reviewed and approved; it will not contain production data by default. Restoring a backup to a new project would copy production database and Auth data and add a separately billed project; it must not be used with student data without an explicit privacy, cost, and access plan.

Until the recovery architecture and a privacy-safe, production-representative rehearsal are approved and complete, database recovery time, effective RPO, Storage recoverability, and the four-hour RTO remain unverified. The database portion of the RPO 24-hour target may be met by daily backups, but is unverified; the full-system target remains unverified because Storage recovery is not covered. RTO 4 hours is also unverified.
