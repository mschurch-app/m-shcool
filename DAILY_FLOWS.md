# Daily attendance and import flows

## Roll call

- Mobile and desktop expose the same attendance, homework, contact-book and note fields, with the existing business defaults.
- Initial date uses Asia/Taipei. Changing the date requires successful loading before saving. Saving prevents repeat clicks; errors preserve input and restore controls.
- Legacy `roll_calls.created_at` encodes the selected class date in its UTC date portion. Keep this interpretation until a separately reviewed `class_date` migration. Do not convert historical rows blindly to local dates.
- Display the highest ID for duplicate student/class-day records, using exact bigint comparison. Daily editing stays within the current after-school course. Preserve historical rows. This is a display rule, not a database uniqueness guarantee; concurrent first saves still require a later atomic write contract.
- Monthly reports preserve all legacy courses and select the highest ID per student/class-day; they show read failures explicitly.

## Data import

1. Parse CSV or TSV with a header and up to 1,000 rows. Quoted separators, newlines, doubled quotes and UTF-8 BOM are supported.
2. Match column names exactly or map manually. Preview changes before any write.
3. Reject missing identity, duplicate IDs and invalid date/number fields before confirmation.
4. Existing records receive only changed, mapped, non-empty fields. Blank or omitted cells preserve existing values. Existing points are preserved. Use the person editor for intentional clearing; point adjustments require the dedicated workflow.
5. New students use INSERT rather than an upsert. A concurrently claimed ID fails visibly instead of overwriting another record.
6. Show per-row failures and successful count. Retry by rebuilding the preview; already applied values are compared again. Source remains in the current page; import history is not yet persisted on the server.

## Delivery boundary

This batch changes frontend workflows only. No schema migration, backend deployment or historical cleanup is included. Preserve the existing differences between `index.html` and `index2.html`; apply shared flow changes to both explicitly.

Physical camera, recognition accuracy, workstation setup, iPhone and Safari acceptance remain separate from synthetic regression checks.
