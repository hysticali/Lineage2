const { createHash } = require('node:crypto');
const { canonicalJson } = require('../domain/archive');
const { InputError } = require('./edit-tree');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Fixed identifiers and ownership paths. Every exported relation belongs to
// one tree; operation receipts, accounts, and edit history are not genealogy.
const entityTables = ['persons', 'person_names', 'families', 'places', 'facts', 'notes', 'repositories', 'sources', 'citations', 'media_objects', 'extension_nodes'];
const originalTables = ['entities', 'import_jobs', ...entityTables, 'family_partners', 'family_children', 'media_files', 'identifiers', 'restrictions', 'import_xrefs', 'media_links', 'media_blobs'];
const versionTwoTables = [...originalTables, 'gedcom_documents', 'gedcom_nodes'];
const tables = [...versionTwoTables, 'gedcom_fragments'];
const snapshotData = snapshot => Object.fromEntries(tables.map(table => [table, Object.hasOwn(snapshot.tables, table) ? snapshot.tables[table] : []]));
const references = {
  entities: { tree_id: 'tree' },
  import_jobs: { tree_id: 'tree' },
  persons: { id: 'entities', created_from_import_id: 'import_jobs' },
  person_names: { id: 'entities', person_id: 'persons' },
  families: { id: 'entities', created_from_import_id: 'import_jobs' },
  places: { id: 'entities' }, facts: { id: 'entities', person_id: 'persons', family_id: 'families', place_id: 'places' },
  notes: { id: 'entities', person_id: 'persons', family_id: 'families', fact_id: 'facts' },
  repositories: { id: 'entities' }, sources: { id: 'entities', repository_id: 'repositories' },
  citations: { id: 'entities', source_id: 'sources', target_entity_id: 'entities' },
  media_objects: { id: 'entities' }, extension_nodes: { id: 'entities', parent_entity_id: 'entities', parent_extension_id: 'extension_nodes' },
  family_partners: { family_id: 'families', person_id: 'persons' }, family_children: { family_id: 'families', person_id: 'persons' },
  media_files: { media_object_id: 'media_objects' }, identifiers: { entity_id: 'entities' }, restrictions: { entity_id: 'entities' },
  import_xrefs: { import_job_id: 'import_jobs', entity_id: 'entities' }, media_links: { media_object_id: 'media_objects', target_entity_id: 'entities' },
  media_blobs: { media_file_id: 'media_files' },
  gedcom_documents: { import_job_id: 'import_jobs' },
  gedcom_nodes: { entity_id: 'entities', import_job_id: 'import_jobs' },
  gedcom_fragments: { owner_entity_id: 'entities', import_job_id: 'import_jobs' },
};

async function snapshotTree(client, treeId) {
  const tree = (await client.query('SELECT to_jsonb(t) AS row FROM trees t WHERE id = $1', [treeId])).rows[0]?.row;
  if (!tree) throw new InputError('Tree not found', 404);
  const data = {};
  for (const table of tables) {
    let condition;
    if (table === 'entities' || table === 'import_jobs') condition = 'r.tree_id = $1';
    else if (entityTables.includes(table)) condition = 'r.id IN (SELECT id FROM entities WHERE tree_id = $1)';
    else if (table === 'family_partners' || table === 'family_children') condition = 'r.family_id IN (SELECT id FROM entities WHERE tree_id = $1)';
    else if (table === 'media_files' || table === 'media_links') condition = 'r.media_object_id IN (SELECT id FROM entities WHERE tree_id = $1)';
    else if (table === 'media_blobs') condition = 'r.media_file_id IN (SELECT f.id FROM media_files f JOIN entities e ON e.id = f.media_object_id WHERE e.tree_id = $1)';
    else if (table === 'gedcom_documents') condition = 'r.import_job_id IN (SELECT id FROM import_jobs WHERE tree_id = $1)';
    else if (table === 'gedcom_fragments') condition = 'r.owner_entity_id IN (SELECT id FROM entities WHERE tree_id = $1)';
    else condition = 'r.entity_id IN (SELECT id FROM entities WHERE tree_id = $1)';
    data[table] = (await client.query(`SELECT to_jsonb(r) AS row FROM ${table} r WHERE ${condition} ORDER BY to_jsonb(r)::text`, [treeId])).rows.map(r => r.row);
  }
  return { format: 'rootline-tree', version: 2, tree, tables: data };
}

