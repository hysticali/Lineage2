const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startPostgres } = require('../helpers/postgres.cjs');
const { runMigrations } = require('../../src/db/migrate');
const { importLegacyFamily } = require('../../src/services/import-legacy-family');
const { TreeRepository } = require('../../src/repositories/tree-repository');
const familyData = require('../../family-data.json');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../../src/app');

test('real PostgreSQL applies migrations, imports records, and rolls back failed replacement', async () => {
  const database = await startPostgres();
  const { pool } = database;
  try {
    await runMigrations(pool);
    const report = await importLegacyFamily(pool, familyData);
    const repository = new TreeRepository(pool);
    const original = await repository.getWheelFamilyData(report.treeId);
    assert.equal(Object.keys(original.family).length, 45);
    const before = await pool.query('SELECT COUNT(*) FROM entities');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM trees WHERE id = $1', [report.treeId]);
      await client.query('ROLLBACK');
    } finally { client.release(); }
    assert.deepEqual((await pool.query('SELECT COUNT(*) FROM entities')).rows, before.rows);
    assert.deepEqual(await repository.getWheelFamilyData(report.treeId), original);
    assert.deepEqual(await runMigrations(pool), []);
    const version = await pool.query('SHOW server_version');
    console.log(`Verified PostgreSQL ${version.rows[0].server_version}`);
    await database.restart();
    assert.deepEqual(await new TreeRepository(database.pool).getWheelFamilyData(report.treeId), original);
  } finally { await database.stop(); }
});

test('transactional edits persist, reject stale tabs and invalid relationships, and deduplicate retries', async () => {
  const database = await startPostgres();
  const { pool } = database;
  try {
    await runMigrations(pool);
    const tree = await importLegacyFamily(pool, familyData);
    const other = await importLegacyFamily(pool, familyData, { treeKey: 'other' });
    const repository = new TreeRepository(pool);
    const app = createApp({ repository });
    const endpoint = `/api/trees/${tree.treeId}/people`;
    const payload = { requestId: randomUUID(), expectedRevision: 0, type: 'child', targetId: 'aria', coParentId: 'dylan', parentSlot: 'mother', pedigree: 'ADOPTED', person: { name: 'Adopted Child', gender: 'X', birthplace: 'Paris', birth: 'ABT 2020' } };
    const created = await request(app).post(endpoint).send(payload).expect(201);
    assert.equal(created.body.archive.revision, 1);
    const child = created.body.archive.family[created.body.personId];
    assert.equal(child.motherId, 'aria');
    assert.equal(child.fatherId, 'dylan');
    assert.equal(child.birth, 'ABT 2020');
    assert.equal(child.birthplace, 'Paris');
    const retried = await request(app).post(endpoint).send(payload).expect(201);
    assert.deepEqual(retried.body, created.body);
    await request(app).post(endpoint).send({ ...payload, person: { name: 'Different' } }).expect(409);
    await request(app).post(endpoint).send({ ...payload, requestId: randomUUID() }).expect(409);
    const before = await pool.query('SELECT COUNT(*) FROM entities');
    const bad = await request(app).post(endpoint).send({ ...payload, requestId: randomUUID(), expectedRevision: 1, existingPersonId: 'elena', targetId: 'aria', coParentId: undefined }).expect(400);
    assert.match(bad.body.error, /cycle/);
    assert.deepEqual((await pool.query('SELECT COUNT(*) FROM entities')).rows, before.rows);
    const foreignPerson = (await repository.getWheelFamilyData(other.treeId)).family.aria.uuid;
    await request(app).post(endpoint).send({ ...payload, requestId: randomUUID(), expectedRevision: 1, existingPersonId: foreignPerson }).expect(404);
    const edited = await request(app).patch(`${endpoint}/${created.body.personId}`).send({ requestId: randomUUID(), expectedRevision: 1, person: { name: 'Renamed Child', birth: 'BET 2019 AND 2021', bio: 'Research notes' } }).expect(200);
    assert.equal(edited.body.archive.revision, 2);
    assert.equal(edited.body.archive.family[created.body.personId].name, 'Renamed Child');
    const pedigree = await pool.query('SELECT pedigree FROM family_children WHERE person_id = $1', [created.body.personId]);
    assert.equal(pedigree.rows[0].pedigree, 'ADOPTED');
    assert.equal((await repository.getWheelFamilyData(other.treeId)).revision, 0);
    const persisted = await new TreeRepository(pool).getWheelFamilyData(tree.treeId);
    assert.equal(persisted.family[created.body.personId].bio, 'Research notes');
    const attempts = await Promise.all([1, 2].map((n) => request(app).post(endpoint).send({ requestId: randomUUID(), expectedRevision: 2, type: 'person', person: { name: `Concurrent ${n}` } })));
    assert.deepEqual(attempts.map((response) => response.status).sort(), [201, 409]);
    assert.equal((await repository.getWheelFamilyData(tree.treeId)).revision, 3);
    const delayedRetry = await request(app).post(endpoint).send(payload).expect(201);
    assert.equal(delayedRetry.body.replayed, true);
    assert.equal(delayedRetry.body.archive.revision, 3);
    assert.equal(delayedRetry.body.archive.family[created.body.personId].bio, 'Research notes');
  } finally { await database.stop(); }
});

