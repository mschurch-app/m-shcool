# Database Baseline — Supabase

## Production protection
Production Supabase is actively used. This inventory does NOT authorize schema or policy changes.

## Data sources observed in current index.html

| Source | Current observed purpose | Risk |
|---|---|---|
| users | students + staff roster, profile/contact/family/health data, points, avatar, face descriptor, role/status | CRITICAL |
| schedules | staff scheduling, shifts, hours, job description | HIGH |
| check_in_logs | student/staff check-in history | HIGH |
| points_logs | student points transaction history | MEDIUM |
| roll_calls | classroom attendance, homework/contact-book status | HIGH |
| counseling_logs | counseling/care records | CRITICAL |
| parent_messages | parent messages and staff replies | HIGH |
| storage: avatars | student/person photos used by roster/face enrollment | CRITICAL |

## Important observations
- The browser currently performs direct Supabase reads/writes.
- Multiple code paths use users.select('*').
- users is overloaded: student/staff identity plus sensitive personal/care-related fields and face_descriptor.
- Face descriptors and avatar images require special privacy/security treatment.
- Current staff login looks up a users record and persists the returned object in localStorage.
- Some UI authorization is inferred from ID patterns such as an ID containing M. This must not be treated as a security boundary.

## Do not change yet
Until schema/RLS inventory and recovery procedures are verified:
- no table deletion/rename;
- no column deletion/rename/type change;
- no production RLS modification;
- no bulk production update/delete;
- no moving face descriptors/photos;
- no forced authentication migration.

## Required next inventory
1. Obtain actual Supabase schema for all 7 tables plus avatars bucket.
2. Record columns, types, defaults, PK/FK, indexes.
3. Record RLS enabled/disabled and every policy.
4. Record triggers/functions.
5. Map every application write path.
6. Classify sensitive fields.
7. Establish backup/recovery and tested migration rollback.

## Read-only production snapshot (2026-09-29)

The following metadata was read from project `othgvewffvkkafbezejy`, which matches the Supabase URL embedded in `index.html`. No application rows were read. No SQL writes, migrations, policy changes, or Storage changes were performed.

### Referenced table schemas

All seven application tables exist in `public`. Each has a primary key and the schema inventory reported no foreign keys on these application tables. The rows below record columns and types; `?` means nullable, and defaults are shown where present.

For all seven referenced application tables, the only index reported is the unique primary-key index on `id`. No additional indexes or foreign keys were reported for them.

| Table | RLS | Columns and notable defaults |
|---|---|---|
| `users` | **Disabled** | `id text` PK, `name text`, `role_type text?` default `學生`, `gender text?`, `birth date?`, `school text?`, `grade text?`, `phone text?`, `address text?`, `guardian_name text?`, `guardian_phone text?`, `points integer?` default `0`, `status text?` default `在班`, `note text?`, `created_at timestamptz?` default `now()`, `avatar_url text?`, `id_card text?`, `class_section text?`, `home_phone text?`, `mentor_name text?`, `guardian_relation text?`, `emergency_name text?`, `emergency_relation text?`, `emergency_phone text?`, `welfare_status text?`, `siblings_count text?`, `family_economy text?`, `medical_history text?`, `dietary_restrictions text?`, `special_needs text?`, `face_descriptor jsonb?`, `parent_name text?`, `parent_relation text?`, `parent_phone text?`, `family_status text?`, `health_notes text?` |
| `schedules` | **Enabled; unsafe policies** | `id bigint` PK, `date date`, `worker_id text`, `worker_name text?`, `shift text?`, `hours numeric?` default `0`, `job_desc text?` default `課輔陪伴`, `role_type text?`, `actual_checkin timestamptz?`, `actual_checkout timestamptz?`, `hourly_wage integer?` default `190` |
| `check_in_logs` | **Disabled** | `id bigint` PK, `check_time timestamptz` default `now()`, `target_id text`, `target_name text?`, `role text?`, `action_text text?` |
| `points_logs` | **Disabled** | `id bigint` PK, `change_time timestamptz` default `now()`, `target_id text`, `target_name text?`, `points_delta integer`, `reason text?` |
| `roll_calls` | **Disabled** | `id bigint` PK, `created_at timestamptz?` default `now()`, `course_name text?` default `課後輔導`, `student_id text`, `student_name text`, `attendance_status text?` default `出席`, `homework_status text?` default `已完成`, `contact_book_signed text?` default `是`, `note text?` |
| `counseling_logs` | **Disabled** | `id bigint` PK, `created_at timestamptz?` default `now()`, `student_id text`, `student_name text`, `teacher_name text`, `duration_min integer?` default `30`, `content text`, `category text?` default `課業輔導`, `follow_up text?`, `selected_tags text?` |
| `parent_messages` | **Disabled** | `id bigint` PK, `created_at timestamptz?` default `now()`, `student_id text`, `student_name text`, `parent_message text`, `reply_content text?`, `reply_time timestamptz?` |