function validateSnapshot(snapshot) {
  if (snapshot?.format !== 'rootline-tree' || ![1, 2].includes(snapshot.version) || !snapshot.tree || !snapshot.tables) throw new InputError('Unsupported full-tree backup format');
  if (!UUID.test(snapshot.tree.id || '') || typeof snapshot.tree.name !== 'string' || !snapshot.tree.name.trim()) throw new InputError('Backup tree identity and name are required');
  const required = snapshot.version === 1 ? originalTables : versionTwoTables;
  if (required.some(table => !Object.hasOwn(snapshot.tables, table)) || Object.keys(snapshot.tables).some(t => !tables.includes(t))) throw new InputError('Backup must contain the supported genealogy tables');
  const data = snapshotData(snapshot);
  const ids = { tree: new Set([snapshot.tree.id]) };
  let rows = 0;
  for (const table of tables) {
    const values = data[table];
    if (!Array.isArray(values) || (rows += values.length) > 1000000) throw new InputError('Invalid or oversized backup tables');
    ids[table] = new Set();
    for (const row of values) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new InputError(`Invalid ${table} record`);
      if (row.id !== undefined) {
        if (!UUID.test(row.id) || ids[table].has(row.id)) throw new InputError(`Invalid or duplicate ${table} ID`);
        ids[table].add(row.id);
      }
    }
  }
  for (const table of tables) for (const row of data[table]) {
    for (const [key, target] of Object.entries(references[table])) {
      if (row[key] != null && !ids[target].has(row[key])) throw new InputError(`Backup ${table}.${key} references a record outside this tree`);
    }
    for (const key of Object.keys(row)) if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new InputError('Unsupported backup field');
  }
  if (snapshot.tree.root_person_id && !ids.persons.has(snapshot.tree.root_person_id)) throw new InputError('Backup root person is missing');
  for (const person of data.persons) {
    if ((person.living_status !== undefined && !['UNKNOWN', 'LIVING', 'DECEASED'].includes(person.living_status)) || (person.is_public !== undefined && typeof person.is_public !== 'boolean') || (person.is_public && person.living_status !== 'DECEASED')) throw new InputError('Invalid living status or publication approval in backup');
  }
  const files = new Map(data.media_files.map(f => [f.id, f]));
  let bytes = 0;
  for (const blob of data.media_blobs) {
    if (typeof blob.content !== 'string' || !blob.content.startsWith('\\x') || blob.content.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(blob.content.slice(2))) throw new InputError('Invalid attachment bytes');
    const content = Buffer.from(blob.content.slice(2), 'hex'); bytes += content.length;
    if (content.length > 10485760 || createHash('sha256').update(content).digest('hex') !== files.get(blob.media_file_id)?.checksum_sha256) throw new InputError('Attachment checksum or size does not match the backup');
  }
  const imports = new Map(data.import_jobs.map(job => [job.id, job]));
  const sourceNodes = new Map();
  for (const document of data.gedcom_documents) {
    if (typeof document.source_text !== 'string' || imports.get(document.import_job_id)?.source_format !== 'GEDCOM' || createHash('sha256').update(document.source_text, 'utf8').digest('hex') !== imports.get(document.import_job_id)?.checksum_sha256) throw new InputError('Original GEDCOM source checksum does not match the backup');
    const parsed = require('../domain/gedcom').parseGedcom(document.source_text);
    if (canonicalJson(parsed.records[0]) !== canonicalJson(document.header)) throw new InputError('Stored GEDCOM header does not match the original source');
    const nodes = new Map(), pending = [...parsed.records];
    while (pending.length) { const node = pending.pop(); nodes.set(node.line, canonicalJson(node)); pending.push(...node.children); }
    sourceNodes.set(document.import_job_id, nodes);
  }
  for (const binding of [...data.gedcom_nodes, ...data.gedcom_fragments]) {
    if (!binding.node || sourceNodes.get(binding.import_job_id)?.get(binding.node.line) !== canonicalJson(binding.node)) throw new InputError('Stored GEDCOM structure does not match its original source');
  }
  if (data.import_jobs.some(job => job.source_format === 'GEDCOM' && job.status === 'COMPLETED' && !sourceNodes.has(job.id))) throw new InputError('A completed GEDCOM import is missing its original source');
  return { treeId: snapshot.tree.id, name: snapshot.tree.name, people: data.persons.length, families: data.families.length, sources: data.sources.length, citations: data.citations.length, attachments: data.media_blobs.length, attachmentBytes: bytes, rows };
}

