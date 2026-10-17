// Shared by the browser and server. Backup files preserve unknown record fields
// so adding richer genealogy data never makes an older UI silently strip it.
const FORMAT = 'rootline-archive';
const VERSION = 1;
const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype']);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function assertSafe(value, depth = 0) {
  if (depth > 100) throw new Error('Archive nesting is too deep');
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) throw new Error(`Unsupported field: ${key}`);
    assertSafe(item, depth + 1);
  }
}

function validateArchive(input) {
  if (!isObject(input) || !isObject(input.family)) throw new Error('Archive must contain a family object');
  assertSafe(input);
  const { family, rootId } = input;
  if (typeof rootId !== 'string' || !Object.hasOwn(family, rootId)) {
    throw new Error('Root must reference a person in this archive');
  }
  const ids = Object.keys(family);
  if (ids.length > 100000) throw new Error('Archive exceeds 100,000 people');
  const parents = new Map();
  let relationshipCount = 0;
  for (const [id, person] of Object.entries(family)) {
    if (!id || !isObject(person) || person.id !== id) throw new Error(`Person ID does not match record key: ${id}`);
    if (typeof person.name !== 'string' || !person.name.trim()) throw new Error(`Person ${id} needs a name`);
    if (person.gender && !['M', 'F', 'X', 'U'].includes(person.gender)) throw new Error(`Invalid gender for ${id}`);
    for (const field of ['birth', 'death', 'birthplace', 'occupation', 'bio']) {
      if (person[field] != null && typeof person[field] !== 'string') throw new Error(`${field} must be text for ${id}`);
    }
    const parentIds = [person.motherId, person.fatherId].filter(Boolean);
    if (new Set(parentIds).size !== parentIds.length) throw new Error(`Duplicate parent for ${id}`);
    parents.set(id, parentIds);
    for (const field of ['spouseIds', 'siblingIds']) {
      if (person[field] != null && (!Array.isArray(person[field]) || new Set(person[field]).size !== person[field].length)) {
        throw new Error(`${field} must be a list of unique IDs for ${id}`);
      }
    }
    const refs = [...parentIds, ...(person.spouseIds || []), ...(person.siblingIds || []), ...(person.spouseId ? [person.spouseId] : [])];
    for (const ref of refs) {
      if (typeof ref !== 'string' || !Object.hasOwn(family, ref)) throw new Error(`Missing relative ${ref} referenced by ${id}`);
      if (ref === id) throw new Error(`Person ${id} cannot be their own relative`);
    }
    relationshipCount += refs.length;
  }
  // Iterative DFS avoids stack overflow on long lineages and distinguishes
  // repeated ancestors from a cycle on the active ancestry path.
  const done = new Set();
  for (const id of ids) {
    const visiting = new Set();
    const stack = [[id, false]];
    while (stack.length) {
      const [current, leaving] = stack.pop();
      if (leaving) { visiting.delete(current); done.add(current); continue; }
      if (done.has(current)) continue;
      if (visiting.has(current)) throw new Error(`Ancestry cycle at ${current}`);
      visiting.add(current);
      stack.push([current, true]);
      for (const parent of parents.get(current)) stack.push([parent, false]);
    }
  }
  return { people: ids.length, relationships: relationshipCount, rootName: family[rootId].name };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  const text = canonicalJson(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16);
}

function createBackup(archive, tree = {}) {
  validateArchive(archive);
  return {
    format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(),
    tree: { id: tree.id || 'local', name: tree.name || 'Family archive' },
    archive: JSON.parse(JSON.stringify(archive)),
  };
}

function parseBackup(text) {
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new Error('Backup exceeds 20 MB');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Backup is not valid JSON'); }
  if (data?.format !== FORMAT || data.version !== VERSION) throw new Error('Unsupported backup format or version');
  const summary = validateArchive(data.archive);
  return { ...data, summary };
}

module.exports = { FORMAT, VERSION, MAX_BACKUP_BYTES, validateArchive, canonicalJson, fingerprint, createBackup, parseBackup };
