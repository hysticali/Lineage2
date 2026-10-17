const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { startPostgres } = require('../helpers/postgres.cjs');
const { runMigrations } = require('../../src/db/migrate');
const { importLegacyFamily } = require('../../src/services/import-legacy-family');
const { TreeRepository } = require('../../src/repositories/tree-repository');
const { createApp } = require('../../src/app');
const { parseGedcom, children, child } = require('../../src/domain/gedcom');
const { importGedcom } = require('../../src/services/import-gedcom');
const familyData = require('../../family-data.json');
const { createHash } = require('node:crypto');

test('reviewed merges retain assertions, aliases, canonical identity, and recover the complete previous state', async () => {
  const db = await startPostgres();
  try {
    await runMigrations(db.pool);
    const tree = await importLegacyFamily(db.pool, familyData);
    const repository = new TreeRepository(db.pool), app = createApp({ repository });
    const endpoint = `/api/trees/${tree.treeId}`;
    const created = await request(app).post(`${endpoint}/people`).send({ expectedRevision: 0, requestId: randomUUID(), type: 'person', person: { name: 'Aria Hartwell', gender: 'X', birth: 'ABT 1996', bio: 'Duplicate research note' } }).expect(201);
    const duplicate = created.body.personId;
    const original = (await request(app).get(`${endpoint}/backup`)).body;
    const candidates = (await request(app).get(`${endpoint}/duplicates`).expect(200)).body;
    assert.ok(candidates.candidates.some(c => [c.survivorId, c.duplicateId].includes(duplicate)));
    const body = { survivorId: 'aria', duplicateId: duplicate };
    const plan = (await request(app).post(`${endpoint}/merge/preview`).send(body).expect(200)).body;
    assert.deepEqual(plan.errors, []);
    assert.equal(plan.transferred.events, 1);
    assert.ok(plan.warnings.some(w => /genders differ/.test(w)));
    const payload = { ...body, choices: plan.choices, expectedRevision: plan.revision, requestId: randomUUID() };
    const merged = (await request(app).post(`${endpoint}/merge`).send(payload).expect(200)).body;
    assert.equal(Object.keys(merged.archive.family).length, 45);
    assert.equal(merged.archive.family.aria.gender, 'F');
    assert.equal(merged.archive.family.aria.birth, familyData.family.aria.birth);
    assert.equal(merged.archive.family.aria.bio, familyData.family.aria.bio);
    assert.equal(merged.archive.aliases[duplicate], 'aria');
    const records = (await request(app).get(`${endpoint}/people/aria/records`).expect(200)).body;
    assert.equal(records.names.length, 2);
    assert.equal(records.events.filter(e => e.gedcom_tag === 'BIRT').length, 2);
    assert.ok(records.notes.some(n => n.text_value === 'Duplicate research note'));
    await request(app).get(`${endpoint}/people/${duplicate}/records`).expect(200);
    assert.deepEqual((await request(app).post(`${endpoint}/merge`).send(payload).expect(200)).body, merged);
    await request(app).post(`${endpoint}/merge`).send({ ...payload, requestId: randomUUID() }).expect(409);
    const change = (await request(app).get(`${endpoint}/history`)).body.changes[0];
    assert.equal(change.action, 'merge-people');
    await request(app).post(`${endpoint}/history/${change.id}/restore`).send({ expectedRevision: merged.archive.revision, requestId: randomUUID() }).expect(200);
    const restored = (await request(app).get(`${endpoint}/backup`)).body;
    assert.deepEqual(restored.tables, original.tables);
    assert.equal(restored.tree.root_person_id, original.tree.root_person_id);
  } finally { await db.stop(); }
});