async function readBackup(pool, treeId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = await snapshotTree(client, treeId);
    await client.query('COMMIT'); return snapshot;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function columnsFor(client, table) {
  return (await client.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position`, [table])).rows.map(r => r.column_name);
}

async function insertRows(client, table, rows) {
  if (!rows.length) return;
  const columns = await columnsFor(client, table);
  if (rows.some(row => Object.keys(row).some(key => !columns.includes(key)))) throw new InputError(`Unknown field in ${table}`);
  // All columns/relations come from the fixed table list and the database
  // catalog. JSON is a bound value and never becomes SQL source text.
  await client.query(`INSERT INTO ${table} (${columns.join(', ')}) SELECT ${columns.join(', ')} FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)`, [JSON.stringify(rows)]);
}

async function installSnapshot(client, snapshot, { existing = false } = {}) {
  validateSnapshot(snapshot);
  if (existing) {
    await client.query('UPDATE trees SET root_person_id = NULL WHERE id = $1', [snapshot.tree.id]);
    await client.query('DELETE FROM entities WHERE tree_id = $1', [snapshot.tree.id]);
    await client.query('DELETE FROM import_jobs WHERE tree_id = $1', [snapshot.tree.id]);
  } else {
    await insertRows(client, 'trees', [{ ...snapshot.tree, root_person_id: null }]);
  }
  const data = snapshotData(snapshot);
  // Older native backups predate ordered notes. Apply the migration's default
  // when restoring those rows rather than inserting NULL through JSON records.
  data.notes = data.notes.map(row => Object.hasOwn(row, 'position') ? row : { ...row, position: 0 });
  data.persons = data.persons.map(row => ({ living_status: 'UNKNOWN', is_public: false, ...row }));
  // Source repositories precede sources; places precede facts; self-linked
  // extensions are inserted in parent order, independent of backup row order.
  const order = ['entities', 'import_jobs', 'persons', 'person_names', 'families', 'places', 'facts', 'notes', 'repositories', 'sources', 'citations', 'media_objects', 'family_partners', 'family_children', 'media_files', 'identifiers', 'restrictions', 'import_xrefs', 'media_links', 'media_blobs', 'gedcom_documents', 'gedcom_nodes', 'gedcom_fragments'];
  for (const table of order) await insertRows(client, table, data[table]);
  const inserted = new Set();
  let pending = [...data.extension_nodes];
  while (pending.length) {
    const ready = pending.filter(r => !r.parent_extension_id || inserted.has(r.parent_extension_id));
    if (!ready.length) throw new InputError('Backup contains a cyclic extension hierarchy');
    await insertRows(client, 'extension_nodes', ready);
    ready.forEach(r => inserted.add(r.id)); pending = pending.filter(r => !inserted.has(r.id));
  }
  await client.query('UPDATE trees SET root_person_id = $1, name = $2, source_gedcom_version = $3, default_language = $4 WHERE id = $5', [snapshot.tree.root_person_id, snapshot.tree.name, snapshot.tree.source_gedcom_version, snapshot.tree.default_language, snapshot.tree.id]);
}

async function restoreNewTree(pool, snapshot, requestId, options = {}) {
  const summary = validateSnapshot(snapshot);
  if (!UUID.test(requestId || '')) throw new InputError('A UUID requestId is required');
  const hash = createHash('sha256').update(canonicalJson({ snapshot, creatorId: options.creatorId || null })).digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [requestId]);
    const prior = (await client.query('SELECT request_hash, tree_id FROM restored_backups WHERE request_id = $1', [requestId])).rows[0];
    if (prior) {
      if (prior.request_hash !== hash) throw new InputError('Request ID was already used for a different backup', 409);
      await client.query('COMMIT'); return { treeId: prior.tree_id, summary };
    }
    if ((await client.query('SELECT id FROM trees WHERE id = $1', [snapshot.tree.id])).rowCount) throw new InputError('This tree already exists. Use its recovery tools to replace it; restoring here requires a clean database or a missing tree.', 409);
    await installSnapshot(client, snapshot);
    if (options.creatorId) await client.query("INSERT INTO tree_memberships (tree_id, user_id, role) VALUES ($1, $2, 'OWNER')", [snapshot.tree.id, options.creatorId]);
    await require('./edit-tree').assertNoCycles(client, snapshot.tree.id);
    await client.query('INSERT INTO restored_backups (request_id, request_hash, tree_id) VALUES ($1, $2, $3)', [requestId, hash, snapshot.tree.id]);
    await client.query('COMMIT'); return { treeId: snapshot.tree.id, summary };
  } catch (error) {
    await client.query('ROLLBACK');
    if (/^(22|23)/.test(error.code || '')) throw new InputError('Backup violates database record constraints; nothing was restored');
    throw error;
  } finally { client.release(); }
}

module.exports = { snapshotTree, validateSnapshot, readBackup, installSnapshot, restoreNewTree };
