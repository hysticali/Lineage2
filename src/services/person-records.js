const { InputError, resolvePerson, entity } = require('./edit-tree');
const { randomUUID, createHash } = require('node:crypto');

async function personRecords(client, treeId, reference) {
  const personId = await resolvePerson(client, treeId, reference);
  const tree = (await client.query('SELECT revision FROM trees WHERE id = $1', [treeId])).rows[0];
  const families = (await client.query(`SELECT f.id, f.label,
    COALESCE((SELECT string_agg(n.full_text, ' + ' ORDER BY p.position) FROM family_partners p
      JOIN person_names n ON n.person_id = p.person_id AND n.is_primary WHERE p.family_id = f.id), 'Unknown parents') AS members
    FROM families f JOIN entities e ON e.id = f.id WHERE e.tree_id = $1 AND
    (EXISTS (SELECT 1 FROM family_partners p WHERE p.family_id = f.id AND p.person_id = $2)
     OR EXISTS (SELECT 1 FROM family_children c WHERE c.family_id = f.id AND c.person_id = $2)) ORDER BY f.id`, [treeId, personId])).rows;
  const familyIds = families.map(f => f.id);
  const names = (await client.query('SELECT * FROM person_names WHERE person_id = $1 ORDER BY position, id', [personId])).rows;
  const events = (await client.query(`SELECT f.*, p.name AS place_name FROM facts f LEFT JOIN places p ON p.id = f.place_id
    WHERE f.person_id = $1 OR f.family_id = ANY($2::uuid[]) ORDER BY f.position, f.id`, [personId, familyIds])).rows;
  const notes = (await client.query(`SELECT * FROM notes WHERE person_id = $1 OR family_id = ANY($2::uuid[])
    OR fact_id = ANY($3::uuid[]) ORDER BY position, id`, [personId, familyIds, events.map(f => f.id)])).rows;
  const targets = [personId, ...familyIds, ...names.map(n => n.id), ...events.map(f => f.id), ...notes.map(n => n.id)];
  const citations = (await client.query(`SELECT c.*, s.title AS source_title FROM citations c JOIN sources s ON s.id = c.source_id
    WHERE c.target_entity_id = ANY($1::uuid[]) ORDER BY c.id`, [targets])).rows;
  const sources = (await client.query(`SELECT s.* FROM sources s JOIN entities e ON e.id = s.id WHERE e.tree_id = $1 ORDER BY s.title, s.id`, [treeId])).rows;
  const media = (await client.query(`SELECT m.*, l.target_entity_id, f.id AS file_id,
    f.file_reference, f.mime_type, f.checksum_sha256, octet_length(b.content) AS byte_length
    FROM media_objects m JOIN media_links l ON l.media_object_id = m.id
    LEFT JOIN media_files f ON f.media_object_id = m.id
    LEFT JOIN media_blobs b ON b.media_file_id = f.id
    WHERE l.target_entity_id = ANY($1::uuid[]) ORDER BY m.id, f.position`, [[...targets, ...citations.map(c => c.id)]])).rows;
  return { personId, revision: tree.revision, names, events, notes, sources, citations, families, media };
}

async function readPersonRecords(pool, treeId, reference) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await personRecords(client, treeId, reference);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

const definitions = {
  name: { table: 'person_names', list: 'names', type: 'NAME', fields: ['full_text', 'name_type', 'given_names', 'surname', 'language_tag', 'is_primary'] },
  event: { table: 'facts', list: 'events', type: 'FACT', fields: ['owner_id', 'gedcom_tag', 'fact_kind', 'type_text', 'value_text', 'date_original', 'place_name'] },
  note: { table: 'notes', list: 'notes', type: 'NOTE', fields: ['owner_id', 'text_value'] },
  source: { table: 'sources', list: 'sources', type: 'SOURCE', fields: ['title', 'author', 'publication_text', 'abbreviation'] },
  citation: { table: 'citations', list: 'citations', type: 'CITATION', fields: ['source_id', 'target_entity_id', 'page_text', 'data_text', 'quality'] },
  media: { table: 'media_objects', list: 'media', type: 'MEDIA_OBJECT', fields: ['title', 'description', 'provenance', 'target_entity_id', 'filename', 'mime_type', 'data_base64'] },
};

