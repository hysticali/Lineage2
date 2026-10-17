# Changelog

All notable changes to the Lineage2 project will be documented in this file.

## [Unreleased]

### Development checkpoint — 2026-10-17

This checkpoint records the database-backed genealogy application, evidence and
GEDCOM workflows, reversible recovery, private accounts and sharing, repository
cleanup, and the completed six-step wheel workspace improvements. Detailed
behavior and verification evidence are linked from the README and Project Notes.
Pre-push verification passed 16 unit, 35 PostgreSQL integration, and 45 browser tests.

- fix: Anchor zoom in a stable chart viewport, preserve the viewed point through pan/zoom and resizing, and distinguish Center wheel from Fit chart.
- feat: Add compact Find person and Tree tools drawers, contextual Add relative actions, an Account menu, compact save/recovery status, and full-height mobile sheets.
- test: Cover all zoom levels, mouse/touch and keyboard panning, resizing, overlay geometry, nested focus recovery, mobile editing, and the existing database/private workflows through the new controls.
- maintenance: Group browser tests under tests/e2e, consolidate disposable browser-server setup, archive the completed implementation history, and organize benchmark records under docs/benchmarks.
- maintenance: Keep README focused on setup and navigation, move API details into docs/API.md, and add allowlisted clean commands plus generated/editor-file ignore rules.
- feat: Add optional private accounts, initial owner setup, scrypt passwords, expiring HttpOnly sessions, password rotation/logout, and login attempt limits while retaining local loopback mode.
- feat: Enforce tree owner/editor/viewer permissions across API/download/recovery paths, recheck queued writes inside transactions, protect locked assertions, and attribute edits/access activity to accounts.
- feat: Add manual living-status/publication controls, filtered viewer/search/export responses, private evidence exclusion, conservative merge privacy, and transient private browser workspaces.
- feat: Add invitation acceptance, reviewed membership changes, last-owner protection, expiring/revocable read-only links, and refreshing sharing controls without automatic email.
- feat: Add validated server configuration, database readiness checks, sanitized request/error logging, graceful shutdown, and server-wide pg_dump/pg_restore commands with clean-target/checksum protections.
- docs: Add private hosting, upgrades, monitoring, backup retention, clean restore, and complete feature guidance.
- test: Add real PostgreSQL permission/privacy/expiry/revocation/race coverage, complete-table clean restore with exact attachments, actual server restart checks, and private/mobile browser flows.
- feat: Add previewed GEDCOM 7.0 import/export, source downloads, semantic round trips, preserved opaque structures, and URI-based Rootline extensions.
- feat: Add reviewed imports into existing trees, possible-name-match reports, atomic rollback through history, and repeat-safe confirmation.
- feat: Add duplicate-person suggestions, explicit merge previews and field/family choices, preserved assertions and identifier aliases, and complete merge recovery.
- fix: Preserve canonical person links after merges, reject inherited-property URL identifiers, and return current tree state on delayed write retries.
- feat: Extend native full-tree backups to version 2 with original GEDCOM sources/bindings, integrity checks, and backward-compatible version 1 restore.
- fix: Apply chart focus and view URLs with the committed render to avoid delayed focus stealing and cross-tree history races.
- fix: Honor explicit parent display slots before gender/role fallback without changing the recorded gender.
- feat: Add records/evidence editing for repeated names, events, family assertions, notes, shared sources, and citations without collapsing conflicting dates.
- feat: Store attachments transactionally in PostgreSQL with captions, provenance, checksums, and exact-byte downloads.
- feat: Add full relational tree backups, validated clean-database restore, and previewed reversible edit-history recovery including attachments.
- test: Verify repeated assertions, structured surname preservation, evidence isolation, attachment downloads, stale record forms, clean restore, and recovery rollback with PostgreSQL and browser tests.
- feat: Add name/date/place search, a paged people list, direct view URLs, browser history, zoom controls, and empty-branch guidance.
- performance: Index family relationships per archive snapshot; reduce the recorded 10,000-person descendant fan computation from about 3.6 seconds to 32 ms.
- test: Cover long and cyclic graph traversal, repeated ancestors, search pagination, selected-person navigation, tree-specific URLs, and mobile zoom.
- feat: Save person and family edits transactionally to PostgreSQL, select trees and existing relatives, and retain multiple parent families and parentage labels.
- fix: Reject stale edits and invalid relationships, preserve failed forms, and deduplicate retried saves.
- feat: Preview and migrate browser additions into a database tree with recovery and repeat-safe requests.
- test: Replace database emulation with disposable real PostgreSQL tests, including process restart and browser-to-API persistence.
- feat: Add versioned browser archive backups, validated restore previews, recovery copies, and explicit discard confirmation.
- fix: Make Reset navigation-only; preserve local edits on source changes and isolate saves by tree identity.
- fix: Display storage failures and backend retry states instead of silently falling back to sample data on database errors.
- refactor: Extract the frontend into local modules and bundle React/JSX/styles with esbuild.
- maintenance: Apply compatible dependency security patches; npm audit reports zero vulnerabilities after the update.
- fix: Keep the selected person centered with their details open when switching ancestor/descendant views.
- fix: Preserve same-sex parents and birthplaces without birth dates in the database wheel projection.
- fix: Preserve explicit sibling pairs without creating transitive sibling relationships during import.
- fix: Remove rectangular bounding-box focus outline from SVG chart wedges and elements.
- feat: Load the wheel from `/api/family-data`, falling back to the static JSON without the backend.
- fix: Scope all generated database IDs per tree so multiple trees can coexist; add `--tree-key`/`--tree-name` import options.
- fix: Record failed imports as FAILED jobs and remove stale import history when replacing a tree.
- fix: Keep parents of unknown or non-binary sex in the wheel projection.
- fix: Serialize concurrent migration runs with a table lock.
- fix: Discard saved browser edits when the source family data has changed; drop non-functional expansion persistence.
- fix: Link the spouse as the other parent when adding a child.
- test: Cover tree isolation, failed imports, idempotent migrations, static routes, add-child parents, and stale saves.
- feat: Add the GEDCOM-aligned PostgreSQL schema, legacy JSON importer, and read API.
- test: Validate schema migrations, relationship conversion, database projection, and API responses.
- fix: Persist added family members and safely recover from stale saved navigation.
- fix: Render explicitly linked siblings when parent records are unknown.
- fix: Stack the chart and sidebar on mobile-sized screens.
- accessibility: Add keyboard chart controls and accessible modal behavior.
- refactor: move hardcoded family data to external JSON file and update codebase accordingly
- test: Added Playwright testing.
- feat: Updated wedge sizing and separation between sibling and spouse.
- feat: Added "Add Child" functionality.
- feat: Added Ancestor/Descendant views.
- feat: Added "Add Spouse" functionality.
- data: Replaced sample Hartwell family data with the McCastle genealogy dataset.
- init: Initial commit with index.html for Lineage Wheel.
