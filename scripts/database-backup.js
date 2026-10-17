const { backupDatabase, restoreDatabase } = require('../src/operations/backup');
async function main() {
  require('dotenv').config({ quiet: true });
  const [action, filename, ...extra] = process.argv.slice(2);
  if (!['backup', 'restore'].includes(action) || !filename || extra.some(a => !/^--sha256=[a-f0-9]{64}$/i.test(a))) throw new Error('Usage: node scripts/database-backup.js backup|restore FILE [--sha256=HASH]');
  const result = action === 'backup' ? await backupDatabase(process.env.DATABASE_URL, filename) : await restoreDatabase(process.env.DATABASE_URL, filename, { sha256: extra[0]?.slice(9) });
  console.log(JSON.stringify(result));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
