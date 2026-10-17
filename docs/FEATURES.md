# Rootline feature guide

This guide describes implemented behavior. The repository is named Lineage2;
the interface is named Rootline. The roadmap in `Projects Notes.md` tracks
delivery and the [operations guide](DEPLOYMENT.md) covers configuration and recovery.

## Explore a family

The default chart is a 180-degree fan with six generation rings in a 1000 × 1000
workspace. Click a person to open details and reveal the relevant branch and
siblings; double-click to center them. Keyboard users can focus a chart person,
press Enter to select, and press R to recenter. The chart's Back control restores
the preceding center, direction, and selection.

**Show descendants** and **Show ancestors** center the currently selected person
and keep their details open. If nobody is selected, the center remains the same.
The URL records the database tree, center, direction, and selection so direct
links, refresh, and browser Back/Forward restore the view. Invalid person links
fall back to the archive root. **Reset view** restores the root and default view while
preserving family edits.

**Find person** in the compact header opens a search drawer; `/` opens it from
outside a form or dialog. Search matches name, recorded birth/death expressions, and birthplace.
It ignores case and accents and combines space-separated terms. **Browse
people** shows a name-sorted list, 25 people per page. Selecting a result centers
that person, closes the drawer, and restores focus to their chart hub, including
people outside the visible fan. **Person details** opens the selected person's
sheet on mobile.

Zoom ranges from 100% to 300% in 25% steps inside a fixed viewport. The hub stays
anchored until you pan. Drag with a mouse or touch after zooming, or focus the
Family wheel region and use the arrow keys. Zoom and resizing preserve the
viewed world point after panning. **Center wheel** (or Home on the region) clears
panning while retaining zoom; **Fit chart** centers the complete wheel at 100%.
Zoom never enlarges the document. Crowded labels shorten or hide, while accessible labels and SVG titles keep
the full name. Empty branches explain that no relatives are recorded.

**Tree tools** opens an overlay with Import and export, Backups and history,
Research, Sharing, and Browser drafts groups as available for the current
archive and permission level. Opening search or tools keeps the wheel's size and
position. Escape closes the active dialog and restores focus; nested previews
and confirmations keep only the active layer interactive. On narrow screens,
people, tools, and details use full-height sheets.

The header shows the archive source and compact save status. Local database
drafts provide **Review draft**; browser storage failures provide **Back up now**.
Recovery warnings remain visible when action is needed. Private accounts expose
password changes and sign-out under **Account**.

Graph indexes are cached per immutable archive snapshot. Path finding is
iterative and tracks visited people; geometry stays bounded to six generations.
Repeated ancestors have distinct rendered occurrence keys. See `PERFORMANCE.md`
for measured targets and fixture limitations.

## Edit people and families

Database mode exposes a tree selector and **Add person**. Select a person to
edit their name, gender, literal birth/death expressions, birthplace, occupation,
and notes. **Add relative** groups parent, child, sibling, spouse, and additional
parent family actions beside the selected person's details.
Relationships can use an existing person, and adding a child allows an explicit
co-parent. Parentage labels include biological, adopted, foster, sealing, and
unknown. Display slots are independent of gender. Details retain all parent
families even though the fan summarizes a preferred two-slot family.

Person and family changes commit together. The server rejects cross-tree
references, self-links, duplicate relationships, and ancestry cycles. A tree
revision detects stale tabs; a request identifier deduplicates identical retries.
Failed forms retain their values. Refreshing a stale form loads current tree
state while keeping the user's proposed fields for a reviewed retry.

Static/demo mode remains browser-local and clearly labels its save status. Its
browser backups are separate from full database backups. A restored local draft
in database mode blocks database editing until it is migrated or discarded.
Migration previews additions, scalar changes, relationships, and conflicts;
retains recovery data; and avoids duplicate people on repeat imports. It refuses
unreviewed existing-parent replacement or unsupported rich-record changes.

## Record assertions and evidence

In database mode, select **Records and evidence** to inspect and edit:

