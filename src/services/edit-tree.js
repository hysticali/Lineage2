const { randomUUID, createHash } = require('node:crypto');
const { canonicalJson } = require('../domain/archive');
const { TreeRepository } = require('../repositories/tree-repository');
const { FIELDS, planLocalMigration } = require('../domain/local-migration');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PEDIGREES = new Set(['BIRTH', 'ADOPTED', 'FOSTER', 'SEALING', 'UNKNOWN']);

class InputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function validatePerson(person) {
  if (!person || typeof person !== 'object' || Array.isArray(person)) throw new InputError('Person fields are required');
  const fields = new Set(['name', 'gender', 'birth', 'death', 'birthplace', 'occupation', 'bio']);
  for (const [key, value] of Object.entries(person)) {
    if (!fields.has(key)) throw new InputError(`Unsupported person field: ${key}`);
    if (typeof value !== 'string' || value.length > 100000) throw new InputError(`Invalid ${key}`);
  }
  if (typeof person.name !== 'string' || !person.name.trim() || person.name.length > 500) throw new InputError('A name of 1–500 characters is required');
  if (person.gender && !['M', 'F', 'X', 'U'].includes(person.gender)) throw new InputError('Invalid gender');
}

async function entity(client, treeId, type) {
  const id = randomUUID();
  await client.query('INSERT INTO entities (id, tree_id, entity_type) VALUES ($1, $2, $3)', [id, treeId, type]);
  return id;
}

async function resolvePerson(client, treeId, id) {
  if (typeof id !== 'string' || !id) throw new InputError('Person ID is required');
  const result = await client.query(
    `SELECT DISTINCT p.id FROM persons p JOIN entities e ON e.id = p.id
     LEFT JOIN identifiers i ON i.entity_id = p.id AND i.identifier_type IN ('REFN', 'UID')
     WHERE e.tree_id = $1 AND (p.id::text = $2 OR i.value = $2)`, [treeId, id]);
  if (result.rowCount !== 1) throw new InputError('Person was not found uniquely in this tree', 404);
  return result.rows[0].id;
}

async function writePerson(client, treeId, fields, personId = null) {
  validatePerson(fields);
  let id = personId;
  if (!id) {
    id = await entity(client, treeId, 'PERSON');
    await client.query('INSERT INTO persons (id, sex) VALUES ($1, $2)', [id, fields.gender || null]);
    await client.query("INSERT INTO identifiers (id, entity_id, identifier_type, value) VALUES ($1, $2, 'UID', $3)", [randomUUID(), id, id]);
  } else if (fields.gender !== undefined) {
    await client.query('UPDATE persons SET sex = $1 WHERE id = $2', [fields.gender || null, id]);
  }
  const name = await client.query('SELECT id, full_text FROM person_names WHERE person_id = $1 AND is_primary', [id]);
  const parts = fields.name.trim().split(/\s+/);
  const surname = parts.length > 1 ? parts.pop() : null;
  if (name.rowCount) {
    if (name.rows[0].full_text !== fields.name.trim()) await client.query('UPDATE person_names SET full_text = $1, given_names = $2, surname = $3 WHERE id = $4', [fields.name.trim(), parts.join(' '), surname, name.rows[0].id]);
  } else {
    const nameId = await entity(client, treeId, 'NAME');
    await client.query('INSERT INTO person_names (id, person_id, full_text, given_names, surname, is_primary) VALUES ($1, $2, $3, $4, $5, true)', [nameId, id, fields.name.trim(), parts.join(' '), surname]);
  }
  for (const [field, tag, position] of [['birth', 'BIRT', 0], ['death', 'DEAT', 1], ['occupation', 'OCCU', 2]]) {
    if (fields[field] === undefined && !(tag === 'BIRT' && fields.birthplace !== undefined)) continue;
    const current = await client.query('SELECT id, date_original, place_id FROM facts WHERE person_id = $1 AND gedcom_tag = $2 ORDER BY position, id LIMIT 1', [id, tag]);
    let fact = current.rows[0];
    if (!fact && !fields[field] && !(tag === 'BIRT' && fields.birthplace)) continue;
    if (!fact) {
      fact = { id: await entity(client, treeId, 'FACT'), date_original: null, place_id: null };
      await client.query('INSERT INTO facts (id, person_id, position, fact_kind, gedcom_tag) VALUES ($1, $2, $3, $4, $5)', [fact.id, id, position, tag === 'OCCU' ? 'ATTRIBUTE' : 'EVENT', tag]);
    }
    let placeId = fact.place_id;
    if (tag === 'BIRT' && fields.birthplace !== undefined) {
      placeId = null;
      if (fields.birthplace.trim()) {
        placeId = await entity(client, treeId, 'PLACE');
        await client.query('INSERT INTO places (id, name) VALUES ($1, $2)', [placeId, fields.birthplace.trim()]);
      }
    }
    if (tag === 'OCCU') {
      await client.query('UPDATE facts SET value_text = $1 WHERE id = $2', [fields[field], fact.id]);
    } else {
      const date = fields[field] === undefined ? fact.date_original : fields[field] || null;
      // Preserve date expressions verbatim; clear parsed components when edited
      // so old exact years cannot contradict a new approximate date.
      await client.query(`UPDATE facts SET date_original = $1, place_id = $2,
        date_start_year = NULL, date_start_month = NULL, date_start_day = NULL,
        date_end_year = NULL, date_end_month = NULL, date_end_day = NULL,
        date_calendar = NULL, date_modifier = NULL WHERE id = $3`, [date, placeId, fact.id]);
    }
  }
  if (fields.bio !== undefined) {
    const notes = await client.query('SELECT id FROM notes WHERE person_id = $1 ORDER BY position, id LIMIT 1', [id]);
    if (notes.rowCount) await client.query('UPDATE notes SET text_value = $1 WHERE id = $2', [fields.bio, notes.rows[0].id]);
    else if (fields.bio) {
      const noteId = await entity(client, treeId, 'NOTE');
      await client.query('INSERT INTO notes (id, person_id, text_value) VALUES ($1, $2, $3)', [noteId, id, fields.bio]);
    }
  }
  return id;
}

