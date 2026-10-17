const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const request = require('supertest');
const { startPostgres } = require('../helpers/postgres.cjs');
const { runMigrations } = require('../../src/db/migrate');
const { importLegacyFamily } = require('../../src/services/import-legacy-family');
const { TreeRepository } = require('../../src/repositories/tree-repository');
const { createApp } = require('../../src/app');
const { tokenHash } = require('../../src/services/access');
const { serverConfig } = require('../../src/config');
const sample = require('../../family-data.json');
const password = 'test password with enough entropy';
const setupToken = 'test-only-setup-token-at-least-thirty-two-characters';

async function fixture(work) {
  const db = await startPostgres();
  try {
    await runMigrations(db.pool);
    const tree = await importLegacyFamily(db.pool, sample);
    const app = createApp({ repository: new TreeRepository(db.pool), auth: { mode: 'private', origin: 'http://127.0.0.1', secureCookies: false, setupToken } });
    const owner = request.agent(app);
    const result = await owner.post('/api/auth/setup').send({ token: setupToken, username: 'owner', password }).expect(201);
    async function invite(name, role) {
      const created = (await owner.post(`/api/trees/${tree.treeId}/access/invitations`).send({ username: name, role }).expect(201)).body;
      const agent = request.agent(app);
      const accepted = (await agent.post(`/api/auth/invitations/${created.token}/accept`).send({ username: name, password }).expect(200)).body;
      return { agent, user: accepted.user, invitation: created };
    }
    await work({ db, app, owner, ownerId: result.body.user.id, treeId: tree.treeId, endpoint: `/api/trees/${tree.treeId}`, invite });
  } finally { await db.stop(); }
}

test('private sessions, setup, origin checks, expiry, password rotation, and configuration fail closed', async () => {
  assert.equal(serverConfig({}).host, '127.0.0.1');
  for (const env of [{ HOST: '0.0.0.0' }, { AUTH_MODE: 'private' }, { PORT: 'NaN' }, { AUTH_MODE: 'private', PUBLIC_ORIGIN: 'http://example.com' }, { AUTH_MODE: 'private', PUBLIC_ORIGIN: 'https://example.com', SESSION_COOKIE_SECURE: 'false' }]) assert.throws(() => serverConfig(env));
  await fixture(async ({ db, app, owner, ownerId, endpoint }) => {
    await request(app).get('/api/health').expect(200);
    for (const path of ['/api/trees', '/api/family-data', `${endpoint}/family-data`, `${endpoint}/backup`]) await request(app).get(path).expect(401);
    await request(app).get('/family-data.json').expect(404);
    await request(app).post('/api/auth/setup').send({ token: setupToken, username: 'other', password }).expect(409);
    await owner.post(`${endpoint}/people`).set('Origin', 'https://evil.example').send({}).expect(403);
    await owner.post(`${endpoint}/people`).set('Sec-Fetch-Site', 'cross-site').send({}).expect(403);
    await request(app).post('/api/auth/login').send({ username: 'owner', password: 'incorrect password' }).expect(401);
    const logged = await request(app).post('/api/auth/login').send({ username: 'OWNER', password }).expect(200);
    const cookie = logged.headers['set-cookie'][0];
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
    const token = cookie.split(';')[0].split('=')[1];
    const session = (await db.pool.query('SELECT * FROM auth_sessions WHERE token_hash = $1', [tokenHash(token)])).rows[0];
    assert.ok(session); assert.notEqual(session.token_hash, token);
    const secure = createApp({ repository: new TreeRepository(db.pool), auth: { mode: 'private', origin: 'https://family.example.test', secureCookies: true } });
    const secureLogin = await request(secure).post('/api/auth/login').send({ username: 'owner', password }).expect(200);
    assert.match(secureLogin.headers['set-cookie'][0], /^__Host-rootline_session=/); assert.match(secureLogin.headers['set-cookie'][0], /; Secure;/);
    await request(secure).post('/api/auth/login').set('Origin', 'http://family.example.test').send({ username: 'owner', password }).expect(403);
    assert.match((await db.pool.query('SELECT password_hash FROM app_users WHERE id = $1', [ownerId])).rows[0].password_hash, /^scrypt\$/);
    await db.pool.query("UPDATE auth_sessions SET expires_at = current_timestamp - interval '1 second' WHERE token_hash = $1", [tokenHash(token)]);
    await request(app).get('/api/trees').set('Cookie', cookie.split(';')[0]).expect(401);
    await owner.post('/api/auth/password').send({ currentPassword: 'wrong', newPassword: `${password} new` }).expect(403);
    await owner.post('/api/auth/password').send({ currentPassword: password, newPassword: `${password} new` }).expect(200);
    await owner.get('/api/trees').expect(401);
    await owner.post('/api/auth/login').send({ username: 'owner', password }).expect(401);
    await owner.post('/api/auth/login').send({ username: 'owner', password: `${password} new` }).expect(200);
    await owner.post('/api/auth/logout').expect(200);
    await owner.get('/api/trees').expect(401);
    for (let i = 0; i < 10; i++) await request(app).post('/api/auth/login').send({ username: 'missing', password }).expect(401);
    await request(app).post('/api/auth/login').send({ username: 'missing', password }).expect(429);
  });
});

