const { randomUUID, createHash } = require('node:crypto');
const { planGedcom, requireValid, text, eventKind } = require('../domain/gedcom-plan');
const { child, children } = require('../domain/gedcom');
const { canonicalJson } = require('../domain/archive');
const { entity, InputError, assertNoCycles } = require('./edit-tree');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const recordTypes = { INDI: 'PERSON', FAM: 'FAMILY', SOUR: 'SOURCE', REPO: 'REPOSITORY', OBJE: 'MEDIA_OBJECT' };

function existingImportReport(snapshot, archive, plan) {
  const declarations = new Map(), uriTags = new Map();
  const existingUsed = new Set(), incomingUsed = new Set();
  function used(nodes, tags) {
    const pending = [...nodes];
    while (pending.length) { const node = pending.pop(); if (node.tag.startsWith('_')) tags.add(node.tag); pending.push(...node.children); }
  }
  used([...(snapshot.tables.gedcom_nodes || []).map(n => n.node), ...(snapshot.tables.gedcom_documents || []).map(d => d.header), ...(snapshot.tables.gedcom_fragments || []).map(n => n.node)], existingUsed);
  used(plan.parsed.records, incomingUsed);
  for (const document of snapshot.tables.gedcom_documents || []) for (const definition of children(child(document.header, 'SCHMA'), 'TAG')) {
    const [tag, uri] = definition.value.split(' '); declarations.set(tag, uri); uriTags.set(uri, tag);
  }
  const errors = [...plan.report.errors];
  const incomingDefinitions = new Map();
  for (const definition of children(child(plan.parsed.records[0], 'SCHMA'), 'TAG')) {
    const [tag, uri] = definition.value.split(' ');
    incomingDefinitions.set(tag, uri);
    if ((declarations.has(tag) && declarations.get(tag) !== uri) || (uriTags.has(uri) && uriTags.get(uri) !== tag) || (existingUsed.has(tag) && !declarations.has(tag))) errors.push(`Extension schema conflict for ${tag}. Import as a separate tree so its original meanings remain unambiguous.`);
  }
  for (const tag of incomingUsed) if (declarations.has(tag) && !incomingDefinitions.has(tag)) errors.push(`Undocumented incoming extension ${tag} conflicts with the tree's defined schema. Import it as a separate tree.`);
  const normalize = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const byName = new Map();
  for (const person of Object.values(archive.family)) {
    const key = normalize(person.name); if (!byName.has(key)) byName.set(key, []); byName.get(key).push(person);
  }
  const matches = [];
  let truncated = false;
  for (const incoming of plan.report.roots) for (const existing of byName.get(normalize(incoming.name)) || []) {
    if (matches.length >= 200) { truncated = true; break; }
    matches.push({ incomingName: incoming.name, existingId: existing.id, existingName: existing.name, existingBirth: existing.birth || '' });
  }
  return { ...plan.report, errors: [...new Set(errors)], revision: snapshot.tree.revision, existingMatches: matches, matchesTruncated: truncated, destinationName: snapshot.tree.name, destinationId: snapshot.tree.id };
}