async function migrateLocal(client, treeId, before, incoming) {
  let plan;
  try { plan = planLocalMigration(before, incoming); }
  catch (error) { throw new InputError(error.message); }
  if (plan.conflicts.length) throw new InputError(plan.conflicts.join(' '), 409);
  const fieldsFor = (person) => Object.fromEntries(FIELDS.filter((field) => person[field] !== undefined).map((field) => [field, person[field]]));
  for (const addition of plan.additions) {
    const id = await writePerson(client, treeId, fieldsFor(incoming.family[addition.id]));
    await client.query("INSERT INTO identifiers (id, entity_id, identifier_type, value) VALUES ($1, $2, 'REFN', $3)", [randomUUID(), id, addition.id]);
  }
  for (const update of plan.updates) {
    const id = await resolvePerson(client, treeId, update.id);
    await writePerson(client, treeId, fieldsFor(incoming.family[update.id]), id);
  }
  for (const link of plan.parents) {
    const id = await resolvePerson(client, treeId, link.parentId);
    await linkRelative(client, treeId, id, { type: link.slot, targetId: link.childId, pedigree: 'UNKNOWN' });
  }
  for (const [a, b] of plan.spouses) {
    const ids = [await resolvePerson(client, treeId, a), await resolvePerson(client, treeId, b)];
    const prior = await client.query('SELECT a.family_id FROM family_partners a JOIN family_partners b ON a.family_id = b.family_id WHERE a.person_id = $1 AND b.person_id = $2', ids);
    if (!prior.rowCount) await createFamily(client, treeId, ids.map((id) => ({ id })));
  }
  for (const [a, b] of plan.siblings) {
    const ids = [await resolvePerson(client, treeId, a), await resolvePerson(client, treeId, b)];
    const prior = await client.query('SELECT a.family_id FROM family_children a JOIN family_children b ON a.family_id = b.family_id WHERE a.person_id = $1 AND b.person_id = $2', ids);
    if (prior.rowCount) continue;
    const familyId = await createFamily(client, treeId, []);
    for (const id of ids) {
      const existing = await client.query('SELECT family_id FROM family_children WHERE person_id = $1 AND is_preferred', [id]);
      await addChild(client, familyId, id, 'UNKNOWN', !existing.rowCount);
    }
  }
  await assertNoCycles(client, treeId);
}

async function createFamily(client, treeId, partners) {
  const familyId = await entity(client, treeId, 'FAMILY');
  await client.query('INSERT INTO families (id) VALUES ($1)', [familyId]);
  for (let position = 0; position < partners.length; position++) {
    await client.query(`INSERT INTO family_partners (family_id, person_id, position, role, parent_slot)
      VALUES ($1, $2, $3, 'PARTNER', $4)`, [familyId, partners[position].id, position, partners[position].slot || null]);
  }
  return familyId;
}

