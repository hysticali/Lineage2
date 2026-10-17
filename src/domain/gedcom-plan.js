const { parseGedcom, children, child, GedcomError } = require('./gedcom');
const INDIVIDUAL_EVENTS = new Set('BIRT CHR DEAT BURI CREM ADOP BAPM BARM BASM BLES CHRA CONF FCOM ORDN NATU EMIG IMMI CENS PROB WILL GRAD RETI EVEN'.split(' '));
const INDIVIDUAL_ATTRIBUTES = new Set('CAST DSCR EDUC IDNO NATI NCHI NMR OCCU PROP RELI RESI SSN TITL FACT'.split(' '));
const FAMILY_EVENTS = new Set('ANUL CENS DIV DIVF ENGA MARB MARC MARL MARR MARS EVEN'.split(' '));
const FAMILY_ATTRIBUTES = new Set('NCHI RESI FACT'.split(' '));
const text = (node, tag) => child(node, tag)?.value ?? null;
const displayName = node => (text(node, 'NAME') || 'Unknown person').replaceAll('/', '').trim();
const eventKind = (ownerTag, tag) => (ownerTag === 'INDI' ? INDIVIDUAL_EVENTS : FAMILY_EVENTS).has(tag) ? 'EVENT' : (ownerTag === 'INDI' ? INDIVIDUAL_ATTRIBUTES : FAMILY_ATTRIBUTES).has(tag) ? 'ATTRIBUTE' : null;

