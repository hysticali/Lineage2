const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseGedcom, serializeGedcom } = require('../../src/domain/gedcom');
const header = '0 HEAD\n1 GEDC\n2 VERS 7.0\n';
const document = (body) => header + body + '0 TRLR\n';

test('GEDCOM container round trip retains pointers, ordered extensions, Unicode, spaces, and multiline at signs', () => {
  const source = '\uFEFF' + document('0 @I1@ INDI\n1 NAME Élodie /Durand/\n1 NOTE me@example.com\n2 CONT @@me and @I are literal\n2 CONT\n2 CONT   leading and trailing  \n1 _CUSTOM one\n2 _NEST two\n1 _CUSTOM three\n1 FAMC @F1@\n0 @F1@ FAM\n1 CHIL @I1@\n1 CHIL @VOID@\n');
  const first = parseGedcom(source);
  const note = first.xrefs.get('@I1@').children.find(n => n.tag === 'NOTE');
  assert.equal(note.value, 'me@example.com\n@me and @I are literal\n\n  leading and trailing  ');
  assert.equal(first.xrefs.get('@I1@').children.find(n => n.tag === 'FAMC').pointer, '@F1@');
  const exported = serializeGedcom(first.records);
  assert.match(exported, /CONT @@me and @I are literal/);
  const second = parseGedcom(exported);
  const semantic = nodes => nodes.map(({ line, children, ...rest }) => ({ ...rest, children: semantic(children) }));
  assert.deepEqual(semantic(second.records), semantic(first.records));
});

test('GEDCOM container rejects malformed hierarchy, pointers, duplicate records, Unicode, and unsupported versions', () => {
  for (const [source, pattern] of [
    [document('0 @I1@ INDI\n2 NAME Bad\n'), /skipped level/],
    [document('0 @I1@ INDI\n1 NOTE Text\n2 CONT More\n3 NOTE Child\n'), /continuation/],
    [document('0 @I1@ INDI\n1 NOTE Text\n2 LANG en\n2 CONT Late\n'), /continuation/],
    [document('0 @I1@ INDI\n1 NOTE @unescaped\n'), /leading literal/],
    [document('0 @I1@ INDI\n1 FAMC @MISSING@\n'), /missing pointer/],
    [document('0 @I1@ INDI\n0 @I1@ INDI\n'), /duplicate/],
    [document('0 @I1@ INDI\n1 @N1@ NAME Bad\n'), /only on a record/],
    [document('0 @VOID@ INDI\n'), /only on a record/],
    [document('0 @I1@ INDI\n1 CONC Bad\n'), /CONC/],
    [document('0 @I1@ INDI\n1 NOTE \n'), /empty payload/],
    [document('0 @I1@ INDI\n1 NOTE Bad\u0000\n'), /Unicode/],
    [document('0 @I1@ INDI\n1 NAME \ud800\n'), /Unicode/],
    [document('0 @I1@ INDI\n').replace('7.0', '5.5.1'), /7.0 UTF-8/],
    [header + '0 @I1@ INDI\n', /TRLR/],
  ]) assert.throws(() => parseGedcom(source), pattern);
});

test('GEDCOM parser bounds nesting and accepts non-BMP Unicode and source line endings', () => {
  assert.doesNotThrow(() => parseGedcom(document('0 @I1@ INDI\n1 NAME Person 😀\n').replaceAll('\n', '\r\n')));
  const nesting = Array.from({ length: 65 }, (_, i) => `${i + 1} _NEST x\n`).join('');
  assert.throws(() => parseGedcom(document('0 @I1@ INDI\n' + nesting)), /64 levels/);
});

test('GEDCOM input exceeding the documented file limit is rejected before parsing', () => {
  assert.throws(() => parseGedcom('x'.repeat(20 * 1024 * 1024 + 1)), /at most 20 MB/);
});
