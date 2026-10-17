# Lineage2 — Project Notes and Roadmap

Updated: 2026-10-17

Execution history: [implementation history](docs/history/IMPLEMENTATION_HISTORY.md).
Requirement audit: [docs/VERIFICATION.md](docs/VERIFICATION.md).
Feature guide: [docs/FEATURES.md](docs/FEATURES.md).
Operations: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Product direction

Build a dependable family history workspace around the interactive lineage fan.
People should be able to explore relatives, maintain accurate relationships,
record the evidence behind their history, and exchange their work with other
genealogy software.

Planning assumption: prioritize a local, single-user application before hosted
collaboration. The phases below are proposed implementation order, not delivery
dates. Optional private-hosting capability is implemented. Choosing a provider,
deploying externally, publishing family data, and paid services are separate decisions.

## Roadmap at a glance

| Order | Milestone | Status | Completion gate |
| --- | --- | --- | --- |
| 1 | Protect existing work | Implemented and verified | Browser backup/restore and recovery preserve people and relationships. |
| 2 | Save and edit through the database | Implemented and verified | Transactional edits survive restart; retries, stale tabs, and tree isolation are covered. |
| 3 | Make larger trees easy to explore | Implemented and verified | Search, direct links, selection, history, zoom, and mobile behavior work together. |
| 4 | Record family history and exchange it | Implemented and verified for the documented GEDCOM subset | Supported records and evidence survive GEDCOM round trips; merges can be reversed. |
| 5 | Prepare private hosting and sharing | Implemented and verified | Permissions and privacy hold across API, exports, and sharing; backups restore into a clean installation. |

All five milestones passed the completion audit against implementation and
current test evidence. The application remains local by default; private
mode is an explicit configuration choice and no external deployment is scheduled.

## Current baseline

- [x] Ancestor and descendant fan views, selection, recentering, and back navigation.
- [x] Switching direction centers the selected individual and keeps their details open.
- [x] Add parents, siblings, spouses, and children in the browser; preserve additions in local storage.
- [x] Responsive chart layout, keyboard selection, and an accessible add-person modal.
- [x] PostgreSQL schema for people, families, facts, names, places, notes, sources, citations, media, and import metadata.
- [x] Legacy JSON importer, deterministic identities scoped per tree, and read API.
- [x] Database-to-wheel projection with a static JSON fallback.
- [x] Fix same-sex parent projection, birthplace-only imports, and transitive sibling inference.
- [x] Versioned browser archive backups, validated restore previews, recovery copies, and navigation-only Reset.
- [x] Tree selection and transactional database creation/editing, existing-relative links, and explicit co-parent selection.
- [x] Revision checks for stale tabs, request deduplication, and previewed migration of browser additions.
- [x] Local React/JSX build and separate frontend, storage, graph, and backend modules.
- [x] Real PostgreSQL integration tests and browser tests against both static mode and Express.

Database mode saves person and family edits to PostgreSQL. Static/demo mode
saves edits in the browser. Private mode uses in-memory browser state and durable
server writes/history, keeping private tree data out of persistent browser caches.
A restored browser draft must be reviewed and migrated before further database
writes. Archive tools export the active wheel projection; native full-tree and
server-wide backups provide the distinct relational/media recovery paths.

The latest completed full run passed **16 unit tests, 35 real PostgreSQL
integration tests, and 45 Chromium browser tests**, with no failures. Coverage
includes archive recovery, stale writes/retries,
restart persistence, graph/navigation behavior, GEDCOM semantic round trips,
merge rollback, access/privacy isolation, private browser flows, and complete
server-wide recovery. See the [requirement audit](docs/VERIFICATION.md).

Records/evidence editing, attachments, native full-tree recovery, supported
GEDCOM 7.0 exchange, reviewed existing-tree imports, and duplicate merging are
implemented. Native backup version 2 includes original sources/structures and
retains version 1 compatibility, with older privacy fields defaulting to unknown
and unpublished. Accounts, owner/editor/viewer roles, manual publication,
expiring invitations/links, actor history, operational backups, and deployment
guidance are implemented as well.