test('merges reject ancestor cycles, foreign references, and conflicting shared memberships without changes', async () => {
  const db = await startPostgres();
  try {
    await runMigrations(db.pool);
    const tree = await importLegacyFamily(db.pool, familyData);
    const other = await importLegacyFamily(db.pool, familyData, { treeKey: 'other' });
    const repository = new TreeRepository(db.pool), app = createApp({ repository });
    const endpoint = `/api/trees/${tree.treeId}`;
    const original = (await request(app).get(`${endpoint}/backup`)).body;
    const plan = (await request(app).post(`${endpoint}/merge/preview`).send({ survivorId: 'aria', duplicateId: 'elena' }).expect(200)).body;
    assert.ok(plan.errors.some(e => /ancestry cycle/.test(e)));
    await request(app).post(`${endpoint}/merge`).send({ survivorId: 'aria', duplicateId: 'elena', expectedRevision: 0, requestId: randomUUID() }).expect(400);
    const foreign = (await repository.getWheelFamilyData(other.treeId)).family.aria.uuid;
    await request(app).post(`${endpoint}/merge/preview`).send({ survivorId: 'aria', duplicateId: foreign }).expect(404);
    assert.deepEqual((await request(app).get(`${endpoint}/backup`)).body, original);
    const sibling = (await request(app).post(`${endpoint}/people`).send({ expectedRevision: 0, requestId: randomUUID(), type: 'sibling', targetId: 'aria', pedigree: 'ADOPTED', person: { name: 'Conflicting duplicate' } }).expect(201)).body;
    const conflicting = (await request(app).post(`${endpoint}/merge/preview`).send({ survivorId: 'aria', duplicateId: sibling.personId }).expect(200)).body;
    assert.ok(conflicting.errors.some(e => /conflicting pedigree/.test(e)));
    await request(app).post(`${endpoint}/merge`).send({ survivorId: 'aria', duplicateId: sibling.personId, expectedRevision: 1, requestId: randomUUID() }).expect(400);
  } finally { await db.stop(); }
});

test('merging imported duplicate people preserves opaque structures and pointer meaning in GEDCOM export', async () => {
  const db = await startPostgres();
  try {
    await runMigrations(db.pool);
    const source = '0 HEAD\n1 GEDC\n2 VERS 7.0\n1 SCHMA\n2 TAG _RESEARCH urn:example:research\n2 TAG _LINK urn:example:link\n0 @A@ INDI\n1 NAME Alex /Person/\n1 NOTE First assertion\n1 _RESEARCH First extension\n0 @B@ INDI\n1 NAME Alex /Person/\n1 NOTE Second assertion\n1 _RESEARCH Second extension\n2 _LINK @A@\n0 TRLR\n';
    const imported = await importGedcom(db.pool, { requestId: randomUUID(), source, checksum: createHash('sha256').update(source).digest('hex'), name: 'Duplicates', rootReference: '@B@' });
    const repository = new TreeRepository(db.pool), app = createApp({ repository });
    const endpoint = `/api/trees/${imported.treeId}`;
    const xrefs = (await db.pool.query('SELECT xref, entity_id FROM import_xrefs WHERE import_job_id = $1', [imported.importJobId])).rows;
    const a = xrefs.find(x => x.xref === '@A@').entity_id, b = xrefs.find(x => x.xref === '@B@').entity_id;
    const merged = (await request(app).post(`${endpoint}/merge`).send({ survivorId: a, duplicateId: b, expectedRevision: 0, requestId: randomUUID() }).expect(200)).body;
    assert.equal(merged.archive.rootId, a);
    const exported = (await request(app).get(`${endpoint}/gedcom`).expect(200)).body.source;
    const parsed = parseGedcom(exported);
    const people = parsed.records.filter(r => r.tag === 'INDI');
    assert.equal(people.length, 1);
    assert.equal(children(people[0], 'NAME').length, 2);
    assert.equal(children(people[0], 'NOTE').length, 2);
    assert.equal(children(people[0], '_RESEARCH').length, 2);
    const pointer = child(children(people[0], '_RESEARCH').find(n => n.value === 'Second extension'), '_LINK').pointer;
    assert.equal(parsed.xrefs.get(pointer), people[0]);
  } finally { await db.stop(); }
});
