const { randomUUID } = require('node:crypto');
const { InputError, resolvePerson, assertNoCycles } = require('./edit-tree');
const { snapshotTree } = require('./tree-backup');
const normalize = text => String(text || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function duplicateCandidates(archive) {
  const groups = new Map(), candidates = [];
  let truncated = false;
  for (const person of Object.values(archive.family)) {
    const key = normalize(person.name);
    if (!key || key === 'unknown person') continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(person);
  }
  for (const group of groups.values()) for (const other of group.slice(1)) {
    if (candidates.length >= 200) { truncated = true; break; }
    candidates.push({ survivorId: group[0].id, duplicateId: other.id, name: group[0].name, firstBirth: group[0].birth || '', secondBirth: other.birth || '', reason: 'Same normalized full name; review dates, relatives, and evidence before merging.' });
  }
  return { candidates, truncated };
}

function mergePlan(snapshot, survivorId, duplicateId, choices = {}) {
  const d = snapshot.tables;
  const survivor = d.persons.find(p => p.id === survivorId), duplicate = d.persons.find(p => p.id === duplicateId);
  if (!survivor || !duplicate) throw new InputError('Both people must belong to this tree', 404);
  if (survivorId === duplicateId) throw new InputError('Choose two different people');
  const allNames = d.person_names.filter(n => [survivorId, duplicateId].includes(n.person_id));
  const survivorName = allNames.find(n => n.person_id === survivorId && n.is_primary);
  const duplicateName = allNames.find(n => n.person_id === duplicateId && n.is_primary);
  const primaryNameId = choices.primaryNameId || survivorName?.id || duplicateName?.id;
  if (primaryNameId && !allNames.some(n => n.id === primaryNameId)) throw new InputError('Primary name must be one of these people’s names');
  const genderChoice = choices.genderChoice || (survivor.sex ? 'survivor' : 'duplicate');
  if (!['survivor', 'duplicate'].includes(genderChoice)) throw new InputError('Choose which recorded gender to retain');
  const parentFamilies = d.family_children.filter(c => [survivorId, duplicateId].includes(c.person_id));
  const preferredFamilyId = choices.preferredFamilyId || parentFamilies.find(c => c.person_id === survivorId && c.is_preferred)?.family_id || parentFamilies.find(c => c.is_preferred)?.family_id || parentFamilies[0]?.family_id || null;
  if (preferredFamilyId && !parentFamilies.some(c => c.family_id === preferredFamilyId)) throw new InputError('Preferred family must belong to one of these people');
  const errors = [], warnings = [];
  const replace = id => id === duplicateId ? survivorId : id;
  const parents = new Map();
  const partners = new Map();
  for (const p of d.family_partners) { if (!partners.has(p.family_id)) partners.set(p.family_id, []); partners.get(p.family_id).push(p); }
  for (const c of d.family_children) for (const p of partners.get(c.family_id) || []) {
    const kid = replace(c.person_id), parent = replace(p.person_id);
    if (!parents.has(kid)) parents.set(kid, new Set()); parents.get(kid).add(parent);
  }
  const done = new Set();
  let cyclic = false;
  for (const id of parents.keys()) {
    const active = new Set(), stack = [[id, false]];
    while (stack.length && !cyclic) {
      const [current, leave] = stack.pop();
      if (leave) { active.delete(current); done.add(current); continue; }
      if (done.has(current)) continue;
      if (active.has(current)) { cyclic = true; break; }
      active.add(current); stack.push([current, true]);
      for (const parent of parents.get(current) || []) stack.push([parent, false]);
    }
    if (cyclic) break;
  }
  if (cyclic) errors.push('Merging these people would create a self-parent link or ancestry cycle.');
  for (const collection of [d.family_children, d.family_partners]) {
    for (const losing of collection.filter(c => c.person_id === duplicateId)) {
      const kept = collection.find(c => c.person_id === survivorId && c.family_id === losing.family_id);
      if (!kept) continue;
      if ('pedigree' in losing && (kept.pedigree !== losing.pedigree || kept.relationship_status !== losing.relationship_status)) errors.push('A shared family has conflicting pedigree or relationship status. Keep these separate assertions until that conflict is resolved.');
      if ('role' in losing && (kept.role !== losing.role || kept.parent_slot !== losing.parent_slot)) errors.push('These people occupy different partner roles in the same family; that relationship must be reviewed before merging.');
    }
  }
  for (const losing of d.identifiers.filter(i => i.entity_id === duplicateId)) {
    if (d.identifiers.some(i => i.entity_id === survivorId && i.identifier_type === losing.identifier_type && i.value === losing.value && i.authority_uri !== losing.authority_uri)) errors.push('An identifier has conflicting authorities; resolve it before merging.');
  }
  if (survivor.sex !== duplicate.sex) warnings.push('The recorded genders differ. The selected value is retained; original imports and the pre-merge recovery state remain available.');
  if (parentFamilies.filter(c => c.is_preferred).length > 1) warnings.push('Both people have a preferred parent family. The chosen family will be shown in the fan; all parent families are retained.');
  warnings.push('All names, events, notes, citations, attachments, and identifiers are retained. Identical family links are folded; separate assertions remain separate records.');
  if (survivor.is_public || duplicate.is_public) warnings.push('Publication is retained only when both people are explicitly approved deceased records without person restrictions. Otherwise review the merged person’s privacy settings before sharing.');
  return {
    revision: snapshot.tree.revision, survivorId, duplicateId,
    survivor: { name: survivorName?.full_text || 'Unknown person', gender: survivor.sex }, duplicate: { name: duplicateName?.full_text || 'Unknown person', gender: duplicate.sex },
    choices: { primaryNameId, genderChoice, preferredFamilyId },
    names: allNames.map(n => ({ id: n.id, name: n.full_text, owner: n.person_id === survivorId ? 'survivor' : 'duplicate' })),
    parentFamilies: [...new Set(parentFamilies.map(f => f.family_id))].map(id => ({ id, pedigree: parentFamilies.filter(f => f.family_id === id).map(f => f.pedigree).join(', ') })),
    transferred: { names: allNames.filter(n => n.person_id === duplicateId).length, events: d.facts.filter(f => f.person_id === duplicateId).length, notes: d.notes.filter(n => n.person_id === duplicateId).length, partnerLinks: d.family_partners.filter(p => p.person_id === duplicateId).length, parentFamilies: parentFamilies.filter(c => c.person_id === duplicateId).length, citations: d.citations.filter(c => c.target_entity_id === duplicateId).length, mediaLinks: d.media_links.filter(m => m.target_entity_id === duplicateId).length },
    warnings, errors: [...new Set(errors)],
  };
}

async function resolveMerge(client, treeId, request, snapshot) {
  const survivor = await resolvePerson(client, treeId, request.survivorId), duplicate = await resolvePerson(client, treeId, request.duplicateId);
  return mergePlan(snapshot || await snapshotTree(client, treeId), survivor, duplicate, request.choices);
}

async function previewMerge(pool, treeId, request) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await resolveMerge(client, treeId, request);
    await client.query('COMMIT'); return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function mergePeople(client, treeId, request, snapshot, archive) {
  const plan = await resolveMerge(client, treeId, request, snapshot);
  if (plan.errors.length) throw new InputError(plan.errors.join(' '));
  const { survivorId: keep, duplicateId: other, choices } = plan;
  const displayReference = Object.values(archive.family).find(p => p.uuid === keep)?.id || keep;
  const genders = snapshot.tables.persons;
  const gender = genders.find(p => p.id === (choices.genderChoice === 'survivor' ? keep : other)).sex;
  const people = genders.filter(p => [keep, other].includes(p.id));
  const livingStatus = people.some(p => p.living_status === 'LIVING') ? 'LIVING' : people.every(p => p.living_status === 'DECEASED') ? 'DECEASED' : 'UNKNOWN';
  const published = people.every(p => p.is_public) && livingStatus === 'DECEASED' && !snapshot.tables.restrictions.some(r => [keep, other].includes(r.entity_id));
  await client.query('UPDATE persons SET living_status = $1, is_public = $2 WHERE id = $3', [livingStatus, published, keep]);
  await client.query('UPDATE persons SET sex = $1, display_reference = $2 WHERE id = $3', [gender, displayReference, keep]);
  await client.query('UPDATE person_names SET is_primary = false WHERE person_id = ANY($1::uuid[])', [[keep, other]]);
  for (const [table, owner] of [['person_names', 'person_id'], ['facts', 'person_id'], ['notes', 'person_id']]) {
    await client.query(`UPDATE ${table} SET ${owner} = $1, position = position + (SELECT COALESCE(MAX(position), -1) + 1 FROM ${table} WHERE ${owner} = $1) WHERE ${owner} = $2`, [keep, other]);
  }
  if (choices.primaryNameId) await client.query('UPDATE person_names SET is_primary = true WHERE id = $1', [choices.primaryNameId]);
  await client.query('UPDATE family_children SET is_preferred = false WHERE person_id = ANY($1::uuid[])', [[keep, other]]);
  await client.query(`INSERT INTO family_children (family_id, person_id, position, pedigree, relationship_status, is_preferred)
    SELECT family_id, $1, position, pedigree, relationship_status, false FROM family_children WHERE person_id = $2 ON CONFLICT (family_id, person_id) DO NOTHING`, [keep, other]);
  await client.query('DELETE FROM family_children WHERE person_id = $1', [other]);
  if (choices.preferredFamilyId) await client.query('UPDATE family_children SET is_preferred = true WHERE person_id = $1 AND family_id = $2', [keep, choices.preferredFamilyId]);
  await client.query(`INSERT INTO family_partners (family_id, person_id, position, role, parent_slot)
    SELECT family_id, $1, position, role, parent_slot FROM family_partners WHERE person_id = $2 ON CONFLICT (family_id, person_id) DO NOTHING`, [keep, other]);
  await client.query('DELETE FROM family_partners WHERE person_id = $1', [other]);
  await client.query(`DELETE FROM identifiers losing USING identifiers kept WHERE losing.entity_id = $2 AND kept.entity_id = $1
    AND losing.identifier_type = kept.identifier_type AND losing.value = kept.value`, [keep, other]);
  await client.query('UPDATE identifiers SET entity_id = $1 WHERE entity_id = $2', [keep, other]);
  await client.query('UPDATE citations SET target_entity_id = $1 WHERE target_entity_id = $2', [keep, other]);
  await client.query('INSERT INTO media_links (media_object_id, target_entity_id) SELECT media_object_id, $1 FROM media_links WHERE target_entity_id = $2 ON CONFLICT DO NOTHING', [keep, other]);
  await client.query('DELETE FROM media_links WHERE target_entity_id = $1', [other]);
  await client.query('INSERT INTO restrictions (entity_id, restriction) SELECT $1, restriction FROM restrictions WHERE entity_id = $2 ON CONFLICT DO NOTHING', [keep, other]);
  await client.query('UPDATE import_xrefs SET entity_id = $1 WHERE entity_id = $2', [keep, other]);
  await client.query('UPDATE gedcom_fragments SET owner_entity_id = $1 WHERE owner_entity_id = $2', [keep, other]);
  const binding = snapshot.tables.gedcom_nodes.find(n => n.entity_id === other);
  if (binding) {
    if (snapshot.tables.gedcom_nodes.some(n => n.entity_id === keep)) await client.query('INSERT INTO gedcom_fragments (id, owner_entity_id, import_job_id, node) VALUES ($1, $2, $3, $4::jsonb)', [randomUUID(), keep, binding.import_job_id, JSON.stringify(binding.node)]);
    else await client.query('UPDATE gedcom_nodes SET entity_id = $1 WHERE entity_id = $2', [keep, other]);
  }
  await client.query('UPDATE extension_nodes SET parent_entity_id = $1 WHERE parent_entity_id = $2', [keep, other]);
  await client.query('UPDATE trees SET root_person_id = $1 WHERE id = $3 AND root_person_id = $2', [keep, other, treeId]);
  await client.query('DELETE FROM entities WHERE id = $1', [other]);
  await assertNoCycles(client, treeId);
  return plan;
}

module.exports = { duplicateCandidates, mergePlan, previewMerge, mergePeople };
