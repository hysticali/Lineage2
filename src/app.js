const path = require('node:path');
const fs = require('node:fs/promises');
const express = require('express');
const { mutateTree } = require('./services/edit-tree');
const { planLocalMigration } = require('./domain/local-migration');
const { readPersonRecords } = require('./services/person-records');
const { readBackup, validateSnapshot, restoreNewTree } = require('./services/tree-backup');
const { planGedcom } = require('./domain/gedcom-plan');
const { importGedcom, previewExistingGedcom } = require('./services/import-gedcom');
const { exportGedcom } = require('./services/export-gedcom');
const { createHash, randomUUID } = require('node:crypto');
const { duplicateCandidates, previewMerge } = require('./services/merge-people');
const { accessConfig, LOOPBACK } = require('./config');
const { installAccess } = require('./http/access-routes');
const { publicArchive, publicGedcom } = require('./services/privacy');

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createApp({ repository, staticDir = path.resolve(__dirname, '..'), auth = {}, logger = console }) {
  const app = express();
  const config = accessConfig(auth);
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 'loopback');
  app.use((request, response, next) => {
    request.requestId = randomUUID();
    response.set({ 'X-Request-ID': request.requestId, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" });
    if (config.mode === 'local' && !LOOPBACK.has(request.hostname)) return response.status(403).json({ error: 'Local mode requires a loopback host' });
    next();
  });
  const access = installAccess(app, repository, config);
  const mutate = (request, treeId, body, action) => mutateTree(repository.pool, treeId, body, action, { actor: request.actor, privateMode: config.mode === 'private' });
  app.use(express.json({ limit: '50mb' }));
  app.use('/assets', express.static(path.join(staticDir, 'assets')));

  app.get('/api/health', async (_request, response) => {
    try { response.json(await repository.health()); }
    catch { response.status(503).json({ status: 'unavailable' }); }
  });

  app.get('/api/trees', async (request, response) => {
    const trees = await repository.listTrees(config.mode === 'private' ? request.actor.id : null);
    const result = [];
    for (const tree of trees) {
      const role = config.mode === 'local' ? 'OWNER' : tree.access_role;
      if (role === 'VIEWER') {
        const data = await publicArchive(repository.pool, tree.id);
        result.push({ id: tree.id, name: data.treeName, root_person_name: data.family[data.rootId].name, people_count: data.visiblePeople, access_role: role });
      } else result.push({ ...tree, access_role: role });
    }
    response.json({ trees: result });
  });

  app.post('/api/gedcom/preview', (request, response) => {
    const plan = planGedcom(request.body.source);
    response.json({ ...plan.report, checksum: createHash('sha256').update(request.body.source, 'utf8').digest('hex') });
  });

  app.post('/api/gedcom/import', async (request, response) => {
    response.status(201).json(await importGedcom(repository.pool, request.body, { creatorId: request.actor.id }));
  });

  app.post('/api/trees/:treeId/gedcom/preview', async (request, response) => {
    if (!UUID_PATTERN.test(request.params.treeId)) return response.status(400).json({ error: 'Invalid tree ID' });
    response.json(await previewExistingGedcom(repository.pool, request.params.treeId, request.body.source));
  });

  app.post('/api/trees/:treeId/gedcom/import', async (request, response) => {
    if (!UUID_PATTERN.test(request.params.treeId)) return response.status(400).json({ error: 'Invalid tree ID' });
    response.json(await mutate(request, request.params.treeId, request.body, 'import-gedcom'));
  });

  app.get('/api/trees/:treeId/gedcom', async (request, response) => {
    if (!UUID_PATTERN.test(request.params.treeId)) return response.status(400).json({ error: 'Invalid tree ID' });
    if (config.mode === 'private' && request.query.includePrivate !== 'true') return response.json(publicGedcom(await publicArchive(repository.pool, request.params.treeId)));
    if (request.treeRole === 'VIEWER') return response.status(403).json({ error: 'Private export requires editor permission' });
    response.set('Cache-Control', 'private, no-store').json(await exportGedcom(repository.pool, request.params.treeId));
  });

  app.get('/api/trees/:treeId/duplicates', async (request, response) => {
    if (!UUID_PATTERN.test(request.params.treeId)) return response.status(400).json({ error: 'Invalid tree ID' });
    const archive = await repository.getWheelFamilyData(request.params.treeId);
    if (!archive) return response.status(404).json({ error: 'Tree not found' });
    response.json({ revision: archive.revision, ...duplicateCandidates(archive) });
  });

  app.post('/api/trees/:treeId/merge/preview', async (request, response) => {
    if (!UUID_PATTERN.test(request.params.treeId)) return response.status(400).json({ error: 'Invalid tree ID' });
    response.json(await previewMerge(repository.pool, request.params.treeId, request.body));
  });

  app.post('/api/trees/:treeId/merge', async (request, response) => {
    if (!UUID_PATTERN.test(request.params.treeId)) return response.status(400).json({ error: 'Invalid tree ID' });
    response.json(await mutate(request, request.params.treeId, request.body, 'merge-people'));
  });

  app.get('/api/trees/:treeId/imports', async (request, response) => {
    if (!UUID_PATTERN.test(request.params.treeId)) return response.status(400).json({ error: 'Invalid tree ID' });
    if (!await repository.getTree(request.params.treeId)) return response.status(404).json({ error: 'Tree not found' });
    const result = await repository.pool.query(`SELECT j.id, j.source_filename, j.source_format, j.gedcom_version, j.checksum_sha256, j.status, j.warnings,
      EXISTS (SELECT 1 FROM gedcom_documents d WHERE d.import_job_id = j.id) AS source_available
      FROM import_jobs j WHERE j.tree_id = $1 ORDER BY j.created_at, j.id`, [request.params.treeId]);
    response.json({ imports: result.rows });
  });

  app.get('/api/trees/:treeId/imports/:importId/source', async (request, response) => {
    if (!UUID_PATTERN.test(request.params.treeId) || !UUID_PATTERN.test(request.params.importId)) return response.status(400).json({ error: 'Invalid tree or import ID' });
    const result = await repository.pool.query(`SELECT d.source_text, j.source_filename FROM gedcom_documents d JOIN import_jobs j ON j.id = d.import_job_id
      WHERE j.tree_id = $1 AND j.id = $2`, [request.params.treeId, request.params.importId]);
    if (!result.rowCount) return response.status(404).json({ error: 'Original source not found' });
    response.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).attachment(result.rows[0].source_filename).type('application/octet-stream').send(Buffer.from(result.rows[0].source_text, 'utf8'));
  });

  app.get('/api/trees/:treeId', async (request, response) => {
    if (!UUID_PATTERN.test(request.params.treeId)) {
      return response.status(400).json({ error: 'Invalid tree ID' });
    }
    const tree = await repository.getTree(request.params.treeId);
    if (!tree) return response.status(404).json({ error: 'Tree not found' });
    if (request.treeRole === 'VIEWER') {
      const data = await publicArchive(repository.pool, tree.id);
      return response.json({ tree: { id: tree.id, name: data.treeName, root_person_id: data.family[data.rootId].uuid || null, root_person_name: data.family[data.rootId].name, people_count: data.visiblePeople, revision: data.revision } });
    }
    return response.json({ tree });
  });

  app.get('/api/trees/:treeId/backup', async (request, response) => {
    if (!UUID_PATTERN.test(request.params.treeId)) return response.status(400).json({ error: 'Invalid tree ID' });
    response.set('Cache-Control', 'private, no-store').json(await readBackup(repository.pool, request.params.treeId));
  });

  app.post('/api/backups/preview', async (request, response) => {
    const summary = validateSnapshot(request.body.backup);
    const existing = await repository.getTree(summary.treeId);
    if (existing) await access.role(request, summary.treeId, 'EDITOR');
    response.json({ summary, exists: Boolean(existing), revision: existing?.revision });
  });

  app.post('/api/backups/restore', async (request, response) => {
    const summary = validateSnapshot(request.body.backup);
    if (await repository.getTree(summary.treeId)) await access.role(request, summary.treeId, 'EDITOR');
    response.json(await restoreNewTree(repository.pool, request.body.backup, request.body.requestId, { creatorId: request.actor.id }));
  });

  app.post('/api/trees/:treeId/restore', async (request, response) => {
    if (!UUID_PATTERN.test(request.params.treeId)) return response.status(400).json({ error: 'Invalid tree ID' });
    response.json(await mutate(request, request.params.treeId, request.body, 'restore-tree'));
  });

  app.get('/api/trees/:treeId/history', async (request, response) => {
    if (!UUID_PATTERN.test(request.params.treeId)) return response.status(400).json({ error: 'Invalid tree ID' });
    if (!await repository.getTree(request.params.treeId)) return response.status(404).json({ error: 'Tree not found' });
    const result = await repository.pool.query(`SELECT id, revision, action, created_at, actor_label,
      before_snapshot IS NOT NULL AS recoverable FROM tree_changes WHERE tree_id = $1 ORDER BY revision DESC LIMIT 100`, [request.params.treeId]);
    response.json({ changes: result.rows });
  });

  app.get('/api/trees/:treeId/history/:changeId/preview', async (request, response) => {
    if (!UUID_PATTERN.test(request.params.treeId) || !UUID_PATTERN.test(request.params.changeId)) return response.status(400).json({ error: 'Invalid tree or history ID' });
    const result = await repository.pool.query('SELECT before_snapshot FROM tree_changes WHERE tree_id = $1 AND id = $2', [request.params.treeId, request.params.changeId]);
    if (!result.rows[0]?.before_snapshot) return response.status(404).json({ error: 'Recovery snapshot not found' });
    const tree = await repository.getTree(request.params.treeId);
    response.json({ summary: validateSnapshot(result.rows[0].before_snapshot), revision: tree.revision });
  });

  app.post('/api/trees/:treeId/history/:changeId/restore', async (request, response) => {
    if (!UUID_PATTERN.test(request.params.treeId) || !UUID_PATTERN.test(request.params.changeId)) return response.status(400).json({ error: 'Invalid tree or history ID' });
    response.json(await mutate(request, request.params.treeId, { ...request.body, changeId: request.params.changeId }, 'restore-history'));
  });

  app.get('/api/trees/:treeId/people', async (request, response) => {
    if (!UUID_PATTERN.test(request.params.treeId)) {
      return response.status(400).json({ error: 'Invalid tree ID' });
    }
    const tree = await repository.getTree(request.params.treeId);
    if (!tree) return response.status(404).json({ error: 'Tree not found' });
    if (request.treeRole === 'VIEWER') {
      const data = await publicArchive(repository.pool, tree.id);
      return response.json({ people: Object.values(data.family).filter(p => !p.placeholder).map(p => ({ id: p.uuid, name: p.name, sex: p.gender || null, reference_id: p.id })) });
    }
    return response.json({ people: await repository.listPeople(tree.id) });
  });

  app.get('/api/trees/:treeId/family-data', async (request, response) => {
    if (!UUID_PATTERN.test(request.params.treeId)) {
      return response.status(400).json({ error: 'Invalid tree ID' });
    }
    const data = request.treeRole === 'VIEWER' ? await publicArchive(repository.pool, request.params.treeId) : await repository.getWheelFamilyData(request.params.treeId);
    if (!data) return response.status(404).json({ error: 'Tree not found' });
    return response.json({ ...data, permissions: access.permissions(request.treeRole) });
  });

  app.get('/api/family-data', async (request, response) => {
    const tree = await repository.getDefaultTree(config.mode === 'private' ? request.actor.id : null);
    if (!tree) return response.status(404).json({ error: 'No trees available' });
    const role = await access.role(request, tree.id);
    const data = role === 'VIEWER' ? await publicArchive(repository.pool, tree.id) : await repository.getWheelFamilyData(tree.id);
    return response.json({ ...data, permissions: access.permissions(role) });
  });

  app.patch('/api/trees/:treeId/people/:personId/privacy', async (request, response) => {
    response.json(await mutate(request, request.params.treeId, { ...request.body, personId: request.params.personId }, 'set-privacy'));
  });

  app.post('/api/trees/:treeId/people', async (request, response) => {
    if (!UUID_PATTERN.test(request.params.treeId)) return response.status(400).json({ error: 'Invalid tree ID' });
    response.status(201).json(await mutate(request, request.params.treeId, request.body, 'add-relative'));
  });

  app.get('/api/trees/:treeId/people/:personId/records', async (request, response) => {
    if (!UUID_PATTERN.test(request.params.treeId)) return response.status(400).json({ error: 'Invalid tree ID' });
    response.json(await readPersonRecords(repository.pool, request.params.treeId, request.params.personId));
  });

  app.post('/api/trees/:treeId/people/:personId/records', async (request, response) => {
    if (!UUID_PATTERN.test(request.params.treeId)) return response.status(400).json({ error: 'Invalid tree ID' });
    response.json(await mutate(request, request.params.treeId, { ...request.body, personId: request.params.personId }, 'edit-record'));
  });

  app.get('/api/trees/:treeId/media/:fileId', async (request, response) => {
    if (!UUID_PATTERN.test(request.params.treeId) || !UUID_PATTERN.test(request.params.fileId)) return response.status(400).json({ error: 'Invalid tree or file ID' });
    const result = await repository.pool.query(`SELECT f.file_reference, b.content FROM media_files f
      JOIN media_blobs b ON b.media_file_id = f.id JOIN entities e ON e.id = f.media_object_id
      WHERE e.tree_id = $1 AND f.id = $2`, [request.params.treeId, request.params.fileId]);
    if (!result.rowCount) return response.status(404).json({ error: 'Attachment not found' });
    response.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
    response.attachment(result.rows[0].file_reference).type('application/octet-stream').send(result.rows[0].content);
  });

  app.patch('/api/trees/:treeId/people/:personId', async (request, response) => {
    if (!UUID_PATTERN.test(request.params.treeId)) return response.status(400).json({ error: 'Invalid tree ID' });
    response.json(await mutate(request, request.params.treeId, { ...request.body, personId: request.params.personId }, 'edit-person'));
  });

  app.post('/api/trees/:treeId/local-migration/preview', async (request, response) => {
    if (!UUID_PATTERN.test(request.params.treeId)) return response.status(400).json({ error: 'Invalid tree ID' });
    const current = await repository.getWheelFamilyData(request.params.treeId);
    if (!current) return response.status(404).json({ error: 'Tree not found' });
    try { response.json({ revision: current.revision, plan: planLocalMigration(current, request.body.archive) }); }
    catch (error) { response.status(400).json({ error: error.message }); }
  });

  app.post('/api/trees/:treeId/local-migration', async (request, response) => {
    if (!UUID_PATTERN.test(request.params.treeId)) return response.status(400).json({ error: 'Invalid tree ID' });
    response.json(await mutate(request, request.params.treeId, request.body, 'migrate-local'));
  });

  app.get(['/', '/index.html'], async (_request, response) => {
    const html = await fs.readFile(path.join(staticDir, 'index.html'), 'utf8');
    response.set('Cache-Control', 'private, no-store').type('html').send(html.replace('name="lineage-mode" content="auto"', 'name="lineage-mode" content="database"'));
  });
  app.get('/family-data.json', (_request, response) => {
    if (config.mode === 'private') return response.status(404).json({ error: 'Static sample data is unavailable in private mode' });
    response.sendFile(path.join(staticDir, 'family-data.json'));
  });

  app.use((error, request, response, _next) => {
    if (error.status && error.status >= 400 && error.status < 500) {
      return response.status(error.status).json({ error: error.message });
    }
    logger.error(JSON.stringify({ event: 'request_failed', requestId: request.requestId, code: error.code || 'internal' }));
    response.status(500).json({ error: 'Internal server error', requestId: request.requestId });
  });

  return app;
}

module.exports = { createApp };
