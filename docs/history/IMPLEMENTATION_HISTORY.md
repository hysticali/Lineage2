# Implementation history

Started: 2026-10-15. Scope: all five milestones in `Projects Notes.md`.

This is the completed delivery record, retained for provenance. Current planning
belongs in [Project Notes](../../Projects%20Notes.md); current behavior belongs
in the feature, API, and operations guides rather than a second active plan.

Current status: all five milestones implemented and verified; completion audit
closed on 2026-10-16. Earlier log entries describe the state at that time. Current
feature behavior is in [docs/FEATURES.md](../FEATURES.md), operator procedures
in [docs/DEPLOYMENT.md](../DEPLOYMENT.md), and the requirement/evidence matrix
in [docs/VERIFICATION.md](../VERIFICATION.md).

## Delivery order and gates

1. **Protect existing work** — versioned full-tree backups; validated restore preview and recovery copy; navigation-only reset; explicit discard; canonical fingerprints and per-tree saves; recoverable source changes; visible source/save state and API retry. Gate: backup round trip, rejected malformed input, reset preservation, storage failure, source-change and API-outage browser tests.
2. **Database editing** — incremental frontend modules and local build; tree selection; transactional person/family writes; relationship validation; existing relatives and co-parent selection; parentage independent of gender; save/retry/conflict states; repeat-safe migration of local additions. Gate: real PostgreSQL transaction/constraint tests plus browser-to-Express tests, restart persistence, isolation, concurrency, and failed-save recovery.
3. **Exploration** — search and people list; URLs; selection/history/focus; empty states; zoom/labels/mobile; safe graph traversal; 100/1,000/10,000-person benchmarks and documented targets. Gate: navigation and refresh tests, repeated ancestor/cycle fixtures, mobile verification, benchmark report.
4. **History and exchange** — editable names/events/places/notes; imprecise/conflicting assertions; citations; media and backups; documented GEDCOM subset checked against the official specification; import preview/provenance/warnings; export and round trips; reviewed duplicate merge with rollback. Gate: full supported-data round trips, unsupported-data reporting, attachment recovery, merge/rollback tests.
5. **Private sharing and operations** — local default with optional private hosting; authentication; tree roles; living/private data policy; history/recovery; production configuration/health/logging; invitations and revocable viewer links; deployment and backup/restore guide. Gate: permission and privacy matrix, concurrency and recovery tests, clean-install/restore exercise.

## Working decisions

- Preserve the existing fan appearance and working interactions while extracting modules.
- Default to a local application; implement private hosting capability without deploying to an external service.
- Keep the Rootline UI name and Lineage2 repository name until a naming decision is needed.
- Retain editable static/demo mode, clearly labeled as browser-only storage.
- Add migrations for new database behavior; preserve original imported records and evidence.
- Do not replace authoritative family relationships with a flat wheel snapshot.
- Keep a recoverable copy of browser edits before any migration or replacement.
- Verify each gate against executable tests and actual runtime behavior; record limitations honestly.

## Progress log

### 2026-10-15 — Start

- Inspected the working tree, schema, read API, existing browser storage, roadmap, and prior regression tests.
- Confirmed that browser changes are currently local-only and that source mismatch/reset can overwrite them.
- Implementation begins with backup/recovery and the frontend module/build foundation.
- All five milestones remain in scope. No milestone has passed its completion gate yet.

### 2026-10-15 — Data protection and frontend foundation

- Implemented versioned JSON backup/restore with record and graph validation, preview, automatic recovery copies, and rejection on storage failure.
- Made Reset navigation-only and added explicit discard confirmation.
- Scoped browser saves by tree identity, canonicalized source fingerprints, preserved older saves/source-change copies, and exposed source/save status.
- Added backend failure retry without sample substitution; Express marks backend pages explicitly.
- Extracted frontend code/styles, storage/data access, reusable modal, and archive controls; bundled React and JSX locally with esbuild.
- Applied compatible patches for three transitive dependency advisories; subsequent npm audit reported zero vulnerabilities.
- Verification: `npm test` passed 15 unit and 20 Chromium browser tests. New tests cover backup round trips, malformed input, repeated ancestors/long lineages, recovery/discard/reset, source changes, key reordering, API outage/retry, tree isolation, and storage failure.
- Milestone 1 acceptance gate passed for the current browser archive model. Database-backed full genealogy backup will be expanded with Milestones 2/4/5.
- Next: transactional database editing and an actual PostgreSQL test instance.