function validateFields(kind, fields) {
  const definition = Object.hasOwn(definitions, kind) ? definitions[kind] : null;
  if (!definition || !fields || typeof fields !== 'object' || Array.isArray(fields)) throw new InputError('A supported record kind and fields are required');
  for (const [key, value] of Object.entries(fields)) {
    if (!definition.fields.includes(key)) throw new InputError(`Unsupported ${kind} field: ${key}`);
    if (key === 'is_primary') {
      if (typeof value !== 'boolean') throw new InputError('Primary name must be true or false');
    } else if (key === 'quality') {
      if (value !== null && (!Number.isInteger(value) || value < 0 || value > 3)) throw new InputError('Citation quality must be 0–3 or unknown');
    } else if (value !== null && (typeof value !== 'string' || value.length > (key === 'data_base64' ? 13981016 : 100000) || value.includes('\0'))) throw new InputError(`Invalid ${key}`);
  }
  return definition;
}

// SQL identifiers below come only from fixed definitions, never request input.
async function updateRow(client, table, id, values) {
  const entries = Object.entries(values);
  if (!entries.length) throw new InputError('No record changes supplied');
  await client.query(`UPDATE ${table} SET ${entries.map(([key], i) => `${key} = $${i + 1}`).join(', ')} WHERE id = $${entries.length + 1}`, [...entries.map(([, value]) => value), id]);
}

async function insertRow(client, table, values) {
  const entries = Object.entries(values);
  await client.query(`INSERT INTO ${table} (${entries.map(([key]) => key).join(', ')}) VALUES (${entries.map((_, i) => `$${i + 1}`).join(', ')})`, entries.map(([, value]) => value));
}

function required(value, label, max = 100000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new InputError(`${label} is required (maximum ${max} characters)`);
}

