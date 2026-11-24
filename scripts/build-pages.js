const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const esbuild = require('esbuild');

const HEADERS = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'

/
  Cache-Control: no-cache

/index.html
  Cache-Control: no-cache

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;

const ROBOTS_TXT = `User-agent: *
Allow: /
`;

const NOT_FOUND_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#0d0f17" />
    <meta name="robots" content="noindex" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>Page Not Found — Rootline</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 1.5rem;
        background: radial-gradient(ellipse at top, #1f1738 0%, #0d0f17 58%, #07090f 100%);
        color: #f7f5f0;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      }
      main {
        max-width: 30rem;
        width: 100%;
        padding: 2rem;
        border-radius: 0.75rem;
        background: rgba(23, 26, 38, 0.92);
        border: 1px solid #484f6e;
        text-align: center;
        box-shadow: 0 20px 60px -12px rgba(0, 0, 0, 0.65);
      }
      .code {
        margin: 0 0 0.5rem;
        font-size: 0.875rem;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #4cc9f0;
        font-weight: 600;
      }
      h1 {
        margin: 0 0 0.75rem;
        font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
        font-size: 1.75rem;
        line-height: 1.25;
      }
      p {
        margin: 0 0 1.5rem;
        color: #b4bcd0;
        line-height: 1.6;
      }
      a {
        display: inline-block;
        padding: 0.7rem 1.25rem;
        border-radius: 0.625rem;
        background: linear-gradient(135deg, #b86ef0, #45c3f0);
        color: #0d0f17;
        font-weight: 600;
        text-decoration: none;
      }
      a:focus-visible {
        outline: 2px solid #f7f5f0;
        outline-offset: 3px;
      }
    </style>
  </head>
  <body>
    <main>
      <p class="code">404 · Branch Not Found</p>
      <h1>We couldn’t find that page</h1>
      <p>That path isn’t part of the Rootline atlas. Return to the interactive family lineage wheel to continue exploring.</p>
      <a href="/">Return to Rootline</a>
    </main>
  </body>
</html>
`;

async function shortHash(filePath) {
  const bytes = await fs.readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex').slice(0, 10);
}

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

  const jsHash = await shortHash(path.join(assetsDir, 'app.js'));
  const cssHash = await shortHash(path.join(assetsDir, 'app.css'));

  const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  const staticHtml = html
    .replace('name="lineage-mode" content="auto"', 'name="lineage-mode" content="static"')
    .replace('href="/assets/app.css"', `href="/assets/app.css?v=${cssHash}"`)
    .replace('src="/assets/app.js"', `src="/assets/app.js?v=${jsHash}"`);
  await fs.writeFile(path.join(outDir, 'index.html'), staticHtml, 'utf8');
  await fs.writeFile(path.join(outDir, '404.html'), NOT_FOUND_HTML, 'utf8');
  await fs.writeFile(path.join(outDir, 'robots.txt'), ROBOTS_TXT, 'utf8');
  await fs.copyFile(path.join(root, 'favicon.svg'), path.join(outDir, 'favicon.svg'));
  await fs.copyFile(path.join(root, 'family-data.json'), path.join(outDir, 'family-data.json'));
  await fs.writeFile(path.join(outDir, '_headers'), HEADERS, 'utf8');

  console.log(`Built static site for Cloudflare Pages in dist/ (app.js?v=${jsHash}, app.css?v=${cssHash})`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