test('publication filters restricted names, facts, places, family links, and private metadata consistently', async () => {
  await fixture(async ({ db, owner, endpoint, treeId, invite }) => {
    const { agent: viewer } = await invite('filtered-viewer', 'VIEWER');
    let revision = 0;
    for (const person of ['aria', 'elena', 'marcus']) await owner.patch(`${endpoint}/people/${person}/privacy`).send({ expectedRevision: revision++, requestId: randomUUID(), livingStatus: 'DECEASED', isPublic: true, privateRecord: false }).expect(200);
    const full = (await owner.get(`${endpoint}/family-data`)).body;
    const aria = full.family.aria.uuid, elena = full.family.elena.uuid;
    const name = (await db.pool.query('SELECT id FROM person_names WHERE person_id = $1 AND is_primary', [aria])).rows[0].id;
    await db.pool.query("INSERT INTO restrictions (entity_id, restriction) VALUES ($1, 'PRIVACY')", [name]);
    const first = (await viewer.get(`${endpoint}/family-data`)).body;
    assert.equal(first.family.aria, undefined);
    assert.doesNotMatch(JSON.stringify(first), /Aria Hartwell|Concert Violinist/);
    await db.pool.query('DELETE FROM restrictions WHERE entity_id = $1', [name]);
    const birth = (await db.pool.query("SELECT id, place_id FROM facts WHERE person_id = $1 AND gedcom_tag = 'BIRT' ORDER BY position, id LIMIT 1", [elena])).rows[0];
    await db.pool.query("INSERT INTO restrictions (entity_id, restriction) VALUES ($1, 'PRIVACY')", [birth.id]);
    const familyId = full.families.find(f => f.children.some(c => c.personId === 'aria') && f.partners.some(p => p.personId === 'elena')).id;
    await db.pool.query("INSERT INTO restrictions (entity_id, restriction) VALUES ($1, 'CONFIDENTIAL')", [familyId]);
    const second = (await viewer.get(`${endpoint}/family-data`)).body;
    assert.equal(second.family.elena.birth, undefined); assert.equal(second.family.elena.birthplace, undefined);
    assert.equal(second.family.aria.motherId, undefined); assert.equal(second.family.aria.fatherId, undefined);
    const gedcom = (await viewer.get(`${endpoint}/gedcom`)).body.source;
    assert.doesNotMatch(gedcom, /Madrid|Concert Violinist/);
    await owner.patch(`${endpoint}/people/aria/privacy`).send({ expectedRevision: revision++, requestId: randomUUID(), livingStatus: 'DECEASED', isPublic: false, privateRecord: true }).expect(200);
    assert.equal((await viewer.get(`${endpoint}/family-data`)).body.family.aria, undefined);
    assert.equal((await owner.get(`${endpoint}/family-data`)).body.family.aria.privateRecord, true);
    await owner.patch(`${endpoint}/people/aria/privacy`).send({ expectedRevision: revision, requestId: randomUUID(), livingStatus: 'DECEASED', isPublic: true, privateRecord: true }).expect(400);
    const share = (await owner.post(`${endpoint}/access/shares`).send({ label: 'Explicit label' }).expect(201)).body;
    await db.pool.query('UPDATE trees SET name = $1 WHERE id = $2', ['Private name Aria Hartwell', treeId]);
    assert.doesNotMatch(JSON.stringify((await viewer.get('/api/trees')).body), /Aria Hartwell/);
    assert.equal((await owner.get(`/api/share/${share.token}`)).body.treeName, 'Explicit label');
  });
});

