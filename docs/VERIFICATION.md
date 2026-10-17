# Implementation and workspace verification

Audit closed: 2026-10-16 (America/Los_Angeles). Scope: all five milestones in
`Projects Notes.md`, including selected-person preservation when changing chart
direction, plus the six wheel-workspace improvements audited below. This report applies to the current working tree; no commit or external
deployment is implied. Full feature behavior and limits are in [FEATURES.md](FEATURES.md).

## Verification environment and commands

Node.js 22.23.3; Chromium through Playwright 1.59.1; disposable real PostgreSQL
18.4. Operational recovery used PostgreSQL 18.0 `pg_dump` and `pg_restore`, built
from the official source archive after verifying its published SHA-256. These
tools were installed under `/tmp`, without changing system packages. A normal
development installation should install compatible PostgreSQL clients on PATH.

```sh
PG_DUMP_BIN=/tmp/lineage-pg-tools/install/bin/pg_dump \
PG_RESTORE_BIN=/tmp/lineage-pg-tools/install/bin/pg_restore npm test
node scripts/benchmark.js --output=docs/benchmarks/performance-final.json
git diff --check
```

`npm test` builds the frontend, runs unit tests, runs integration tests against
new isolated PostgreSQL instances, rebuilds browser assets, and runs Chromium
against static/local/private fixtures. Tests never read the configured
application database. The operations suite invokes the actual `npm run
db:backup` and `npm run db:restore` commands and starts the actual server process.

The final full command exited with status 0: **16 unit tests, 35 real PostgreSQL
integration tests, and 45 Chromium browser tests passed**, with zero failures.
The Chromium run completed in 26.0 seconds. The previously recorded final benchmark passed all
documented targets; its 10,000-person descendant fan took 34.312 ms and warmed
search took 1.474 ms. Documentation-relative-link and whitespace checks passed.
Every milestone requirement below has corresponding implementation and direct
verification evidence; the five-milestone audit is complete.

## Milestone 1 — Protect existing work

| Requirement | Implementation and direct evidence |
| --- | --- |
| Versioned complete browser archive download | `src/domain/archive.js`, `frontend/ArchiveControls.jsx`; archive unit round trip and browser backup/restore test preserve extension fields and relatives. |
| Validated restore preview and recovery before replacement | Archive unit invalid-input cases and `tests/e2e/archive.spec.js` reject malformed roots/IDs/references/cycles without replacing the active tree. |
| Navigation-only Reset and explicit discard | `handleReset` resets navigation; archive browser tests prove edits survive Reset and discard creates recovery before replacement. |
| Recover source changes | Source-change browser test downloads the preserved prior archive; failed API/retry test keeps the active archive recoverable. |
| Stable fingerprints and per-tree saves | Fingerprint unit test ignores key ordering; browser tests verify reordered source and tree-isolated saves. |
| Visible source/save state | Archive controls distinguish static/local database source, save failure, draft, and private memory-only storage. Browser storage-failure test verifies the message and blocked replacement. |
| API failure and retry without sample substitution | `frontend/data.js` accepts static fallback only for a plain static-server HTML 404. Archive outage test verifies retry and preservation. |

## Milestone 2 — Save and edit through the database

| Requirement | Implementation and direct evidence |
| --- | --- |
| Incremental modules and local React build | `frontend/`, `src/domain/`, and esbuild build script replace the inline frontend. The full command builds actual browser assets before testing them. |
| Tree selection and tree-scoped editing | Database browser tests create/edit people, open a fresh context, and change trees without mixed data. |
| Transactional people/family changes | Real PostgreSQL integration tests verify persisted child/co-parent/pedigree writes and rollback after invalid input. |
| Boundary, duplicate, self-link, and ancestry validation | `tests/integration/postgres.test.cjs` and GEDCOM/merge suites reject invalid graphs and foreign references without partial writes. |
| Existing relatives and explicit co-parent | PostgreSQL transaction tests and browser add-child coverage verify the selected relationships. |
| Gender-independent labels and multiple families | Same-sex/unknown-sex fixtures, explicit-slot precedence, foster/adopted GEDCOM semantics, and family detail projections verify preservation beyond two fan slots. |
| Saving/failure/retry behavior | Browser failed-save and stale-form tests retain proposed fields. Mutation receipts deduplicate identical retries; changed payloads/revisions conflict. |
| Stale-tab detection | Two-tab browser test saves one edit, rejects the stale second, refreshes while keeping its fields, and retries explicitly. |
| Previewed repeat-safe browser migration | PostgreSQL migration tests and database browser restore/migration flow verify preview, recovery, relationships, and repeat behavior. |
| Real database/browser integration and restart | Production migrations run on actual PostgreSQL. Restart tests reopen the database/server and compare retained records; browser fixtures use Express. |

## Milestone 3 — Explore larger trees

