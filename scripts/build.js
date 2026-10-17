const path = require('node:path');
const esbuild = require('esbuild');

esbuild.build({
  entryPoints: [path.resolve(__dirname, '../frontend/main.jsx')],
  bundle: true,
  outfile: path.resolve(__dirname, '../assets/app.js'),
  minify: true,
  sourcemap: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  target: ['es2022'],
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
