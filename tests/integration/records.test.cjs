const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { startPostgres } = require('../helpers/postgres.cjs');
const { runMigrations } = require('../../src/db/migrate');
const { importLegacyFamily } = require('../../src/services/import-legacy-family');
const { TreeRepository } = require('../../src/repositories/tree-repository');
const { createApp } = require('../../src/app');
const familyData = require('../../family-data.json');

test('repeated names, events, notes and citations retain assertions through edits and restart', async () => {
  const db = await startPostgres();
  try {
    await runMigrations(db.pool);
    const tree = await importLegacyFamily(db.pool, familyData);
    const app = createApp({ repository: new TreeRepository(db.pool) });
    const endpoint = `/api/trees/${tree.treeId}/people/aria/records`;
    let records = (await request(app).get(endpoint).expect(200)).body;
    const originalBirth = records.events.find(e => e.gedcom_tag === 'BIRT');
    async function save(kind, fields, recordId) {
      const payload = { requestId: randomUUID(), expectedRevision: records.revision, kind, fields, recordId };
      const response = await request(app).post(endpoint).send(payload).expect(200);
      const retry = await request(app).post(endpoint).send(payload).expect(200);
      assert.deepEqual(retry.body, response.body);
      records = response.body.records;
      return response.body;
    }
    const alternate = await save('name', { full_text: 'Aria de la Cruz', given_names: 'Aria', surname: 'de la Cruz', name_type: 'MARRIED', is_primary: false });
    assert.equal(records.names.length, 2);
    assert.equal(alternate.archive.family.aria.name, 'Aria Hartwell');
    await save('name', { is_primary: true }, alternate.recordId);
    assert.equal(records.names.filter(n => n.is_primary).length, 1);
    const event = await save('event', { gedcom_tag: 'BIRT', fact_kind: 'EVENT', date_original: 'BET 1989 AND 1991', place_name: 'Montréal', type_text: 'Conflicting register' });
    assert.equal(records.events.filter(e => e.gedcom_tag === 'BIRT').length, 2);
    assert.equal(event.archive.family.aria.birth, originalBirth.date_original);
    assert.equal(records.events.find(e => e.id === originalBirth.id).date_original, originalBirth.date_original);
    await save('event', { date_original: 'ABT 1899', place_name: 'Paris' }, event.recordId);
    assert.equal(records.events.find(e => e.id === event.recordId).date_original, 'ABT 1899');
    assert.equal(records.events.find(e => e.id === event.recordId).date_start_year, null);
    await save('note', { owner_id: event.recordId, text_value: 'Do not collapse these conflicting dates.\nCompare the original registers.' });
    const source = await save('source', { title: 'Birth register', author: 'Town clerk', publication_text: 'Archive volume 3' });
    const citation = await save('citation', { source_id: source.recordId, target_entity_id: event.recordId, page_text: 'Page 12', data_text: 'Legible date; uncertain identity', quality: 2 });
    await save('citation', { page_text: 'Page 13', quality: null }, citation.recordId);
    const family = records.families[0];
    await save('citation', { source_id: source.recordId, target_entity_id: family.id, page_text: 'Relationship evidence' });
    await save('event', { owner_id: family.id, gedcom_tag: 'MARR', fact_kind: 'EVENT', date_original: 'FROM 1900 TO 1902', place_name: 'Rome' });
    assert.equal(records.citations.length, 2);
    assert.ok(records.notes.some(n => n.fact_id === event.recordId));
    // Editing a basic note must not reparse an unchanged structured surname.
    await request(app).patch(`/api/trees/${tree.treeId}/people/aria`).send({ requestId: randomUUID(), expectedRevision: records.revision, person: { name: 'Aria de la Cruz', bio: 'Basic note edit' } }).expect(200);
    const latest = (await request(app).get(endpoint).expect(200)).body;
    assert.equal(latest.names.find(n => n.is_primary).surname, 'de la Cruz');
    await db.restart();
    const restarted = createApp({ repository: new TreeRepository(db.pool) });
    assert.deepEqual((await request(restarted).get(endpoint).expect(200)).body, latest);
  } finally { await db.stop(); }
});

