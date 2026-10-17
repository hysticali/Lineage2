// Index each immutable family snapshot once. React edits replace the mapping,
// so a WeakMap gives fast lookups without retaining old archives.
const indexes = new WeakMap();
const birthOrder = (a, b) => (parseInt(a.birth) || 9999) - (parseInt(b.birth) || 9999);
const normalize = (text) => String(text || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

function graphIndex(family) {
  if (indexes.has(family)) return indexes.get(family);
  const children = new Map(), siblings = new Map(), spouses = new Map();
  const add = (map, a, b) => { if (!map.has(a)) map.set(a, new Set()); map.get(a).add(b); };
  const people = Object.values(family);
  for (const person of people) {
    for (const parent of [person.motherId, person.fatherId].filter(Boolean)) add(children, parent, person.id);
    for (const sibling of person.siblingIds || []) { add(siblings, person.id, sibling); add(siblings, sibling, person.id); }
    for (const spouse of [...(person.spouseIds || []), ...(person.spouseId ? [person.spouseId] : [])]) { add(spouses, person.id, spouse); add(spouses, spouse, person.id); }
  }
  const records = (ids) => [...(ids || [])].map((id) => family[id]).filter(Boolean).sort(birthOrder);
  const childRecords = new Map([...children].map(([id, ids]) => [id, records(ids)]));
  const spouseRecords = new Map([...spouses].map(([id, ids]) => [id, records(ids)]));
  const searchRows = people.map((person) => ({ person, text: normalize([person.name, person.birth, person.death, person.birthplace].filter(Boolean).join(' ')) }));
  searchRows.sort((a, b) => a.person.name.localeCompare(b.person.name));
  const index = { children, siblings, childRecords, spouseRecords, searchRows, records };
  indexes.set(family, index);
  return index;
}

function getChildren(id, family) { return graphIndex(family).childRecords.get(id) || []; }
function getSpouses(id, family) { return graphIndex(family).spouseRecords.get(id) || []; }
function getSpouse(id, family) { return getSpouses(id, family)[0] || null; }
function getSiblings(id, family) {
  const person = family[id];
  if (!person) return [];
  const index = graphIndex(family);
  const ids = new Set(index.siblings.get(id) || []);
  for (const parent of [person.motherId, person.fatherId]) for (const child of index.children.get(parent) || []) ids.add(child);
  ids.delete(id);
  return index.records(ids);
}

function lineagePath(centerId, targetId, family, direction) {
  const queue = [centerId], prior = new Map([[centerId, null]]);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor];
    if (id === targetId) {
      const path = [];
      for (let current = id; current !== null; current = prior.get(current)) if (current !== centerId || id === centerId) path.push(current);
      return new Set(path);
    }
    const person = family[id];
    if (!person) continue;
    const adjacent = direction === 'descendants' ? getChildren(id, family).map((child) => child.id) : [person.motherId, person.fatherId].filter(Boolean);
    for (const next of adjacent) if (!prior.has(next)) { prior.set(next, id); queue.push(next); }
  }
  return new Set();
}

function searchPeople(family, query, offset = 0, limit = 25) {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  const matches = graphIndex(family).searchRows.filter((row) => words.every((word) => row.text.includes(word)));
  return { total: matches.length, people: matches.slice(offset, offset + limit).map((row) => row.person) };
}

module.exports = { graphIndex, getChildren, getSiblings, getSpouses, getSpouse, lineagePath, searchPeople };
