const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readJson } = require('../../frontend/http.js');

test('readJson parses JSON success, surfaces JSON errors, and handles non-JSON responses', async () => {

  const ok = new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
  assert.deepEqual(await readJson(ok), { ok: true });

  const jsonErr = new Response(JSON.stringify({ error: 'Invalid revision' }), {
    status: 409,
    headers: { 'Content-Type': 'application/json' },
  });
  await assert.rejects(() => readJson(jsonErr, 'Save failed'), (error) => error.status === 409 && error.message === 'Invalid revision');

  const htmlErr = new Response('<html><body>502 Bad Gateway</body></html>', {
    status: 502,
    headers: { 'Content-Type': 'text/html' },
  });
  await assert.rejects(() => readJson(htmlErr, 'Save failed'), (error) => error.status === 502 && /Save failed \(502\)/.test(error.message));

  const htmlOk = new Response('<html><body>Unexpected</body></html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });
  await assert.rejects(() => readJson(htmlOk, 'Load failed'), /Load failed: the server returned an unexpected response/);
});