test('record writes reject foreign references, invalid fields, and stale revisions without partial changes', async () => {
  const db = await startPostgres();
  try {
    await runMigrations(db.pool);
    const tree = await importLegacyFamily(db.pool, familyData);
    const other = await importLegacyFamily(db.pool, familyData, { treeKey: 'other' });
    const app = createApp({ repository: new TreeRepository(db.pool) });
    const endpoint = `/api/trees/${tree.treeId}/people/aria/records`;
    const foreignEndpoint = `/api/trees/${other.treeId}/people/aria/records`;
    const records = (await request(app).get(endpoint)).body;
    const foreign = (await request(app).get(foreignEndpoint)).body;
    const before = (await db.pool.query('SELECT COUNT(*) FROM entities')).rows;
    const failures = [
      { kind: 'name', recordId: foreign.names[0].id, fields: { full_text: 'Wrong tree' }, status: 404 },
      { kind: 'name', recordId: records.names[0].id, fields: { is_primary: false } },
      { kind: 'name', fields: { full_text: 'X', unexpected: 'field' } },
      { kind: 'event', fields: { owner_id: foreign.personId, gedcom_tag: 'BIRT', fact_kind: 'EVENT', place_name: 'Should not persist' } },
      { kind: 'event', fields: { gedcom_tag: 'BIRT', fact_kind: 'INVALID' } },
      { kind: 'citation', fields: { source_id: foreign.personId, target_entity_id: records.personId } },
      { kind: 'source', fields: { title: '' } },
    ];
    for (const { status = 400, ...payload } of failures) {
      await request(app).post(endpoint).send({ requestId: randomUUID(), expectedRevision: 0, ...payload }).expect(status);
      assert.deepEqual((await db.pool.query('SELECT COUNT(*) FROM entities')).rows, before);
      assert.equal((await request(app).get(endpoint)).body.revision, 0);
    }
    const source = await request(app).post(foreignEndpoint).send({ requestId: randomUUID(), expectedRevision: 0, kind: 'source', fields: { title: 'Foreign source' } }).expect(200);
    await request(app).post(endpoint).send({ requestId: randomUUID(), expectedRevision: 0, kind: 'citation', fields: { source_id: source.body.recordId, target_entity_id: records.personId } }).expect(400);
    const first = { requestId: randomUUID(), expectedRevision: 0, kind: 'note', fields: { text_value: 'First tab' } };
    await request(app).post(endpoint).send(first).expect(200);
    await request(app).post(endpoint).send({ ...first, requestId: randomUUID(), fields: { text_value: 'Stale tab' } }).expect(409);
    assert.ok(!(await request(app).get(endpoint)).body.notes.some(n => n.text_value === 'Stale tab'));
  } finally { await db.stop(); }
});

test('explicit parent display slots take priority over gender fallback', async () => {
  const db = await startPostgres();
  try {
    await runMigrations(db.pool);
    const tree = await importLegacyFamily(db.pool, familyData);
    const repository = new TreeRepository(db.pool);
    const original = await repository.getWheelFamilyData(tree.treeId);
    const familyId = original.families.find(f => f.children.some(c => c.personId === 'aria' && c.preferred)).id;
    await db.pool.query('UPDATE family_partners SET parent_slot = $1 WHERE family_id = $2 AND person_id = $3', ['mother', familyId, original.family.marcus.uuid]);
    const projected = await repository.getWheelFamilyData(tree.treeId);
    assert.equal(projected.family.aria.motherId, 'marcus');
    assert.equal(projected.family.aria.fatherId, 'elena');
    assert.equal(projected.family.marcus.gender, 'M');
    assert.equal(projected.family.elena.gender, 'F');
  } finally { await db.stop(); }
});
