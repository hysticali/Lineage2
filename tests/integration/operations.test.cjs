const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { startPostgres } = require('../helpers/postgres.cjs');
const { runMigrations } = require('../../src/db/migrate');
const { importLegacyFamily } = require('../../src/services/import-legacy-family');
const { TreeRepository } = require('../../src/repositories/tree-repository');
const { createApp } = require('../../src/app');
const { backupDatabase, restoreDatabase, connectionEnv } = require('../../src/operations/backup');
const { setupAccount, issueSession, createShare } = require('../../src/services/access');

async function contents(pool) {
  const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).rows;
  const result = {};
  for (const { tablename } of tables) {
    assert.match(tablename, /^[a-z_]+$/);
    result[tablename] = (await pool.query(`SELECT row_to_json(t) AS value FROM "${tablename}" t ORDER BY row_to_json(t)::text`)).rows.map(r => r.value);
  }
  return result;
}

test('server-wide pg_dump and pg_restore recover all application tables and exact attachment bytes into a clean installation', async () => {
  const db = await startPostgres(), recovered = await startPostgres();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lineage-backup-verification-'));
  try {
    await runMigrations(db.pool);
    const tree = await importLegacyFamily(db.pool, require('../../family-data.json'));
    const actor = await setupAccount(db.pool, { setupToken: 'test-only-token' }, { token: 'test-only-token', username: 'backup-owner', password: 'backup verification password' });
    const token = await issueSession(db.pool, actor);
    await createShare(db.pool, tree.treeId, actor, { label: 'Recovery link' });
    const app = createApp({ repository: new TreeRepository(db.pool) });
    const records = (await request(app).get(`/api/trees/${tree.treeId}/people/aria/records`).expect(200)).body;
    const bytes = Buffer.from([0, 255, 1, 128, 13, 10, 42]);
    await request(app).post(`/api/trees/${tree.treeId}/people/aria/records`).send({ requestId: randomUUID(), expectedRevision: 0, kind: 'media', fields: { title: 'Original proof', target_entity_id: records.personId, filename: 'proof.bin', data_base64: bytes.toString('base64') } }).expect(200);
    const before = await contents(db.pool);
    const filename = path.join(directory, 'complete.dump');
    async function cli(action, connectionString, args) {
      const child = spawn('npm', ['run', '--silent', `db:${action}`, '--', ...args], { cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: connectionString }, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '', errors = '';
      child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
      assert.equal((await once(child, 'exit'))[0], 0, errors);
      assert.ok(!output.includes(connectionString));
      return JSON.parse(output);
    }
    const backup = await cli('backup', db.connectionString, [filename]);
    assert.ok(backup.bytes > 0); assert.match(backup.sha256, /^[a-f0-9]{64}$/);
    assert.equal((await fs.stat(filename)).mode & 0o777, 0o600);
    await assert.rejects(backupDatabase(db.connectionString, filename), /EEXIST/);
    await assert.rejects(backupDatabase(db.connectionString, path.join(directory, 'failed.dump'), { binary: path.join(directory, 'missing-client-tool') }), /could not start/);
    assert.deepEqual((await fs.readdir(directory)).sort(), ['complete.dump']);
    await assert.rejects(restoreDatabase(recovered.connectionString, filename, { sha256: '0'.repeat(64) }), /checksum/);
    const corrupt = path.join(directory, 'truncated.dump'), dumpBytes = await fs.readFile(filename);
    // Keep the magic/header but remove the table of contents and data.
    await fs.writeFile(corrupt, dumpBytes.subarray(0, 64));
    await assert.rejects(restoreDatabase(recovered.connectionString, corrupt), /client tool failed/);
    assert.deepEqual(await contents(recovered.pool), {});
    await cli('restore', recovered.connectionString, [filename, `--sha256=${backup.sha256}`]);
    const after = await contents(recovered.pool);
    assert.ok(before.auth_sessions.length > 0); before.auth_sessions = [];
    assert.deepEqual(after, before);
    assert.deepEqual((await recovered.pool.query('SELECT content FROM media_blobs')).rows[0].content, bytes);
    assert.deepEqual(await runMigrations(recovered.pool), []);
    const restoredApp = createApp({ repository: new TreeRepository(recovered.pool), auth: { mode: 'private', origin: 'http://127.0.0.1', secureCookies: false } });
    const owner = request.agent(restoredApp);
    await owner.get('/api/trees').set('Cookie', `rootline_session=${token}`).expect(401);
    await owner.post('/api/auth/login').send({ username: actor.username, password: 'backup verification password' }).expect(200);
    assert.equal((await owner.get('/api/trees')).body.trees.length, 1);
    await assert.rejects(restoreDatabase(recovered.connectionString, filename), /empty database/);
    const env = connectionEnv('postgresql://user:secret@127.0.0.1:5432/example?sslmode=require');
    assert.equal(env.PGSSLMODE, 'require'); assert.equal(env.PGPASSWORD, 'secret'); assert.equal(env.PGDATABASE, 'example');
    assert.equal(connectionEnv('postgresql://user:secret@[::1]:5432/example').PGHOST, '::1');
    assert.throws(() => connectionEnv('postgresql://localhost/example?constructor=unexpected'), /Unsupported/);
  } finally { await db.stop(); await recovered.stop(); await fs.rm(directory, { recursive: true, force: true }); }
});

test('the actual server starts in private mode, reports readiness, persists accounts through restart, and shuts down cleanly', async () => {
  const db = await startPostgres();
  let child;
  try {
    const listener = net.createServer();
    await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
    const port = listener.address().port;
    await new Promise(resolve => listener.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    const env = { ...process.env, DATABASE_URL: db.connectionString, PORT: String(port), HOST: '127.0.0.1', AUTH_MODE: 'private', PUBLIC_ORIGIN: origin, SESSION_COOKIE_SECURE: 'false', SETUP_TOKEN: 'server-test-token-with-at-least-32-characters' };
    async function start() {
      child = spawn(process.execPath, ['src/server.js'], { cwd: path.resolve(__dirname, '../..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stderr.resume();
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Server readiness timed out')), 10000);
        child.stdout.on('data', chunk => { if (String(chunk).includes('server-ready')) { clearTimeout(timeout); resolve(); } });
        child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited before readiness: ${code}`)); });
      });
    }
    async function stop() { const exited = once(child, 'exit'); child.kill('SIGTERM'); assert.equal((await exited)[0], 0); child = null; }
    await start();
    await request(origin).get('/api/health').expect(200, { status: 'ok' });
    await request(origin).get('/api/trees').expect(401);
    await request(origin).post('/api/auth/setup').send({ token: env.SETUP_TOKEN, username: 'server-owner', password: 'server verification password' }).expect(201);
    await stop(); await start();
    await request(origin).post('/api/auth/login').send({ username: 'server-owner', password: 'server verification password' }).expect(200);
    await stop();
    const failed = spawn(process.execPath, ['src/server.js'], { cwd: path.resolve(__dirname, '../..'), env: { ...env, AUTH_MODE: 'local', HOST: '0.0.0.0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let errors = ''; failed.stderr.on('data', c => { errors += c; }); failed.stdout.resume();
    assert.equal((await once(failed, 'exit'))[0], 1);
    assert.match(errors, /Local mode can bind only to loopback/); assert.ok(!errors.includes(db.connectionString));
    const logs = [];
    const broken = createApp({ repository: { pool: db.pool, health: async () => { throw new Error('private database details'); }, listTrees: async () => { throw new Error('private database details'); } }, logger: { error: value => logs.push(value) } });
    await request(broken).get('/api/health').expect(503, { status: 'unavailable' });
    const error = await request(broken).get('/api/trees').expect(500);
    assert.ok(error.headers['x-request-id']); assert.ok(!JSON.stringify(error.body).includes('private database details'));
    assert.equal(logs.length, 1); assert.ok(!JSON.stringify(logs).includes('private database details'));
  } finally { if (child) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; } await db.stop(); }
});
