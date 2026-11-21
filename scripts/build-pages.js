const fs = require('node:fs/promises');
const path = require('node:path');
const esbuild = require('esbuild');

const HEADERS = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'

/assets/*
  Cache-Control: public, max-age=3600
`;

async function main() {
  const root = path.resolve(__dirname, '..');
  const outDir = path.join(root, 'dist');
  const assetsDir = path.join(outDir, 'assets');

  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(assetsDir, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(root, 'frontend/main.jsx')],
    bundle: true,
    outfile: path.join(assetsDir, 'app.js'),
    minify: true,
    sourcemap: false,
    define: { 'process.env.NODE_ENV': '"production"' },
    target: ['es2022'],
  });

  const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  const staticHtml = html.replace('name="lineage-mode" content="auto"', 'name="lineage-mode" content="static"');
  await fs.writeFile(path.join(outDir, 'index.html'), staticHtml, 'utf8');
  await fs.copyFile(path.join(root, 'family-data.json'), path.join(outDir, 'family-data.json'));
  await fs.writeFile(path.join(outDir, '_headers'), HEADERS, 'utf8');

  console.log('Built static site for Cloudflare Pages in dist/');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
