const http = require('node:http');
const { startPostgres } = require('./postgres.cjs');
const { runMigrations } = require('../../src/db/migrate');
const { importLegacyFamily } = require('../../src/services/import-legacy-family');
const { TreeRepository } = require('../../src/repositories/tree-repository');
const { createApp } = require('../../src/app');
const sample = require('../../family-data.json');

async function main() {
  const mode = process.argv[2];
  if (!['local', 'private'].includes(mode)) throw new Error('Usage: node tests/helpers/server.cjs local|private');
  const port = mode === 'private' ? 43175 : 43174;
  const database = await startPostgres();
  let server;
  let stopped = false;
  async function stop() {
    if (stopped) return;
    stopped = true;
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await database.stop();
  }
  try {
    await runMigrations(database.pool);
    await importLegacyFamily(database.pool, sample);
    if (mode === 'local') await importLegacyFamily(database.pool, sample, { treeKey: 'second', treeName: 'Second family' });
    const auth = mode === 'private' ? {
      mode, origin: `http://127.0.0.1:${port}`, secureCookies: false,
      setupToken: 'browser-test-setup-secret-at-least-32-characters',
    } : {};
    server = http.createServer(createApp({ repository: new TreeRepository(database.pool), auth }));
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    console.log(`${mode} browser fixture ready on port ${port}`);
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (error) { await stop(); throw error; }
}

main().catch(() => { console.error('Browser test fixture failed'); process.exitCode = 1; });
