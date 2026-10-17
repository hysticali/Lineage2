# Lineage2

Lineage2 is a family history workspace with an interactive lineage fan. The
interface is named Rootline. Explore ancestors and descendants, edit people and
relationships, record evidence, exchange the supported GEDCOM 7.0 subset, and
optionally share approved records through a private installation.

## Local setup

Use Node.js 22 or newer and PostgreSQL. The default is a trusted single-user
workspace bound to `127.0.0.1`.

1. Create a PostgreSQL database.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to your database.
3. Install dependencies with `npm ci`.
4. Apply migrations with `npm run db:migrate`.
5. Optionally load the sample archive with `npm run db:import`.
6. Run `npm start` and open `http://127.0.0.1:4173`.

`npm start` builds the frontend automatically. To use the editable static demo
without PostgreSQL:

```sh
npm run build
python3 -m http.server 4173 --bind 127.0.0.1
```

Static edits are saved in the browser. Database edits are saved to PostgreSQL;
private-mode browser state is held in memory. Switching ancestor/descendant
direction keeps the selected person centered with their details open.

Use **Find person** to search or browse, and **Tree tools** for import/export,
backups, history, duplicate review, and sharing. Both open over the wheel.
Zoom keeps the wheel anchored; drag to pan, **Center wheel** to keep zoom and
return to the hub, or **Fit chart** to show the complete wheel. On mobile,
**Person details** opens the selected person's editing sheet.

The legacy JSON importer refuses to overwrite a tree. Use a separate key to add
another archive:

```sh
npm run db:import -- other-family.json --tree-key=other --tree-name="Other Family"
```

For an intentional replacement of the local sample tree, use
`npm run db:import -- --replace` after backing up any work you need to keep.

## Documentation

| Document | Purpose |
| --- | --- |
| [Feature guide](docs/FEATURES.md) | Exploration, editing, evidence, recovery, accounts, privacy, and sharing. |
| [API reference](docs/API.md) | Routes, write contracts, tree access, and database model. |
| [Operations guide](docs/DEPLOYMENT.md) | Private configuration, HTTPS hosting, upgrades, monitoring, and full database recovery. |
| [GEDCOM contract](docs/GEDCOM.md) | Supported records, versions, extensions, preservation, and limits. |
| [Performance](docs/PERFORMANCE.md) | Measured fixtures, targets, and benchmark records. |
| [Verification](docs/VERIFICATION.md) | Requirement-by-requirement implementation and test evidence. |
| [Project notes and roadmap](Projects%20Notes.md) | Product decisions, milestone status, and later ideas. |
| [Implementation history](docs/history/IMPLEMENTATION_HISTORY.md) | Archived delivery plan, progress, and resolved issues. |
| [Changelog](CHANGELOG.md) | User-visible changes. |

## Project structure

```text
frontend/                 React components, chart UI, storage, and styles
src/
  db/                     PostgreSQL pool and migration runner
  domain/                 Archive, graph, geometry, and GEDCOM logic
  http/                   Access-control routes and middleware
  operations/             Server-wide database backup and restore
  repositories/           Database queries and chart projection
  services/               Transactional edits, evidence, imports, and recovery
  app.js                  Express application and genealogy routes
  config.js               Validated local/private server configuration
  server.js               Startup, migrations, and graceful shutdown
db/migrations/            Ordered schema migrations
scripts/                  Build, clean, import, backup, and benchmark commands
tests/
  e2e/                    Playwright browser flows
  integration/            Real PostgreSQL/API/operations coverage
  unit/                   Domain tests
  helpers/                Disposable PostgreSQL and browser-server fixtures
  fixtures/               GEDCOM evidence used by tests
docs/
  benchmarks/             Distinct baseline, indexed, and final measurements
  history/                Completed implementation history
family-data.json          Shared sample archive used by the demo and tests
index.html                Frontend entry page
```

`assets/`, dependency installations, test reports, and local backups are generated
or local files and are ignored by Git. The sample archive, migration history,
lockfile, test fixtures, and distinct benchmark records are source material.

## Tests and housekeeping

Install Playwright's Chromium and PostgreSQL 18 client tools (`pg_dump` and
`pg_restore`) before the complete suite. Embedded PostgreSQL supplies disposable
servers, not those client tools. Set `PG_DUMP_BIN` and `PG_RESTORE_BIN` if the
clients are outside PATH. Tests do not use your configured application database.
Browser fixtures use ports 4173, 43174, and 43175.

| Command | Purpose |
| --- | --- |
| `npm test` | Build and run unit, real PostgreSQL integration, and browser tests. |
| `npm run test:unit` | Run domain tests. |
| `npm run test:integration` | Run database/API/recovery tests. |
| `npm run test:e2e` | Build and run browser tests. |
| `npm run test:headed` | Run browser tests with visible browser windows. |
| `npm run benchmark` | Print current synthetic exploration measurements. |
| `npm run clean` | Remove generated assets, test reports, and coverage output. |
| `npm run clean:reports` | Remove reports and coverage while keeping built assets. |

The clean commands use a fixed allowlist. They retain source code, dependencies,
`.env`, family data, fixtures, and backups. After a full clean, `npm start`,
`npm test`, or `npm run build` regenerates the frontend assets. To retain a new
benchmark report, pass an explicit filename, for example
`npm run benchmark -- --output=docs/benchmarks/new-measurement.json`; do not
replace the historical baseline.

## Private operation and backups

Private mode is optional and requires an explicit origin, initial setup token,
and sign-in. Outside loopback, use HTTPS and secure session cookies. Owners
manage memberships and expiring invitations/links; viewers see only explicitly
approved deceased people and basic relationships. Review the
[operations guide](docs/DEPLOYMENT.md) before enabling private mode.

Browser archive JSON, native full-tree JSON, and server-wide PostgreSQL dumps
serve different recovery purposes. For complete installation backups, use
`npm run db:backup -- NEW_FILE.dump`; restore into an empty database with
`npm run db:restore -- FILE.dump --sha256=HASH`. Keep database credentials,
external configuration, and backup storage protected as described in the guide.
