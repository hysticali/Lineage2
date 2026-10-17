const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const request = require('supertest');
const { startPostgres } = require('../helpers/postgres.cjs');
const { runMigrations } = require('../../src/db/migrate');
const { importLegacyFamily } = require('../../src/services/import-legacy-family');
const { TreeRepository } = require('../../src/repositories/tree-repository');
const { createApp } = require('../../src/app');
const { validateSnapshot } = require('../../src/services/tree-backup');
const familyData = require('../../family-data.json');

test('full backups restore records and exact attachment bytes into a clean database; history recovery is reversible', async () => {
  const db = await startPostgres();
  const clean = await startPostgres();
  try {
    await runMigrations(db.pool); await runMigrations(clean.pool);
    const tree = await importLegacyFamily(db.pool, familyData);
    const other = await importLegacyFamily(db.pool, familyData, { treeKey: 'other' });
    const app = createApp({ repository: new TreeRepository(db.pool) });
    const fresh = createApp({ repository: new TreeRepository(clean.pool) });
    const endpoint = `/api/trees/${tree.treeId}`;
    let revision = 0;
    async function edit(kind, fields, recordId) {
      const response = await request(app).post(`${endpoint}/people/aria/records`).send({ requestId: randomUUID(), expectedRevision: revision, kind, fields, recordId }).expect(200);
      revision = response.body.archive.revision;
      return response.body;
    }
    const event = await edit('event', { gedcom_tag: 'BIRT', fact_kind: 'EVENT', date_original: 'ABT 1990', place_name: 'Paris' });
    const source = await edit('source', { title: 'Original register', publication_text: 'Volume 12' });
    await edit('citation', { source_id: source.recordId, target_entity_id: event.recordId, page_text: 'Page 19', quality: 3 });
    const bytes = Buffer.from('Original file bytes\n\0\x01\xff', 'latin1');
    const payload = { title: 'Original record', description: 'Scan description', provenance: 'Archive copy, box 9', target_entity_id: event.recordId, filename: 'register.bin', mime_type: 'application/octet-stream', data_base64: bytes.toString('base64') };
    const media = await edit('media', payload);
    const file = media.records.media[0];
    assert.equal(file.byte_length, bytes.length);
    assert.equal(file.checksum_sha256, createHash('sha256').update(bytes).digest('hex'));
    const downloaded = await request(app).get(`${endpoint}/media/${file.file_id}`).expect(200);
    assert.deepEqual(downloaded.body, bytes);
    assert.match(downloaded.headers['content-disposition'], /attachment/);
    await request(app).get(`/api/trees/${other.treeId}/media/${file.file_id}`).expect(404);
    await edit('media', { title: 'Updated caption', provenance: 'Reviewed provenance' }, file.id);
    const backup = (await request(app).get(`${endpoint}/backup`).expect(200)).body;
    const summary = validateSnapshot(backup);
    assert.equal(summary.attachments, 1);
    assert.equal(summary.citations, 1);
    assert.ok(summary.people === 45 && summary.attachmentBytes === bytes.length);
    const tampered = structuredClone(backup);
    tampered.tables.media_blobs[0].content = '\\x61';
    await request(fresh).post('/api/backups/preview').send({ backup: tampered }).expect(400);
    await request(fresh).post('/api/backups/restore').send({ backup: tampered, requestId: randomUUID() }).expect(400);
    assert.equal((await request(fresh).get('/api/trees').expect(200)).body.trees.length, 0);
    const restoreBody = { requestId: randomUUID(), backup };
    await request(fresh).post('/api/backups/preview').send({ backup }).expect(200);
    await request(fresh).post('/api/backups/restore').send(restoreBody).expect(200);
    await request(fresh).post('/api/backups/restore').send(restoreBody).expect(200);
    assert.deepEqual((await request(fresh).get(`${endpoint}/backup`).expect(200)).body, backup);
    assert.deepEqual((await request(fresh).get(`${endpoint}/media/${file.file_id}`).expect(200)).body, bytes);
    await request(fresh).post('/api/backups/restore').send({ ...restoreBody, requestId: randomUUID() }).expect(409);
    await clean.restart();
    const restarted = createApp({ repository: new TreeRepository(clean.pool) });
    assert.deepEqual((await request(restarted).get(`${endpoint}/backup`).expect(200)).body, backup);

    const changes = (await request(app).get(`${endpoint}/history`).expect(200)).body.changes;
    assert.equal(changes.length, 5);
    const beforeAttachment = changes.find(c => c.revision === 4);
    const preview = (await request(app).get(`${endpoint}/history/${beforeAttachment.id}/preview`).expect(200)).body;
    assert.equal(preview.summary.attachments, 0);
    const recovery = { expectedRevision: revision, requestId: randomUUID() };
    const undone = await request(app).post(`${endpoint}/history/${beforeAttachment.id}/restore`).send(recovery).expect(200);
    revision = undone.body.archive.revision;
    await request(app).post(`${endpoint}/history/${beforeAttachment.id}/restore`).send(recovery).expect(200);
    await request(app).get(`${endpoint}/media/${file.file_id}`).expect(404);
    const recoveryEntry = (await request(app).get(`${endpoint}/history`).expect(200)).body.changes[0];
    assert.equal(recoveryEntry.action, 'restore-history');
    const redone = await request(app).post(`${endpoint}/history/${recoveryEntry.id}/restore`).send({ expectedRevision: revision, requestId: randomUUID() }).expect(200);
    revision = redone.body.archive.revision;
    assert.deepEqual((await request(app).get(`${endpoint}/media/${file.file_id}`).expect(200)).body, bytes);
    assert.equal((await new TreeRepository(db.pool).getTree(other.treeId)).revision, 0);
    await request(app).post(`${endpoint}/restore`).send({ expectedRevision: 0, requestId: randomUUID(), backup }).expect(409);
    await request(app).post(`${endpoint}/restore`).send({ expectedRevision: revision, requestId: randomUUID(), backup }).expect(200);
  } finally { await db.stop(); await clean.stop(); }
});