Switching ancestor/descendant direction centers the selected individual and
keeps selection and details open. Direct URLs, chart/browser history, keyboard
focus, and mobile behavior are covered by regression tests.

## Roadmap

### Milestone 1 — Protect existing work

Goal: make browser edits recoverable before expanding editing features.

- [x] Add a versioned JSON backup download containing the complete active tree.
- [x] Add backup restore with validation, a preview of people and relationships, and a backup of the current state before replacement.
- [x] Separate resetting chart navigation from discarding local edits. Destructive actions should explain their effect and require confirmation.
- [x] Preserve a recoverable copy when source data changes instead of overwriting the only local save after a fingerprint mismatch.
- [x] Make fingerprints independent of object-key ordering and scope saved state by tree identity.
- [x] Show whether the user is viewing database data or the sample archive, and whether changes are saved only in this browser.
- [x] Surface database failures with a retry action. A backend outage must not silently replace the active archive with sample data.

Acceptance: add relatives, download a backup, clear browser storage, restore the
backup, and recover the same people and links. Resetting the view preserves all
edits. A source update or failed API request preserves the recoverable local copy.

### Milestone 2 — Save and edit through the database

Goal: make PostgreSQL the durable source of truth in backend mode.

- [x] Incrementally extract chart geometry, relationship helpers, components, and data access from `index.html` into modules as those areas change.
- [x] Introduce a frontend build that bundles React and JSX locally; serve the built assets from Express and retain a deliberate static/demo mode.
- [x] Add a tree selector and tree-scoped person creation and editing endpoints.
- [x] Persist family membership and relationship changes in transactions with the person record.
- [x] Validate referenced people, tree boundaries, duplicate links, self-parent links, and ancestry cycles on the server.
- [x] Let users select an existing person as a relative and explicitly choose a co-parent when several partners exist.
- [x] Provide relationship labels independent of gender, including biological, adoptive, foster, and unknown parentage; preserve multiple families behind the wheel's two-slot display.
- [x] Add visible saving, saved, and failed states; retain unsaved form data on failure and prevent duplicate creation on retries.
- [x] Detect stale updates so two open tabs cannot silently overwrite each other.
- [x] Offer a previewed, repeat-safe migration of existing browser additions into the selected database tree.
- [x] Add integration tests against real PostgreSQL and browser tests using Express and a disposable test database.

Acceptance: create and edit a person and their relationships, restart the server,
and see the same data in a fresh browser session. Invalid relationships are
rejected without partial writes. Switching trees cannot mix records or local edits.

### Milestone 3 — Make larger trees easy to explore

Goal: find and navigate people without repeatedly opening branches by hand.

Search, URL navigation, history, zoom, empty states, and graph traversal are
implemented and verified together. Switching ancestor/descendant direction keeps
the selected individual as the center and keeps their details open.

- [x] Search by name and available dates/places; selecting a result focuses that person.
- [x] Add a searchable people list for individuals outside the currently visible fan.
- [x] Preserve tree, center person, and view direction in the URL for refresh and direct navigation.
- [x] Keep selection, history, keyboard focus, and details consistent across view changes.
- [x] Add useful empty states for people with no recorded ancestors or descendants.
- [x] Improve crowded labels, zoom controls, and narrow-screen chart interaction without changing the default fan geometry.
- [x] Make traversal safe around repeated ancestors and malformed cyclic input.
- [x] Benchmark representative 100-, 1,000-, and 10,000-person fixtures; set measured responsiveness targets before optimizing.

Performance evidence: the recorded 10,000-person descendant-fan computation
dropped from approximately 3,584 ms to 32 ms after indexing. See
[performance targets](docs/PERFORMANCE.md), [baseline](docs/benchmarks/performance-baseline.json),
and [current measurements](docs/benchmarks/performance-current.json). These synthetic
measurements exclude browser rendering and network time. The production search
helper measured approximately 1 ms for 10,000 people on the reference machine.

