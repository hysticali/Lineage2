const fs = require('node:fs/promises');
const path = require('node:path');
const { createPool } = require('./pool');

const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, '../../db/migrations');

async function runMigrations(pool, migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  const bookkeeping = await pool.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_name = 'schema_migrations'`,
  );
  if (bookkeeping.rowCount === 0) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT current_timestamp
      )
    `);
  }

  const files = (await fs.readdir(migrationsDir))
    .filter((filename) => filename.endsWith('.sql'))
    .sort();

  const newlyApplied = [];
  for (const filename of files) {
    const sql = await fs.readFile(path.join(migrationsDir, filename), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize concurrent migrators (e.g. two servers starting at once).
      // The lock is held until COMMIT/ROLLBACK, and the applied check runs
      // after acquiring it so a migration is never executed twice.
      await client.query('LOCK TABLE schema_migrations IN EXCLUSIVE MODE');
      const alreadyApplied = await client.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [filename],
      );
      if (alreadyApplied.rowCount > 0) {
        await client.query('COMMIT');
        continue;
      }
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [filename],
      );
      await client.query('COMMIT');
      newlyApplied.push(filename);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${filename} failed: ${error.message}`, {
        cause: error,
      });
    } finally {
      client.release();
    }
  }

  return newlyApplied;
}

async function main() {
  require('dotenv').config();
  const pool = createPool();
  try {
    const applied = await runMigrations(pool);
    console.log(
      applied.length > 0
        ? `Applied migrations: ${applied.join(', ')}`
        : 'Database is already up to date',
    );
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { DEFAULT_MIGRATIONS_DIR, runMigrations };