The app uses these columns as observed in `index.html`; this inventory is not a proposal to rename or reconcile fields. Schema metadata also revealed additional public tables outside the current app path: `students`, `staff_members`, `system_settings`, `courses`, `student_course_enrollments`, `rollcall_logs`, `counseling_records`, `elective_courses`, and `line_bindings`. Preserve and inventory them before considering any schema work.

### RLS, grants, and Storage findings

- Supabase's security advisor reports 15 public tables with RLS disabled. This includes all seven app-referenced tables other than `schedules`, plus nine additional public tables.
- For every public table returned by the advisor, `anon` and `authenticated` have `SELECT`, `INSERT`, `UPDATE`, and `DELETE` table grants. With RLS disabled, the browser's publishable key is therefore not protecting rows from anonymous Data API access.
- `schedules` has RLS enabled, but its four policies apply to `public` and use `true` for read, insert, update, and delete. This permits unrestricted operations by the public role.
- The four `schedules` policies are `Public Read Schedules`, `Public Insert Schedules`, `Public Update Schedules`, and `Public Delete Schedules`. Grants also include all table privileges for `anon` and `authenticated`.
- Storage bucket `avatars` exists and has `public = true`; its file-size and MIME restrictions are unset. `storage.objects` policies grant the `public` role read, upload, update, and delete access in that bucket. Duplicate policies overlap these operations.
- There are no application-defined public triggers or functions in the catalog snapshot. The listed triggers/functions belong to Supabase Storage internals.
- Supabase migration listing returned no migrations for this project. No repository migration files are present. Backup/recovery and schema provenance remain unverified.

**Critical:** this is a live exposure condition, not a recommended immediate RLS toggle. Enabling RLS without a complete compatibility policy set could interrupt the current system. Do not apply the advisor's generated `ENABLE ROW LEVEL SECURITY` statements. First create and validate a complete access model, backup/recovery plan, and isolated test path, then review a small rollout and rollback plan with the system owner.

### Application write paths (static source audit)

| Source | Observed writes |
|---|---|
| `users` | scan updates student points; roster upsert/delete; point buttons update points; CSV import upsert |
| `schedules` | batch insert; current list/calendar reads schedules; UI exposes edit/delete affordances, but this source snapshot contains no matching Supabase update/delete implementation |
| `check_in_logs` | student/staff scan inserts; check-in activity reads |
| `points_logs` | student scan inserts a point transaction; roster point buttons do not write this log |
| `roll_calls` | daily load and batch insert |
| `counseling_logs` | `feature/counseling-records` adds reads/inserts/updates and keeps delete visible to M-role UI only; database RLS remains disabled and does not enforce these frontend role controls |
| `parent_messages` | list and reply update |
| `avatars` Storage | browser uploads JPEG to `students/<id>_<timestamp>.jpg` with `upsert: true`, then obtains a public URL |

The form captures a face descriptor in a hidden input, but `handleUserSubmit` omits it from the `users` payload. Face matching reads `face_descriptor` from `users`, so the current UI capture/persistence path appears inconsistent and requires a separate, privacy-reviewed verification.

## First safe refactor candidate
Do NOT begin with authentication, face recognition, users schema, or attendance writes.
First create a non-behavior-changing data-access boundary on the takeover branch, beginning with a read-heavy low-risk area, with regression verification before any production merge.