Acceptance: find a person outside the visible branches, navigate both directions,
refresh a direct link, and return through history on desktop and mobile. Repeated
ancestors and invalid cycles do not hang the page.

### Milestone 4 — Record family history and exchange it

Goal: support evidence and richer genealogy records, then GEDCOM exchange.

Deliver in this order: repeated names/events and evidence editing; attachment
storage and recovery; a documented GEDCOM subset; import into a new tree;
export and round-trip verification; duplicate review and reversible merge.
The records/evidence editor, attachment recovery, semantic GEDCOM exchange,
reviewed imports, and reversible duplicate merging have passed their gates.
The [GEDCOM exchange contract](docs/GEDCOM.md) defines the implemented subset,
opaque retention, and explicitly reported interoperability limits.

- [x] Expand person details to editable names, dated events, places, occupations, and notes.
- [x] Preserve approximate dates, date ranges, unknown dates, and conflicting assertions without inventing precision.
- [x] Add source and citation editing so an event or relationship can reference its evidence.
- [x] Add media attachments with captions, provenance, and a defined local storage/backup strategy.
- [x] Define the supported GEDCOM versions and first-release record subset against the official specification before implementation.
- [x] Implement GEDCOM import into a new tree first, with a preview, validation report, source file retention, and clear handling of unsupported structures.
- [x] Implement GEDCOM export for the supported subset and disclose anything that cannot be represented.
- [x] Test import/export round trips with fixtures covering multiple partners, adoption, missing parents, dates, citations, and extension data.
- [x] Add duplicate-person review and a previewed merge with rollback before allowing imports to merge into existing trees.

Acceptance: import a supported GEDCOM fixture, inspect its family links and
evidence, export it, and re-import without losing supported information.
Unsupported content is preserved where possible and explicitly reported.

### Milestone 5 — Prepare private hosting and sharing

Goal: make the application operable outside one local machine when needed.

Default plan: retain local operation and prepare optional private hosting.
Choose the hosting target and confirm the living-person policy before exposing
real family data. Complete and verify permissions before making invitations or
links available in the interface, and verify full database and attachment
recovery before a hosted release.

- [x] Decide whether deployment remains local or becomes a private hosted service. Default: local, with optional private hosting capability; no external deployment is scheduled.
- [x] Before exposing family data, implement authentication, tree membership, and viewer/editor permissions enforced by the API.
- [x] Define living-person visibility and private-record behavior for shared views and exports.
- [x] Add edit history and application-level full-tree recovery, including attachments.
- [x] Add server-wide database/media backup and restore procedures, including accounts, access settings, and history; prove restoration into a clean installation.
- [x] Add production configuration, health monitoring, error reporting, migration procedures, and a deployment guide.
- [x] Add invitation-based sharing and optional revocable read-only links after access controls are tested.
- [x] Test access isolation, concurrent edits, failed saves, and recovery from backups.

Acceptance: an authorized viewer can inspect only their permitted trees and
cannot edit; an editor can save changes; a backup restores into a clean deployment.

## Milestone 5 delivery sequence

The implementation followed this order. Each package has executable coverage;
the final audit verifies all five milestones together. All five packages passed.

| Priority | Work package | User-visible outcome | Completion gate |
| --- | --- | --- | --- |
| 1 | Validate access-control groundwork and wire server configuration | Local operation stays simple; private mode requires sign-in and limits access to permitted trees. | Real PostgreSQL tests cover setup, login/logout, expired sessions, cross-tree access, every API route, and rejected writes. Invalid hosting configuration fails at startup. |
| 2 | Complete account and privacy interfaces | Users can sign in/out, change passwords, review living status, and explicitly approve records for sharing. | Browser tests cover account flows, role-appropriate controls, failed saves, and clearing private state on logout or role change. Private tree data never persists in browser storage. |
| 3 | Complete invitations and read-only sharing | Owners can invite a named collaborator, assign a role, create an expiring link, and revoke access. | Tests cover acceptance, expiry, revocation, last-owner protection, concurrent permission changes, and private-data exclusion from views and exports. |
| 4 | Prove operations and recovery | An operator can configure, monitor, upgrade, back up, and recover a private installation. | Documented commands restore a server-wide backup into a clean database, including accounts, memberships, history, and exact attachment bytes. Startup, health, and migration checks pass. |
| 5 | Audit the release and refresh documentation | Features, limits, setup instructions, and verification evidence agree with the implementation. | Run the complete suites, record results, check every roadmap item, and finish the feature and deployment guides. |