async function addChild(client, familyId, personId, pedigree, preferred) {
  if (preferred) await client.query('UPDATE family_children SET is_preferred = false WHERE person_id = $1', [personId]);
  await client.query('INSERT INTO family_children (family_id, person_id, pedigree, is_preferred) VALUES ($1, $2, $3, $4)', [familyId, personId, pedigree, preferred]);
}

async function assertNoCycles(client, treeId) {
  const links = await client.query(`SELECT fc.person_id AS child, fp.person_id AS parent
    FROM family_children fc JOIN family_partners fp ON fp.family_id = fc.family_id
    JOIN entities e ON e.id = fc.family_id WHERE e.tree_id = $1`, [treeId]);
  const parents = new Map();
  for (const { child, parent } of links.rows) {
    if (!parents.has(child)) parents.set(child, new Set());
    parents.get(child).add(parent);
  }
  const done = new Set();
  for (const id of parents.keys()) {
    const active = new Set(), stack = [[id, false]];
    while (stack.length) {
      const [current, leave] = stack.pop();
      if (leave) { active.delete(current); done.add(current); continue; }
      if (done.has(current)) continue;
      if (active.has(current)) throw new InputError('This relationship would create an ancestry cycle');
      active.add(current); stack.push([current, true]);
      for (const parent of parents.get(current) || []) stack.push([parent, false]);
    }
  }
}

async function linkRelative(client, treeId, personId, request) {
  const { type, targetId, parentSlot, pedigree = 'UNKNOWN' } = request;
  if (!['person', 'mother', 'father', 'parent', 'child', 'sibling', 'spouse'].includes(type)) throw new InputError('Invalid relationship type');
  if (!PEDIGREES.has(pedigree)) throw new InputError('Invalid parentage type');
  if (parentSlot && !['mother', 'father'].includes(parentSlot)) throw new InputError('Invalid display slot');
  if (type === 'person') return;
  const target = await resolvePerson(client, treeId, targetId);
  if (target === personId) throw new InputError('A person cannot be their own relative');
  const coParent = request.coParentId ? await resolvePerson(client, treeId, request.coParentId) : null;
  if (coParent && [personId, target].includes(coParent)) throw new InputError('The co-parent must be a different person');
  const preferred = await client.query('SELECT family_id, pedigree FROM family_children WHERE person_id = $1 AND is_preferred ORDER BY family_id LIMIT 1', [target]);
  if (type === 'spouse') {
    const linked = await client.query(`SELECT a.family_id FROM family_partners a JOIN family_partners b ON a.family_id = b.family_id
      WHERE a.person_id = $1 AND b.person_id = $2`, [personId, target]);
    if (linked.rowCount) throw new InputError('These people are already partners');
    await createFamily(client, treeId, [{ id: target }, { id: personId }]);
  } else if (type === 'child') {
    const partners = [{ id: target, slot: parentSlot || null }, ...(coParent ? [{ id: coParent, slot: parentSlot === 'mother' ? 'father' : parentSlot === 'father' ? 'mother' : null }] : [])];
    const prior = await client.query(`SELECT fc.family_id FROM family_children fc JOIN family_partners fp ON fp.family_id = fc.family_id WHERE fc.person_id = $1 AND fp.person_id = $2`, [personId, target]);
    if (prior.rowCount) throw new InputError('This parent-child relationship already exists');
    const familyId = await createFamily(client, treeId, partners);
    await addChild(client, familyId, personId, pedigree, request.preferred !== false);
  } else if (type === 'sibling') {
    const prior = await client.query(`SELECT a.family_id FROM family_children a JOIN family_children b ON b.family_id = a.family_id WHERE a.person_id = $1 AND b.person_id = $2`, [personId, target]);
    if (prior.rowCount) throw new InputError('These people are already siblings in a family');
    let familyId = preferred.rows[0]?.family_id;
    const partners = familyId ? await client.query('SELECT person_id FROM family_partners WHERE family_id = $1', [familyId]) : { rowCount: 0 };
    if (!partners.rowCount) {
      familyId = await createFamily(client, treeId, []);
      await addChild(client, familyId, target, 'UNKNOWN', !preferred.rowCount);
    }
    const otherPreferred = await client.query('SELECT family_id FROM family_children WHERE person_id = $1 AND is_preferred', [personId]);
    await addChild(client, familyId, personId, partners.rowCount ? pedigree : 'UNKNOWN', !otherPreferred.rowCount);
  } else {
    const slot = type === 'mother' ? 'mother' : type === 'father' ? 'father' : parentSlot || null;
    if (slot && !['mother', 'father'].includes(slot)) throw new InputError('Invalid display slot');
    const prior = await client.query(`SELECT fc.family_id FROM family_children fc JOIN family_partners fp ON fp.family_id = fc.family_id WHERE fc.person_id = $1 AND fp.person_id = $2`, [target, personId]);
    if (prior.rowCount) throw new InputError('This parent-child relationship already exists');
    const projection = await new TreeRepository(client, { inTransaction: true }).getWheelFamilyData(treeId);
    const displayTarget = Object.values(projection.family).find((person) => person.uuid === target);
    if (slot && displayTarget?.[`${slot}Id`]) throw new InputError(`This person already has a displayed ${slot}; use an additional parent family`);
    let familyId = preferred.rows[0]?.family_id;
    if (type === 'parent' || !familyId) {
      familyId = await createFamily(client, treeId, [{ id: personId, slot }, ...(coParent ? [{ id: coParent }] : [])]);
      await addChild(client, familyId, target, pedigree, request.preferred !== false);
    } else {
      const count = await client.query('SELECT COUNT(*)::integer AS count FROM family_partners WHERE family_id = $1', [familyId]);
      await client.query(`INSERT INTO family_partners (family_id, person_id, position, role, parent_slot) VALUES ($1, $2, $3, 'PARTNER', $4)`, [familyId, personId, count.rows[0].count, slot]);
    }
  }
  await assertNoCycles(client, treeId);
}

