const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--reports-only')) throw new Error('Usage: node scripts/clean.js [--reports-only]');
  const projectRoot = path.resolve(__dirname, '..');
  const reports = ['test-results', 'playwright-report', 'blob-report', 'coverage'];
  const directories = args[0] === '--reports-only' ? reports : ['assets', ...reports];
  for (const directory of directories) await fs.rm(path.join(projectRoot, directory), { recursive: true, force: true });
  console.log(`Cleaned generated output: ${directories.join(', ')}`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
