require('dotenv').config();
const { createPool } = require('../src/db/pool');
const { pruneDatabase } = require('../src/operations/prune');

function parseArgs(argv) {
  const options = { apply: false };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg.startsWith('--keep-history=')) options.keepHistory = Number(arg.split('=')[1]);
    else if (arg.startsWith('--receipt-days=')) options.receiptDays = Number(arg.split('=')[1]);
    else if (arg.startsWith('--security-days=')) options.securityDays = Number(arg.split('=')[1]);
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const pool = createPool();
  try {
    const result = await pruneDatabase(pool, options);
    console.log(JSON.stringify(result, null, 2));
    if (!result.apply) {
      console.error('Dry run only. Re-run with --apply to delete the reported rows.');
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

