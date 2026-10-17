const { createHash } = require('node:crypto');

const UUID_NAMESPACE = 'lineage2-gedcom-database-v1';

function deterministicUuid(value) {
  const bytes = createHash('sha1')
    .update(`${UUID_NAMESPACE}:${value}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function splitName(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return { givenNames: parts[0], surname: null };
  }
  return {
    givenNames: parts.slice(0, -1).join(' '),
    surname: parts.at(-1),
  };
}

function normalizeYearDate(value) {
  if (!value || !/^-?\d{1,6}$/.test(value)) {
    return { dateOriginal: value || null };
  }
  const year = Number(value);
  return {
    dateOriginal: value,
    dateCalendar: 'GREGORIAN',
    dateStartYear: year,
    dateEndYear: year,
  };
}

function transformLegacyFamilyData(input, options = {}) {
  if (!input || typeof input !== 'object' || !input.family) {
    throw new Error('Input must contain a family object');
  }
  if (!input.rootId || !input.family[input.rootId]) {
    throw new Error('Input rootId must reference a family member');
  }

  const source = input.family;
  const legacyIds = new Set(Object.keys(source));
  const treeKey = options.treeKey || 'default';
  const treeId = deterministicUuid(`tree:${treeKey}`);
  // Every other ID is scoped to the tree so that separate trees may reuse
  // legacy IDs (e.g. `aria`) and place names without primary-key collisions.
  const scopedUuid = (value) => deterministicUuid(`tree:${treeKey}:${value}`);
  const personId = (legacyId) => scopedUuid(`person:${legacyId}`);
  const result = {
    tree: {
      id: treeId,
      name: options.treeName || 'Lineage2 Family Tree',
      rootPersonId: personId(input.rootId),
      sourceGedcomVersion: null,
      defaultLanguage: 'en',
    },
    entities: [],
    persons: [],
    names: [],
    families: [],
    familyPartners: [],
    familyChildren: [],
    places: [],
    facts: [],
    notes: [],
    identifiers: [],
    warnings: [],
  };
  const entityIds = new Set();
  const placeIds = new Map();

  function addEntity(id, entityType) {
    if (entityIds.has(id)) return;
    entityIds.add(id);
    result.entities.push({ id, treeId, entityType });
  }

  function addIdentifier(entityId, type, value, authorityUri = null) {
    result.identifiers.push({
      id: scopedUuid(`identifier:${entityId}:${type}:${value}`),
      entityId,
      identifierType: type,
      value,
      authorityUri,
    });
  }

  function getPlaceId(name) {
    const normalized = name.trim();
    if (placeIds.has(normalized)) return placeIds.get(normalized);
    const id = scopedUuid(`place:${normalized}`);
    placeIds.set(normalized, id);
    addEntity(id, 'PLACE');
    result.places.push({ id, name: normalized });
    return id;
  }

  for (const [legacyId, person] of Object.entries(source)) {
    if (!person?.name || typeof person.name !== 'string') {
      throw new Error(`Family member ${legacyId} must have a name`);
    }
    const id = personId(legacyId);
    addEntity(id, 'PERSON');
    result.persons.push({ id, sex: ['M', 'F', 'X', 'U'].includes(person.gender) ? person.gender : null });
    addIdentifier(id, 'UID', id);
    addIdentifier(id, 'REFN', legacyId);

    const nameId = scopedUuid(`name:${legacyId}:0`);
    const { givenNames, surname } = splitName(person.name);
    addEntity(nameId, 'NAME');
    result.names.push({
      id: nameId,
      personId: id,
      position: 0,
      fullText: person.name.trim(),
      givenNames,
      surname,
      languageTag: 'en',
      isPrimary: true,
    });

    const factDefinitions = [
      ['birth', 'BIRT', 'EVENT'],
      ['death', 'DEAT', 'EVENT'],
      ['occupation', 'OCCU', 'ATTRIBUTE'],
    ];
    let factPosition = 0;
    for (const [field, tag, factKind] of factDefinitions) {
      if (!person[field] && !(tag === 'BIRT' && person.birthplace)) continue;
      const factId = scopedUuid(`fact:${legacyId}:${tag}:${factPosition}`);
      addEntity(factId, 'FACT');
      const date = tag === 'BIRT' || tag === 'DEAT'
        ? normalizeYearDate(person[field] ? String(person[field]) : null)
        : {};
      result.facts.push({
        id: factId,
        personId: id,
        position: factPosition++,
        factKind,
        gedcomTag: tag,
        valueText: factKind === 'ATTRIBUTE' ? String(person[field]) : null,
        placeId:
          tag === 'BIRT' && person.birthplace
            ? getPlaceId(person.birthplace)
            : null,
        ...date,
      });
    }

    if (person.bio) {
      const noteId = scopedUuid(`note:${legacyId}:bio`);
      addEntity(noteId, 'NOTE');
      result.notes.push({
        id: noteId,
        personId: id,
        textValue: String(person.bio),
        mimeType: 'text/plain',
        languageTag: 'en',
      });
    }
  }

  const familyDefinitions = new Map();

  function ensureFamily(key, kind) {
    if (!familyDefinitions.has(key)) {
      familyDefinitions.set(key, {
        key,
        kind,
        partners: new Set(),
        children: new Set(),
      });
    }
    return familyDefinitions.get(key);
  }

  function coupleKey(ids) {
    return `couple:${[...ids].sort().join('|')}`;
  }

  for (const [legacyId, person] of Object.entries(source)) {
    const requestedParents = [person.motherId, person.fatherId].filter(Boolean);
    const validParents = requestedParents.filter((id) => {
      if (legacyIds.has(id)) return true;
      result.warnings.push(`Ignoring missing parent ${id} referenced by ${legacyId}`);
      return false;
    });
    if (validParents.length > 0) {
      const family = ensureFamily(coupleKey(validParents), 'PARENTS');
      validParents.forEach((id) => family.partners.add(id));
      family.children.add(legacyId);
    }

    const spouseIds = new Set([
      ...(person.spouseIds || []),
      ...(person.spouseId ? [person.spouseId] : []),
    ]);
    for (const spouseId of spouseIds) {
      if (spouseId === legacyId) {
        result.warnings.push(`Ignoring self-spouse relationship for ${legacyId}`);
        continue;
      }
      if (!legacyIds.has(spouseId)) {
        result.warnings.push(`Ignoring missing spouse ${spouseId} referenced by ${legacyId}`);
        continue;
      }
      const family = ensureFamily(coupleKey([legacyId, spouseId]), 'COUPLE');
      family.partners.add(legacyId);
      family.partners.add(spouseId);
    }
  }

  // A sibling link is not transitive (for example, two different sets of
  // half-siblings). Use a partnerless family per explicit pair unless an
  // existing family already represents that relationship.
  for (const [legacyId, person] of Object.entries(source)) {
    for (const siblingId of person.siblingIds || []) {
      if (!legacyIds.has(siblingId)) {
        result.warnings.push(`Ignoring missing sibling ${siblingId} referenced by ${legacyId}`);
      } else if (siblingId !== legacyId) {
        const pair = [legacyId, siblingId].sort();
        const alreadyGrouped = [...familyDefinitions.values()].some((family) =>
          pair.every((id) => family.children.has(id)),
        );
        if (!alreadyGrouped) {
          const family = ensureFamily(`siblings:${JSON.stringify(pair)}`, 'SIBLINGS');
          pair.forEach((id) => family.children.add(id));
        }
      }
    }
  }

  const childFamilyCounts = new Map();
  for (const definition of familyDefinitions.values()) {
    const id = scopedUuid(`family:${definition.key}`);
    addEntity(id, 'FAMILY');
    const partnerNames = [...definition.partners].map((legacyId) => source[legacyId].name);
    result.families.push({
      id,
      label:
        partnerNames.length > 0
          ? partnerNames.join(' + ')
          : `Sibling group: ${[...definition.children].map((legacyId) => source[legacyId].name).join(', ')}`,
    });
    addIdentifier(id, 'UID', id);

    [...definition.partners].forEach((legacyId, position) => {
      const sex = source[legacyId].gender;
      result.familyPartners.push({
        familyId: id,
        personId: personId(legacyId),
        position,
        role: sex === 'M' ? 'HUSB' : sex === 'F' ? 'WIFE' : 'PARTNER',
      });
    });

    [...definition.children].forEach((legacyId, position) => {
      const count = childFamilyCounts.get(legacyId) || 0;
      childFamilyCounts.set(legacyId, count + 1);
      result.familyChildren.push({
        familyId: id,
        personId: personId(legacyId),
        position,
        pedigree: definition.kind === 'SIBLINGS' ? 'UNKNOWN' : 'BIRTH',
        isPreferred: count === 0,
      });
    });

    if (definition.kind === 'PARENTS' && definition.partners.size === 1) {
      result.warnings.push(
        `Inferred a single-parent family for ${source[[...definition.partners][0]].name}`,
      );
    }
  }

  return result;
}

module.exports = {
  deterministicUuid,
  normalizeYearDate,
  transformLegacyFamilyData,
};