test('tree roles isolate every data path, privacy applies to viewers and GEDCOM, and history identifies editors', async () => {
  await fixture(async ({ db, app, owner, endpoint, treeId, invite }) => {
    const { agent: editor } = await invite('editor', 'EDITOR');
    const { agent: viewer } = await invite('viewer', 'VIEWER');
    const other = await importLegacyFamily(db.pool, sample, { treeKey: 'unrelated', treeName: 'Secret unrelated archive' });
    await viewer.get(`/api/trees/${other.treeId}/family-data`).expect(404);
    const trees = (await viewer.get('/api/trees').expect(200)).body.trees;
    assert.equal(trees.length, 1); assert.equal(trees[0].people_count, 0); assert.equal(trees[0].root_person_name, 'Private archive');
    const denied = ['/backup', '/history', '/imports', '/duplicates', '/access', '/people/aria/records', '/history/not-a-uuid/preview', '/imports/not-a-uuid/source', '/media/not-a-uuid/download'];
    for (const path of denied) await viewer.get(`${endpoint}${path}`).expect(403);
    await viewer.get(`${endpoint}/gedcom?includePrivate=true`).expect(403);
    for (const path of ['/people', '/merge', '/backup/restore', '/local-migration/preview', '/gedcom/preview']) await viewer.post(`${endpoint}${path}`).send({}).expect(403);
    await viewer.patch(`${endpoint}/people/aria`).send({}).expect(403);
    await editor.get(`${endpoint}/access`).expect(403);
    let revision = 0;
    for (const personId of ['elena', 'marcus']) {
      await owner.patch(`${endpoint}/people/${personId}/privacy`).send({ expectedRevision: revision++, requestId: randomUUID(), livingStatus: 'DECEASED', isPublic: true, privateRecord: false }).expect(200);
    }
    await owner.patch(`${endpoint}/people/aria/privacy`).send({ expectedRevision: revision, requestId: randomUUID(), livingStatus: 'LIVING', isPublic: true, privateRecord: false }).expect(400);
    const projected = (await viewer.get(`${endpoint}/family-data`).expect(200)).body;
    assert.deepEqual(Object.keys(projected.family).sort(), ['elena', 'marcus']);
    assert.equal(projected.permissions.canEdit, false);
    for (const data of [projected, (await viewer.get('/api/family-data')).body, (await viewer.get(`${endpoint}/people`)).body, (await viewer.get(`${endpoint}`)).body, (await viewer.get('/api/trees')).body]) {
      const text = JSON.stringify(data);
      assert.doesNotMatch(text, /Aria Hartwell|Concert Violinist|bio|occupation|dylan/);
    }
    const exported = (await viewer.get(`${endpoint}/gedcom`).expect(200)).body;
    assert.match(exported.source, /Elena Vasquez/); assert.doesNotMatch(exported.source, /Aria|Concert Violinist|NOTE|OBJE/);
    assert.equal(exported.redacted, true);
    assert.equal((await owner.get(`${endpoint}/gedcom`)).body.redacted, true);
    const fullExport = (await owner.get(`${endpoint}/gedcom?includePrivate=true`)).body;
    assert.match(fullExport.source, /Aria/); assert.ok(fullExport.warnings.some(w => /publication approvals/.test(w)));
    const edit = { expectedRevision: revision++, requestId: randomUUID(), person: { name: 'Aria revised', gender: 'F' } };
    await editor.patch(`${endpoint}/people/aria`).send(edit).expect(200);
    const history = (await owner.get(`${endpoint}/history`).expect(200)).body.changes;
    assert.equal(history[0].actor_label, 'editor');
    assert.ok((await db.pool.query('SELECT actor_id FROM tree_changes WHERE tree_id = $1 ORDER BY revision DESC LIMIT 1', [treeId])).rows[0].actor_id);
    const uid = (await db.pool.query("SELECT user_id FROM tree_memberships m JOIN app_users u ON u.id = m.user_id WHERE tree_id = $1 AND username = 'editor'", [treeId])).rows[0].user_id;
    await owner.patch(`${endpoint}/access/members/${uid}`).send({ role: 'VIEWER' }).expect(200);
    await editor.patch(`${endpoint}/people/aria`).send(edit).expect(403);
    await editor.get(`${endpoint}/backup`).expect(403);
    const filtered = (await editor.get(`${endpoint}/family-data`)).body;
    assert.equal(filtered.family.aria, undefined);
    assert.equal((await request(app).get('/api/auth/session')).body.user, null);
  });
});

