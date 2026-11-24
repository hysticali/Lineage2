const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildWheel, buildDescendantWheel, extractYear, genColor } = require('../../src/domain/wheel');
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

test('format helpers handle empty, single-word, multi-word, suffixes, and long strings safely', () => {
  assert.equal(getInitials('Aria Hartwell'), 'AH');
  assert.equal(getInitials('  Aria   Marie   Hartwell  '), 'AH');
  assert.equal(getInitials('Madonna'), 'MA');
  assert.equal(getInitials('   '), '?');
  assert.equal(getInitials('Alexandria Montgomery-Featherstonehaugh III'), 'AM');
  assert.equal(getInitials('Marcus Hartwell Jr.'), 'MH');
  assert.equal(getInitials('William Gates Sr.'), 'WG');
  assert.equal(getInitials('John Doe II'), 'JD');
  assert.equal(getInitials('Henry Tudor IV'), 'HT');
  assert.equal(getInitials('Charles V'), 'CH');
  assert.equal(getInitials('III'), 'II');

  assert.deepEqual(splitDisplayName('Aria Hartwell'), { first: 'Aria', rest: 'Hartwell' });
  assert.deepEqual(splitDisplayName('Solo'), { first: 'Solo', rest: '' });
  assert.deepEqual(splitDisplayName(''), { first: 'Unknown', rest: '' });

  assert.equal(truncateLabel('Short', 10), 'Short');
  assert.equal(truncateLabel('Very Long Name Here', 10), 'Very Long…');

  assert.equal(formatLifespan('1942', '2020'), '1942–2020');
  assert.equal(formatLifespan('ABT 1942', ''), 'b. ABT 1942');
  assert.equal(formatLifespan('', '2020'), 'd. 2020');
  assert.equal(formatLifespan('', ''), '');

  assert.equal(generationLabel(2, 'ancestors', 'maternal', false), 'Maternal Grandparent');
  assert.equal(generationLabel(1, 'ancestors', 'paternal', true), 'Paternal Parent · Sibling');
  assert.equal(generationLabel(2, 'descendants', 'descendant', false), 'Grandchild');
});

test('genColor palette meets WCAG AA (>= 4.5:1) contrast for light labels and sublabels', () => {
  function hslToRgb(h, s, l) {
    s /= 100;
    l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return [r + m, g + m, b + m];
  }
  const composite = (fg, alpha, bg) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };

  const bg = hslToRgb(230, 30, 10);
  const label = hslToRgb(40, 30, 97);
  for (let gen = 0; gen <= 10; gen++) {
    const match = /^hsl\((\d+),(\d+)%,(\d+)%\)$/.exec(genColor(gen));
    assert.ok(match, `gen ${gen} must be hsl(...)`);
    const wedge = composite(hslToRgb(Number(match[1]), Number(match[2]), Number(match[3])), 0.98, bg);
    const sublabel = composite(label, 0.96, wedge);
    assert.ok(ratio(label, wedge) >= 4.5, `gen ${gen} label contrast below 4.5:1`);
    assert.ok(ratio(sublabel, wedge) >= 4.5, `gen ${gen} sublabel contrast below 4.5:1`);
  }
});