### 2026-10-15 — Roadmap reconciliation

- Updated `Projects Notes.md` to reflect the current working tree rather than the earlier read-only backend baseline.
- Database editing now includes transactional person/family writes, tree selection, relationship validation, revision conflicts, deduplicated retries, and previewed local migration.
- The last recorded full suite passed 4 unit tests, 14 real PostgreSQL integration tests, and 23 browser tests. It covered restart persistence, stale-tab recovery, tree isolation, and local migration. This is prior-run evidence, not a new run for this documentation update.
- Search, graph indexing, direct URLs, navigation history, empty states, and zoom are in progress. Their latest changes postdate that full run; Milestone 3 remains open pending focused coverage and a fresh full suite.
- The next slice is search/navigation verification, mobile and zoom checks, graph safety fixtures, actual-search benchmarking, and documentation reconciliation. Milestones 4 and 5 remain planned.

## Completion audit

### Current evidence — exploration and records/recovery slice

- Milestone 3 passed its gate: search and 25-result pages, URL/tree identity, selection-preserving direction changes, app/browser history, focus, empty states, mobile zoom, repeated ancestors, and cyclic/long graph traversal are covered.
- The production graph/search benchmark measured 32.08 ms for a first 10,000-person descendant fan and 1.05 ms for warmed search on the recorded reference machine. The baseline remains unchanged.
- Added repeated names/events, structured names, literal/conflicting dates, independent place assertions, person/family/event notes, shared sources, citations, and attachments with caption/provenance/checksum.
- Added full relational snapshots to edit history, versioned portable database-tree backups, checksum/reference validation, clean-database restore, and reversible whole-tree recovery. PostgreSQL stores file bytes, so its backups include attachments.
- Verification: the final `npm test` for this slice passed 11 unit, 19 real PostgreSQL integration, and 33 Chromium browser tests. Tests exercise process restart, exact binary attachment restore into a second clean database, stale form retry, source/target isolation, malformed attachment input, tampered backup rejection, and reversible history.
- Added a GEDCOM 7 container parser/serializer after consulting the official 7.0.18 specification. Its tests are included in the final 11-test unit suite. `docs/GEDCOM.md` defines the supported initial exchange contract; semantic import/export and duplicate merge remain incomplete.
- Fixed explicit display-slot precedence over gender fallback, a delayed focus race, a delayed URL/history update, and stale selection/history references after full-tree recovery. Four navigation/pointer regressions also passed five repeated runs each.
- Added `docs/FEATURES.md`, refreshed setup/API/recovery documentation, and reconciled roadmap statuses. Milestone 4 is partially delivered; Milestone 5 still requires authentication, roles/privacy, invitations/sharing, and operational guidance. Full-scope completion remains unproven.

Before declaring completion, reconcile every unchecked roadmap item with implementation and test evidence here, run the required suites, exercise a clean database and backup restore, and publish a full feature guide and verification report. Test success alone does not establish unimplemented requirements.

### GEDCOM exchange and duplicate review

