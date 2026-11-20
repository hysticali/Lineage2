const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildWheel, buildDescendantWheel, extractYear } = require('../../src/domain/wheel');
const { getInitials, splitDisplayName, truncateLabel, formatLifespan, generationLabel } = require('../../frontend/format');

test('extractYear parses GEDCOM approximate, full, and numeric dates and sorts siblings chronologically', () => {
  assert.equal(extractYear('ABT 1942'), 1942);
  assert.equal(extractYear('12 MAY 1898'), 1898);
  assert.equal(extractYear(1910), 1910);
  assert.equal(extractYear('Unknown'), 9999);

  const family = {
    child: { id: 'child', name: 'Child', motherId: 'mom' },
    mom: { id: 'mom', name: 'Mom', birth: 'ABT 1960', siblingIds: ['older', 'younger', 'undated'] },
    older: { id: 'older', name: 'Older', birth: '14 JAN 1955', siblingIds: ['mom'] },
    younger: { id: 'younger', name: 'Younger', birth: 'BEF 1965', siblingIds: ['mom'] },
    undated: { id: 'undated', name: 'Undated', siblingIds: ['mom'] },
  };
  const { wedges } = buildWheel('child', family, new Set(), 'mom', null);
  const ring1 = wedges.filter((w) => w.generation === 1 && w.person).map((w) => w.person.id);
  assert.deepEqual(ring1, ['older', 'mom', 'younger', 'undated']);
});

test('wheel keys stay angle-independent and expose hasMore and empty-slot metadata', () => {
  const family = {
    a: { id: 'a', name: 'A', motherId: 'b', fatherId: 'c' },
    b: { id: 'b', name: 'B', motherId: 'd', siblingIds: ['b2'] },
    b2: { id: 'b2', name: 'B2', siblingIds: ['b'] },
    c: { id: 'c', name: 'C' },
    d: { id: 'd', name: 'D', motherId: 'e' },
    e: { id: 'e', name: 'E' },
  };
  const plain = buildWheel('a', family, new Set(), null, null).wedges;
  const withSibs = buildWheel('a', family, new Set(), 'b', null).wedges;

  const momPlain = plain.find((w) => w.person?.id === 'b');
  const momWithSibs = withSibs.find((w) => w.person?.id === 'b');
  assert.equal(momPlain.key, momWithSibs.key);

  const gma = plain.find((w) => w.person?.id === 'd');
  assert.equal(gma.hasMore, true);
  assert.equal(gma.lineageSide, 'maternal');

  const emptyGrandparent = plain.find((w) => !w.person && w.parentChildId === 'c' && w.slot === 'mother');
  assert.ok(emptyGrandparent);
  assert.equal(emptyGrandparent.lineageSide, 'paternal');

  const desc = buildDescendantWheel('e', {
    e: { id: 'e', name: 'E' },
    d: { id: 'd', name: 'D', motherId: 'e' },
    b: { id: 'b', name: 'B', motherId: 'd' },
    a: { id: 'a', name: 'A', motherId: 'b' },
  }, new Set()).wedges;
  const gen2 = desc.find((w) => w.person?.id === 'b');
  assert.equal(gen2.hasMore, true);
});

test('format helpers handle empty, single-word, multi-word, and long strings safely', () => {
  assert.equal(getInitials('Aria Hartwell'), 'AH');
  assert.equal(getInitials('  Aria   Marie   Hartwell  '), 'AH');
  assert.equal(getInitials('Madonna'), 'MA');
  assert.equal(getInitials('   '), '?');

  assert.deepEqual(splitDisplayName('Aria Hartwell'), { first: 'Aria', rest: 'Hartwell' });
  assert.deepEqual(splitDisplayName('Solo'), { first: 'Solo', rest: '' });
  assert.deepEqual(splitDisplayName(''), { first: 'Unknown', rest: '' });

  assert.equal(truncateLabel('Short', 10), 'Short');
  assert.equal(truncateLabel('Very Long Name Here', 10), 'Very Long…');

  assert.equal(formatLifespan('1942', '2020'), '1942–2020');
  assert.equal(formatLifespan('ABT 1942', ''), 'ABT 1942–?');
  assert.equal(formatLifespan('', ''), '');

  assert.equal(generationLabel(2, 'ancestors', 'maternal', false), 'Maternal Grandparent');
  assert.equal(generationLabel(1, 'ancestors', 'paternal', true), 'Paternal Parent · Sibling');
  assert.equal(generationLabel(2, 'descendants', 'descendant', false), 'Grandchild');
});
