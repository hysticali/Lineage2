const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { startPostgres } = require('../helpers/postgres.cjs');
const { runMigrations } = require('../../src/db/migrate');
const { TreeRepository } = require('../../src/repositories/tree-repository');
const { createApp } = require('../../src/app');
const { parseGedcom, child, children } = require('../../src/domain/gedcom');
const fixture = fs.readFileSync(path.join(__dirname, '../fixtures/evidence.ged'), 'utf8');

async function importFile(app, source, name = 'GEDCOM family') {
  const preview = await request(app).post('/api/gedcom/preview').send({ source }).expect(200);
  assert.deepEqual(preview.body.errors, []);
  const payload = { requestId: randomUUID(), source, name, filename: 'evidence.ged', checksum: preview.body.checksum, rootReference: preview.body.roots[0].reference };
  const result = await request(app).post('/api/gedcom/import').send(payload).expect(201);
  return { ...result.body, payload };
}

function semantics(source) {
  const { records, xrefs } = parseGedcom(source);
  const personName = pointer => child(xrefs.get(pointer), 'NAME')?.value;
  function identity(record) {
    if (record.tag === 'INDI') return `INDI:${child(record, 'NAME')?.value}`;
    if (record.tag === 'FAM') return `FAM:${record.children.filter(n => ['HUSB', 'WIFE'].includes(n.tag)).map(n => personName(n.pointer)).sort().join('+')}`;
    return `${record.tag}:${record.value || child(record, 'TITL')?.value || child(record, 'NAME')?.value || child(record, 'FILE')?.value || ''}`;
  }
  const citations = [], mediaLinks = [];
  function walk(node, location) {
    const occurrences = new Map();
    for (const nested of node.children) {
      const index = occurrences.get(nested.tag) || 0; occurrences.set(nested.tag, index + 1);
      if (nested.tag === 'SOUR' && nested.pointer) citations.push({ target: location, source: child(xrefs.get(nested.pointer), 'TITL')?.value, page: child(nested, 'PAGE')?.value, quality: child(nested, 'QUAY')?.value, text: children(child(nested, 'DATA'), 'TEXT').map(n => n.value) });
      if (nested.tag === 'OBJE' && nested.pointer) mediaLinks.push({ target: location, files: children(xrefs.get(nested.pointer), 'FILE').map(n => n.value) });
      walk(nested, `${location}/${nested.tag}[${index}]`);
    }
  }
  records.filter(r => !['HEAD', 'TRLR'].includes(r.tag)).forEach(record => walk(record, identity(record)));
  return {
    people: records.filter(r => r.tag === 'INDI').map(r => ({
      names: children(r, 'NAME').map(n => n.value), namePieces: children(r, 'NAME').map(n => Object.fromEntries(['GIVN', 'SURN', 'NPFX', 'NSFX', 'NICK', 'SPFX'].map(tag => [tag, child(n, tag)?.value]))), sex: child(r, 'SEX')?.value,
      births: children(r, 'BIRT').map(n => ({ date: child(n, 'DATE')?.value, place: child(n, 'PLAC')?.value })),
      pedigree: children(r, 'FAMC').map(n => child(n, 'PEDI')?.value),
      notes: children(r, 'NOTE').map(n => n.value),
    })).sort((a, b) => a.names[0].localeCompare(b.names[0])),
    families: records.filter(r => r.tag === 'FAM').map(r => ({
      partners: r.children.filter(n => ['HUSB', 'WIFE'].includes(n.tag)).map(n => personName(n.pointer)).sort(),
      kids: children(r, 'CHIL').map(n => n.pointer === '@VOID@' ? 'VOID' : personName(n.pointer)),
      marriages: children(r, 'MARR').map(n => child(n, 'DATE')?.value),
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    sources: records.filter(r => r.tag === 'SOUR').map(r => [child(r, 'TITL')?.value, child(r, 'AUTH')?.value, child(r, 'PUBL')?.value]).sort(),
    citations: citations.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    mediaLinks: mediaLinks.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

test('GEDCOM import/export retains supported records, raw extensions, evidence, provenance, and fresh tree identities', async () => {
  const db = await startPostgres();
  try {
    await runMigrations(db.pool);
    const repository = new TreeRepository(db.pool), app = createApp({ repository });
    const imported = await importFile(app, fixture);
    await request(app).post('/api/gedcom/import').send(imported.payload).expect(201);
    assert.equal((await repository.listTrees()).length, 1);
    const endpoint = `/api/trees/${imported.treeId}`;
    const wheel = await repository.getWheelFamilyData(imported.treeId);
    const alex = Object.values(wheel.family).find(p => p.name === 'Alex de la Cruz');
    assert.equal(alex.gender, 'X');
    assert.equal(wheel.family[alex.motherId].name, 'Morgan Guardian');
    assert.equal(alex.fatherId, undefined);
    assert.equal(wheel.families.filter(f => f.children.some(c => c.personId === alex.id)).length, 2);
    const records = (await request(app).get(`${endpoint}/people/${alex.id}/records`).expect(200)).body;
    assert.equal(records.names.length, 2);
    assert.equal(records.events.filter(e => e.gedcom_tag === 'BIRT').length, 2);
    assert.equal(records.citations.length, 3);
    assert.equal(records.media.length, 2);
    const original = await request(app).get(`${endpoint}/imports/${imported.importJobId}/source`).expect(200);
    assert.deepEqual(original.body, Buffer.from(fixture));
    const exported = (await request(app).get(`${endpoint}/gedcom`).expect(200)).body;
    assert.deepEqual(semantics(exported.source), semantics(fixture));
    assert.match(exported.source, /_RESEARCH Retain this extension/);
    assert.match(exported.source, /urn:example:research/);
    assert.match(exported.source, /4 LATI N48.8566/);
    assert.match(exported.source, /Name from original register/);
    assert.match(exported.source, /BOX 12/);
    assert.match(exported.source, /@@uncertain identity/);
    const repeated = await importFile(app, exported.source, 'Round trip');
    const again = (await request(app).get(`/api/trees/${repeated.treeId}/gedcom`).expect(200)).body;
    assert.deepEqual(semantics(again.source), semantics(exported.source));
    assert.notEqual(repeated.treeId, imported.treeId);
    const originalIds = new Set(Object.keys(wheel.family));
    assert.ok(Object.keys((await repository.getWheelFamilyData(repeated.treeId)).family).every(id => !originalIds.has(id)));
    // Ordinary edits update the relational assertion without deleting opaque
    // original substructures from the exported event/name.
    await request(app).post(`${endpoint}/people/${alex.id}/records`).send({ requestId: randomUUID(), expectedRevision: 0, kind: 'event', recordId: records.events.find(e => e.gedcom_tag === 'BIRT').id, fields: { date_original: 'BET 1900 AND 1902' } }).expect(200);
    const edited = (await request(app).get(`${endpoint}/gedcom`).expect(200)).body;
    assert.match(edited.source, /DATE BET 1900 AND 1902/);
    assert.match(edited.source, /_RESEARCH Retain this extension/);
    const backup = (await request(app).get(`${endpoint}/backup`).expect(200)).body;
    assert.equal(backup.version, 2);
    assert.equal(backup.tables.gedcom_documents[0].source_text, fixture);
    assert.ok(backup.tables.gedcom_nodes.length > 20);
    const damaged = structuredClone(backup);
    damaged.tables.gedcom_documents[0].source_text += '\n';
    await request(app).post('/api/backups/preview').send({ backup: damaged }).expect(400);
    const changedStructure = structuredClone(backup);
    changedStructure.tables.gedcom_nodes[0].node.value = 'Not the original structure';
    await request(app).post('/api/backups/preview').send({ backup: changedStructure }).expect(400);
    const clean = await startPostgres();
    try {
      await runMigrations(clean.pool);
      const restored = createApp({ repository: new TreeRepository(clean.pool) });
      await request(restored).post('/api/backups/restore').send({ requestId: randomUUID(), backup }).expect(200);
      assert.deepEqual((await request(restored).get(`${endpoint}/imports/${imported.importJobId}/source`).expect(200)).body, Buffer.from(fixture));
      const afterRestore = (await request(restored).get(`${endpoint}/gedcom`).expect(200)).body.source;
      assert.deepEqual(semantics(afterRestore), semantics(edited.source));
    } finally { await clean.stop(); }
  } finally { await db.stop(); }
});

test('GEDCOM preview rejects invalid relationships before writing and import confirmation checks the reviewed file', async () => {
  const db = await startPostgres();
  try {
    await runMigrations(db.pool);
    const app = createApp({ repository: new TreeRepository(db.pool) });
    const invalid = fixture.replace('1 CHIL @VOID@', '1 CHIL @I4@');
    const preview = await request(app).post('/api/gedcom/preview').send({ source: invalid }).expect(200);
    assert.ok(preview.body.errors.some(e => /cycle/.test(e)));
    await request(app).post('/api/gedcom/import').send({ source: invalid, requestId: randomUUID(), name: 'Invalid', checksum: preview.body.checksum, rootReference: '@I1@' }).expect(400);
    const valid = (await request(app).post('/api/gedcom/preview').send({ source: fixture }).expect(200)).body;
    await request(app).post('/api/gedcom/import').send({ source: fixture, requestId: randomUUID(), name: 'Unreviewed', checksum: 'wrong', rootReference: '@I1@' }).expect(409);
    assert.equal((await db.pool.query('SELECT COUNT(*)::int AS n FROM trees')).rows[0].n, 0);
    await request(app).post('/api/gedcom/preview').send({ source: fixture.replace('7.0', '5.5.1') }).expect(400);
    await request(app).post('/api/gedcom/preview').send({ source: fixture.replace('2 SOUR @S1@', '2 SOUR @MISSING@') }).expect(400);
    assert.equal(valid.people, 7);
  } finally { await db.stop(); }
});

test('reviewed import into an existing tree retains its root, deduplicates retries, and rolls back as one history entry', async () => {
  const db = await startPostgres();
  try {
    await runMigrations(db.pool);
    const repository = new TreeRepository(db.pool), app = createApp({ repository });
    const first = await importFile(app, fixture);
    const endpoint = `/api/trees/${first.treeId}`;
    const before = (await request(app).get(`${endpoint}/backup`).expect(200)).body;
    const report = (await request(app).post(`${endpoint}/gedcom/preview`).send({ source: fixture }).expect(200)).body;
    assert.equal(report.revision, 0);
    assert.equal(report.existingMatches.length, 7);
    const payload = { ...first.payload, requestId: randomUUID(), expectedRevision: 0, reviewMatches: true, checksum: report.checksum };
    await request(app).post(`${endpoint}/gedcom/import`).send({ ...payload, reviewMatches: false }).expect(400);
    const imported = (await request(app).post(`${endpoint}/gedcom/import`).send(payload).expect(200)).body;
    assert.equal(Object.keys(imported.archive.family).length, 14);
    assert.equal(imported.archive.rootId, before.tree.root_person_id);
    await request(app).post(`${endpoint}/gedcom/import`).send(payload).expect(200);
    assert.equal(Object.keys((await repository.getWheelFamilyData(first.treeId)).family).length, 14);
    const exported = (await request(app).get(`${endpoint}/gedcom`).expect(200)).body;
    assert.equal(semantics(exported.source).people.length, 14);
    assert.ok((await request(app).get(`${endpoint}/duplicates`)).body.candidates.length >= 7);
    const change = (await request(app).get(`${endpoint}/history`)).body.changes[0];
    assert.equal(change.action, 'import-gedcom');
    await request(app).post(`${endpoint}/history/${change.id}/restore`).send({ expectedRevision: 1, requestId: randomUUID() }).expect(200);
    assert.deepEqual((await request(app).get(`${endpoint}/backup`)).body.tables, before.tables);
    const conflictingSource = fixture.replace('urn:example:research', 'urn:another:meaning');
    const conflict = (await request(app).post(`${endpoint}/gedcom/preview`).send({ source: conflictingSource }).expect(200)).body;
    assert.ok(conflict.errors.some(e => /schema conflict/.test(e)));
    await request(app).post(`${endpoint}/gedcom/import`).send({ ...payload, source: conflictingSource, checksum: conflict.checksum, expectedRevision: 2, requestId: randomUUID() }).expect(400);
    assert.equal(Object.keys((await repository.getWheelFamilyData(first.treeId)).family).length, 7);
  } finally { await db.stop(); }
});

test('native extended facts and media metadata round trip without taking over foreign extension meanings', async () => {
  const db = await startPostgres();
  try {
    await runMigrations(db.pool);
    const app = createApp({ repository: new TreeRepository(db.pool) });
    const conflictingNames = fixture.replace('1 SCHMA\n', '1 SCHMA\n2 TAG _ROOTLINE_ROOT urn:example:foreign-root\n2 TAG _ROOTLINE_DESCRIPTION urn:example:foreign-description\n').replace('0 @I1@ INDI', '1 _ROOTLINE_ROOT Keep foreign header data\n0 @I1@ INDI').replace('0 @M1@ OBJE', '0 @M1@ OBJE\n1 _ROOTLINE_DESCRIPTION Keep foreign media data');
    const first = await importFile(app, conflictingNames);
    const endpoint = `/api/trees/${first.treeId}`;
    const wheel = (await request(app).get(`${endpoint}/family-data`)).body;
    const alex = Object.values(wheel.family).find(p => p.name === 'Alex de la Cruz');
    let records = (await request(app).get(`${endpoint}/people/${alex.id}/records`)).body;
    const attachment = records.media[0];
    const edited = (await request(app).post(`${endpoint}/people/${alex.id}/records`).send({ expectedRevision: 0, requestId: randomUUID(), kind: 'media', recordId: attachment.id, fields: { title: 'Updated scan', description: 'Native description', provenance: 'Archive box 12', target_entity_id: attachment.target_entity_id } }).expect(200)).body;
    await request(app).post(`${endpoint}/people/${alex.id}/records`).send({ expectedRevision: edited.archive.revision, requestId: randomUUID(), kind: 'event', fields: { gedcom_tag: '_RESEARCH_FACT', fact_kind: 'ATTRIBUTE', date_original: 'Around the harvest season', value_text: 'Uncertain assertion' } }).expect(200);
    const exported = (await request(app).get(`${endpoint}/gedcom`).expect(200)).body;
    assert.match(exported.source, /_ROOTLINE_ROOT Keep foreign header data/);
    assert.match(exported.source, /_ROOTLINE_DESCRIPTION Keep foreign media data/);
    assert.match(exported.source, /urn:example:foreign-description/);
    assert.match(exported.source, /urn:rootline:gedcom:description/);
    const second = await importFile(app, exported.source, 'Extended round trip');
    const secondWheel = (await request(app).get(`/api/trees/${second.treeId}/family-data`)).body;
    const secondAlex = Object.values(secondWheel.family).find(p => p.name === 'Alex de la Cruz');
    records = (await request(app).get(`/api/trees/${second.treeId}/people/${secondAlex.id}/records`)).body;
    assert.ok(records.events.some(e => e.gedcom_tag === '_RESEARCH_FACT' && e.date_original === 'Around the harvest season' && e.value_text === 'Uncertain assertion'));
    assert.ok(records.media.every(m => m.description === 'Native description' && m.provenance === 'Archive box 12'));
    const again = (await request(app).get(`/api/trees/${second.treeId}/gedcom`).expect(200)).body.source;
    assert.equal((again.match(/_ROOTLINE_FACT Uncertain assertion/g) || []).length, 1);
  } finally { await db.stop(); }
});
