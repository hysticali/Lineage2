const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildGedcom } = require('../../src/services/export-gedcom');
const { planGedcom, requireValid } = require('../../src/domain/gedcom-plan');
const { child } = require('../../src/domain/gedcom');

test('native families with three partners export explicit layout slots without inferring gender', () => {
  const data = Object.fromEntries(['persons', 'families', 'sources', 'repositories', 'media_objects', 'entities', 'person_names', 'places', 'facts', 'notes', 'citations', 'media_links', 'media_files', 'media_blobs', 'identifiers', 'restrictions', 'import_xrefs'].map(table => [table, []]));
  data.persons = [{ id: 'p1', sex: 'F' }, { id: 'p2', sex: 'F' }, { id: 'p3', sex: 'U' }, { id: 'c', sex: 'X' }];
  data.families = [{ id: 'f' }];
  data.entities = [...data.persons.map(p => ({ id: p.id, entity_type: 'PERSON' })), { id: 'f', entity_type: 'FAMILY' }];
  data.person_names = data.persons.map(p => ({ id: `n${p.id}`, person_id: p.id, full_text: `Person ${p.id}`, is_primary: true, position: 0 }));
  data.family_partners = [{ family_id: 'f', person_id: 'p1', role: 'PARTNER', parent_slot: 'father', position: 0 }, { family_id: 'f', person_id: 'p2', role: 'PARTNER', parent_slot: 'mother', position: 1 }, { family_id: 'f', person_id: 'p3', role: 'PARTNER', parent_slot: null, position: 2 }];
  data.family_children = [{ family_id: 'f', person_id: 'c', pedigree: 'ADOPTED', position: 0, is_preferred: true }];
  data.facts = [{ id: 'fact', person_id: 'c', family_id: null, gedcom_tag: 'BIRT', fact_kind: 'ATTRIBUTE', value_text: 'A differently typed assertion', position: 0 }];
  const exported = buildGedcom({ tree: { root_person_id: 'c' }, tables: data });
  const plan = requireValid(planGedcom(exported.source));
  assert.equal(plan.families[0].children.filter(plan.isPartner).length, 3);
  const husband = plan.parsed.xrefs.get(child(plan.families[0], 'HUSB').pointer);
  assert.equal(child(husband, 'SEX').value, 'F');
  assert.equal(child(husband, 'NAME').value, 'Person p1');
  assert.ok(exported.warnings.some(w => w.includes('more than two partners')));
  const childRecord = plan.individuals.find(p => child(p, 'NAME')?.value === 'Person c');
  const extended = childRecord.children.map(n => plan.factInfo('INDI', n)).find(Boolean);
  assert.deepEqual(extended, { tag: 'BIRT', kind: 'ATTRIBUTE' });
});
