const fs = require('node:fs/promises');
const path = require('node:path');
const { createPool } = require('../src/db/pool');
const { runMigrations } = require('../src/db/migrate');
const { importLegacyFamily } = require('../src/services/import-legacy-family');

async function main() {
  require('dotenv').config();
  const args = process.argv.slice(2);
  const replace = args.includes('--replace');
  const optionValue = (name) =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const treeKey = optionValue('tree-key');
  const treeName = optionValue('tree-name');
  const filenameArg = args.find((arg) => !arg.startsWith('--'));
  const filename = path.resolve(filenameArg || 'family-data.json');
  const input = JSON.parse(await fs.readFile(filename, 'utf8'));
  const pool = createPool();

  try {
    await runMigrations(pool);
    const report = await importLegacyFamily(pool, input, {
      replace,
      sourceFilename: path.basename(filename),
      ...(treeKey && { treeKey }),
      ...(treeName && { treeName }),
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