No delivery dates or external deployment are scheduled. Before hosting real
data, choose the operator, domain/provider, protected backup destination, and
retention schedule using the operations guide. These are operational choices,
not unfinished application features.

## Implemented access and privacy rules

These defaults are implemented and tested. Owners explicitly choose what to
publish; local mode remains a trusted single-user workspace.

| Access | Intended capability |
| --- | --- |
| Owner | Read and edit the complete tree, manage memberships/invitations/links, and use recovery tools. Prevent removal of the last owner. |
| Editor | Read and edit the complete permitted tree, subject to record restrictions; cannot manage sharing or memberships. |
| Viewer | Read only the approved basic-detail subset of a permitted tree; cannot edit or access private evidence, source files, media, history, or full backups. |
| Read-only link | See the same approved subset while the link remains valid; no account-management or editing access. |

- Living status is explicit: unknown, living, or deceased. Do not infer death from missing dates or age.
- Unknown, living, and unreviewed records stay private to viewers and links. Publication requires explicit approval of a deceased record.
- The shared subset contains approved names, gender, birth/death dates, birthplaces, and links between approved relatives. Notes, citations, original imports, and attachments remain private.
- Apply the same filtering to search, tree summaries, direct links, aliases, family links, and GEDCOM exports. Relationship references must not reveal hidden people.
- Keep private-mode tree data in memory in the browser; retain the existing browser-local saves only for local/static mode. Clear private state on logout and access changes.
- Full private exports and backups remain explicit owner/editor actions. Label their contents clearly before download.
- Generate copyable invitation/share links. Automatic email delivery is outside this plan.

## Release risks and checks

- **Access bypass:** protect all alternate paths to the same data, including static sample files, original GEDCOM downloads, media, backups, history, and restore/import endpoints.
- **Privacy regression:** test private names and relationships as well as record counts; a filtered chart alone does not prove safe exports or summaries.
- **Permission changes during a save:** recheck authority inside the transaction and reject revoked editors without partial writes or replay leaks.
- **Recovery gaps:** distinguish portable tree backups from complete server backups. The latter must retain accounts, permissions, sessions/settings as applicable, history, and attachments.
- **Navigation regression:** rerun selected-person direction switching, direct URLs, back navigation, keyboard focus, and mobile tests after account and sharing UI changes.

## Planning review — 2026-10-15 (before implementation)

- Reconciled the roadmap with the current source files, migration list, frontend, server startup, tests, and implementation log.
- Retained milestones 1–4 as previously verified and marked Milestone 5 as unfinished work in progress.
- Split completed application-level recovery from pending server-wide recovery so the checklist does not imply that operational restore is already verified.
- Defined the remaining work packages, proposed access/privacy rules, release checks, and the next concrete development task.
- This review changes project notes only. Historical test counts are retained as prior evidence; unfinished code has not been certified by this update.

## Implementation closeout — 2026-10-16