| Requirement | Implementation and direct evidence |
| --- | --- |
| Name/date/place search | Production search unit test covers normalization and combined terms; exploration browser test finds a person outside the fan. |
| Searchable people list | Browser fixture with 1,000 people verifies 25-result pages, next page, filtering, and no-result guidance. |
| Direct tree/person/direction URLs | Exploration browser tests refresh direct links and navigate Back/Forward across database trees. Invalid/prototype-name identifiers fall back safely. |
| Selected person, history, focus, details | Rootline direction regression and exploration history tests assert center identity, open details, direction, URL, and keyboard focus. |
| Empty branches | Browser tests verify ancestor/descendant empty messages; filtered private views explain that only approved relationships are shown. |
| Crowded labels, zoom, narrow screens | SVG labels shorten/hide at limited space while titles/accessible labels retain names. Browser tests verify chart geometry, keyboard access, 375px layout, anchored zoom/panning, and Fit. |
| Repeated ancestors and cycles | Graph/archive unit tests include long input, shared ancestors, repeated render occurrences, and malformed cycles; traversal terminates and generations remain bounded. |
| Measured 100/1,000/10,000-person targets | [Original baseline](benchmarks/performance-baseline.json), [indexed measurements](benchmarks/performance-current.json), and [final rerun](benchmarks/performance-final.json) retain machine/fixture details. [Targets and limitations](PERFORMANCE.md) distinguish computation from rendering/network performance. |

## Milestone 4 — Record history and exchange it

| Requirement | Implementation and direct evidence |
| --- | --- |
| Editable repeated names/events/places/occupations/notes | Records PostgreSQL tests and browser records editor preserve multiple assertions, structured name pieces, note text, and independent places through reload/restart. |
| Literal and conflicting dates | Records and semantic GEDCOM tests compare unknown/approximate/ranged/conflicting expressions without invented precision. Unsupported native expressions use DATE.PHRASE on export. |
| Sources and citations for events and families | Records tests verify shared sources, evidence targets, locator/text/quality, and rejection of foreign references. |
| Attachments and recovery strategy | Binary download, checksum validation, full-tree clean restore, server-wide restore, and browser attachment tests verify exact bytes and metadata. PostgreSQL holds the files transactionally. |
| Defined exchange subset | [GEDCOM.md](GEDCOM.md) specifies GEDCOM 7.0, official specification reference, supported records, extensions, opaque retention, limits, and rejected versions. |
| New-tree import with preview and provenance | GEDCOM browser/integration tests verify counts/roots/warnings/checksum, exact original source retention/download, failed input, and fresh identities. |
| Current-data export and limitations | Semantic tests edit/re-export/re-import supported records, preserve original pointer meaning and extension URIs, and verify explicit reports for unsupported/native data. |
| Representative round trips | Fixtures include multiple/same-sex partners, adopted/foster children, missing parents, dates, citations, media references, multiline/Unicode values, and foreign/native extensions. |
| Reviewed duplicates, reversible merge, existing-tree imports | Merge suites verify preview choices, conflict/cycle rejection, transferred assertions, aliases, and whole-tree rollback. Browser GEDCOM flow reviews matches before adding separate records and explicitly merges later. |

## Milestone 5 — Private sharing and operations

| Requirement | Implementation and direct evidence |
| --- | --- |
| Local default and optional private hosting | `src/config.js`, `src/server.js`, `.env.example`, and [DEPLOYMENT.md](DEPLOYMENT.md). Actual server tests verify private startup, invalid local bind rejection, restart, and clean SIGTERM exit. No external deployment is scheduled. |
| Authentication and API-enforced roles | `tests/integration/access.test.cjs` verifies initial setup, password/session hashing, Secure cookie flags, origin checks, expired sessions, rotation/logout, login limits, owner/editor/viewer boundaries, foreign-tree isolation, ownership of imported/restored trees, and cross-account receipt rejection. |
| Living/private records and exports | Privacy tests explicitly publish deceased people, reject living/private publication, omit restricted names/facts/places/families and metadata, and filter aliases, lists, summaries, raw downloads, and GEDCOM. Private UI defaults to memory and requires explicit full export. |
| History, application recovery, and server-wide restore | Recovery and operations tests compare all application tables, original imports, history/receipts, accounts/memberships/links, and exact binary files in clean databases. Restored accounts sign in; old sessions are rejected. Native version 1 backups still restore with conservative defaults. |
| Production configuration, health, errors, upgrades, deployment guide | Actual process tests cover configuration, readiness, persistence/restart, and shutdown. Broken repository tests verify 503 health and sanitized correlated 500 errors. The operations guide supplies setup, proxy example, upgrades, monitoring/retention, and a clean restore drill. |
| Invitations and revocable links | Access tests cover named acceptance, role preservation, expiry, revocation, hashed secrets, last-owner protection, and revocation of a departing owner's links. Browser flow verifies copyable links, acceptance, anonymous navigation/refresh, filtered export, and visible removal. |
| Isolation, concurrent edits, failed saves, and backup failures | Real lock-contention test queues demotion before an editor save and proves rejection after lock release, including old receipt retries. Locked-record/migration/merge tests protect restrictions. Browser tests verify mobile editor failed-save retry and editor-to-viewer state clearing. Operations tests reject wrong checksums, malformed dumps, nonempty targets, and failed client execution without partial output. |

## Failures found and resolved