test('invitations and read-only links expire, revoke, retain owners, and never persist plaintext tokens', async () => {
  await fixture(async ({ db, app, owner, ownerId, endpoint, invite }) => {
    const { agent: viewer, user } = await invite('viewer', 'VIEWER');
    await owner.patch(`${endpoint}/access/members/${ownerId}`).send({ role: null }).expect(409);
    const pending = (await owner.post(`${endpoint}/access/invitations`).send({ username: 'next-user', role: 'EDITOR' }).expect(201)).body;
    await viewer.post(`/api/auth/invitations/${pending.token}/accept`).send({}).expect(403);
    await owner.post(`${endpoint}/access/invitations/${pending.id}/revoke`).expect(200);
    await request(app).get(`/api/auth/invitations/${pending.token}`).expect(404);
    const expired = (await owner.post(`${endpoint}/access/invitations`).send({ username: 'expired', role: 'VIEWER', days: 1 }).expect(201)).body;
    await db.pool.query("UPDATE tree_invitations SET expires_at = current_timestamp - interval '1 second' WHERE id = $1", [expired.id]);
    await request(app).post(`/api/auth/invitations/${expired.token}/accept`).send({ username: 'expired', password }).expect(404);
    const share = (await owner.post(`${endpoint}/access/shares`).send({ label: 'Approved family', days: 1 }).expect(201)).body;
    const shared = (await request(app).get(`/api/share/${share.token}`).expect(200)).body;
    assert.equal(shared.treeName, 'Approved family'); assert.equal(shared.visiblePeople, 0);
    assert.doesNotMatch(JSON.stringify(shared), /Aria|Hartwell|McCastle/);
    assert.equal((await request(app).get(`/api/share/${share.token}/gedcom`).expect(200)).body.people, 0);
    const stored = (await db.pool.query('SELECT token_hash FROM tree_share_links WHERE id = $1', [share.id])).rows[0].token_hash;
    assert.equal(stored, tokenHash(share.token)); assert.notEqual(stored, share.token);
    assert.doesNotMatch(JSON.stringify((await owner.get(`${endpoint}/access`)).body), new RegExp(`${share.token}|${pending.token}`));
    await owner.post(`${endpoint}/access/shares/${share.id}/revoke`).expect(200);
    await request(app).get(`/api/share/${share.token}`).expect(404);
    const timed = (await owner.post(`${endpoint}/access/shares`).send({ label: 'Timed' }).expect(201)).body;
    await db.pool.query("UPDATE tree_share_links SET expires_at = current_timestamp - interval '1 second' WHERE id = $1", [timed.id]);
    await request(app).get(`/api/share/${timed.token}`).expect(404);
    await owner.patch(`${endpoint}/access/members/${user.id}`).send({ role: 'OWNER' }).expect(200);
    const ownedLink = (await viewer.post(`${endpoint}/access/shares`).send({ label: 'Former owner' }).expect(201)).body;
    await owner.patch(`${endpoint}/access/members/${user.id}`).send({ role: null }).expect(200);
    await request(app).get(`/api/share/${ownedLink.token}`).expect(404);
    await viewer.get(`${endpoint}/family-data`).expect(404);
  });
});

