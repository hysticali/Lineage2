const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { createPool } = require('../db/pool');

function connectionEnv(connectionString, env = process.env) {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use PostgreSQL');
  const result = { ...env, PGHOST: url.hostname.replace(/^\[|\]$/g, ''), PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGDATABASE: decodeURIComponent(url.pathname.slice(1)) || 'postgres', PGPASSWORD: decodeURIComponent(url.password), PGCONNECT_TIMEOUT: '15' };
  const supported = { sslmode: 'PGSSLMODE', sslcert: 'PGSSLCERT', sslkey: 'PGSSLKEY', sslrootcert: 'PGSSLROOTCERT', sslcrl: 'PGSSLCRL', sslcrldir: 'PGSSLCRLDIR', sslpassword: 'PGSSLPASSWORD', channel_binding: 'PGCHANNELBINDING', options: 'PGOPTIONS', application_name: 'PGAPPNAME', connect_timeout: 'PGCONNECT_TIMEOUT' };
  for (const [key, value] of url.searchParams) {
    if (!Object.hasOwn(supported, key)) throw new Error(`Unsupported backup connection parameter: ${key}`);
    result[supported[key]] = value;
  }
  return result;
}
async function run(binary, args, env, output = 'ignore') {
  await new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env, stdio: ['ignore', output, 'pipe'], shell: false });
    // Do not echo connection details, user data, or tool stderr into logs.
    child.stderr.resume();
    child.once('error', () => reject(new Error('PostgreSQL client tool could not start. Install matching pg_dump/pg_restore or set its executable path.')));
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`PostgreSQL client tool failed (exit ${code}). Check tool/server versions, database access, and archive integrity.`)));
  });
}
async function checksum(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}
async function backupDatabase(connectionString, filename, options = {}) {
  if (!filename) throw new Error('A new output filename is required');
  const output = path.resolve(filename), temporary = `${output}.partial-${randomUUID()}`;
  const file = await fs.open(temporary, 'wx', 0o600);
  try {
    await run(options.binary || process.env.PG_DUMP_BIN || 'pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--no-password'], connectionEnv(connectionString, options.env), file.fd);
    await file.sync(); await file.close();
    // link is an atomic publish that refuses to replace an existing backup.
    await fs.link(temporary, output);
    return { filename: output, sha256: await checksum(output), bytes: (await fs.stat(output)).size };
  } finally { await file.close().catch(() => {}); await fs.unlink(temporary).catch(() => {}); }
}
async function restoreDatabase(connectionString, filename, options = {}) {
  if (!filename) throw new Error('A trusted backup filename is required');
  if (options.sha256 && await checksum(filename) !== options.sha256.toLowerCase()) throw new Error('Backup SHA-256 checksum does not match');
  const env = connectionEnv(connectionString, options.env);
  const pool = createPool(connectionString);
  try {
    const objects = await pool.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      UNION ALL SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' LIMIT 1`);
    if (objects.rowCount) throw new Error('Restore requires an empty database. Create a new recovery database; existing data will not be overwritten.');
    await run(options.binary || process.env.PG_RESTORE_BIN || 'pg_restore', ['--single-transaction', '--exit-on-error', '--no-owner', '--no-privileges', '--no-password', '--dbname', env.PGDATABASE, path.resolve(filename)], env);
    // Retain credentials/memberships, but require fresh authentication after a
    // disaster recovery rather than reactivating old bearer sessions.
    await pool.query('DELETE FROM auth_sessions');
    return { restored: true, sessionsRevoked: true };
  } finally { await pool.end(); }
}
module.exports = { backupDatabase, restoreDatabase, checksum, connectionEnv };