- Multiple names, structured given names/surnames, name type, language, and a primary chart name.
- Repeated events and attributes, each with its tag, description, value, literal date expression, and place.
- Notes on a person, related family, or event, preserving line breaks.
- Shared tree sources with title, author, publication, and abbreviation.
- Citations identifying a source, target person/family/name/event/note, locator, evidence text, and optional quality from 0 to 3.
- Attachments with a caption, description, provenance, and target record.

Conflicting assertions remain separate records. Empty dates stay unknown;
approximate dates and ranges remain as written. Editing a date clears old parsed
components so they cannot contradict the new expression. Editing a place creates
an independent place assertion instead of renaming a place used by other facts.
The fan summarizes the first event of each type and the primary name; the records
view shows all assertions. Source edits affect every citation of that source.

Attachments contain 1 byte to 10 MB per file. Original bytes are stored in
PostgreSQL in the same transaction as their metadata and link. Downloads use an
attachment response, are tree-scoped, and retain the original filename. Each file
has a SHA-256 checksum. Caption/provenance edits preserve the original bytes;
upload another attachment for another original. PostgreSQL backups therefore
include stored files without a separate media directory. External file references
from other formats are not automatically read from disk or fetched from URLs.

## Back up and recover

**Tree tools → Browser drafts → Download backup** exports the active browser archive as
`rootline-archive` version 1. Restore validates IDs, root, references, duplicate
links, and cycles; previews counts; and saves a recovery copy before replacing
the active browser archive. Its limit is 20 MB and 100,000 people. It captures
the browser projection, not every relational evidence record. Browser recovery
copies preserve old source/local states and should be downloaded for durability.

**Tree tools → Backups and history → Download full tree backup** exports `rootline-tree` version 2 (with version 1 restore compatibility): the tree,
genealogy tables, import metadata, extensions, restrictions, citations, media
metadata, original GEDCOM source/structure bindings, and exact stored attachment bytes. Export uses a consistent database
snapshot. Restore previews counts and verifies references and attachment
checksums, including original-source and structure integrity. Restoring a missing tree keeps its original identities and refuses to
overwrite an existing tree. A clean database can restore from the loading/error
screen after migrations are applied. Identical restore retries are repeat-safe.

Replacing an existing tree requires selecting that tree, reviewing the preview,
and confirming. It checks the current revision and retains a full recovery
snapshot of the replaced state. **Edit history** lists the latest 100 changes;
previewing an entry shows the state before that change. Confirming recovery
restores the entire tree to that state, rather than undoing only one field. The
recovery itself creates a new history entry, allowing the replacement to be
reversed. Older entries without full snapshots are labeled unavailable.
History stores complete snapshots, including file bytes, so frequent
edits to trees with large attachments increase database size. Operational
retention and storage monitoring must be planned when hosting.

Full-tree web restore requests are limited to 50 MB. Use PostgreSQL backup tools
for larger archives. Portable tree backups exclude account credentials, operation
receipts, and edit-history logs. Server-wide operational backups are described
in the [operations guide](DEPLOYMENT.md). Keep downloaded backups outside the machine's
browser storage.

## Exchange genealogy with GEDCOM

**Tree tools → Import and export → Import GEDCOM** accepts the supported UTF-8 GEDCOM 7.0 subset. It previews
people/family/source/media counts, root choices, errors, warnings, and retained
unsupported structures. Root choices use a bounded name filter so large archives
do not render every person as a dropdown option. The browser rejects invalid
UTF-8. Limits are 20 MB, 100,000 people, 1,000,000 lines, and 64 levels. GEDCOM
5.5.1 and GEDZIP are outside this release.

The default creates a separate tree with fresh UUIDs. Original source bytes,
filename, checksum, header, raw structures, and scoped cross references remain
available in **Import provenance**. Common names/events, dates, places, family
links, pedigree, notes, sources/citations, repositories, restrictions, and media
references become relational records. Unsupported content is retained and
reported. Original media paths are displayed as references; unavailable files
are not presented as downloadable attachments.

To add records to the current tree, select **Current database tree** before
choosing the file. Review possible name matches and explicitly acknowledge that
people remain separate until merged. The transaction keeps the existing root,
checks the reviewed revision/checksum, and saves a full pre-import recovery
snapshot. Retrying the same confirmation does not import twice. Incompatible
extension schemas require a separate tree to preserve their original meanings.

