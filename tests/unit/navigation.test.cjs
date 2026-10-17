const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveNavigationPerson } = require('../../src/domain/navigation');

test('navigation follows valid merge aliases and ignores inherited property names', () => {
  const family = { root: { id: 'root', name: 'Root' } };
  assert.equal(resolveNavigationPerson(family, { old: 'root' }, 'old'), 'root');
  for (const id of ['constructor', '__proto__', 'toString', 'missing']) assert.equal(resolveNavigationPerson(family, {}, id, 'root'), 'root');
  assert.equal(resolveNavigationPerson(family, { old: 'missing' }, 'old'), null);
});
