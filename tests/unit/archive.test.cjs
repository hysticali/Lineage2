const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBackup, parseBackup, validateArchive, fingerprint } = require('../../src/domain/archive');
const sample = require('../../family-data.json');

test('backup round trip preserves all records and extension fields', () => {
  const archive = structuredClone(sample);
  archive.family.aria.research = { citations: [{ source: 'Register', page: '12' }] };
  const backup = createBackup(archive, { id: 'tree-one', name: 'One' });
  const restored = parseBackup(JSON.stringify(backup));
  assert.deepEqual(restored.archive, archive);
  assert.equal(restored.tree.id, 'tree-one');
  assert.equal(restored.summary.people, 45);
});

test('fingerprints ignore object key order but detect changed values', () => {
  assert.equal(fingerprint({ a: { x: 1, y: 2 }, b: 3 }), fingerprint({ b: 3, a: { y: 2, x: 1 } }));
  assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }));
});

test('restore rejects invalid format, record IDs, missing relatives, and cycles', () => {
  assert.throws(() => parseBackup('oops'), /valid JSON/);
  assert.throws(() => parseBackup('{"version":99}'), /Unsupported/);
  const original = { rootId: 'a', family: { a: { id: 'a', name: 'A' }, b: { id: 'b', name: 'B' } } };
  for (const [mutate, pattern] of [
    [(x) => { x.rootId = 'missing'; }, /Root/],
    [(x) => { x.family.a.id = 'b'; }, /ID/],
    [(x) => { x.family.a.motherId = 'missing'; }, /Missing relative/],
    [(x) => { x.family.a.fatherId = 'a'; }, /own relative/],
    [(x) => { x.family.a.motherId = 'b'; x.family.b.motherId = 'a'; }, /cycle/],
    [(x) => { x.family.a.spouseIds = ['b', 'b']; }, /unique/],
  ]) {
    const input = structuredClone(original); mutate(input);
    assert.throws(() => validateArchive(input), pattern);
  }
  assert.throws(() => validateArchive(JSON.parse('{"rootId":"a","family":{"a":{"id":"a","name":"A","__proto__":{}}}}')), /Unsupported field/);
});

test('validation accepts repeated ancestors and long acyclic lineages', () => {
  const family = {};
  for (let i = 0; i < 10000; i++) family[`p${i}`] = { id: `p${i}`, name: `P ${i}`, ...(i < 9999 && { motherId: `p${i + 1}` }) };
  family.p0.fatherId = 'p2';
  assert.equal(validateArchive({ rootId: 'p0', family }).people, 10000);
});
