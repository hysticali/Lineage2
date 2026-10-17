const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { startPostgres } = require('../helpers/postgres.cjs');
const request = require('supertest');

const familyData = require('../../family-data.json');
const { createApp } = require('../../src/app');
const { runMigrations } = require('../../src/db/migrate');
const {
  transformLegacyFamilyData,
} = require('../../src/domain/legacy-transform');
const { TreeRepository } = require('../../src/repositories/tree-repository');
const {
  importLegacyFamily,
} = require('../../src/services/import-legacy-family');

async function createTestDatabase() {
  const database = await startPostgres();
  try {
    await runMigrations(database.pool, path.resolve(__dirname, '../../db/migrations'));
  } catch (error) {
    await database.stop();
    throw error;
  }
  return {
    query: database.pool.query.bind(database.pool),
    connect: database.pool.connect.bind(database.pool),
    end: database.stop,
  };
}

test('the production PostgreSQL schema applies and the legacy transform is deterministic', async () => {
  const pool = await createTestDatabase();
  try {
    const first = transformLegacyFamilyData(familyData);
    const second = transformLegacyFamilyData(familyData);
    assert.equal(first.tree.id, second.tree.id);
    assert.equal(first.persons.length, 45);
    assert.ok(first.families.length > 0);

    const tables = await pool.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'`,
    );
    const tableNames = new Set(tables.rows.map((row) => row.table_name));
    for (const expected of [
      'persons',
      'families',
      'family_partners',
      'family_children',
      'facts',
      'sources',
      'citations',
      'extension_nodes',
    ]) {
      assert.ok(tableNames.has(expected), `missing table ${expected}`);
    }
  } finally {
    await pool.end();
  }
});

test('imports family-data.json and rebuilds the wheel compatibility document', async () => {
  const pool = await createTestDatabase();
  try {
    const report = await importLegacyFamily(pool, familyData);
    assert.equal(report.people, 45);

    const repository = new TreeRepository(pool);
    const projected = await repository.getWheelFamilyData(report.treeId);
    assert.equal(projected.rootId, 'aria');
    assert.equal(Object.keys(projected.family).length, 45);
    assert.equal(projected.family.aria.motherId, 'elena');
    assert.equal(projected.family.aria.fatherId, 'marcus');
    assert.deepEqual(projected.family.aria.spouseIds, ['dylan']);
    assert.equal(projected.family.elena.birthplace, 'Madrid, Spain');
    assert.equal(projected.family.elena.occupation, 'Concert Violinist');

    await assert.rejects(
      importLegacyFamily(pool, familyData),
      /already exists/,
    );
    const replaced = await importLegacyFamily(pool, familyData, { replace: true });
    assert.equal(replaced.people, 45);
  } finally {
    await pool.end();
  }
});

test('represents siblings with unknown parents as a partnerless family', async () => {
  const input = {
    rootId: 'alex',
    family: {
      alex: {
        id: 'alex',
        name: 'Alex Morgan',
        gender: 'X',
        siblingIds: ['casey'],
      },
      casey: {
        id: 'casey',
        name: 'Casey Morgan',
        gender: 'F',
        siblingIds: ['alex'],
      },
    },
  };
  const transformed = transformLegacyFamilyData(input, { treeKey: 'siblings' });
  assert.equal(transformed.families.length, 1);
  assert.equal(transformed.familyPartners.length, 0);
  assert.equal(transformed.familyChildren.length, 2);
  assert.ok(transformed.familyChildren.every((child) => child.pedigree === 'UNKNOWN'));

  const pool = await createTestDatabase();
  try {
    const report = await importLegacyFamily(pool, input, { treeKey: 'siblings' });
    const repository = new TreeRepository(pool);
    const projected = await repository.getWheelFamilyData(report.treeId);
    assert.deepEqual(projected.family.alex.siblingIds, ['casey']);
    assert.deepEqual(projected.family.casey.siblingIds, ['alex']);
  } finally {
    await pool.end();
  }
});

test('serves tree and compatibility data through the read API', async () => {
  const pool = await createTestDatabase();
  try {
    const report = await importLegacyFamily(pool, familyData);
    const repository = new TreeRepository(pool);
    const app = createApp({ repository, staticDir: path.resolve(__dirname, '../..') });

    await request(app).get('/api/health').expect(200, { status: 'ok' });
    const trees = await request(app).get('/api/trees').expect(200);
    assert.equal(trees.body.trees.length, 1);
    assert.equal(trees.body.trees[0].people_count, 45);

    const people = await request(app)
      .get(`/api/trees/${report.treeId}/people`)
      .expect(200);
    assert.equal(people.body.people.length, 45);

    const compatibility = await request(app).get('/api/family-data').expect(200);
    assert.equal(compatibility.body.rootId, 'aria');
    assert.equal(compatibility.body.family.aria.name, 'Aria Hartwell');

    await request(app).get('/api/trees/00000000-0000-0000-0000-000000000000').expect(404);
    await request(app).get('/api/trees/not-a-uuid').expect(400, {
      error: 'Invalid tree ID',
    });

    const page = await request(app).get('/').expect(200);
    assert.match(page.text, /<div id="root">/);
    const staticData = await request(app).get('/family-data.json').expect(200);
    assert.equal(staticData.body.rootId, 'aria');
  } finally {
    await pool.end();
  }
});

