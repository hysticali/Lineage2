# Local operation, private hosting, and recovery

The default is a trusted single-user application bound to loopback. Private
hosting is optional. No external service, domain, email delivery, or hosting
account is created by this project.

## Requirements and first start

Use Node.js 22 or newer, PostgreSQL, and the PostgreSQL `pg_dump`/`pg_restore`
client tools. Recovery verification uses PostgreSQL 18 clients against the
disposable PostgreSQL 18 test server. Use client tools compatible with your
server; install them separately from the embedded test server.

```sh
npm ci
cp .env.example .env
chmod 600 .env
# Edit DATABASE_URL in .env to use your own database and credentials.
npm run build
npm run db:migrate
npm run db:import
npm start
```

The sample import is optional and refuses to replace an existing tree unless
explicitly requested. A private workspace can instead import a GEDCOM file or
restore a native tree backup after account setup. Start with an empty database
when importing a server-wide dump; do not run migrations before that restore.

## Configuration

| Setting | Behavior |
| --- | --- |
| `DATABASE_URL` | Required PostgreSQL connection URI. Keep it in a protected environment or `.env`. |
| `PORT` | Integer 1–65535; default 4173. |
| `HOST` | Default `127.0.0.1`. Local mode rejects non-loopback binding. |
| `AUTH_MODE` | `local` by default; `private` enables accounts, sessions, and tree permissions. |
| `PUBLIC_ORIGIN` | Required in private mode. Exact HTTP(S) origin without a path; HTTPS is required outside loopback. |
| `SESSION_COOKIE_SECURE` | Defaults to `true`. Set `false` only for loopback HTTP development. |
| `SETUP_TOKEN` | Random secret of at least 32 characters for creating the first owner. Setup is unavailable after any account exists. |
| `TRUST_PROXY` | Default `false`. Set `loopback` only for a trusted reverse proxy connecting over loopback. |
| `PG_DUMP_BIN`, `PG_RESTORE_BIN` | Optional executable paths; defaults are tools on `PATH`. |

Generate a setup secret locally:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

For local HTTP testing of private mode, use `AUTH_MODE=private`,
`PUBLIC_ORIGIN=http://127.0.0.1:4173`, and `SESSION_COOKIE_SECURE=false`.
Open that exact origin, create the owner account using the setup token, and
remove the token from the environment afterward. Initial setup gives the first
owner control of existing trees that have no membership. Keep the setup token
private; do not put it in a URL or committed configuration.

Passwords require 12–1024 characters and use salted scrypt hashes. Sessions last
seven days and use HttpOnly, SameSite=Strict cookies, with Secure enabled by
default. Password changes revoke all sessions; logout revokes the current one.
Failed login attempts have account and address limits over a 15-minute window.
This release has no email password-reset flow or MFA. Preserve the owner
credentials and maintain a second owner if operational continuity requires it.

## Optional HTTPS hosting

Run the app and database as services under dedicated operating-system accounts.
Keep the application bound to `127.0.0.1`, put a trusted TLS reverse proxy in
front of it, and expose the proxy rather than the application's local port.
Configure `AUTH_MODE=private`, `PUBLIC_ORIGIN=https://your-domain.example`,
`SESSION_COOKIE_SECURE=true`, and `TRUST_PROXY=loopback` for this arrangement.
Do not run local mode through a public reverse proxy.

For example, a Caddyfile can proxy a chosen hostname:

```caddyfile
family.example.com {
    reverse_proxy 127.0.0.1:4173
}
```

