const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startPostgres() {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lineage-postgres-test-'));
  const port = await availablePort();
  const password = randomUUID();
  const messages = [];
  const postgres = new EmbeddedPostgres({
    databaseDir: path.join(directory, 'data'), user: 'postgres', password, port,
    persistent: true,
    postgresFlags: ['-h', '127.0.0.1', '-k', directory],
    onLog: (message) => messages.push(message),
    onError: (message) => messages.push(String(message)),
  });
  try {
    await postgres.initialise();
    await postgres.start();
  } catch (error) {
    throw new Error(`Could not start test PostgreSQL: ${error?.message || messages.join('\n')}`);
  }
  const connectionString = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  let pool;
  const clients = new Set();
  function createPool() {
    pool = new Pool({ connectionString });
    pool.on('connect', (client) => {
      clients.add(client);
      client.once('end', () => clients.delete(client));
    });
    return pool;
  }
  async function closePool() {
    // pg Pool.end removes idle clients before their sockets have emitted end.
    // Wait for those end events before sending PostgreSQL a shutdown signal.
    const ended = [...clients].map((client) => new Promise((resolve) => client.once('end', resolve)));
    await pool.end();
    await Promise.all(ended);
  }
  const database = {
    pool: createPool(), connectionString,
    async restart() {
      await closePool();
      await postgres.stop();
      await postgres.start();
      database.pool = createPool();
    },
    async stop() {
      await closePool();
      await postgres.stop();
      // Only delete the freshly-created test directory owned by this helper.
      await fs.rm(directory, { recursive: true, force: true });
    },
  };
  return database;
}

module.exports = { startPostgres };