async function previewExistingGedcom(pool, treeId, source) {
  const plan = planGedcom(source), client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = await require('./tree-backup').snapshotTree(client, treeId);
    const archive = await new (require('../repositories/tree-repository').TreeRepository)(client, { inTransaction: true }).getWheelFamilyData(treeId);
    const report = existingImportReport(snapshot, archive, plan);
    await client.query('COMMIT');
    return { ...report, checksum: createHash('sha256').update(source, 'utf8').digest('hex') };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function insert(client, table, row) {
  const keys = Object.keys(row);
  await client.query(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(row));
}

async function importGedcom(pool, request, options = {}) {
  const { source, requestId, name, rootReference, filename = 'family.ged' } = request;
  if (!UUID.test(requestId || '')) throw new InputError('A UUID requestId is required');
  if (typeof name !== 'string' || !name.trim() || name.length > 500) throw new InputError('A tree name of 1–500 characters is required');
  if (typeof filename !== 'string' || !filename || filename.length > 500 || /[\r\n\0]/.test(filename)) throw new InputError('A valid source filename is required');
  const plan = requireValid(planGedcom(source));
  if (options.treeId) {
    if (request.reviewMatches !== true) throw new InputError('Review possible matches and confirm that records will remain separate until explicitly merged');
    const report = existingImportReport(options.snapshot, options.archive, plan);
    if (report.errors.length) throw new InputError(report.errors.join(' '));
  }
  const checksum = createHash('sha256').update(source, 'utf8').digest('hex');
  if (request.checksum !== checksum) throw new InputError('The file changed after preview. Preview it again before importing.', 409);
  const root = plan.individuals.find(n => (n.xref || `line:${n.line}`) === rootReference);
  if (!root) throw new InputError('Choose a root person from the import preview');
  const hash = createHash('sha256').update(canonicalJson({ checksum, name, rootReference, filename, creatorId: options.creatorId || null })).digest('hex');
  const owned = !options.client;
  const client = options.client || await pool.connect();
  try {
    if (owned) {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [requestId]);
      const receipt = (await client.query('SELECT request_hash, response FROM gedcom_import_receipts WHERE request_id = $1', [requestId])).rows[0];
      if (receipt) {
        if (receipt.request_hash !== hash) throw new InputError('Request ID was already used for a different import', 409);
        await client.query('COMMIT'); return receipt.response;
      }
    }
    const treeId = options.treeId || randomUUID(), importId = randomUUID();
    if (!options.treeId) await insert(client, 'trees', { id: treeId, name: name.trim(), source_gedcom_version: plan.report.version, default_language: text(plan.parsed.records[0], 'LANG') });
    if (!options.treeId && options.creatorId) await client.query("INSERT INTO tree_memberships (tree_id, user_id, role) VALUES ($1, $2, 'OWNER')", [treeId, options.creatorId]);
    await client.query(`INSERT INTO import_jobs (id, tree_id, source_filename, source_format, gedcom_version, checksum_sha256, status, warnings, started_at)
      VALUES ($1, $2, $3, 'GEDCOM', $4, $5, 'RUNNING', $6::jsonb, current_timestamp)`, [importId, treeId, filename, plan.report.version, checksum, JSON.stringify(plan.report.warnings)]);
    const ids = new Map(), byXref = new Map();
    const records = plan.parsed.records.filter(n => !['HEAD', 'TRLR'].includes(n.tag));
    for (const node of records) {
      const id = await entity(client, treeId, recordTypes[node.tag] || 'EXTENSION');
      ids.set(node, id);
      if (node.xref) {
        byXref.set(node.xref, id);
        await insert(client, 'import_xrefs', { import_job_id: importId, xref: node.xref, entity_id: id });
      }
      if (recordTypes[node.tag]) await insert(client, 'identifiers', { id: randomUUID(), entity_id: id, identifier_type: 'UID', value: id });
    }
    async function bind(id, node, baseline, isRecord = false) {
      await client.query('INSERT INTO gedcom_nodes (entity_id, import_job_id, node, baseline, is_record) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)', [id, importId, JSON.stringify(node), JSON.stringify(baseline), isRecord]);
    }
    for (const node of records) {
      const id = ids.get(node);
      let baseline = {};
      if (node.tag === 'INDI') {
        baseline = { sex: ['M', 'F', 'X', 'U'].includes(text(node, 'SEX')) ? text(node, 'SEX') : null };
        await insert(client, 'persons', { id, ...baseline, created_from_import_id: importId });
      } else if (node.tag === 'FAM') {
        baseline = { partnerExtension: plan.partnerExtension, partnerTags: [...new Set(node.children.filter(plan.isPartner).map(n => n.tag).filter(tag => !['HUSB', 'WIFE'].includes(tag)))] };
        await insert(client, 'families', { id, created_from_import_id: importId });
      } else if (node.tag === 'REPO') {
        baseline = { name: text(node, 'NAME') || '', address_text: text(node, 'ADDR'), website_uri: text(node, 'WWW') };
        await insert(client, 'repositories', { id, ...baseline });
      } else if (node.tag === 'OBJE') {
        baseline = { title: text(child(node, 'FILE'), 'TITL'), description: node.children.find(n => plan.ownExtension(n.tag, 'description'))?.value || null, provenance: node.children.find(n => plan.ownExtension(n.tag, 'provenance'))?.value || null };
        await insert(client, 'media_objects', { id, ...baseline });
        let position = 0;
        for (const file of children(node, 'FILE')) await insert(client, 'media_files', { id: randomUUID(), media_object_id: id, position: position++, file_reference: file.value, mime_type: text(file, 'FORM') });
      }
      // Sources depend on repositories, which may occur later in the document.
      if (node.tag !== 'SOUR') await bind(id, node, baseline, true);
    }
    for (const node of records.filter(n => n.tag === 'SOUR')) {
      const baseline = { title: text(node, 'TITL') || '', author: text(node, 'AUTH'), publication_text: text(node, 'PUBL'), abbreviation: text(node, 'ABBR'), repository_id: byXref.get(child(node, 'REPO')?.pointer) || null };
      await insert(client, 'sources', { id: ids.get(node), ...baseline });
      await bind(ids.get(node), node, baseline, true);
    }
    const evidenceQueue = [];
    for (const node of records) {
      if (!recordTypes[node.tag]) continue;
      const ownerId = ids.get(node);
      for (const restriction of (text(node, 'RESN') || '').split(',').map(s => s.trim())) {
        if (['CONFIDENTIAL', 'LOCKED', 'PRIVACY'].includes(restriction)) await client.query('INSERT INTO restrictions (entity_id, restriction) VALUES ($1, $2) ON CONFLICT DO NOTHING', [ownerId, restriction]);
      }
      evidenceQueue.push([node, ownerId, node.tag === 'INDI' ? 'person_id' : node.tag === 'FAM' ? 'family_id' : null]);
      if (node.tag === 'INDI') {
        let position = 0;
        for (const nameNode of children(node, 'NAME')) {
          const id = await entity(client, treeId, 'NAME');
          const surname = /\/([^/]*)\//.exec(nameNode.value)?.[1] || null;
          const baseline = {
            full_text: nameNode.value.replaceAll('/', '').trim(), name_type: text(nameNode, 'TYPE'),
            given_names: text(nameNode, 'GIVN') || (surname ? nameNode.value.split('/')[0].trim() : null), surname: text(nameNode, 'SURN') || surname,
            prefix: text(nameNode, 'NPFX'), suffix: text(nameNode, 'NSFX'), nickname: text(nameNode, 'NICK'), surname_prefix: text(nameNode, 'SPFX'), language_tag: null,
          };
          await insert(client, 'person_names', { id, person_id: ownerId, position, is_primary: position++ === 0, ...baseline });
          await bind(id, nameNode, baseline); evidenceQueue.push([nameNode, id, null]);
        }
      }
      if (['INDI', 'FAM'].includes(node.tag)) {
        let position = 0;
        for (const event of node.children.filter(n => plan.factInfo(node.tag, n))) {
          const id = await entity(client, treeId, 'FACT');
          let placeId = null;
          const placeName = text(event, 'PLAC');
          if (placeName !== null) {
            placeId = await entity(client, treeId, 'PLACE');
            await insert(client, 'places', { id: placeId, name: placeName, jurisdiction_format: text(child(event, 'PLAC'), 'FORM') });
          }
          const date = child(event, 'DATE');
          const info = plan.factInfo(node.tag, event);
          const baseline = { gedcom_tag: info.tag, fact_kind: info.kind, type_text: text(event, 'TYPE'), value_text: event.value || null, date_original: date?.value || text(date, 'PHRASE'), place_name: placeName };
          const { place_name, ...fields } = baseline;
          await insert(client, 'facts', { id, [node.tag === 'INDI' ? 'person_id' : 'family_id']: ownerId, position: position++, ...fields, place_id: placeId });
          await bind(id, event, baseline); evidenceQueue.push([event, id, 'fact_id']);
        }
      }
    }
    for (let cursor = 0; cursor < evidenceQueue.length; cursor++) {
      const [node, ownerId, ownerColumn] = evidenceQueue[cursor];
      let notePosition = 0;
      if (ownerColumn) for (const note of children(node, 'NOTE')) {
        const id = await entity(client, treeId, 'NOTE');
        const baseline = { text_value: note.value, mime_type: text(note, 'MIME') || 'text/plain', language_tag: text(note, 'LANG') };
        await insert(client, 'notes', { id, [ownerColumn]: ownerId, position: notePosition++, ...baseline });
        await bind(id, note, baseline); evidenceQueue.push([note, id, null]);
      }
      for (const citation of children(node, 'SOUR').filter(n => n.pointer && n.pointer !== '@VOID@')) {
        const id = await entity(client, treeId, 'CITATION');
        const quality = text(citation, 'QUAY');
        const baseline = { source_id: byXref.get(citation.pointer), target_entity_id: ownerId, page_text: text(citation, 'PAGE'), data_text: children(child(citation, 'DATA'), 'TEXT').map(n => n.value).join('\n') || null, quality: /^[0-3]$/.test(quality || '') ? Number(quality) : null, event_type: text(citation, 'EVEN'), role: text(child(citation, 'EVEN'), 'ROLE') };
        await insert(client, 'citations', { id, ...baseline });
        await bind(id, citation, baseline); evidenceQueue.push([citation, id, null]);
      }
      for (const link of children(node, 'OBJE').filter(n => n.pointer && n.pointer !== '@VOID@')) await client.query('INSERT INTO media_links (media_object_id, target_entity_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [byXref.get(link.pointer), ownerId]);
    }
    for (const family of plan.families) {
      const familyId = ids.get(family);
      let position = 0;
      for (const partner of family.children.filter(plan.isPartner)) {
        if (partner.pointer === '@VOID@') continue;
        await insert(client, 'family_partners', { family_id: familyId, person_id: byXref.get(partner.pointer), position: position++, role: ['HUSB', 'WIFE'].includes(partner.tag) ? partner.tag : 'PARTNER', parent_slot: partner.tag === 'WIFE' ? 'mother' : partner.tag === 'HUSB' ? 'father' : null });
      }
      position = 0;
      for (const link of children(family, 'CHIL')) {
        const childPosition = position++;
        if (link.pointer === '@VOID@') continue;
        const person = plan.parsed.xrefs.get(link.pointer);
        const parentFamilies = children(person, 'FAMC').map(n => plan.parsed.xrefs.get(n.pointer)).filter(Boolean);
        const preferred = parentFamilies[0] || plan.memberships.get(person)?.[0];
        const familyLink = children(person, 'FAMC').find(n => n.pointer === family.xref);
        const pedigree = text(familyLink, 'PEDI');
        await insert(client, 'family_children', { family_id: familyId, person_id: ids.get(person), position: childPosition, pedigree: ['BIRTH', 'ADOPTED', 'FOSTER', 'SEALING'].includes(pedigree) ? pedigree : 'UNKNOWN', relationship_status: text(familyLink, 'STAT'), is_preferred: preferred === family });
      }
    }
    await insert(client, 'gedcom_documents', { import_job_id: importId, source_text: source, header: plan.parsed.records[0] });
    if (!options.treeId) await client.query('UPDATE trees SET root_person_id = $1 WHERE id = $2', [ids.get(root), treeId]);
    await assertNoCycles(client, treeId);
    await client.query("UPDATE import_jobs SET status = 'COMPLETED', completed_at = current_timestamp WHERE id = $1", [importId]);
    const response = { treeId, importJobId: importId, report: plan.report };
    if (owned) {
      await client.query('INSERT INTO gedcom_import_receipts (request_id, request_hash, tree_id, response) VALUES ($1, $2, $3, $4::jsonb)', [requestId, hash, treeId, JSON.stringify(response)]);
      await client.query('COMMIT');
    }
    return response;
  } catch (error) { if (owned) await client.query('ROLLBACK'); throw error; }
  finally { if (owned) client.release(); }
}

module.exports = { importGedcom, previewExistingGedcom };
