const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { planGedcom, requireValid } = require('../../src/domain/gedcom-plan');
const fixture = fs.readFileSync(path.join(__dirname, '../fixtures/evidence.ged'), 'utf8');

test('GEDCOM preview reports all people, family choices, source/media references, and retained extensions', () => {
  const plan = requireValid(planGedcom(fixture));
  assert.equal(plan.report.people, 7);
  assert.equal(plan.report.families, 4);
  assert.equal(plan.report.sources, 1);
  assert.equal(plan.report.media, 1);
  assert.equal(plan.report.roots[0].name, 'Alex de la Cruz');
  assert.ok(plan.report.unsupported.some(n => n.tag === '_RESEARCH'));
  assert.ok(plan.report.unsupported.some(n => n.tag === 'SNOTE'));
  assert.ok(plan.report.unsupported.some(n => n.tag === 'MAP'));
  assert.ok(plan.report.unsupported.some(n => n.tag === 'NOTE' && n.parent === 'NAME'));
  assert.ok(plan.report.warnings.some(w => w.includes('No local file or remote URL')));
});

test('GEDCOM semantic validation rejects wrong record types, duplicate memberships, and ancestry cycles', () => {
  for (const [source, pattern] of [
    [fixture.replace('1 CHIL @I6@', '1 CHIL @S1@'), /must point to a INDI/],
    [fixture.replace('1 CHIL @I6@', '1 CHIL @I6@\n1 CHIL @I6@'), /repeat/],
    [fixture.replace('1 CHIL @I6@', '1 CHIL @I5@'), /own child/],
    [fixture.replace('1 CHIL @VOID@', '1 CHIL @I4@'), /ancestry cycle/],
    [fixture.replace('2 SOUR @S1@', '2 SOUR @I1@'), /must point to a SOUR/],
    [fixture.replace('2 FORM image/jpeg\n', ''), /FORM media type/],
    [fixture.replace('urn:example:research', 'not-an-absolute-uri'), /absolute URI/],
  ]) assert.ok(planGedcom(source).report.errors.some(error => pattern.test(error)), pattern.toString());
});