Replace the example with your actual DNS name and configure the proxy's service
and certificates. Caddy documents its hostname-based HTTPS and reverse proxy
setup in its [official quick start](https://caddyserver.com/docs/quick-starts/reverse-proxy).
The application trusts forwarded headers only when configured; the proxy must
overwrite client-supplied forwarding headers. See
[Express's proxy guidance](https://expressjs.com/en/guide/behind-proxies/).
The loopback application lifecycle is tested; no external TLS/provider deployment
has been performed by this implementation.

Disable proxy caching for application pages and `/api`. Avoid URL-bearing access
logs for invitation and share requests: their URLs contain bearer secrets. Do
not cache or log cookies, passwords, setup tokens, or request bodies. The app
sets no-store on API responses and the HTML shell, and a no-referrer policy.

## Upgrades, health, and logs

1. Record the current code revision and take a server-wide backup.
2. Stop the application gracefully with SIGTERM and retain its previous build/configuration.
3. Install the new dependencies with `npm ci`, run `npm run build`, and run `npm run db:migrate`.
4. Start the app and check health and sign-in. Startup also runs the migrations under a database lock.
5. If recovery is necessary, restore the pre-upgrade dump to a new empty database and start the matching previous code against it. Do not run older code against an incompatible newer schema.

`GET /api/health` executes a database readiness query. It returns HTTP 200 with
`{"status":"ok"}` or 503 with `{"status":"unavailable"}`. A failed process or
connection also fails the readiness check. Monitor that endpoint from the host
or proxy, process exits, disk usage, database size, and backup age/status.

Startup/shutdown and unexpected request failures produce JSON log events.
API errors include an `X-Request-ID`; unexpected errors return that ID for
correlation without database details. Genealogy history attributes writes to an
account; owners can inspect recent access-management activity in the sharing
dialog. Private data is not sent to an external monitoring service.

The server drains connections on SIGTERM/SIGINT and closes PostgreSQL clients;
after ten seconds it closes remaining HTTP connections. Use your service
manager's restart and log rotation facilities. Choose alert thresholds and an
operator before hosting real data. History stores complete snapshots, including
attachments; monitor its growth. This release does not prune recovery history
automatically.

## Three different backup types

| Backup | Includes | Use |
| --- | --- | --- |
| Browser archive JSON | Active wheel projection and relationships | Recover a local/static draft. It omits full relational evidence. |
| Native full-tree JSON | One tree's genealogy, evidence, privacy flags/restrictions, original imports, and attachment bytes | Move/recover a tree, with preview and history. It excludes accounts, memberships, sessions, receipts, and edit-history logs. |
| Server-wide PostgreSQL dump | All application tables, including accounts, permissions, links, history, receipts, sources, and attachment bytes | Recover the application database into an empty installation. Restoring revokes saved sessions. |

Create a protected backup directory and choose a new filename for every run:

```sh
mkdir -p backups
chmod 700 backups
npm run db:backup -- backups/rootline-2026-10-15.dump
```

The command uses the configured `DATABASE_URL`, emits the filename, byte count,
and SHA-256 digest, and refuses to overwrite an existing file. A new file has
mode 0600 and appears only after `pg_dump` succeeds. Credentials are passed to
the client tool through environment variables, not command arguments. A custom
dump includes stored file bytes because they live in PostgreSQL; there is no
separate attachment directory. PostgreSQL documents the
[custom dump format](https://www.postgresql.org/docs/current/app-pgdump.html).

These are logical backups of one database. Database-server roles, certificates,
`.env`, proxy settings, and operating-system service configuration must be kept
separately in protected operator storage. Choose an encrypted off-machine
destination and retention schedule before hosting. A reasonable starting
operating plan is nightly dumps, an additional dump before upgrades, 30 days of
retention, and a monthly restore drill; adjust it to the acceptable data-loss
window and available storage. No scheduler or remote upload is installed by the
application. Larger installations may need PostgreSQL's
[continuous recovery facilities](https://www.postgresql.org/docs/current/backup.html).

## Clean restore drill

1. Use a trusted dump and verify its recorded SHA-256. Dumps can execute database code, so do not restore files from unknown sources.
2. Create a separate empty PostgreSQL database owned by the intended application database user. Keep the active production database intact and stop app traffic to the restore target.
3. Set `DATABASE_URL` to the recovery database in a protected environment/configuration. Keep passwords out of shell history.
4. Restore before migrating:

```sh
npm run db:restore -- backups/rootline-2026-10-15.dump --sha256=REPLACE_WITH_RECORDED_64_CHARACTER_HEX_DIGEST
npm run db:migrate
npm start
```

The restore refuses a database containing user relations/functions and runs
`pg_restore` in one transaction with error checking. Ownership and database ACLs
are assigned by the target environment rather than copied from another server.
See the [pg_restore documentation](https://www.postgresql.org/docs/current/app-pgrestore.html).
After recovery, saved sessions are deleted and users must sign in again. Existing
invitation/share links retain their previous validity and expiry; revoke them
through the owner interface if the incident requires it.

Confirm sign-in, membership isolation, people/relationship counts, edit history,
privacy-filtered views/exports, and downloaded attachment checksums. Record the
dump digest, code version, recovery date, and outcome. Switch the application to
the recovered database only after these checks. Retain the previous database
until the recovery is accepted.

## Verification commands

```sh
npm test
npm run benchmark
```

The full suite starts disposable PostgreSQL instances; it never uses the
application's configured database. The operations integration test requires
`pg_dump` and `pg_restore` on PATH or their `PG_*_BIN` paths. Browser fixtures use
ports 4173, 43174, and 43175. Playwright's Chromium must also be installed.
The operational test invokes the actual npm backup/restore commands, compares
every application table in a clean restored database, verifies exact binary
attachments, signs in with the recovered account, and checks session revocation.