test('revoking an editor while a save waits for the tree lock prevents the queued write and receipt replay', async () => {
  await fixture(async ({ db, owner, endpoint, treeId, invite }) => {
    const { agent: editor, user } = await invite('queued-editor', 'EDITOR');
    const payload = { expectedRevision: 0, requestId: randomUUID(), person: { name: 'Saved before revocation' } };
    await editor.patch(`${endpoint}/people/aria`).send(payload).expect(200);
    const client = await db.pool.connect();
    let demotion, save;
    try {
      await client.query('BEGIN'); await client.query('SELECT id FROM trees WHERE id = $1 FOR UPDATE', [treeId]);
      async function waiting(fragment) {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const found = await db.pool.query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE $1", [fragment]);
          if (found.rowCount) return;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        throw new Error(`Expected blocked query ${fragment}`);
      }
      demotion = owner.patch(`${endpoint}/access/members/${user.id}`).send({ role: 'VIEWER' }).then(response => response);
      await waiting('SELECT id FROM trees WHERE id = % FOR UPDATE');
      save = editor.patch(`${endpoint}/people/aria`).send({ ...payload, expectedRevision: 1, requestId: randomUUID(), person: { name: 'Must not be saved' } }).then(response => response);
      await waiting('SELECT id, revision FROM trees WHERE id = % FOR UPDATE');
      await client.query('COMMIT');
      assert.equal((await demotion).status, 200); assert.equal((await save).status, 403);
    } finally { await client.query('ROLLBACK'); client.release(); await Promise.allSettled([demotion, save].filter(Boolean)); }
    await editor.patch(`${endpoint}/people/aria`).send(payload).expect(403);
    const archive = (await owner.get(`${endpoint}/family-data`)).body;
    assert.equal(archive.revision, 1); assert.equal(archive.family.aria.name, 'Saved before revocation');
  });
});

test('locked assertions resist alternate edit paths and merges conservatively combine publication state', async () => {
  await fixture(async ({ db, owner, endpoint, treeId, invite }) => {
    const { agent: editor } = await invite('restricted-editor', 'EDITOR');
    const archive = (await owner.get(`${endpoint}/family-data`)).body;
    const aria = archive.family.aria.uuid;
    await db.pool.query("INSERT INTO restrictions (entity_id, restriction) VALUES ($1, 'LOCKED')", [aria]);
    const payload = () => ({ expectedRevision: 0, requestId: randomUUID() });
    await editor.patch(`${endpoint}/people/aria`).send({ ...payload(), person: { name: 'Denied' } }).expect(403);
    await editor.patch(`${endpoint}/people/aria/privacy`).send({ ...payload(), livingStatus: 'DECEASED', isPublic: false, privateRecord: false }).expect(403);
    const draft = structuredClone(archive); draft.family.aria.name = 'Migration bypass';
    await editor.post(`${endpoint}/local-migration`).send({ ...payload(), archive: draft }).expect(403);
    await editor.post(`${endpoint}/people`).send({ ...payload(), type: 'child', targetId: 'aria', person: { name: 'Denied child' } }).expect(403);
    const backup = (await owner.get(`${endpoint}/backup`)).body;
    await editor.post(`${endpoint}/restore`).send({ ...payload(), backup }).expect(403);
    const invalidBackup = structuredClone(backup); invalidBackup.tables.persons[0].living_status = 'LIVING'; invalidBackup.tables.persons[0].is_public = true;
    await owner.post('/api/backups/preview').send({ backup: invalidBackup }).expect(400);
    await owner.patch(`${endpoint}/people/aria`).send({ ...payload(), person: { name: 'Owner corrected' } }).expect(200);
    // An unrestricted person is still editable while another record is locked.
    await editor.patch(`${endpoint}/people/alfred`).send({ expectedRevision: 1, requestId: randomUUID(), person: { name: 'Unrestricted edit' } }).expect(200);
    await db.pool.query("DELETE FROM restrictions WHERE entity_id = $1", [aria]);
    await owner.patch(`${endpoint}/people/aria/privacy`).send({ expectedRevision: 2, requestId: randomUUID(), livingStatus: 'DECEASED', isPublic: true, privateRecord: false }).expect(200);
    const duplicate = (await owner.post(`${endpoint}/people`).send({ expectedRevision: 3, requestId: randomUUID(), type: 'person', person: { name: 'Owner corrected' } }).expect(201)).body.personId;
    const merged = (await owner.post(`${endpoint}/merge`).send({ expectedRevision: 4, requestId: randomUUID(), survivorId: 'aria', duplicateId: duplicate }).expect(200)).body;
    assert.equal(merged.archive.family.aria.isPublic, undefined); assert.equal(merged.archive.family.aria.livingStatus, undefined);
    const viewer = (await invite('privacy-viewer', 'VIEWER')).agent;
    assert.equal((await viewer.get(`${endpoint}/family-data`)).body.visiblePeople, 0);
    await owner.post(`${endpoint}/merge`).send({ expectedRevision: 5, requestId: randomUUID(), survivorId: 'aria', duplicateId: 'elena' }).expect(400);
    assert.equal((await owner.get(`${endpoint}/family-data`)).body.revision, 5);
    assert.ok(treeId);
  });
});

