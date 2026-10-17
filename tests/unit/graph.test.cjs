const { test } = require('node:test');
const assert = require('node:assert/strict');
const { searchPeople, lineagePath, getChildren, getSiblings } = require('../../src/domain/graph');
const { buildWheel, buildDescendantWheel } = require('../../src/domain/wheel');

test('search combines normalized name, date, and place terms and returns bounded pages', () => {
  const family = {};
  for (let i = 0; i < 10000; i++) family[`p${i}`] = { id: `p${i}`, name: `Élodie ${String(i).padStart(5, '0')}`, birth: 'ABT 1900', birthplace: 'Montréal' };
  const first = searchPeople(family, 'ELODIE Montreal 1900');
  assert.equal(first.total, 10000);
  assert.equal(first.people.length, 25);
  assert.equal(first.people[0].id, 'p0');
  assert.equal(searchPeople(family, 'elodie', 25).people[0].id, 'p25');
  assert.equal(searchPeople(family, 'absent').total, 0);
  const changed = { ...family, extra: { id: 'extra', name: 'New Person' } };
  assert.equal(searchPeople(changed, 'New Person').total, 1);
  assert.equal(searchPeople(family, 'New Person').total, 0);
});

test('graph index preserves half siblings without inventing transitive sibling links', () => {
  const family = {
    a: { id: 'a', name: 'A', motherId: 'p', siblingIds: ['b'] },
    b: { id: 'b', name: 'B', siblingIds: ['c'] },
    c: { id: 'c', name: 'C' },
    d: { id: 'd', name: 'D', fatherId: 'p' },
    p: { id: 'p', name: 'Parent' },
  };
  assert.deepEqual(getSiblings('a', family).map(p => p.id).sort(), ['b', 'd']);
  assert.deepEqual(getChildren('p', family).map(p => p.id).sort(), ['a', 'd']);
});

test('lineage paths terminate on long lineages, repeated ancestors, and cycles', () => {
  const family = {};
  for (let i = 0; i < 10000; i++) family[`p${i}`] = { id: `p${i}`, name: `P ${i}`, ...(i < 9999 && { motherId: `p${i + 1}` }) };
  assert.equal(lineagePath('p0', 'p9999', family, 'ancestors').size, 9999);
  assert.equal(lineagePath('p9999', 'p0', family, 'descendants').size, 9999);
  const cyclic = { ...family, p9999: { ...family.p9999, motherId: 'p0' } };
  assert.equal(lineagePath('p0', 'missing', cyclic, 'ancestors').size, 0);
  assert.equal(lineagePath('p0', 'missing', cyclic, 'descendants').size, 0);
  assert.deepEqual([...lineagePath('p0', 'p0', family, 'ancestors')], ['p0']);
});

test('fan geometry gives repeated ancestors distinct keys and bounds cyclic traversal', () => {
  const family = {
    a: { id: 'a', name: 'A', motherId: 'b', fatherId: 'c' },
    b: { id: 'b', name: 'B', motherId: 'd' },
    c: { id: 'c', name: 'C', motherId: 'd' },
    d: { id: 'd', name: 'D', motherId: 'a' },
  };
  const expanded = new Set(Object.keys(family));
  const ancestors = buildWheel('a', family, expanded);
  assert.ok(ancestors.wedges.filter(w => w.person?.id === 'd').length >= 2);
  for (const result of [ancestors, buildDescendantWheel('a', family, expanded)]) {
    assert.equal(new Set(result.wedges.map(w => w.key)).size, result.wedges.length);
    assert.ok(result.wedges.length <= 126);
    assert.ok(result.wedges.every(w => w.generation <= 6 && !/NaN|Infinity/.test(w.path)));
  }
});