- Completed account/session UI, configuration wiring, tree roles, locked-record checks, and actor-aware history.
- Added explicit publication controls and consistent filtered chart/list/summary/GEDCOM responses; private browser workspaces use memory only.
- Added named invitations, reviewed role changes/removal, expiring read-only links, token hashing, and revocation, with a refreshing owner interface.
- Added protected server-wide backup/restore commands, empty-target/checksum checks, session revocation after recovery, readiness/error reporting, and graceful startup/shutdown.
- Verified actual server restart, clean database restore, exact binary attachments, permission changes during queued saves, mobile editing, failed saves/background connectivity, role demotion, anonymous links, logout, and password rotation.
- Added full feature, operations, and requirement-by-requirement verification guides. Historical progress entries describe earlier states; current status is recorded at the top and in the audit.
- Final benchmark: 10,000-person descendant fan 34.312 ms; warmed production search 1.474 ms, within the documented computation targets. Original measurements remain unchanged.
- Final full suite passed 16 unit, 35 real PostgreSQL integration, and 38 Chromium browser tests. Documentation links and whitespace checks passed. All five milestone checklists and completion gates are reconciled in the verification report; no required implementation work remains in this roadmap scope.

## Repository housekeeping — 2026-10-16

- Keep production code in `frontend/`, `src/`, and `db/migrations/`; keep developer commands in `scripts/` and test-only infrastructure in `tests/helpers/`.
- Browser tests live in `tests/e2e/`, alongside separate unit, integration, helper, and fixture directories. Local/private browser fixtures share one configurable server helper.
- README is the setup and navigation entry point. API details live in `docs/API.md`, the completed delivery record is archived in `docs/history/IMPLEMENTATION_HISTORY.md`, and current plans remain in this file.
- Preserve the distinct baseline/indexed/final performance measurements under `docs/benchmarks/`; these are historical evidence rather than duplicate artifacts.
- Remove generated test reports and stale assets through `npm run clean`; use `npm run clean:reports` to keep the current build. These allowlisted commands retain dependencies, source, configuration, family data, fixtures, and backups.
- The content audit found no byte-identical project files, empty project files, or stray temporary/backup files. Preserved-file hashes and documentation links passed verification. The reorganized project passed 16 unit, 35 real PostgreSQL integration, and 38 Chromium browser tests; generated reports were removed afterward while retaining the rebuilt application assets.

## Wheel workspace improvements — completed 2026-10-16

The wheel is the primary workspace. All six steps are implemented and verified:

1. [x] Replace width-only zoom with an anchored, fixed-size chart viewport. Keep the hub stationary through unpanned zoom, preserve the viewed point after panning, and provide Center wheel and Fit controls. Resize, direction changes, and recentering must preserve usable chart navigation.
2. [x] Move import/export, backups/history, duplicate review, sharing, and browser-draft tools into an overlay drawer. Opening tools must not change chart dimensions or push the wheel down the page. Keep access checks, restore previews, and destructive confirmations intact.
3. [x] Add a compact Find person entry point and move search/browse/pagination into a drawer. Selecting a result closes the drawer, centers the person, and restores chart focus.
4. [x] Keep selected-person editing contextual, group Add relative actions, consolidate account actions in a menu, and show a compact save indicator with actionable warnings.
5. [x] Adapt the workspace to narrow screens with comfortable controls and people/tools/details sheets. Keep the wheel first and prevent horizontal document overflow.
6. [x] Add direct browser coverage for zoom anchoring, pan/zoom, Center/Fit, resizing, stable overlay layout, keyboard/focus behavior, mobile interaction, and selected-person view changes. Update existing feature flows for the new entry points, run the complete suites, inspect rendered desktop/mobile views, and update documentation.

Closeout: `ChartViewport.jsx` owns anchored scale, world-unit panning, resizing,
Center/Fit, and keyboard navigation. `WorkspacePanels.jsx` contains people/tools
drawers; `Modal.jsx` handles stacked focus, inert background layers, and return
focus. Tools retain their existing permission checks and reviewed mutations.
Selected-person editing stays beside the wheel on desktop and opens in a sheet
on mobile. Account actions are grouped, storage failures link directly to
backups, and database drafts link to migration/recovery.