**Export GEDCOM** previews counts and interoperability warnings. It overlays
current relational assertions onto retained original structures so edits appear
without losing untouched extensions, source detail, or pointer meaning. The
chosen root, additional partners beyond two, extended native facts, and media
provenance use documented Rootline URI definitions; foreign tag meanings are
preserved. Stored file bytes, unsupported native name-language metadata, and
complete recovery state require the native backup. Multiple original headers
remain downloadable; export uses the earliest header and compatible combined
extension definitions. See [the exchange contract](GEDCOM.md) for the full subset.

## Review and merge duplicate people

**Tree tools → Research → Review duplicates** suggests people with the same normalized full name. A
suggestion is evidence for review, not an identity decision. Search/filter the
manual choices to compare any two people. Preview the surviving identity,
transferred records, and relationship warnings; choose the primary name,
recorded gender, and preferred family for the fan before confirming.

Merging retains all names, event assertions, notes, citations, attachments,
restrictions, and identifiers. Identical family links are folded; separate
parent families remain available. The surviving display identity stays stable,
and old UUID/legacy links resolve as aliases. Opaque imported structures retain
their original source and pointer interpretation after merging. **Edit history**
can recover the complete pre-merge tree, including both people and all evidence.

Cross-tree references and ancestry cycles are rejected. Shared-family pedigree
or status conflicts, incompatible partner roles, and conflicting identifier
authorities block the merge instead of silently choosing one assertion. Stale
previews require a fresh review. Delayed retries of completed writes return the
current tree snapshot so newer browser data is preserved.

Merging combines privacy conservatively: living takes precedence, deceased is
retained only when both records are marked deceased, and publication remains
approved only when both people were approved and unrestricted. The preview
explains when publication may need review.

## Accounts and tree permissions

Local mode remains a trusted single-user workspace on loopback. Optional private
mode requires a configured origin and sign-in. Initial owner setup requires a
secret setup token and is available only before any account exists. The first
owner receives existing unowned trees. New GEDCOM trees and newly restored
missing trees belong to the account that creates them.

Accounts have normalized usernames and passwords of at least 12 characters.
Passwords are stored as salted scrypt hashes. Sessions use HttpOnly,
SameSite=Strict cookies, Secure by default, and expire after seven days. Signing
out removes the current session; changing a password removes all sessions.
Failed-login limits reduce repeated guessing. No account credentials or bearer
tokens are stored in browser localStorage.

| Role | Access |
| --- | --- |
| Owner | Complete tree, editing/recovery, membership management, invitations, and links. The final owner cannot be removed or demoted. |
| Editor | Complete permitted tree and editing/recovery, subject to locked-record checks. No membership or sharing administration. |
| Viewer | Approved basic details and relationships only. No writes, original imports, evidence/media, full backups, or history. |

Permissions are enforced by the API, including alternate download, import,
restore, and history paths. Tree mutations recheck editor permission inside the
transaction after locking the tree. Removing permission while a save waits
therefore prevents the queued write. Locked assertions require an owner for
affected edits, local migration, merges, or full-tree replacement.

Private-mode browser workspaces use memory for draft/recovery state; they do not
read or write persistent browser tree caches. Successful writes remain durable
in PostgreSQL and edit history. Unsaved forms survive ordinary save failures,
but refreshing or signing out discards unsaved in-memory work. Browser recovery
copies in private mode last only for that mounted workspace: download a backup
to keep them. Local/static mode retains its existing persistent browser saves.

The interface checks account/tree access every five seconds and on window focus.
It clears the mounted workspace on verified sign-out, denied access, removed
membership, or a role change; moving from editor to viewer discards private tree
state and open forms. Server enforcement applies to each request immediately;
previously downloaded data cannot be recalled. Temporary network/server errors
retain the current in-memory workspace and unsaved forms, show a reconnecting
notice, and retry access checks; confirmed denial still clears it.

## Living people, private records, and exports

Select **Privacy and sharing** to choose unknown/living/deceased status, mark a
record private, and explicitly approve a deceased person's basic details.
Neither an old birth date nor a recorded death event automatically publishes a
person. Living, unknown, unreviewed, private, confidential, and locked people
are withheld from viewers and links. Imported restricted primary names also
prevent a person from appearing.

