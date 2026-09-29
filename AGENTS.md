# M+ School — Codex Takeover Rules

## Mission
Gradually take over and improve the production M+ School tutoring administration system without interrupting daily operations.

## Highest-priority rules
1. Production availability comes first.
2. Existing production data must not be lost or silently transformed.
3. No big-bang rewrite.
4. Never make unreviewed destructive changes to Supabase production schema, RLS, tables, columns, policies, or data.
5. Work in small, independently verifiable changes.
6. Every production-affecting change needs a rollback path.
7. Do not commit secrets or service-role keys.
8. Keep current behavior compatible until a replacement is tested and approved.

## Git workflow
- main = current production baseline. Do not develop directly on main.
- codex-takeover = takeover/inventory branch.
- Future implementation work should use focused feature branches.
- Review and test before merge to main.

## Current architecture
The current application is primarily a single index.html containing UI, styles, business logic and direct Supabase calls. External browser/CDN dependencies include Tailwind, Supabase JS, QR scanning, face recognition and related UI libraries.

## Known high-risk area
Current staff session/authorization logic is client-side and must be redesigned carefully. Do not abruptly replace it in production. First document existing behavior, design backward-compatible authentication/RBAC, test it separately, then migrate.

## Required change sequence
Inventory -> document -> isolate -> test -> implement small change -> verify -> merge -> observe.

## Database rule
Before any schema change:
- document current table/column usage;
- identify affected production features;
- create forward migration;
- create rollback/recovery plan;
- test outside production;
- obtain approval before production execution.

## Definition of done
A change is not done merely because code works locally. Existing daily workflows must continue to work and rollback must be possible.
