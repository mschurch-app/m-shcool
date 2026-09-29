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

## First safe refactor candidate
Do NOT begin with authentication, face recognition, users schema, or attendance writes.
First create a non-behavior-changing data-access boundary on the takeover branch, beginning with a read-heavy low-risk area, with regression verification before any production merge.
