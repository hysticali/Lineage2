const { validateArchive, canonicalJson } = require('./archive');
const FIELDS = ['name', 'gender', 'birth', 'death', 'birthplace', 'occupation', 'bio'];
const RECORD_FIELDS = new Set([...FIELDS, 'id', 'uuid', 'motherId', 'fatherId', 'spouseId', 'spouseIds', 'siblingIds']);

function pairKey(a, b) { return JSON.stringify([a, b].sort()); }
function relationshipPairs(family, field) {
  const pairs = new Map();
  for (const person of Object.values(family)) {
    const ids = [...(person[field] || []), ...(field === 'spouseIds' && person.spouseId ? [person.spouseId] : [])];
    for (const id of ids) pairs.set(pairKey(person.id, id), [person.id, id].sort());
  }
  return pairs;
}

function planLocalMigration(current, incoming) {
  validateArchive(incoming);
  const plan = { additions: [], updates: [], parents: [], spouses: [], siblings: [], conflicts: [] };
  if (incoming.rootId !== current.rootId) plan.conflicts.push('The backup root differs from the selected tree. Restore or import it as a separate tree instead.');
  const priorSpouses = relationshipPairs(current.family, 'spouseIds');
  const priorSiblings = relationshipPairs(current.family, 'siblingIds');
  for (const [id, person] of Object.entries(incoming.family)) {
    const existing = current.family[id];
    const unsupported = Object.keys(person).filter((key) => !RECORD_FIELDS.has(key) && canonicalJson(person[key]) !== canonicalJson(existing?.[key]));
    if (unsupported.length) plan.conflicts.push(`${person.name}: extra fields (${unsupported.join(', ')}) need a full archive import to preserve them.`);
    if (!existing) {
      plan.additions.push({ id, name: person.name });
    } else {
      if (person.uuid && existing.uuid && person.uuid !== existing.uuid) plan.conflicts.push(`${person.name}: this identifier belongs to a different database record.`);
      const changes = FIELDS.filter((field) => Object.hasOwn(person, field) && (person[field] || '') !== (existing[field] || ''))
        .map((field) => ({ field, before: existing[field] || '', after: person[field] || '' }));
      if (changes.length) plan.updates.push({ id, name: person.name, changes });
    }
    for (const slot of ['mother', 'father']) {
      const parentId = person[`${slot}Id`];
      if (!parentId || existing?.[`${slot}Id`] === parentId) continue;
      if (existing?.[`${slot}Id`]) plan.conflicts.push(`${person.name}: the displayed ${slot} differs. Review the relationship in the editor before migrating.`);
      else plan.parents.push({ childId: id, parentId, slot });
    }
  }
  for (const [key, pair] of relationshipPairs(incoming.family, 'spouseIds')) if (!priorSpouses.has(key)) plan.spouses.push(pair);
  for (const [key, pair] of relationshipPairs(incoming.family, 'siblingIds')) if (!priorSiblings.has(key)) plan.siblings.push(pair);
  plan.relationships = plan.parents.length + plan.spouses.length + plan.siblings.length;
  return plan;
}

module.exports = { FIELDS, planLocalMigration };
