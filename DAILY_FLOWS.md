# Daily attendance and data flows — Phase 2

This branch includes the earlier frontend batch and the additive daily-data migration. It is a release candidate; deployment requires the owner’s approval. Production data is not a test fixture. Physical acceptance is scheduled for **2026-10-12**.

## Attendance dates and concurrent editing

- New point sheets use an explicit `class_date`. `recorded_at` records the actual creation time; updates record `updated_at` and the staff ID.
- Existing records have mixed timestamp conventions. No historical backfill, date shift, duplicate removal or orphan deletion occurs. Reads retain the previous UTC-date interpretation. Nonstandard legacy hours are flagged for manual review in monthly reports.
- For cached clients and existing integrations, new rows also retain the legacy `created_at = selected-day T16:00Z` encoding. It is not the real recording time.
- The daily read returns the current revision. Saves lock the day/course, validate students and choices, and reject stale revisions. The page preserves the unsaved draft and offers an explicit reload confirmation.
- The highest bigint ID per student/day is edited; earlier duplicates remain untouched. IDs in the new read API are strings to preserve bigint precision. Monthly reports preserve all historical courses.
- Request UUIDs make retrying an uncertain save safe. After a failed reload, saving is blocked until the selected day is loaded successfully.
- Cached REST clients are translated into the same atomic save. They lack revision checks; refreshing to the current frontend is required for stale-edit protection. Mixed-day writes and deletes are rejected.

## Points

- Adjustments require a reason and M/T authorization. SQL locks the student balance and writes the balance plus ledger entry in the same transaction. Negative balances and overflow are rejected.
- A retried operation UUID returns its original result. Ordinary profile edits omit points; cached profiles cannot overwrite a changed balance. Initial points on a newly created person get an opening entry.
- Student arrival still adds exactly one point/day and records its source and balance. No opening balances or actors are fabricated for historical ledger entries.
- The roster shows point history, increase and decrease on mobile and desktop. P has history/read only; M/T can adjust; deletion stays M only. History returns at most 100 recent entries.

## Imports

1. Parse CSV/TSV, map exact headers, then preview with fresh personnel data. Up to 1,000 source rows; quotes, separators and newlines are preserved.
2. Reject invalid identities, duplicate source IDs, dates and balances. Blank/unmapped fields and existing balances are preserved.
3. Send chunks of at most 100 rows. Each changed field includes its preview value; SQL locks the person and refuses a stale preview. New IDs never overwrite existing people.
4. Each row has an isolated success/failure outcome. Successful chunks are retained in the page; uncertain chunks retry the same UUID. Source input remains available. A new preview compares already applied changes again.
5. The server records minimal per-row outcomes, counts, staff ID, request ID and payload hash. It does not duplicate the source CSV or full personal records. Managers can view the latest 20 chunks in import history.

## Scheduling and reporting

- Initial calendar, batch month and report month use the current Taipei month. Changing views preserves the selected month.
- Only active M/T/P personnel can be scheduled; IDs do not imply a role.
- A read-only preview checks existing, batch and adjacent-day conflicts. Overnight shifts extend into the next day; touching endpoints are allowed. Unparseable nearby legacy shifts require review.
- Commit rechecks under a transaction lock. A conflicting batch writes nothing. M/T may create/edit; only M deletes; P reads. Actual punch fields cannot be edited through this workflow. Hours and personnel names are calculated on the server.
- Stored roster, log, schedule and report text is escaped. Roster avatars accept HTTPS only. Loading errors show retry and do not appear as zero activity.
- Actual workhours remain separate from planned payroll amounts; missing/invalid/cross-day cards stay pending review.

## Cameras and public devices

- Student check-in eligibility is limited to active students. Graduated/withdrawn students, departed staff and unknown roles cannot match or punch.
- Match distance stays **0.25**. A distance is not displayed as a probability. Model assets are pinned to **face-api 1.7.15**; physical accuracy remains unverified.
- Face/photo/QR requests have cancellation generations and bounded waits. Late streams stop after cancellation; late photo results cannot attach to another student. Navigation, backgrounding and page exit stop cameras. QR generations own separate containers.
- Workstation capture requires one face. Existing-photo backfill uses compare-and-set on the photo, status and missing descriptor; it cannot overwrite a concurrent enrollment.
- A punch UUID replays an uncertain request instead of turning a retried clock-in into a clock-out. Continuous face presence still requires five observed seconds of absence before another punch.
- Managers can pair/revoke a check-in browser. The device token grants only kiosk access, never management. Enrollment workstations retain their separate password and permissions. Sign out both management systems before handing a device to the public.
- **Device enforcement defaults off.** Pair and verify onsite first, then explicitly enable “only paired devices.” No device is auto-provisioned by the migration.
- Per-minute limits are 1,200 matches, 180 punches and 120 log reads per device/connection hint, plus a global limit of three times each limit. Connection hints are hashed with a server secret; compatibility mode is rate control, not proof of an authorized device. Strict device enforcement needs onsite acceptance.

## Release and recovery

See [PHASE2_RELEASE.md](PHASE2_RELEASE.md) for the ordered rollout, permissions, recovery boundary and onsite checklist. Keep index/index2 layout differences; shared safety functions are ported explicitly, not by replacing one whole page with the other.