test('backup validation rejects tampered files and cross-tree references with no partial restore', async () => {
  const db = await startPostgres();
  try {
    await runMigrations(db.pool);
    const tree = await importLegacyFamily(db.pool, familyData);
    const app = createApp({ repository: new TreeRepository(db.pool) });
    const endpoint = `/api/trees/${tree.treeId}`;
    const backup = (await request(app).get(`${endpoint}/backup`).expect(200)).body;
    const original = JSON.stringify(backup);
    const foreign = structuredClone(backup);
    foreign.tables.facts[0].person_id = randomUUID();
    await request(app).post('/api/backups/preview').send({ backup: foreign }).expect(400);
    await request(app).post(`${endpoint}/restore`).send({ expectedRevision: 0, requestId: randomUUID(), backup: foreign }).expect(400);
    assert.equal(JSON.stringify((await request(app).get(`${endpoint}/backup`).expect(200)).body), original);
    const invalid = { title: 'Bad file', target_entity_id: backup.tree.root_person_id, filename: '../escape', data_base64: 'YQ==' };
    await request(app).post(`${endpoint}/people/aria/records`).send({ requestId: randomUUID(), expectedRevision: 0, kind: 'media', fields: invalid }).expect(400);
    invalid.filename = 'file.bin'; invalid.data_base64 = 'bad base64';
    await request(app).post(`${endpoint}/people/aria/records`).send({ requestId: randomUUID(), expectedRevision: 0, kind: 'media', fields: invalid }).expect(400);
    assert.equal(JSON.stringify((await request(app).get(`${endpoint}/backup`).expect(200)).body), original);
    const versionOne = structuredClone(backup);
    versionOne.version = 1;
    for (const table of ['gedcom_documents', 'gedcom_nodes', 'gedcom_fragments']) delete versionOne.tables[table];
    versionOne.tables.notes.forEach(row => delete row.position);
    versionOne.tables.persons.forEach(row => delete row.display_reference);
    await request(app).post(`${endpoint}/restore`).send({ expectedRevision: 0, requestId: randomUUID(), backup: versionOne }).expect(200);
    const recovered = (await request(app).get(`${endpoint}/backup`).expect(200)).body;
    assert.ok(recovered.tables.notes.every(row => row.position === 0));
  } finally { await db.stop(); }
});