- The sharing member list stayed stale after an invitation was accepted. It now refreshes periodically, on focus, and through an explicit button.
- Creating another invitation left the previous token visible during the request. The interface clears it before creating a new link; the test waits for the newly issued URL.
- The first client-tool recovery attempt lacked its runtime library. The verified PostgreSQL clients and libpq were installed together under `/tmp`; the documented prerequisite is a complete PostgreSQL client installation.
- A test assumed cutting 20% off a custom dump necessarily made it invalid. PostgreSQL accepted that fixture, so the malformed-file test now removes the table of contents and data; separate wrong-digest coverage verifies byte-integrity rejection.
- Access review found alternate locked-record paths through migration and evidence targets; affected-entity checks now cover those paths. Merge publication is conservative and GEDCOM reports native privacy metadata limitations.
- Background connectivity failures previously cleared private in-memory forms. Temporary network/server errors now retain drafts with a reconnecting notice; verified denial, logout, and role changes still clear the private workspace. The private browser flow exercises both failed background checks before retrying a save.

## Explicit limits

The deliverable is a local application with tested private-hosting capability;
no public/provider deployment or email message was performed. External TLS/proxy
setup remains an operator task and the guide labels that boundary. There is no
MFA, email password recovery, backup scheduler, automatic history pruning,
GEDZIP, or GEDCOM 5.5.1 support in this release. Manual publication approval
trusts owners/editors to inspect the basic detail values they share. Previously
downloaded files cannot be recalled. Browser checks run in Chromium; benchmark
results exclude network, database transfer, and browser rendering.

## Repository cleanup verification — 2026-10-16

- Grouped browser flows under `tests/e2e/` and replaced the separate local/private server scripts with `tests/helpers/server.cjs`, used by both Playwright fixtures.
- Moved distinct benchmark records to `docs/benchmarks/` and archived the completed execution record under `docs/history/`. README now provides setup and a directory/document index; API details have one reference in `docs/API.md`.
- Ran `npm run clean`, rebuilt from the cleaned state through the full test command, and passed 16 unit, 35 real PostgreSQL integration, and 38 Chromium browser tests (28.7 seconds for Chromium).
- SHA-256 comparisons confirmed production source, frontend, schema migrations, family data, fixtures, lockfile, and the environment example were unchanged by cleanup. Documentation links and whitespace checks passed; the content audit found no identical project files or stray temporary/backup files.
- Ran `npm run clean:reports` after verification, keeping the rebuilt assets and installed dependencies. Clean commands use a fixed generated-directory allowlist and retain configuration, family data, fixtures, backups, and source files.

## Six-step wheel workspace audit — 2026-10-16

| Step | Implementation and direct evidence |
| --- | --- |
| 1. Stable anchored viewport | `frontend/ChartViewport.jsx` centers both stage axes and stores pan in SVG units. Desktop/mobile tests check every 25% zoom level from 100–300%, fixed hub/document geometry, pan/zoom and resize invariance, keyboard arrows/Home, Center retaining zoom, and Fit returning to 100%. |
| 2. Overlay Tree tools | `frontend/WorkspacePanels.jsx` groups exchange, backups/history, research, sharing, and browser drafts. Workspace tests compare chart bounds and scroll position before/after opening. Existing database, GEDCOM, merge, and archive flows prove previews, confirmations, downloads, migration, and recovery through the drawer. Private flows verify owner/editor/viewer tool visibility. |
| 3. People drawer | `PeopleDrawer` embeds bounded `PeopleSearch` results. Exploration tests verify 1,000 people, 25-result pages, and combined filters. Workspace tests prove `/` opens search outside forms, input focus, stable chart bounds, selection closing the drawer, and return focus to the centered person. |
| 4. Contextual details and compact header | `main.jsx` groups Add relative with selected-person actions and shows source/save state plus actionable draft, storage-failure, and recovery links. `Access.jsx` provides the Account menu. Existing relative/records/private tests cover editing; storage failure opens backup tools; password-dialog cancellation restores Account focus. |
| 5. Mobile sheets and controls | Responsive CSS and `useMobileLayout` retain the wheel first and move details into a full-height sheet. Workspace tests verify 375px layout, no horizontal document overflow, 44px chart-control heights, sheet-to-relative-form focus, and mouse-independent touch panning/centering without document scrolling. Private flow edits through the mobile sheet and retains failed-save forms. |
| 6. Regression tests and documentation | Seven workspace tests supplement updated existing feature flows. Final `npm test` exited 0 with 16 unit, 35 real PostgreSQL integration, and 45 Chromium tests passing. Desktop 1440×900 and mobile 375×812 chart, tools, and people views were visually inspected. README, feature guide, notes, and changelog match the delivered controls. |

Overlay tests also exercise Tab/Shift+Tab wrapping, Escape closing only the
active confirmation, inert background layers, and focus returning first to the
parent drawer and then its trigger. Selected-person direction changes, chart
Back, browser history, and tree-specific URLs remain covered. Generated browser
reports were removed after validation; built application assets remain ready.
No server/schema/API changes or external deployment were needed for this work.
