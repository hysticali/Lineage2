const { test } = require('node:test');
const assert = require('node:assert/strict');
const sample = require('../../family-data.json');
const { previewBrowserGedcom, importBrowserGedcom, exportBrowserGedcom } = require('../../src/domain/browser-gedcom');

test('browser GEDCOM export and import round-trips people, root, dates, places, notes, and relationships', () => {
  const exported = exportBrowserGedcom(sample);
  assert.equal(exported.people, 45);
  assert.ok(exported.families > 0);
  assert.ok(exported.source.startsWith('\uFEFF'), 'exported GEDCOM should include leading UTF-8 BOM');
  assert.match(exported.source, /0 HEAD/);
  assert.match(exported.source, /2 VERS 7\.0/);
  assert.match(exported.source, /Aria \/Hartwell\//);

  const encoded = new TextEncoder().encode(exported.source);
  const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(encoded);
  const preview = previewBrowserGedcom(decoded);
  assert.equal(preview.errors.length, 0);
  assert.equal(preview.warnings.length, 0);
  assert.equal(preview.people, 45);

  const { archive } = importBrowserGedcom(exported.source);
  assert.equal(Object.keys(archive.family).length, 45);
  const root = archive.family[archive.rootId];
  assert.equal(root.name, 'Aria Hartwell');
  assert.ok(root.motherId);
  assert.ok(root.fatherId);
  assert.equal(archive.family[root.motherId].name, 'Elena Vasquez');
  assert.equal(archive.family[root.fatherId].name, 'Marcus Hartwell');
  assert.equal(archive.family[root.motherId].birthplace, 'Madrid, Spain');
  assert.equal(archive.family[root.motherId].occupation, 'Concert Violinist');
  assert.ok(archive.family[root.motherId].bio.includes('Boston Symphony'));
});

test('browser GEDCOM import supports arbitrary prose dates and partnerless sibling groups', () => {
  const original = {
    rootId: 'a',
    family: {
      a: { id: 'a', name: 'Alex', birth: 'Spring 1990', siblingIds: ['b'] },
      b: { id: 'b', name: 'Blair', siblingIds: ['a'] },
    },
  };
  const { source } = exportBrowserGedcom(original);
  const { archive } = importBrowserGedcom(source);
  const alex = archive.family[archive.rootId];
  assert.equal(alex.name, 'Alex');
  assert.equal(alex.birth, 'Spring 1990');
  assert.equal(alex.siblingIds.length, 1);
  assert.equal(archive.family[alex.siblingIds[0]].name, 'Blair');
});

test('browser GEDCOM import handles slash-only 1 NAME // without throwing', () => {
  const source = '\uFEFF0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @I1@ INDI\n1 NAME //\n0 TRLR\n';
  const preview = previewBrowserGedcom(source);
  assert.equal(preview.errors.length, 0);
  assert.equal(preview.roots[0].name, 'Unknown person');

  const { archive } = importBrowserGedcom(source);
  assert.equal(archive.family[archive.rootId].name, 'Unknown person');
});
