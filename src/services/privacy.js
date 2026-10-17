const { TreeRepository } = require('../repositories/tree-repository');
const { InputError, resolvePerson } = require('./edit-tree');
const { serializeGedcom } = require('../domain/gedcom');
const { dateNode } = require('./export-gedcom');

async function publicArchive(pool, treeId, label = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const archive = await new TreeRepository(client, { inTransaction: true }).getWheelFamilyData(treeId);
    if (!archive) throw new InputError('Tree not found', 404);
    const allowed = (await client.query(`SELECT p.id, n.id AS name_id FROM persons p JOIN entities e ON e.id = p.id
      JOIN person_names n ON n.person_id = p.id AND n.is_primary
      WHERE e.tree_id = $1 AND p.living_status = 'DECEASED' AND p.is_public
        AND NOT EXISTS (SELECT 1 FROM restrictions r WHERE r.entity_id IN (p.id, n.id))`, [treeId])).rows;
    const eligible = new Set(allowed.map(p => p.id));
    const restricted = new Set((await client.query('SELECT r.entity_id FROM restrictions r JOIN entities e ON e.id = r.entity_id WHERE e.tree_id = $1', [treeId])).rows.map(r => r.entity_id));
    const facts = (await client.query(`SELECT f.person_id, f.id, f.gedcom_tag, f.date_original, f.place_id, p.name AS place_name
      FROM facts f JOIN entities e ON e.id = f.id LEFT JOIN places p ON p.id = f.place_id
      WHERE e.tree_id = $1 AND f.person_id IS NOT NULL AND f.gedcom_tag IN ('BIRT', 'DEAT') ORDER BY f.position, f.id`, [treeId])).rows;
    const family = Object.fromEntries(Object.values(archive.family).filter(p => eligible.has(p.uuid)).map(p => [p.id, { id: p.id, uuid: p.uuid, name: p.name, ...(p.gender && { gender: p.gender }) }]));
    const seen = new Set();
    const byUuid = new Map(Object.values(family).map(p => [p.uuid, p]));
    for (const fact of facts) {
      const person = byUuid.get(fact.person_id), key = `${fact.person_id}:${fact.gedcom_tag}`;
      if (!person || seen.has(key)) continue;
      seen.add(key);
      if (restricted.has(fact.id)) continue;
      if (fact.date_original) person[fact.gedcom_tag === 'BIRT' ? 'birth' : 'death'] = fact.date_original;
      if (fact.gedcom_tag === 'BIRT' && fact.place_name && !restricted.has(fact.place_id)) person.birthplace = fact.place_name;
    }
    const families = archive.families.filter(f => !restricted.has(f.id)).map(f => ({ id: f.id,
      partners: f.partners.filter(p => Object.hasOwn(family, p.personId)),
      children: f.children.filter(c => Object.hasOwn(family, c.personId)),
    })).filter(f => f.partners.length || f.children.length);
    for (const f of families) {
      for (const partner of f.partners) {
        const person = family[partner.personId];
        const spouses = f.partners.filter(p => p.personId !== person.id).map(p => p.personId);
        if (spouses.length) person.spouseIds = [...new Set([...(person.spouseIds || []), ...spouses])];
      }
      for (const link of f.children) {
        const person = family[link.personId];
        const siblings = f.children.filter(c => c.personId !== person.id).map(c => c.personId);
        if (siblings.length) person.siblingIds = [...new Set([...(person.siblingIds || []), ...siblings])];
        if (!link.preferred) continue;
        const original = archive.family[person.id];
        const parentIds = new Set(f.partners.map(p => p.personId));
        for (const field of ['motherId', 'fatherId']) if (parentIds.has(original[field])) person[field] = original[field];
      }
    }
    const visiblePeople = Object.keys(family).length;
    let rootId = Object.hasOwn(family, archive.rootId) ? archive.rootId : Object.keys(family).sort()[0];
    if (!rootId) { rootId = 'private-archive'; family[rootId] = { id: rootId, name: 'Private archive', placeholder: true }; }
    const result = { treeId, treeName: label || 'Shared family archive', revision: archive.revision, rootId, family, families,
      aliases: Object.fromEntries(Object.entries(archive.aliases || {}).filter(([, id]) => Object.hasOwn(family, id))),
      visiblePeople, redacted: true,
      privacyNotice: 'Read-only view: only explicitly shared deceased people and approved basic details are shown. Living, unknown, restricted, and unreviewed people are withheld. Notes, sources, citations, media, and recovery data are private.',
    };
    await client.query('COMMIT'); return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

function publicGedcom(archive) {
  const make = (tag, value = '', nested = [], pointer = null) => ({ tag, value, children: nested, pointer, xref: null });
  const people = Object.values(archive.family).filter(p => !p.placeholder);
  const refs = new Map(people.map((p, i) => [p.id, `@I${i + 1}@`]));
  const families = archive.families.filter(f => f.partners.length || f.children.length);
  const familyRefs = new Map(families.map((f, i) => [f.id, `@F${i + 1}@`]));
  const records = [make('HEAD', '', [make('GEDC', '', [make('VERS', '7.0')]), make('SOUR', 'ROOTLINE'), make('SCHMA', '', [make('TAG', '_ROOTLINE_PARTNER urn:rootline:gedcom:partner')])])];
  for (const person of people) {
    const n = make('INDI', '', [make('NAME', person.name)]); n.xref = refs.get(person.id);
    if (person.gender) n.children.push(make('SEX', person.gender));
    for (const [field, tag] of [['birth', 'BIRT'], ['death', 'DEAT']]) {
      const details = [];
      if (person[field]) details.push(dateNode(person[field]));
      if (field === 'birth' && person.birthplace) details.push(make('PLAC', person.birthplace));
      if (details.length) n.children.push(make(tag, '', details));
    }
    const orderedFamilies = [...families].sort((a, b) => Number(Boolean(b.children.find(c => c.personId === person.id)?.preferred)) - Number(Boolean(a.children.find(c => c.personId === person.id)?.preferred)));
    for (const f of orderedFamilies) {
      if (f.partners.some(p => p.personId === person.id)) n.children.push(make('FAMS', '', [], familyRefs.get(f.id)));
      const child = f.children.find(c => c.personId === person.id);
      if (child) n.children.push(make('FAMC', '', child.pedigree && child.pedigree !== 'UNKNOWN' ? [make('PEDI', child.pedigree)] : [], familyRefs.get(f.id)));
    }
    records.push(n);
  }
  for (const f of families) {
    const n = make('FAM'), used = new Set(); n.xref = familyRefs.get(f.id);
    for (const partner of f.partners) {
      const desired = partner.slot === 'mother' ? 'WIFE' : partner.slot === 'father' ? 'HUSB' : ['HUSB', 'WIFE'].includes(partner.role) ? partner.role : null;
      const tag = desired && !used.has(desired) ? desired : !used.has('HUSB') ? 'HUSB' : !used.has('WIFE') ? 'WIFE' : '_ROOTLINE_PARTNER';
      used.add(tag); n.children.push(make(tag, '', [], refs.get(partner.personId)));
    }
    n.children.push(...f.children.map(c => make('CHIL', '', [], refs.get(c.personId)))); records.push(n);
  }
  records.push(make('TRLR'));
  return { source: serializeGedcom(records), people: people.length, families: families.length, sources: 0,
    warnings: ['Privacy-filtered export: living, unknown, unreviewed, and restricted people are omitted. Notes, sources, citations, media, original structures, and private recovery metadata are withheld.'], redacted: true };
}

async function setPrivacy(client, treeId, request) {
  const id = await resolvePerson(client, treeId, request.personId);
  if (!['UNKNOWN', 'LIVING', 'DECEASED'].includes(request.livingStatus) || typeof request.isPublic !== 'boolean' || typeof request.privateRecord !== 'boolean') throw new InputError('Choose living status, publication approval, and private-record status');
  if (request.isPublic && (request.livingStatus !== 'DECEASED' || request.privateRecord)) throw new InputError('Only deceased, unrestricted people can be approved for viewers');
  const confidential = await client.query("SELECT 1 FROM restrictions WHERE entity_id = $1 AND restriction IN ('CONFIDENTIAL', 'LOCKED')", [id]);
  if (request.isPublic && confidential.rowCount) throw new InputError('Imported confidential or locked restrictions must remain private');
  await client.query('UPDATE persons SET living_status = $1, is_public = $2 WHERE id = $3', [request.livingStatus, request.isPublic, id]);
  if (request.privateRecord) await client.query("INSERT INTO restrictions (entity_id, restriction) VALUES ($1, 'PRIVACY') ON CONFLICT DO NOTHING", [id]);
  else await client.query("DELETE FROM restrictions WHERE entity_id = $1 AND restriction = 'PRIVACY'", [id]);
  return id;
}
module.exports = { publicArchive, publicGedcom, setPrivacy };