The shared subset includes the primary name, gender, unrestricted birth/death
expressions, birthplace, and relationships between approved people. Restricted
facts/places/families are omitted. Notes, occupations, source files, citations,
attachments, raw imported structures, private relatives, and recovery data never
enter the filtered response. Viewer tree labels are generic; link labels are
chosen explicitly by the owner. If the original root is private, an approved
person becomes the shared root. If nobody is approved, a private-archive empty
state is shown with zero visible people.

The same policy covers chart data, search/list data, tree summaries, aliases,
relationships, and GEDCOM downloads. Private-mode GEDCOM exports default to the
filtered subset even for owners/editors. Editors can explicitly select **Include
private records and evidence in GEDCOM export**; the interface labels that
download as private. Native full-tree backups always contain the complete
permitted tree, including private data, and are unavailable to viewers/links.

## Invite people and share a read-only view

Owners use **Tree tools → Sharing → Manage tree access** to inspect members and recent access activity,
review role changes/removal, and generate invitations for a specific username.
Invitations assign editor or viewer access and expire in 1–30 days, defaulting
to seven. New invitees create a password; existing invitees sign in with the
matching account. A token can be accepted once. Re-inviting an existing member
does not silently replace their role; owners review role changes separately.

Owners can also create a labeled read-only link with a 1–30-day lifetime.
Recipients can explore approved people and download the filtered GEDCOM without
an account. Navigation and refresh retain the share link. Owners can revoke
pending invitations and links. Removing/demoting an owner also revokes their
pending invitations and links. Revocation takes effect on subsequent requests;
open views clear during the next access check.

Links are displayed only when created; the database stores token hashes.
Copy the link while it is shown. No email is sent automatically. Treat link URLs
as secrets and use labels that are suitable for recipients.

## Operate and recover the installation

Production configuration validates the access mode, bind address, port, public
origin, cookie security, and setup secret. Local mode rejects non-loopback
binding/hostnames. Private hosting requires an HTTPS origin outside loopback;
trusted proxy handling is explicit. The health endpoint checks PostgreSQL and
returns 503 on failure. Request IDs and sanitized JSON errors support diagnosis;
startup/shutdown events and actor-aware genealogy/access history support review.

`npm run db:backup -- FILE` creates a protected custom-format PostgreSQL dump,
refuses to overwrite a file, and reports its SHA-256 and size. It includes all
application tables, credentials/permissions, receipts/history, original sources,
and attachment bytes. `npm run db:restore -- FILE --sha256=HASH` verifies a digest
and restores into an empty database in one transaction. Existing databases are
rejected. Restored accounts and memberships remain usable, but old sessions are
revoked. Database-server roles and external configuration are managed separately.
See [deployment, upgrades, monitoring, retention, and restore drills](DEPLOYMENT.md).

## Verification and limits

Unit tests cover archive validation, graph safety, navigation aliases, search,
geometry, GEDCOM syntax, and extended family/fact export. Real PostgreSQL tests
cover transactions, concurrency, restart persistence, semantic GEDCOM round
trips, provenance/extension integrity, merge/rollback, attachment bytes, clean
restore, version 1 backup compatibility, accounts/permissions, privacy, expiry,
revocation during a queued save, locked records, server lifecycle, and server-wide
dump/restore. Playwright covers static/demo, local database, and private database
and database flows, including previewed imports, export/re-import, duplicate
review, old person links, whole-import recovery, owner setup, publication,
invitation acceptance, editor failed-save retry, viewer isolation, mobile private
editing, role changes, anonymous links, revocation, logout, and password changes.

The final complete run passed 16 unit, 35 real PostgreSQL integration, and 45
Chromium browser tests. The [completion audit](VERIFICATION.md) maps each roadmap
requirement to its implementation and verification evidence.

Known limits: GEDCOM 7.0 subset only; no GEDZIP, email delivery, MFA, email password
recovery, automatic backup scheduler, automatic history pruning, or external
deployment. Privacy approval is manual and editors are trusted with the full
tree. Full snapshots can make attachment-heavy history large. Performance
benchmarks are synthetic computation measurements, not network/render guarantees.
