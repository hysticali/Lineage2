const { createPool } = require('./db/pool');
const { runMigrations } = require('./db/migrate');
const { TreeRepository } = require('./repositories/tree-repository');
const { createApp } = require('./app');
const { serverConfig } = require('./config');

async function main() {
  require('dotenv').config();
  const config = serverConfig();
  const pool = createPool();
  let server;
  try {
    await runMigrations(pool);
    const app = createApp({ repository: new TreeRepository(pool), auth: config });
    server = require('node:http').createServer(app);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, resolve);
    });
  } catch (error) { await pool.end(); throw error; }
  console.log(JSON.stringify({ event: 'server-ready', mode: config.mode, host: config.host, port: config.port }));

  let stopping = false;
  async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    console.log(JSON.stringify({ event: 'server-stopping', signal }));
    const timeout = setTimeout(() => { server.closeAllConnections(); }, 10000);
    timeout.unref();
    await new Promise(resolve => server.close(resolve));
    await pool.end();
    clearTimeout(timeout);
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error(JSON.stringify({ event: 'startup-failed', message: /^(AUTH_MODE|Local mode|Private mode|PUBLIC_ORIGIN|Private hosting|Insecure session|SETUP_TOKEN|PORT|DATABASE_URL)/.test(error.message) ? error.message : 'Startup failed. Check database connectivity, migrations, build assets, and listen address.', code: error.code || error.cause?.code || null }));
  process.exitCode = 1;
});
