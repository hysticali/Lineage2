const { readBackup } = require('./tree-backup');
const { serializeGedcom, child, children } = require('../domain/gedcom');
const { eventKind } = require('../domain/gedcom-plan');
const { InputError } = require('./edit-tree');

const node = (tag, value = '', nested = [], pointer = null) => ({ tag, value: value ?? '', pointer, xref: null, children: nested });
const clone = value => structuredClone(value);
const equal = (a, b) => (a ?? null) === (b ?? null);
function replace(parent, tags, items) {
  const set = new Set(tags);
  parent.children = [...parent.children.filter(n => !set.has(n.tag)), ...items];
}
function scalar(parent, tag, value) { replace(parent, [tag], value == null || value === '' ? [] : [node(tag, String(value))]); }
function dateNode(value) {
  const atom = '(?:(?:[0-9]{1,2} )?(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) )?[0-9]+(?: BCE)?';
  const pattern = new RegExp(`^(?:(?:ABT |CAL |EST |BEF |AFT )?${atom}|BET ${atom} AND ${atom}|FROM ${atom}(?: TO ${atom})?|TO ${atom})$`);
  return pattern.test(value) ? node('DATE', value) : node('DATE', '', [node('PHRASE', value)]);
}

function buildGedcom(snapshot) {
  const data = snapshot.tables;
  const warnings = [];
  const bindings = new Map((data.gedcom_nodes || []).map(b => [b.entity_id, b]));
  const tagUris = new Map(), usedTags = new Set();
  for (const document of data.gedcom_documents || []) for (const definition of children(child(document.header, 'SCHMA'), 'TAG')) {
    const [tag, uri] = definition.value.split(' ');
    if (tagUris.has(tag) && tagUris.get(tag) !== uri) throw new InputError(`Conflicting extension meanings for ${tag}; export original sources separately or repair the schema.`, 409);
    tagUris.set(tag, uri);
  }
  const originals = [...bindings.values(), ...(data.gedcom_fragments || [])].map(b => b.node).concat((data.gedcom_documents || []).map(d => d.header));
  while (originals.length) { const current = originals.pop(); if (current.tag.startsWith('_')) usedTags.add(current.tag); originals.push(...current.children); }
  function ownTag(name) {
    const uri = `urn:rootline:gedcom:${name}`;
    const existing = [...tagUris].find(([, value]) => value === uri)?.[0];
    if (existing) return existing;
    let tag = `_ROOTLINE_${name.toUpperCase()}`, suffix = 1;
    while (usedTags.has(tag) || tagUris.has(tag)) tag = `_ROOTLINE_${name.toUpperCase()}_${suffix++}`;
    tagUris.set(tag, uri); usedTags.add(tag); return tag;
  }
  function ownScalar(result, name, value) {
    const tags = result.children.filter(n => tagUris.get(n.tag) === `urn:rootline:gedcom:${name}`).map(n => n.tag);
    replace(result, tags, value == null || value === '' ? [] : [node(ownTag(name), String(value))]);
  }
  const xrefs = new Map(data.import_xrefs.map(x => [`${x.import_job_id}:${x.xref}`, x.entity_id]));
  const byId = new Map(data.entities.map(e => [e.id, e]));
  const records = [], outputIds = new Map();
  const topTables = ['persons', 'families', 'sources', 'repositories', 'media_objects'];
  for (const table of topTables) for (const row of data[table]) outputIds.set(row.id, `@R${row.id.replaceAll('-', '').toUpperCase()}@`);
  for (const binding of bindings.values()) if (binding.is_record) outputIds.set(binding.entity_id, `@R${binding.entity_id.replaceAll('-', '').toUpperCase()}@`);
  function originalNode(binding, fallbackTag) {
    if (!binding) return node(fallbackTag);
    const result = clone(binding.node), pending = [result];
    while (pending.length) {
      const current = pending.pop(); current.xref = null;
      if (current.pointer && current.pointer !== '@VOID@') {
        const mapped = outputIds.get(xrefs.get(`${binding.import_job_id}:${current.pointer}`));
        if (!mapped) throw new InputError('An unsupported structure references a missing record; restore or repair the reference before export.', 409);
        current.pointer = mapped;
      }
      pending.push(...current.children);
    }
    return result;
  }
  function original(id, fallbackTag) { return originalNode(bindings.get(id), fallbackTag); }
  function changed(id, field, value) { return !bindings.has(id) || !equal(bindings.get(id).baseline[field], value); }
  const notesByOwner = new Map(), citationsByTarget = new Map(), mediaByTarget = new Map();
  const add = (map, id, value) => { if (!map.has(id)) map.set(id, []); map.get(id).push(value); };
  for (const note of [...data.notes].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))) if (note.person_id || note.family_id || note.fact_id) add(notesByOwner, note.person_id || note.family_id || note.fact_id, note);
  for (const citation of data.citations) add(citationsByTarget, citation.target_entity_id, citation);
  for (const link of data.media_links) add(mediaByTarget, link.target_entity_id, link);
  function citation(row) {
    const result = original(row.id, 'SOUR'); result.pointer = outputIds.get(row.source_id); result.value = '';
    for (const [field, tag] of [['page_text', 'PAGE'], ['quality', 'QUAY']]) if (changed(row.id, field, row[field])) scalar(result, tag, row[field]);
    if (changed(row.id, 'data_text', row.data_text)) {
      const details = child(result, 'DATA') || node('DATA');
      scalar(details, 'TEXT', row.data_text);
      replace(result, ['DATA'], details.value || details.children.length ? [details] : []);
    }
    if (changed(row.id, 'event_type', row.event_type) || changed(row.id, 'role', row.role)) {
      const event = node('EVEN', row.event_type, row.role ? [node('ROLE', row.role)] : []);
      replace(result, ['EVEN'], event.value || event.children.length ? [event] : []);
    }
    // Citation notes unsupported by the current editor remain in its original
    // structure; media links and nested source assertions are still exported.
    evidence(result, row.id, false);
    return result;
  }
  const rendering = new Set();
  function evidence(result, id, replaceNotes = true) {
    if (rendering.has(id)) throw new Error('Cyclic source/media evidence cannot be exported.');
    rendering.add(id);
    if (replaceNotes) replace(result, ['NOTE'], (notesByOwner.get(id) || []).map(row => {
      const note = original(row.id, 'NOTE');
      if (changed(row.id, 'text_value', row.text_value)) note.value = row.text_value;
      if (changed(row.id, 'mime_type', row.mime_type)) scalar(note, 'MIME', row.mime_type === 'text/plain' ? null : row.mime_type);
      if (changed(row.id, 'language_tag', row.language_tag)) scalar(note, 'LANG', row.language_tag);
      evidence(note, row.id, false); return note;
    }));
    replace(result, ['SOUR'], (citationsByTarget.get(id) || []).map(citation));
    const existing = children(result, 'OBJE');
    replace(result, ['OBJE'], (mediaByTarget.get(id) || []).map(link => {
      const pointer = outputIds.get(link.media_object_id);
      return clone(existing.find(n => n.pointer === pointer) || node('OBJE', '', [], pointer));
    }));
    rendering.delete(id);
  }
  const places = new Map(data.places.map(p => [p.id, p]));
  const factsByOwner = new Map();
  for (const fact of [...data.facts].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))) add(factsByOwner, fact.person_id || fact.family_id, fact);
  function fact(row, ownerTag) {
    const result = original(row.id, row.gedcom_tag);
    if (changed(row.id, 'gedcom_tag', row.gedcom_tag)) result.tag = row.gedcom_tag;
    if (!eventKind(ownerTag, result.tag) || eventKind(ownerTag, result.tag) !== row.fact_kind) {
      warnings.push(`Event ${row.gedcom_tag} is outside the supported ${ownerTag} tags; it is exported as a Rootline extension.`);
      result.tag = ownTag('fact');
      ownScalar(result, 'tag', row.gedcom_tag); ownScalar(result, 'kind', row.fact_kind);
    }
    if (changed(row.id, 'value_text', row.value_text)) result.value = row.value_text || '';
    if (changed(row.id, 'type_text', row.type_text)) scalar(result, 'TYPE', row.type_text);
    if (['EVEN', 'FACT'].includes(result.tag) && !child(result, 'TYPE')) scalar(result, 'TYPE', row.type_text || row.gedcom_tag);
    if (changed(row.id, 'date_original', row.date_original)) replace(result, ['DATE'], row.date_original ? [dateNode(row.date_original)] : []);
    const place = places.get(row.place_id);
    if (changed(row.id, 'place_name', place?.name || null)) replace(result, ['PLAC'], place ? [node('PLAC', place.name, place.jurisdiction_format ? [node('FORM', place.jurisdiction_format)] : [])] : []);
    evidence(result, row.id);
    if (!result.value && !result.children.length && eventKind(ownerTag, result.tag) === 'EVENT' && result.tag !== 'EVEN') result.value = 'Y';
    return result;
  }
  function addFacts(result, id, ownerTag) {
    replace(result, result.children.filter(n => eventKind(ownerTag, n.tag) || tagUris.get(n.tag) === 'urn:rootline:gedcom:fact').map(n => n.tag), []);
    result.children.push(...(factsByOwner.get(id) || []).map(f => fact(f, ownerTag)));
  }
  function restrictions(result, id) {
    const unknown = children(result, 'RESN').flatMap(n => n.value.split(',')).map(v => v.trim()).filter(v => v && !['CONFIDENTIAL', 'LOCKED', 'PRIVACY'].includes(v));
    const values = [...new Set([...data.restrictions.filter(r => r.entity_id === id).map(r => r.restriction), ...unknown])];
    scalar(result, 'RESN', values.join(', '));
  }
  function identity(result, id) {
    if (!children(result, 'UID').length) {
      const uid = data.identifiers.find(i => i.entity_id === id && i.identifier_type === 'UID');
      if (uid) result.children.push(node('UID', uid.value));
    }
  }
  const parentLinks = new Map(), spouseLinks = new Map();
  for (const link of data.family_children) add(parentLinks, link.person_id, link);
  for (const link of data.family_partners) add(spouseLinks, link.person_id, link);
  for (const person of data.persons) {
    const result = original(person.id, 'INDI');
    for (const fragment of (data.gedcom_fragments || []).filter(f => f.owner_entity_id === person.id)) {
      const extra = originalNode(fragment, 'INDI');
      result.children.push(...extra.children.filter(n => !['NAME', 'SEX', 'FAMC', 'FAMS', 'NOTE', 'SOUR', 'OBJE'].includes(n.tag) && !eventKind('INDI', n.tag) && tagUris.get(n.tag) !== 'urn:rootline:gedcom:fact'));
    }
    if (changed(person.id, 'sex', person.sex)) scalar(result, 'SEX', person.sex);
    const names = data.person_names.filter(n => n.person_id === person.id).sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.position - b.position || a.id.localeCompare(b.id));
    replace(result, ['NAME'], names.map(row => {
      const name = original(row.id, 'NAME');
      if (changed(row.id, 'full_text', row.full_text)) {
        const surnameAt = row.surname && row.full_text.lastIndexOf(row.surname);
        name.value = row.surname && surnameAt >= 0 ? row.full_text.slice(0, surnameAt) + '/' + row.surname + '/' + row.full_text.slice(surnameAt + row.surname.length) : row.full_text;
      }
      for (const [field, tag] of [['name_type', 'TYPE'], ['given_names', 'GIVN'], ['surname', 'SURN'], ['prefix', 'NPFX'], ['suffix', 'NSFX'], ['nickname', 'NICK'], ['surname_prefix', 'SPFX']]) if (changed(row.id, field, row[field])) scalar(name, tag, row[field]);
      if (row.language_tag) warnings.push('Native name language is retained in full-tree backups; GEDCOM name translations require an explicit translated name.');
      evidence(name, row.id, false); return name;
    }));
    const originalFAMC = children(result, 'FAMC');
    replace(result, ['FAMC'], (parentLinks.get(person.id) || []).sort((a, b) => Number(b.is_preferred) - Number(a.is_preferred) || a.position - b.position || a.family_id.localeCompare(b.family_id)).map(link => {
      const pointer = outputIds.get(link.family_id);
      const originalLink = originalFAMC.find(n => n.pointer === pointer);
      const family = clone(originalLink || node('FAMC', '', [], pointer));
      const priorPedigree = child(family, 'PEDI')?.value;
      const mappedPrior = ['BIRTH', 'ADOPTED', 'FOSTER', 'SEALING'].includes(priorPedigree) ? priorPedigree : 'UNKNOWN';
      if (!originalLink || mappedPrior !== link.pedigree) scalar(family, 'PEDI', link.pedigree === 'UNKNOWN' ? null : link.pedigree);
      if (!equal(child(family, 'STAT')?.value, link.relationship_status)) scalar(family, 'STAT', link.relationship_status);
      return family;
    }));
    const originalFAMS = children(result, 'FAMS');
    replace(result, ['FAMS'], (spouseLinks.get(person.id) || []).map(link => clone(originalFAMS.find(n => n.pointer === outputIds.get(link.family_id)) || node('FAMS', '', [], outputIds.get(link.family_id)))));
    addFacts(result, person.id, 'INDI'); evidence(result, person.id); restrictions(result, person.id); identity(result, person.id);
    result.xref = outputIds.get(person.id); records.push(result);
  }
  const peopleById = new Map(data.persons.map(p => [p.id, p]));
  for (const family of data.families) {
    const result = original(family.id, 'FAM');
    const managedTags = ['HUSB', 'WIFE', ...(bindings.get(family.id)?.baseline.partnerTags || (bindings.get(family.id)?.baseline.partnerExtension ? ['_ROOTLINE_PARTNER'] : []))];
    const previousPartners = result.children.filter(n => managedTags.includes(n.tag));
    const partners = data.family_partners.filter(p => p.family_id === family.id).sort((a, b) => Number(Boolean(b.parent_slot)) - Number(Boolean(a.parent_slot)) || a.position - b.position);
    const assigned = new Map(), used = new Set();
    for (const partner of partners) {
      const wanted = partner.parent_slot === 'mother' ? 'WIFE' : partner.parent_slot === 'father' ? 'HUSB' : partner.role !== 'PARTNER' ? partner.role : peopleById.get(partner.person_id)?.sex === 'F' ? 'WIFE' : peopleById.get(partner.person_id)?.sex === 'M' ? 'HUSB' : null;
      if (wanted && !used.has(wanted)) { assigned.set(partner.person_id, wanted); used.add(wanted); }
    }
    for (const partner of partners) if (!assigned.has(partner.person_id)) {
      const role = !used.has('HUSB') ? 'HUSB' : !used.has('WIFE') ? 'WIFE' : ownTag('partner'); assigned.set(partner.person_id, role); used.add(role);
    }
    replace(result, managedTags, partners.map(partner => {
      const pointer = outputIds.get(partner.person_id), tag = assigned.get(partner.person_id);
      const old = clone(previousPartners.find(n => n.pointer === pointer) || node(tag, '', [], pointer)); old.tag = tag; return old;
    }));
    if (partners.length > 2) warnings.push('Families with more than two partners use the documented Rootline _ROOTLINE_PARTNER extension.');
    const oldChildren = children(result, 'CHIL');
    const childRows = data.family_children.filter(c => c.family_id === family.id).sort((a, b) => a.position - b.position || a.person_id.localeCompare(b.person_id));
    const childNodes = childRows.map(row => ({ position: row.position, node: clone(oldChildren.find(n => n.pointer === outputIds.get(row.person_id)) || node('CHIL', '', [], outputIds.get(row.person_id))) }));
    oldChildren.forEach((old, position) => { if (old.pointer === '@VOID@') childNodes.push({ position, node: old }); });
    replace(result, ['CHIL'], childNodes.sort((a, b) => a.position - b.position).map(n => n.node));
    addFacts(result, family.id, 'FAM'); evidence(result, family.id); restrictions(result, family.id); identity(result, family.id);
    result.xref = outputIds.get(family.id); records.push(result);
  }
  for (const source of data.sources) {
    const result = original(source.id, 'SOUR');
    for (const [field, tag] of [['title', 'TITL'], ['author', 'AUTH'], ['publication_text', 'PUBL'], ['abbreviation', 'ABBR']]) if (changed(source.id, field, source[field])) scalar(result, tag, source[field]);
    if (changed(source.id, 'repository_id', source.repository_id)) replace(result, ['REPO'], source.repository_id ? [node('REPO', '', [], outputIds.get(source.repository_id)), ...children(result, 'REPO').slice(1)] : children(result, 'REPO').slice(1));
    evidence(result, source.id, false); restrictions(result, source.id); identity(result, source.id);
    result.xref = outputIds.get(source.id); records.push(result);
  }
  for (const repository of data.repositories) {
    const result = original(repository.id, 'REPO');
    for (const [field, tag] of [['name', 'NAME'], ['address_text', 'ADDR'], ['website_uri', 'WWW']]) if (changed(repository.id, field, repository[field])) scalar(result, tag, repository[field]);
    evidence(result, repository.id, false); identity(result, repository.id);
    result.xref = outputIds.get(repository.id); records.push(result);
  }
  for (const media of data.media_objects) {
    const result = original(media.id, 'OBJE'), originals = children(result, 'FILE');
    replace(result, ['FILE'], data.media_files.filter(f => f.media_object_id === media.id).sort((a, b) => a.position - b.position).map((file, index) => {
      const item = clone(originals[index] || node('FILE')); item.value = file.file_reference;
      if (!originals[index] || child(item, 'FORM')?.value !== file.mime_type) scalar(item, 'FORM', file.mime_type || 'application/octet-stream');
      if (index === 0 && changed(media.id, 'title', media.title)) scalar(item, 'TITL', media.title);
      return item;
    }));
    for (const field of ['description', 'provenance']) if (changed(media.id, field, media[field])) ownScalar(result, field, media[field]);
    evidence(result, media.id, false); restrictions(result, media.id); identity(result, media.id);
    result.xref = outputIds.get(media.id); records.push(result);
  }
  for (const binding of bindings.values()) if (binding.is_record && byId.get(binding.entity_id)?.entity_type === 'EXTENSION') {
    const result = original(binding.entity_id, binding.node.tag); result.xref = outputIds.get(binding.entity_id); records.push(result);
    warnings.push('Unsupported original records are preserved as raw structures; their semantics are not edited by Rootline.');
  }
  let header = node('HEAD');
  const jobs = new Map(data.import_jobs?.map(job => [job.id, job]) || []);
  const documents = [...(data.gedcom_documents || [])].sort((a, b) => Date.parse(jobs.get(a.import_job_id)?.created_at || 0) - Date.parse(jobs.get(b.import_job_id)?.created_at || 0) || a.import_job_id.localeCompare(b.import_job_id));
  const firstDocument = documents[0];
  if (documents.length > 1) warnings.push('Multiple original headers are retained with their source files. This export uses the earliest imported header and combines compatible extension schemas.');
  if (firstDocument) {
    header = clone(firstDocument.header);
    const pending = [header];
    while (pending.length) {
      const current = pending.pop();
      if (current.pointer && current.pointer !== '@VOID@') current.pointer = outputIds.get(xrefs.get(`${firstDocument.import_job_id}:${current.pointer}`));
      pending.push(...current.children);
    }
  }
  replace(header, ['GEDC'], [node('GEDC', '', [node('VERS', '7.0')])]);
  replace(header, ['SOUR'], [node('SOUR', 'ROOTLINE', [node('VERS', '1.0'), node('NAME', 'Rootline')])]);
  const rootTag = ownTag('root');
  replace(header, header.children.filter(n => tagUris.get(n.tag) === 'urn:rootline:gedcom:root').map(n => n.tag), [node(rootTag, '', [], outputIds.get(snapshot.tree.root_person_id))]);
  if (snapshot.tree.default_language && !child(header, 'LANG')) header.children.push(node('LANG', snapshot.tree.default_language));
  const allNodes = [header, ...records], pending = [...allNodes], extensionTags = new Set();
  while (pending.length) { const current = pending.pop(); if (current.tag.startsWith('_')) extensionTags.add(current.tag); pending.push(...current.children); }
  const schema = node('SCHMA', '', [...tagUris].map(([tag, uri]) => node('TAG', `${tag} ${uri}`)));
  for (const tag of extensionTags) if (!tagUris.has(tag)) warnings.push(`Undocumented original extension ${tag} is retained without inventing a URI definition.`);
  if (schema.children.length) replace(header, ['SCHMA'], [schema]);
  if (data.media_blobs.length) warnings.push(`${data.media_blobs.length} stored binary attachments are referenced by filename; a .ged file does not embed their bytes. Download them or use a full-tree backup.`);
  if (data.persons.some(p => (p.living_status && p.living_status !== 'UNKNOWN') || p.is_public)) warnings.push('Rootline living-status and publication approvals are retained in native full-tree backups. GEDCOM re-import defaults people to unknown and unpublished; imported restrictions are retained.');
  const source = serializeGedcom([...allNodes, node('TRLR')]);
  return { source, warnings: [...new Set(warnings)], people: data.persons.length, families: data.families.length, sources: data.sources.length };
}

async function exportGedcom(pool, treeId) { return buildGedcom(await readBackup(pool, treeId)); }
module.exports = { buildGedcom, exportGedcom, dateNode };