test('migrations are idempotent', async () => {
  const pool = await createTestDatabase();
  try {
    const applied = await runMigrations(
      pool,
      path.resolve(__dirname, '../../db/migrations'),
    );
    assert.deepEqual(applied, []);
  } finally {
    await pool.end();
  }
});

test('separate trees can reuse legacy IDs and place names', async () => {
  const pool = await createTestDatabase();
  try {
    const first = await importLegacyFamily(pool, familyData);
    const second = await importLegacyFamily(pool, familyData, {
      treeKey: 'copy',
      treeName: 'Copy',
    });
    assert.notEqual(first.treeId, second.treeId);

    const repository = new TreeRepository(pool);
    const trees = await repository.listTrees();
    assert.deepEqual(
      trees.map((tree) => tree.people_count),
      [45, 45],
    );
    const projected = await repository.getWheelFamilyData(second.treeId);
    assert.equal(projected.family.elena.birthplace, 'Madrid, Spain');
  } finally {
    await pool.end();
  }
});

test('keeps parents whose sex is unknown or non-binary', async () => {
  const input = {
    rootId: 'kid',
    family: {
      kid: { id: 'kid', name: 'Kid Doe', motherId: 'pat' },
      pat: { id: 'pat', name: 'Pat Doe', gender: 'X' },
    },
  };
  const pool = await createTestDatabase();
  try {
    const report = await importLegacyFamily(pool, input, { treeKey: 'nb' });
    const repository = new TreeRepository(pool);
    const projected = await repository.getWheelFamilyData(report.treeId);
    const parents = [projected.family.kid.motherId, projected.family.kid.fatherId];
    assert.ok(parents.includes('pat'), 'parent with sex X must be kept');
  } finally {
    await pool.end();
  }
});

test('records failed imports and cleans up history on replace', async () => {
  const pool = await createTestDatabase();
  try {
    await importLegacyFamily(pool, familyData);
    await assert.rejects(importLegacyFamily(pool, familyData), /already exists/);

    const jobs = await pool.query(
      'SELECT status, error_message FROM import_jobs ORDER BY status',
    );
    assert.deepEqual(
      jobs.rows.map((row) => row.status),
      ['COMPLETED', 'FAILED'],
    );
    assert.match(jobs.rows[1].error_message, /already exists/);

    await importLegacyFamily(pool, familyData, { replace: true });
    const afterReplace = await pool.query(
      'SELECT status, tree_id FROM import_jobs',
    );
    assert.equal(afterReplace.rowCount, 1);
    assert.equal(afterReplace.rows[0].status, 'COMPLETED');
    assert.ok(afterReplace.rows[0].tree_id);
  } finally {
    await pool.end();
  }
});

test('keeps both same-sex parents in the wheel projection', async () => {
  const pool = await createTestDatabase();
  try {
    const repository = new TreeRepository(pool);
    for (const gender of ['F', 'M']) {
      const input = {
        rootId: 'kid',
        family: {
          kid: { name: 'Kid Doe', motherId: 'a', fatherId: 'b' },
          a: { name: 'Parent A', gender },
          b: { name: 'Parent B', gender },
        },
      };
      const report = await importLegacyFamily(pool, input, { treeKey: `parents-${gender}` });
      const { family } = await repository.getWheelFamilyData(report.treeId);
      assert.deepEqual(
        [family.kid.motherId, family.kid.fatherId].sort(),
        ['a', 'b'],
      );
      assert.equal(family.a.gender, gender);
      assert.equal(family.b.gender, gender);
    }
  } finally {
    await pool.end();
  }
});

test('preserves a birthplace when the birth date is unknown', async () => {
  const pool = await createTestDatabase();
  try {
    const input = {
      rootId: 'alex',
      family: { alex: { name: 'Alex Doe', birthplace: 'Paris, France' } },
    };
    const report = await importLegacyFamily(pool, input);
    const { family } = await new TreeRepository(pool).getWheelFamilyData(report.treeId);
    assert.equal(family.alex.birthplace, 'Paris, France');
    assert.equal(family.alex.birth, undefined);
    const facts = await pool.query("SELECT date_original FROM facts WHERE gedcom_tag = 'BIRT'");
    assert.equal(facts.rowCount, 1);
    assert.equal(facts.rows[0].date_original, null);
  } finally {
    await pool.end();
  }
});

test('preserves explicit sibling pairs without inventing transitive links', async () => {
  const pool = await createTestDatabase();
  try {
    const input = {
      rootId: 'a',
      family: {
        a: { name: 'Sibling A', siblingIds: ['b'] },
        b: { name: 'Sibling B', siblingIds: ['a', 'c'] },
        c: { name: 'Sibling C' },
      },
    };
    const report = await importLegacyFamily(pool, input);
    assert.equal(report.families, 2, 'reciprocal links should share one family');
    const { family } = await new TreeRepository(pool).getWheelFamilyData(report.treeId);
    assert.deepEqual(family.a.siblingIds, ['b']);
    assert.deepEqual(family.b.siblingIds.slice().sort(), ['a', 'c']);
    assert.deepEqual(family.c.siblingIds, ['b']);
    for (const person of Object.values(family)) {
      assert.equal(person.motherId, undefined);
      assert.equal(person.fatherId, undefined);
    }
  } finally {
    await pool.end();
  }
});