test('private imports and missing-tree restores assign ownership without cross-account receipt or tree access', async () => {
  await fixture(async ({ db, owner, invite }) => {
    const { agent: collaborator, user } = await invite('tree-creator', 'VIEWER');
    const source = '0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @A@ INDI\n1 NAME Imported /Protected/\n0 TRLR\n';
    const input = { source, checksum: createHash('sha256').update(source).digest('hex'), rootReference: '@A@', name: 'Owner import', requestId: randomUUID() };
    const imported = (await owner.post('/api/gedcom/import').send(input).expect(201)).body;
    await owner.get(`/api/trees/${imported.treeId}/family-data`).expect(200);
    await collaborator.get(`/api/trees/${imported.treeId}/family-data`).expect(404);
    await collaborator.post('/api/gedcom/import').send(input).expect(409);
    const own = (await collaborator.post('/api/gedcom/import').send({ ...input, name: 'Collaborator import', requestId: randomUUID() }).expect(201)).body;
    assert.equal((await collaborator.get(`/api/trees/${own.treeId}/family-data`)).body.permissions.role, 'OWNER');
    await owner.get(`/api/trees/${own.treeId}/family-data`).expect(404);
    const backup = (await owner.get(`/api/trees/${imported.treeId}/backup`)).body;
    // Exercise compatibility with native backups created before privacy fields.
    for (const person of backup.tables.persons) { delete person.living_status; delete person.is_public; }
    await db.pool.query('DELETE FROM import_jobs WHERE tree_id = $1', [imported.treeId]);
    await db.pool.query('DELETE FROM trees WHERE id = $1', [imported.treeId]);
    const restore = { backup, requestId: randomUUID() };
    await collaborator.post('/api/backups/restore').send(restore).expect(response => assert.equal(response.status, 200, JSON.stringify(response.body)));
    const membership = (await db.pool.query('SELECT role FROM tree_memberships WHERE tree_id = $1 AND user_id = $2', [imported.treeId, user.id])).rows[0];
    assert.equal(membership.role, 'OWNER');
    const restored = (await collaborator.get(`/api/trees/${imported.treeId}/family-data`)).body;
    assert.equal(Object.values(restored.family)[0].isPublic, undefined); assert.equal(Object.values(restored.family)[0].livingStatus, undefined);
    await owner.get(`/api/trees/${imported.treeId}/family-data`).expect(404);
    await collaborator.post('/api/backups/restore').send(restore).expect(200);
    await owner.post('/api/backups/restore').send(restore).expect(404);
  });
});