function planGedcom(source) {
  const parsed = parseGedcom(source);
  const schemaUris = new Map(children(child(parsed.records[0], 'SCHMA'), 'TAG').map(n => { const space = n.value.indexOf(' '); return [n.value.slice(0, space), n.value.slice(space + 1)]; }));
  const ownExtension = (tag, name) => schemaUris.get(tag) === `urn:rootline:gedcom:${name}`;
  const warnings = [...parsed.warnings], errors = [];
  const seenSchema = new Map(), seenUris = new Map();
  for (const definition of children(child(parsed.records[0], 'SCHMA'), 'TAG')) {
    const match = /^(_[A-Z0-9_]+) ([a-zA-Z][a-zA-Z0-9+.-]*:\S+)$/.exec(definition.value);
    if (!match) { errors.push(`Line ${definition.line}: extension TAG requires an uppercase extension tag and an absolute URI.`); continue; }
    if (seenSchema.has(match[1]) && seenSchema.get(match[1]) !== match[2]) errors.push(`Line ${definition.line}: an extension tag cannot have two different meanings.`);
    if (seenUris.has(match[2]) && seenUris.get(match[2]) !== match[1]) warnings.push(`Line ${definition.line}: multiple extension aliases refer to the same URI; their original definitions are retained.`);
    seenSchema.set(match[1], match[2]); seenUris.set(match[2], match[1]);
  }
  const individuals = parsed.records.filter(r => r.tag === 'INDI');
  const families = parsed.records.filter(r => r.tag === 'FAM');
  const partnerExtension = [...schemaUris.values()].includes('urn:rootline:gedcom:partner');
  const isPartner = n => ['HUSB', 'WIFE'].includes(n.tag) || ownExtension(n.tag, 'partner');
  if (!individuals.length) errors.push('The document contains no individuals.');
  if (individuals.length > 100000) errors.push('The document exceeds 100,000 people.');
  const fail = (node, message) => errors.push(`Line ${node.line}: ${message}`);
  const singleton = (node, tags) => { for (const tag of tags) if (children(node, tag).length > 1) fail(node, `${tag} must appear at most once in this structure.`); };
  function factInfo(ownerTag, node) {
    if (ownExtension(node.tag, 'fact')) {
      const tag = node.children.find(n => ownExtension(n.tag, 'tag'))?.value, kind = node.children.find(n => ownExtension(n.tag, 'kind'))?.value;
      if (!/^(?:[A-Z][A-Z0-9]{0,30}|_[A-Z0-9_]{1,30})$/.test(tag || '') || !['EVENT', 'ATTRIBUTE'].includes(kind)) { fail(node, 'Invalid Rootline fact extension.'); return null; }
      return { tag, kind };
    }
    const kind = eventKind(ownerTag, node.tag);
    return kind ? { tag: node.tag, kind } : null;
  }
  function target(node, tag) {
    if (node.pointer === '@VOID@') return null;
    const record = parsed.xrefs.get(node.pointer);
    if (!record || record.tag !== tag) { fail(node, `${node.tag} must point to a ${tag} record.`); return null; }
    return record;
  }
  const parents = new Map(), memberships = new Map();
  for (const family of families) {
    singleton(family, ['HUSB', 'WIFE']);
    const partners = family.children.filter(isPartner).map(n => target(n, 'INDI')).filter(Boolean);
    const kids = children(family, 'CHIL').map(n => target(n, 'INDI')).filter(Boolean);
    if (new Set(partners).size !== partners.length || new Set(kids).size !== kids.length) fail(family, 'A family cannot repeat the same partner or child.');
    for (const person of partners) {
      if (kids.includes(person)) fail(family, 'A person cannot be a partner and their own child in a family.');
      if (family.xref && !children(person, 'FAMS').some(n => n.pointer === family.xref)) warnings.push(`Line ${family.line}: a missing reciprocal FAMS link will be repaired.`);
    }
    for (const person of kids) {
      if (!parents.has(person)) parents.set(person, new Set());
      partners.forEach(p => parents.get(person).add(p));
      if (!memberships.has(person)) memberships.set(person, []);
      memberships.get(person).push(family);
      if (family.xref && !children(person, 'FAMC').some(n => n.pointer === family.xref)) warnings.push(`Line ${family.line}: a missing reciprocal FAMC link will be repaired.`);
    }
  }
  const done = new Set();
  let cycleFound = false;
  for (const person of individuals) {
    const active = new Set(), stack = [[person, false]];
    while (stack.length && !cycleFound) {
      const [node, leave] = stack.pop();
      if (leave) { active.delete(node); done.add(node); continue; }
      if (done.has(node)) continue;
      if (active.has(node)) { fail(node, 'The family graph contains an ancestry cycle.'); cycleFound = true; break; }
      active.add(node); stack.push([node, true]);
      for (const parent of parents.get(node) || []) stack.push([parent, false]);
    }
    singleton(person, ['SEX']);
    for (const link of children(person, 'FAMC')) {
      const family = target(link, 'FAM');
      singleton(link, ['PEDI', 'STAT']);
      if (family && !children(family, 'CHIL').some(n => n.pointer && parsed.xrefs.get(n.pointer) === person)) fail(link, 'FAMC has no corresponding CHIL membership.');
    }
    for (const link of children(person, 'FAMS')) {
      const family = target(link, 'FAM');
      if (family && !family.children.some(n => isPartner(n) && parsed.xrefs.get(n.pointer) === person)) fail(link, 'FAMS has no corresponding partner membership.');
    }
    if (text(person, 'SEX') && !['M', 'F', 'X', 'U'].includes(text(person, 'SEX'))) warnings.push(`Line ${person.line}: unsupported sex value is retained in the source; the application will show unknown.`);
  }
  const unsupported = [];
  const recordSet = new Set(parsed.records);
  const pending = parsed.records.map(node => [node, null]);
  const supportedChildren = {
    HEAD: new Set('GEDC SCHMA SOUR LANG'.split(' ')),
    INDI: new Set('NAME SEX FAMC FAMS NOTE SOUR OBJE UID REFN EXID RESN'.split(' ')),
    FAM: new Set('HUSB WIFE CHIL NOTE SOUR OBJE UID REFN EXID RESN'.split(' ')),
    SOUR: new Set('TITL AUTH PUBL ABBR REPO OBJE UID REFN EXID RESN'.split(' ')),
    OBJE: new Set('FILE SOUR UID REFN EXID RESN'.split(' ')),
    REPO: new Set('NAME ADDR WWW UID REFN EXID RESN'.split(' ')),
  };
  const nestedChildren = {
    GEDC: 'VERS', SCHMA: 'TAG', NAME: 'TYPE GIVN SURN NPFX NSFX NICK SPFX SOUR',
    DATE: 'PHRASE', PLAC: 'FORM', NOTE: 'MIME LANG SOUR OBJE', FAMC: 'PEDI STAT',
    PEDI: 'PHRASE', STAT: 'PHRASE', TYPE: 'PHRASE', HUSB: 'PHRASE', WIFE: 'PHRASE', CHIL: 'PHRASE',
    FILE: 'FORM TITL', EXID: 'TYPE', REFN: 'TYPE', DATA: 'TEXT',
  };
  function modeled(owner, node) {
    if (recordSet.has(owner) && supportedChildren[owner.tag]?.has(node.tag)) return true;
    if (recordSet.has(owner) && ['INDI', 'FAM'].includes(owner.tag) && factInfo(owner.tag, node)) return true;
    if (['partner', 'fact', 'tag', 'kind', 'root', 'description', 'provenance'].some(name => ownExtension(node.tag, name))) return true;
    if (eventKind('INDI', owner.tag) || eventKind('FAM', owner.tag) || ownExtension(owner.tag, 'fact')) return 'TYPE DATE PLAC NOTE SOUR OBJE'.split(' ').includes(node.tag);
    if (owner.tag === 'SOUR' && owner.pointer) return 'PAGE DATA EVEN QUAY OBJE'.split(' ').includes(node.tag);
    if (owner.tag === 'REPO' && owner.pointer) return false;
    if (owner.tag === 'OBJE' && owner.pointer) return false;
    if (owner.tag === 'SOUR' && !recordSet.has(owner) && !owner.pointer) return ['VERS', 'NAME', 'CORP', 'DATA'].includes(node.tag);
    return (nestedChildren[owner.tag] || '').split(' ').includes(node.tag);
  }
  for (const [tag, uri] of schemaUris) if (uri === 'urn:rootline:gedcom:partner') supportedChildren.FAM.add(tag);
  while (pending.length) {
    const [node, owner] = pending.pop();
    if (owner && node.tag === 'SOUR' && node.pointer) target(node, 'SOUR');
    if (owner && node.tag === 'OBJE' && node.pointer) target(node, 'OBJE');
    if (owner && node.tag === 'REPO' && node.pointer) target(node, 'REPO');
    if (owner && ['INDI', 'FAM'].includes(owner.tag) && factInfo(owner.tag, node)) singleton(node, ['TYPE', 'DATE', 'PLAC']);
    if (!owner && node.tag === 'OBJE') {
      if (!children(node, 'FILE').length) fail(node, 'A multimedia record requires at least one FILE.');
      for (const file of children(node, 'FILE')) {
        if (!file.value || file.pointer) fail(file, 'FILE must contain a nonempty file reference.');
        if (children(file, 'FORM').length !== 1 || !text(file, 'FORM')) fail(file, 'FILE requires one FORM media type.');
      }
    }
    if (owner && !modeled(owner, node)) unsupported.push({ line: node.line, tag: node.tag, parent: owner.tag });
    else if (!owner && !['HEAD', 'TRLR', 'INDI', 'FAM', 'SOUR', 'OBJE', 'REPO'].includes(node.tag)) unsupported.push({ line: node.line, tag: node.tag, parent: 'Document' });
    else if (!owner && node.tag.startsWith('_') && !['partner', 'fact', 'tag', 'kind', 'root', 'description', 'provenance'].some(name => ownExtension(node.tag, name))) unsupported.push({ line: node.line, tag: node.tag, parent: 'Document' });
    for (const nested of node.children) pending.push([nested, node]);
  }
  if (unsupported.length) warnings.push(`${unsupported.length} unsupported structures are retained for export and original-source download.`);
  if (parsed.records.some(r => r.tag === 'OBJE')) warnings.push('Media paths are retained as references. No local file or remote URL will be opened automatically.');
  const roots = individuals.map(node => ({ reference: node.xref || `line:${node.line}`, name: displayName(node) }));
  const rootNode = parsed.records[0].children.find(n => ownExtension(n.tag, 'root'));
  const suggestedRoot = rootNode && target(rootNode, 'INDI');
  const preferredRoot = suggestedRoot ? suggestedRoot.xref || `line:${suggestedRoot.line}` : roots[0]?.reference;
  return { parsed, individuals, families, memberships, isPartner, partnerExtension, ownExtension, factInfo, report: { version: parsed.version, people: individuals.length, families: families.length, sources: parsed.records.filter(n => n.tag === 'SOUR').length, media: parsed.records.filter(n => n.tag === 'OBJE').length, roots, preferredRoot, warnings: [...new Set(warnings)], errors: [...new Set(errors)], unsupported } };
}

function requireValid(plan) {
  if (plan.report.errors.length) throw new GedcomError(plan.report.errors.join(' '));
  return plan;
}
module.exports = { planGedcom, requireValid, text, displayName, eventKind };
