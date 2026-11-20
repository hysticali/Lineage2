const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { startPostgres } = require('../helpers/postgres.cjs');
const { runMigrations } = require('../../src/db/migrate');
const { importLegacyFamily } = require('../../src/services/import-legacy-family');
const { TreeRepository } = require('../../src/repositories/tree-repository');
const { createApp } = require('../../src/app');
const { pruneDatabase } = require('../../src/operations/prune');
const sample = require('../../family-data.json');

test('pruneDatabase dry-run reports counts without deleting, and apply prunes per-tree history, receipts, security events, and expired auth rows', async () => {
  const db = await startPostgres();
  try {
    await runMigrations(db.pool);
    const first = await importLegacyFamily(db.pool, sample);
    const second = await importLegacyFamily(db.pool, sample, { treeKey: 'second', treeName: 'Second tree' });
    const app = createApp({ repository: new TreeRepository(db.pool) });

    for (let rev = 0; rev < 4; rev++) {
      await request(app)
        .patch(`/api/trees/${first.treeId}/people/aria`)
        .send({ expectedRevision: rev, requestId: randomUUID(), person: { name: `Aria v${rev + 1}` } })
        .expect(200);
    }
    await request(app)
      .patch(`/api/trees/${second.treeId}/people/aria`)
      .send({ expectedRevision: 0, requestId: randomUUID(), person: { name: 'Second Aria v1' } })
      .expect(200);

    await db.pool.query(
      "UPDATE mutation_receipts SET created_at = current_timestamp - interval '45 days' WHERE tree_id = $1 AND request_id IN (SELECT request_id FROM mutation_receipts WHERE tree_id = $1 ORDER BY created_at LIMIT 2)",
      [first.treeId],
    );
    await db.pool.query("INSERT INTO app_users (id, username, password_hash) VALUES ($1, 'prune-user', 'hash')", [randomUUID()]);
    const userId = (await db.pool.query("SELECT id FROM app_users WHERE username = 'prune-user'")).rows[0].id;
    await db.pool.query("INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ('expired-tok', $1, current_timestamp - interval '1 hour'), ('active-tok', $1, current_timestamp + interval '1 day')", [userId]);
    await db.pool.query("INSERT INTO auth_failures (key_hash, failures, window_start) VALUES ('old-key', 2, current_timestamp - interval '20 minutes'), ('fresh-key', 2, current_timestamp)");
    await db.pool.query("INSERT INTO security_events (id, tree_id, actor_id, action, created_at) VALUES ($1, $2, $3, 'old-event', current_timestamp - interval '400 days'), ($4, $2, $3, 'new-event', current_timestamp)", [randomUUID(), first.treeId, userId, randomUUID()]);

    const dry = await pruneDatabase(db.pool, { keepHistory: 2, receiptDays: 30, securityDays: 365, apply: false });
    assert.equal(dry.apply, false);
    assert.deepEqual(dry.counts, {
      tree_changes: 2,
      mutation_receipts: 2,
      security_events: 1,
      auth_sessions: 1,
      auth_failures: 1,
    });
    assert.equal((await db.pool.query('SELECT COUNT(*)::integer AS c FROM tree_changes WHERE tree_id = $1', [first.treeId])).rows[0].c, 4);

    const applied = await pruneDatabase(db.pool, { keepHistory: 2, receiptDays: 30, securityDays: 365, apply: true });
    assert.equal(applied.apply, true);
    assert.deepEqual(applied.counts, dry.counts);

    const keptFirst = (await db.pool.query('SELECT id, revision FROM tree_changes WHERE tree_id = $1 ORDER BY revision DESC', [first.treeId])).rows;
    assert.deepEqual(keptFirst.map(r => r.revision), [4, 3]);
    assert.equal((await db.pool.query('SELECT COUNT(*)::integer AS c FROM tree_changes WHERE tree_id = $1', [second.treeId])).rows[0].c, 1);
    assert.equal((await db.pool.query('SELECT COUNT(*)::integer AS c FROM mutation_receipts WHERE tree_id = $1', [first.treeId])).rows[0].c, 2);
    assert.equal((await db.pool.query('SELECT COUNT(*)::integer AS c FROM security_events')).rows[0].c, 1);
    assert.equal((await db.pool.query('SELECT COUNT(*)::integer AS c FROM auth_sessions')).rows[0].c, 1);
    assert.equal((await db.pool.query('SELECT COUNT(*)::integer AS c FROM auth_failures')).rows[0].c, 1);

    // Recovery from a retained history entry still works after pruning older rows.
    await request(app)
      .post(`/api/trees/${first.treeId}/history/${keptFirst[1].id}/restore`)
      .send({ expectedRevision: 4, requestId: randomUUID() })
      .expect(200);
  } finally {
    await db.stop();
  }
});