async function editRecord(client, treeId, request) {
  const { kind, fields, recordId } = request;
  const definition = validateFields(kind, fields);
  const records = await personRecords(client, treeId, request.personId);
  const current = recordId ? records[definition.list].find(r => r.id === recordId && (kind !== 'media' || !fields.target_entity_id || r.target_entity_id === fields.target_entity_id)) : null;
  if (recordId && !current) throw new InputError('Record was not found for this person and tree', 404);
  const values = { ...fields };
  const merged = { ...current, ...fields };
  const isNew = !current;
  let ownerId;
  if (kind === 'event' || kind === 'note') {
    ownerId = fields.owner_id || current?.person_id || current?.family_id || current?.fact_id || records.personId;
    const family = records.families.some(f => f.id === ownerId);
    const fact = kind === 'note' && records.events.some(f => f.id === ownerId);
    if (ownerId !== records.personId && !family && !fact) throw new InputError('The record owner must be this person, one of their families, or an event for a note');
    delete values.owner_id;
    values.person_id = ownerId === records.personId ? ownerId : null;
    values.family_id = family ? ownerId : null;
    if (kind === 'note') values.fact_id = fact ? ownerId : null;
  }
  if (kind === 'name') {
    required(merged.full_text, 'Name', 500);
    values.full_text = merged.full_text.trim();
    if (current?.is_primary && fields.is_primary === false) throw new InputError('Choose another primary name before clearing this one');
    const primary = fields.is_primary === true || !records.names.length;
    if (primary) {
      await client.query('UPDATE person_names SET is_primary = false WHERE person_id = $1', [records.personId]);
      values.is_primary = true;
    }
    if (isNew) Object.assign(values, { person_id: records.personId, position: Math.max(-1, ...records.names.map(n => n.position)) + 1 });
  } else if (kind === 'event') {
    if (!/^(?:[A-Z][A-Z0-9]{0,30}|_[A-Z0-9_]{1,30})$/.test(merged.gedcom_tag || '')) throw new InputError('Event tag must be uppercase, for example BIRT, OCCU, or EVEN');
    if (!['EVENT', 'ATTRIBUTE'].includes(merged.fact_kind)) throw new InputError('Choose event or attribute');
    if (fields.date_original !== undefined) Object.assign(values, {
      date_start_year: null, date_start_month: null, date_start_day: null,
      date_end_year: null, date_end_month: null, date_end_day: null,
      date_calendar: null, date_modifier: null,
    });
    if (fields.place_name !== undefined) {
      delete values.place_name;
      values.place_id = null;
      if (fields.place_name?.trim()) {
        // A place may be shared by imported facts. Editing one assertion must
        // not silently rename the place on all the other assertions.
        values.place_id = await entity(client, treeId, 'PLACE');
        await insertRow(client, 'places', { id: values.place_id, name: fields.place_name.trim() });
      }
    }
    if (isNew) values.position = Math.max(-1, ...records.events.filter(f => (f.person_id || f.family_id) === ownerId).map(f => f.position)) + 1;
  } else if (kind === 'note') {
    required(merged.text_value, 'Note');
    if (isNew) values.position = Math.max(-1, ...records.notes.filter(n => (n.person_id || n.family_id || n.fact_id) === ownerId).map(n => n.position)) + 1;
  } else if (kind === 'source') {
    required(merged.title, 'Source title');
  } else if (kind === 'citation' || kind === 'media') {
    if (kind === 'citation' && !records.sources.some(s => s.id === merged.source_id)) throw new InputError('Choose a source in this tree');
    const targets = [records.personId, ...records.families.map(f => f.id), ...records.names.map(n => n.id), ...records.events.map(f => f.id), ...records.notes.map(n => n.id)];
    if (!targets.includes(merged.target_entity_id)) throw new InputError('Evidence target is not a record for this person or their families');
    if (kind === 'media') {
      required(merged.title, 'Attachment caption', 500);
      if (isNew) {
        required(fields.filename, 'File name', 500);
        if (/[\r\n/\\]/.test(fields.filename)) throw new InputError('Use a file name without directory separators or line breaks');
        if (typeof fields.data_base64 !== 'string' || fields.data_base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(fields.data_base64)) throw new InputError('Attachment must contain valid base64 data');
        const bytes = Buffer.from(fields.data_base64, 'base64');
        if (bytes.toString('base64') !== fields.data_base64) throw new InputError('Attachment must contain canonical base64 data');
        if (!bytes.length || bytes.length > 10485760) throw new InputError('Attachment must contain 1 byte to 10 MB');
      } else if (fields.data_base64 !== undefined || fields.filename !== undefined || fields.mime_type !== undefined) {
        throw new InputError('Add a new attachment to keep an original file; edit captions and provenance here');
      }
      for (const key of ['target_entity_id', 'filename', 'mime_type', 'data_base64']) delete values[key];
    }
  }
  const id = recordId || await entity(client, treeId, definition.type);
  if (isNew) await insertRow(client, definition.table, { id, ...values });
  else await updateRow(client, definition.table, id, values);
  if (kind === 'media') {
    if (isNew) {
      await insertRow(client, 'media_links', { media_object_id: id, target_entity_id: fields.target_entity_id });
      const bytes = Buffer.from(fields.data_base64, 'base64');
      const fileId = randomUUID();
      const mime = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(fields.mime_type || '') ? fields.mime_type : 'application/octet-stream';
      await insertRow(client, 'media_files', { id: fileId, media_object_id: id, file_reference: fields.filename, mime_type: mime, checksum_sha256: createHash('sha256').update(bytes).digest('hex'), storage_key: `postgres:${fileId}` });
      await client.query('INSERT INTO media_blobs (media_file_id, content) VALUES ($1, $2)', [fileId, bytes]);
    }
  }
  await client.query('UPDATE entities SET updated_at = current_timestamp WHERE id = $1', [id]);
  return { personId: records.personId, recordId: id };
}

module.exports = { personRecords, readPersonRecords, editRecord };
