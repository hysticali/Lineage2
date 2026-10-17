# API and database model

The Express API is implemented in `src/app.js` and `src/http/access-routes.js`.
This reference lists routes and persistence contracts. User-facing behavior is
in [FEATURES.md](FEATURES.md); account and server configuration is in
[DEPLOYMENT.md](DEPLOYMENT.md).

## Database model

The PostgreSQL schema is defined in [`db/migrations`](../db/migrations). People are
stored as GEDCOM `INDI`-like records and relationships are represented through
`families`, `family_partners`, and `family_children`, corresponding to GEDCOM
`FAM`, partner, and child links. Events, attributes, names, sources, citations,
media, identifiers, restrictions, import metadata, and extension structures are
stored independently so repeated or conflicting assertions are not collapsed.

GEDCOM cross-reference identifiers such as `@I1@` are import-local and belong in
`import_xrefs`. Durable application identity uses UUIDs and GEDCOM `UID`
identifiers. Existing JSON IDs such as `aria` are retained as `REFN` identifiers.


## Routes and write contracts

- `GET /api/health`
- `GET /api/trees`
- `GET /api/trees/:treeId`
- `GET /api/trees/:treeId/people`
- `GET /api/trees/:treeId/family-data`
- `GET /api/family-data` for the first available tree
- `POST /api/trees/:treeId/people` to create a person or link an existing relative
- `PATCH /api/trees/:treeId/people/:personId` to edit a person
- `POST /api/trees/:treeId/local-migration/preview` to review browser changes
- `POST /api/trees/:treeId/local-migration` to apply reviewed browser changes
- `GET /api/trees/:treeId/people/:personId/records` for repeated names, events, notes, sources, citations, and attachment metadata
- `POST /api/trees/:treeId/people/:personId/records` to add or edit a record with `kind`, `fields`, and optional `recordId`
- `GET /api/trees/:treeId/media/:fileId` to download a stored attachment
- `GET /api/trees/:treeId/backup` for a full relational tree backup including stored files
- `POST /api/backups/preview` and `/api/backups/restore` to preview and restore a missing tree
- `POST /api/trees/:treeId/restore` to replace a tree with a reviewed full backup
- `GET /api/trees/:treeId/history` and `/history/:changeId/preview` for recovery previews
- `POST /api/trees/:treeId/history/:changeId/restore` to recover the state before an edit
- `POST /api/gedcom/preview` and `/api/gedcom/import` for reviewed imports into a new tree
- `POST /api/trees/:treeId/gedcom/preview` and `/gedcom/import` to review and add records to an existing tree
- `GET /api/trees/:treeId/gedcom` for GEDCOM text and an export report
- `GET /api/trees/:treeId/imports` and `/imports/:importId/source` for provenance and original source download
- `GET /api/trees/:treeId/duplicates` for matching-name suggestions
- `POST /api/trees/:treeId/merge/preview` and `/merge` for explicit, reversible person merges
- `GET /api/auth/session`; `POST /api/auth/setup`, `/login`, `/logout`, and `/password` for private-mode account/session management
- `GET /api/auth/invitations/:token` and `POST /api/auth/invitations/:token/accept` for explicit invitation acceptance
- `PATCH /api/trees/:treeId/people/:personId/privacy` for living status and publication approval
- `GET /api/trees/:treeId/access` for owner membership/link/activity management
- `POST /api/trees/:treeId/access/invitations` and `/shares` to generate expiring links
- `PATCH /api/trees/:treeId/access/members/:userId` to review role changes or removal
- `POST /api/trees/:treeId/access/invitations/:id/revoke` and `/shares/:id/revoke` to revoke links
- `GET /api/share/:token` and `/api/share/:token/gedcom` for a filtered, read-only view

Mutations to an existing tree require a UUID `requestId` and the loaded tree's
`expectedRevision`. New-tree imports/restores require a request ID; account and
access-management requests use their own fields.
Repeating the same request returns the original result; reusing an ID with
different changes or saving a stale revision returns 409. Person/family writes
are transactional and reject cross-tree references, duplicate relationships,
self-links, and ancestry cycles. The editor preserves form contents on failure
and offers a refresh before retrying a stale edit. A delayed retry of an already
completed request returns the current tree state so it cannot replace newer
browser data with an old response.

The `family-data` endpoints return the current `{ rootId, family }` shape so the
wheel can move to the database without a chart rewrite. The page requests
`/api/family-data` first and falls back to the static `family-data.json` when it
is served without the backend (an HTML 404 from a plain static file server).
Backend errors show a retry action and preserve browser data. Responses also
include `treeId`, `treeName`, `revision`, and all `families` so local state is
isolated per archive and additional parent families remain available.


## Private-mode access

Except for readiness, session/setup/login, invitation acceptance, and valid
read-only share links, private-mode data routes require an authenticated session.
Tree routes also require membership. Owners/editors can use complete tree data;
viewers can use only the filtered tree summary, people list, chart projection,
and GEDCOM export. Viewer writes, records/evidence, original sources, media,
full backups, history, and access management are denied.

`GET /api/trees/:treeId/gedcom` defaults to approved basic details in private
mode. An owner/editor can explicitly request `?includePrivate=true`; a viewer
cannot. `/api/share/:token` and its GEDCOM route always use the filtered subset,
even when the recipient is signed in as an owner. Local mode is a trusted
single-user workspace restricted to loopback.