test('local migration previews additions, preserves relationships, and is repeat-safe', async () => {
  const database = await startPostgres();
  const { pool } = database;
  try {
    await runMigrations(pool);
    const tree = await importLegacyFamily(pool, familyData);
    const repository = new TreeRepository(pool);
    const app = createApp({ repository });
    const endpoint = `/api/trees/${tree.treeId}/local-migration`;
    const incoming = structuredClone(familyData);
    incoming.family.local = { id: 'local', name: 'Local Child', motherId: 'aria', fatherId: 'dylan', birthplace: 'Rome' };
    incoming.family.aria.bio = 'Reviewed local note';
    const preview = await request(app).post(`${endpoint}/preview`).send({ archive: incoming }).expect(200);
    assert.equal(preview.body.plan.additions.length, 1);
    assert.equal(preview.body.plan.updates.length, 1);
    assert.equal(preview.body.plan.parents.length, 2);
    assert.deepEqual(preview.body.plan.conflicts, []);
    assert.equal(Object.keys((await repository.getWheelFamilyData(tree.treeId)).family).length, 45);
    const payload = { archive: incoming, expectedRevision: preview.body.revision, requestId: randomUUID() };
    const response = await request(app).post(endpoint).send(payload).expect(200);
    assert.equal(response.body.archive.family.local.motherId, 'aria');
    assert.equal(response.body.archive.family.local.fatherId, 'dylan');
    assert.equal(response.body.archive.family.local.birthplace, 'Rome');
    await request(app).post(endpoint).send(payload).expect(200);
    const secondPreview = await request(app).post(`${endpoint}/preview`).send({ archive: incoming }).expect(200);
    assert.equal(secondPreview.body.plan.additions.length, 0);
    assert.equal(secondPreview.body.plan.relationships, 0);
    await request(app).post(endpoint).send({ ...payload, expectedRevision: 1, requestId: randomUUID() }).expect(200);
    assert.equal(Object.keys((await repository.getWheelFamilyData(tree.treeId)).family).length, 46);
    incoming.family.aria.motherId = 'sofia';
    const conflict = await request(app).post(`${endpoint}/preview`).send({ archive: incoming }).expect(200);
    assert.ok(conflict.body.plan.conflicts.some((value) => value.includes('displayed mother')));
    await request(app).post(endpoint).send({ archive: incoming, expectedRevision: 2, requestId: randomUUID() }).expect(409);
    assert.equal((await repository.getWheelFamilyData(tree.treeId)).family.aria.motherId, 'elena');
  } finally { await database.stop(); }
});