async function mutateTree(pool, treeId, request, action, context = {}) {
  if (!request || !UUID.test(request.requestId || '')) throw new InputError('A UUID requestId is required');
  if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) throw new InputError('expectedRevision is required');
  const hash = createHash('sha256').update(canonicalJson({ action, request })).digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tree = await client.query('SELECT id, revision FROM trees WHERE id = $1 FOR UPDATE', [treeId]);
    if (!tree.rowCount) throw new InputError('Tree not found', 404);
    let actorRole = 'OWNER';
    if (context.privateMode) {
      actorRole = context.actor?.id ? (await client.query('SELECT role FROM tree_memberships WHERE tree_id = $1 AND user_id = $2', [treeId, context.actor.id])).rows[0]?.role : null;
      if (!['OWNER', 'EDITOR'].includes(actorRole)) throw new InputError('Editor permission is required', 403);
    }
    const previous = await client.query('SELECT request_hash, response FROM mutation_receipts WHERE tree_id = $1 AND request_id = $2', [treeId, request.requestId]);
    if (previous.rowCount) {
      if (previous.rows[0].request_hash !== hash) throw new InputError('Request ID was already used for different changes', 409);
      let response = previous.rows[0].response;
      if (response.archive.revision !== tree.rows[0].revision) {
        const current = await new TreeRepository(client, { inTransaction: true }).getWheelFamilyData(treeId);
        response = { ...response, archive: current, replayed: true };
        if (response.records) {
          try { response.records = await require('./person-records').personRecords(client, treeId, response.personId); }
          catch (error) {
            if (error.status === 404) throw new InputError('This earlier save completed, but the person was subsequently removed. Close the form and refresh the tree.', 409);
            throw error;
          }
        }
      }
      await client.query('COMMIT');
      return response;
    }
    if (tree.rows[0].revision !== request.expectedRevision) throw new InputError('This tree changed in another session. Reload before saving; your form is preserved.', 409);
    const repository = new TreeRepository(client, { inTransaction: true });
    const before = await repository.getWheelFamilyData(treeId);
    const { snapshotTree, validateSnapshot, installSnapshot } = require('./tree-backup');
    const beforeSnapshot = await snapshotTree(client, treeId);
    if (actorRole === 'EDITOR') {
      const locked = new Set(beforeSnapshot.tables.restrictions.filter(r => r.restriction === 'LOCKED').map(r => r.entity_id));
      const affected = new Set([request.recordId, request.fields?.owner_id, request.fields?.target_entity_id, request.fields?.source_id].filter(Boolean));
      const personIds = new Set();
      for (const key of ['personId', 'targetId', 'existingPersonId', 'coParentId', 'survivorId', 'duplicateId']) if (request[key]) personIds.add(await resolvePerson(client, treeId, request[key]));
      if (action === 'migrate-local') {
        const plan = planLocalMigration(before, request.archive);
        const references = new Set([...plan.updates.map(p => p.id), ...plan.parents.flatMap(p => [p.childId, p.parentId]), ...plan.spouses.flat(), ...plan.siblings.flat()]);
        for (const reference of references) if (Object.hasOwn(before.family, reference)) personIds.add(before.family[reference].uuid);
      }
      for (const id of personIds) affected.add(id);
      for (const row of beforeSnapshot.tables.person_names) if (personIds.has(row.person_id)) affected.add(row.id);
      for (const row of beforeSnapshot.tables.facts) if (personIds.has(row.person_id)) affected.add(row.id);
      for (const row of beforeSnapshot.tables.notes) if (personIds.has(row.person_id) || affected.has(row.fact_id)) affected.add(row.id);
      for (const row of [...beforeSnapshot.tables.family_partners, ...beforeSnapshot.tables.family_children]) if (personIds.has(row.person_id)) affected.add(row.family_id);
      for (const row of beforeSnapshot.tables.facts) if (affected.has(row.family_id)) affected.add(row.id);
      for (const row of beforeSnapshot.tables.notes) if (affected.has(row.family_id) || affected.has(row.fact_id)) affected.add(row.id);
      for (const row of beforeSnapshot.tables.citations) if (affected.has(row.target_entity_id)) affected.add(row.id);
      for (const row of beforeSnapshot.tables.citations) if (row.source_id === request.recordId) affected.add(row.target_entity_id);
      for (const row of beforeSnapshot.tables.media_links) if (affected.has(row.target_entity_id)) affected.add(row.media_object_id);
      if ((['restore-tree', 'restore-history'].includes(action) && locked.size) || [...affected].some(id => locked.has(id))) throw new InputError('A locked record requires a tree owner to make this change', 403);
    }
    let personId, recordId, merge, imported;
    if (action === 'edit-person') {
      personId = await resolvePerson(client, treeId, request.personId);
      await writePerson(client, treeId, request.person, personId);
    } else if (action === 'add-relative') {
      personId = request.existingPersonId
        ? await resolvePerson(client, treeId, request.existingPersonId)
        : await writePerson(client, treeId, request.person);
      await linkRelative(client, treeId, personId, request);
    } else if (action === 'migrate-local') {
      await migrateLocal(client, treeId, before, request.archive);
    } else if (action === 'edit-record') {
      ({ personId, recordId } = await require('./person-records').editRecord(client, treeId, request));
    } else if (action === 'merge-people') {
      merge = await require('./merge-people').mergePeople(client, treeId, request, beforeSnapshot, before);
      personId = merge.survivorId;
    } else if (action === 'import-gedcom') {
      imported = await require('./import-gedcom').importGedcom(null, request, { client, treeId, snapshot: beforeSnapshot, archive: before });
    } else if (action === 'set-privacy') {
      personId = await require('./privacy').setPrivacy(client, treeId, request);
    } else if (action === 'restore-tree' || action === 'restore-history') {
      let snapshot = request.backup;
      if (action === 'restore-history') {
        if (!UUID.test(request.changeId || '')) throw new InputError('A history entry ID is required');
        snapshot = (await client.query('SELECT before_snapshot FROM tree_changes WHERE tree_id = $1 AND id = $2', [treeId, request.changeId])).rows[0]?.before_snapshot;
        if (!snapshot) throw new InputError('A complete recovery snapshot is unavailable for this entry', 404);
      }
      validateSnapshot(snapshot);
      if (snapshot.tree.id !== treeId) throw new InputError('Backup belongs to a different tree');
      await installSnapshot(client, snapshot, { existing: true });
      await assertNoCycles(client, treeId);
    } else throw new InputError('Unsupported edit action');
    await client.query('UPDATE trees SET revision = revision + 1, updated_at = current_timestamp WHERE id = $1', [treeId]);
    const after = await repository.getWheelFamilyData(treeId);
    const afterSnapshot = await snapshotTree(client, treeId);
    await client.query('INSERT INTO tree_changes (id, tree_id, revision, action, before_data, after_data, before_snapshot, after_snapshot, actor_id, actor_label) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10)', [randomUUID(), treeId, after.revision, action, JSON.stringify(before), JSON.stringify(after), JSON.stringify(beforeSnapshot), JSON.stringify(afterSnapshot), context.actor?.id || null, context.actor?.username || 'Local user']);
    const response = { personId, ...(recordId && { recordId }), ...(merge && { merge }), ...(imported && { imported }), archive: after };
    if (action === 'edit-record') response.records = await require('./person-records').personRecords(client, treeId, personId);
    await client.query('INSERT INTO mutation_receipts (tree_id, request_id, request_hash, response) VALUES ($1, $2, $3, $4::jsonb)', [treeId, request.requestId, hash, JSON.stringify(response)]);
    await client.query('COMMIT');
    return response;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

module.exports = { InputError, validatePerson, mutateTree, resolvePerson, writePerson, entity, assertNoCycles };