The final full run passed **16 unit, 35 real PostgreSQL integration, and 45
Chromium browser tests** (26.0 seconds for Chromium). Seven new workspace tests
cover all zoom levels, pan/zoom/resize, Center/Fit, keyboard panning, drawer
geometry, nested focus traps, search focus, mobile sheets, and real touch
gestures. Existing tests exercise backup/history, imports, duplicate merges,
permissions, and private editing through their new entry points. Desktop and
375px mobile chart/tools/search views were visually inspected. README, the
feature guide, changelog, and requirement audit now describe the new workspace.

## GitHub development checkpoint — 2026-10-17

Record the completed application, documentation, migration history, repository
cleanup, and six workspace improvements together in Git history. The changelog
contains the change inventory; `docs/VERIFICATION.md` maps delivered behavior to
test evidence. Generated assets/reports, dependencies, local configuration, and
operational backups remain outside version control. This checkpoint publishes
source to the existing GitHub repository; application hosting remains a separate
operational decision.

Pre-push verification on 2026-10-17 passed 16 unit, 35 real PostgreSQL integration,
and 45 Chromium browser tests (25.4 seconds for Chromium), staged whitespace
checks, and documentation links. Generated browser reports were cleaned after
the run; source, configuration examples, fixtures, and built assets were retained.

## Verification and definition of done

- Run focused tests while implementing; use `npm test` for the full unit, real PostgreSQL, and Playwright suites at milestone completion.
- Use `npm run benchmark` for exploration measurements; retain the original baseline and report fixture and machine details with comparisons.
- Test data changes for atomic failure, tree isolation, repeat-safe retries, stale updates, and persistence after restart.
- Test user flows with keyboard navigation and a narrow viewport as well as desktop pointer input.
- Treat browser archive recovery, relational database recovery, and media recovery as distinct requirements with explicit coverage.
- Record implemented behavior, verification evidence, and remaining limitations. Do not count schema tables or unverified code as a finished user feature.
- Keep setup instructions and feature documentation consistent with shipped behavior before closing a milestone.

## Implementation principles

- Keep chart behavior stable while changing data persistence; extract modules incrementally.
- Store authoritative relationships in the family model. Treat the wheel's `motherId`/`fatherId` fields as a compatibility projection, not the complete genealogy model.
- Distinguish missing information from known facts. Do not infer unrelated sibling links or silently discard parents.
- Use UUIDs for durable application identity; retain original identifiers and import provenance separately.
- Introduce schema changes through new migrations once an existing migration has been applied.
- Add focused regression tests for data integrity and user flows; use real PostgreSQL for transaction and constraint behavior that the in-memory emulator cannot establish.
- Keep README setup instructions and CHANGELOG behavior notes current as milestones ship.

## Chart design baseline

| Setting | Current baseline |
| --- | --- |
| Canvas/viewBox | 1000 × 1000 |
| Default sweep | 180° |
| Ring width | 58 px |
| Maximum generations | 6 ancestor/descendant rings |
| Center radius | 80 px |
| Outer radius | 428 px |
| Safety margin | 72 px |
| Mode | Fan |

Historical comparison notes: earlier concepts used a 900 px canvas, including a
140° descendant arc with 36 px rings and a Gemini version with a 360° descendant
circle and 75 px rings. These are reference alternatives, not the current target.
The earlier note “visual workspace 43%” has no defined measurement and should be
clarified before using it as an acceptance criterion.

## Decisions to revisit

- Final product name: the repository is Lineage2 and the interface currently says Rootline.
- Whether later releases add GEDCOM 5.5.1 or packaged media beyond the documented GEDCOM 7.0 subset and native backups.
- Whether two parent slots remain the main visual convention or the chart gains a richer family representation.
- Whether to change the current decision to retain editing in the static demo.
- Whether viewers should eventually have a trusted full-tree read-only role in addition to the implemented privacy-filtered role.
- Hosting provider, backup destination/retention, and operational ownership before an external deployment.
- Review publication choices and the documented shared-detail subset before sharing real records.

## Later ideas

Printable charts, SVG/image export, a timeline, place maps, relationship-path
explanations, and research tasks can follow the durable editing and exchange
milestones. External genealogy integrations and automated research are not
scheduled yet.