- Implemented GEDCOM 7.0 semantic preview/import/export against the documented subset. Browser previews show counts, roots, validation failures, retained unsupported structures, and file checksum; original UTF-8 source bytes, headers, scoped cross references, and structure bindings are retained in PostgreSQL.
- Export overlays current names, facts, notes, sources/citations, repositories, media references, and family relationships onto retained structures. URI-based Rootline extensions preserve the chosen root, additional partners, extended assertion kinds/tags, and attachment description/provenance without taking over foreign tag meanings.
- Added reviewed existing-tree imports with possible-name-match reports, explicit acknowledgment, revision/checksum guards, idempotent retries, and a complete pre-import recovery snapshot. Conflicting extension meanings require a separate tree. Matching people remain separate until explicitly merged.
- Added matching-name suggestions, manual duplicate selection, merge previews, primary-name/gender/preferred-family choices, graph and membership conflict checks, preserved assertions/evidence, stable display identity, old-ID aliases, and full merge rollback. Raw fragments retain opaque data and pointer meaning from both imported people.
- Extended full-tree backups to version 2, including source/structure integrity checks and compatibility defaults for version 1 note ordering. Verified original-source recovery into a second clean database.
- Fixed a delayed-write-retry response that could show an obsolete browser tree after later edits; a replay now returns current state without repeating the write. Expanded semantic comparisons to cover structured name pieces, citation targets/text/quality, and media links.
- Final verified full run: 16 unit, 26 real PostgreSQL integration, and 37 browser tests passed, including the explicit 20 MB input-limit and extension-schema cases. Milestone 4's documented-subset gate has passed; Milestone 5 remains incomplete.
- Refreshed README/API documentation, `docs/GEDCOM.md`, `docs/FEATURES.md`, CHANGELOG, and the roadmap. Remaining work is authentication, roles/privacy, invitations/sharing, actor-aware operations, server-wide backup/restore, deployment guidance, and the full-scope completion audit.

### Private sharing, operational recovery, and final audit

- Added migration 007 for accounts, hashed sessions, login attempt limits, owner/editor/viewer membership, invitation/link hashes and expiry, security events, explicit living/publication state, and history actors.
- Completed initial owner setup, account/session/password flows, API membership enforcement, locked-record checks, transaction-time authority rechecks, cross-account import/restore ownership, and receipt isolation.
- Added manual privacy approval and a separately constructed public projection/export; default unknown/living/unreviewed people and private evidence remain withheld. Native backups retain privacy flags; old backups default conservatively. Merge approval requires both people to be approved deceased records. GEDCOM reports native privacy metadata limits.
- Added owner sharing UI, named invitation acceptance, reviewed membership changes, last-owner protection, expiring/revocable anonymous links, and hashed secret storage. Links are copied manually and no email was sent.
- Private workspaces use memory rather than persistent browser caches. Verified logout/denial/demotion clear the mounted private state; temporary connection failures retain unsaved forms with reconnecting notices.
- Added explicit production configuration, loopback default, origin/cookie/proxy checks, readiness reporting, correlated sanitized errors, actor-aware history, and graceful shutdown. Tested the actual server process through startup, restart, and shutdown.
- Implemented `npm run db:backup` and `db:restore`: protected atomic new files, SHA-256 reporting/checking, empty-target restore, one-transaction pg_restore, and session revocation after recovery. Verified every application table, accounts/memberships/history, original records, and exact file bytes in a separate clean PostgreSQL instance.
- Built checksum-verified official PostgreSQL 18 clients and libpq under `/tmp` for the operational exercise; no system package or external deployment was changed. The development guide now lists PostgreSQL clients as a full-suite prerequisite.
- Fixed sharing-list refresh after invitation acceptance, old invitation URL visibility during new-link creation, alternate locked migration/evidence paths, private draft loss on background connectivity failures, and conservative publication after merging.
- Expanded private Chromium coverage through owner setup/publication, viewer/editor invitation, mobile editor failure/retry, background connection failure, role demotion, filtered export, anonymous navigation/refresh, revocation, logout, and password rotation.
- Added `docs/DEPLOYMENT.md` and `docs/VERIFICATION.md`; expanded the complete feature guide, README/API, GEDCOM limits, CHANGELOG, and roadmap. The final benchmark records 34.312 ms for the 10,000-person descendant fan and 1.474 ms for warmed search, meeting all recorded targets.
- Final full command exited successfully: 16 unit tests, 35 real PostgreSQL integration tests, and 38 Chromium browser tests passed with zero failures. This run includes the final connectivity-preservation, private import/restore ownership, backup connection parsing, and malformed-archive checks.
- The final requirement-by-requirement audit, documentation-link check, and `git diff --check` passed. All five milestones and their acceptance gates are complete within the documented subset/capability scope. External deployment and the explicitly deferred features remain outside this delivery.
