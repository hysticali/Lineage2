const { children, child, serializeGedcom } = require('./gedcom');
const { planGedcom, requireValid, text, displayName } = require('./gedcom-plan');
const { validateArchive } = require('./archive');
const { getSiblings, getSpouses } = require('./graph');

function makeNode(tag, value = '', nested = [], pointer = null, xref = null) {
  return { tag, value, children: nested, pointer, xref };
}

function dateNode(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  // GEDCOM 7 DATE accepts exact/approximate calendar forms; arbitrary prose uses PHRASE.
  const exact = /^(?:(?:ABT|CAL|EST|BEF|AFT)\s+)?(?:\d{1,2}\s+)?(?:(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+)?\d{1,4}(?:\s+BCE)?$/i;
  if (exact.test(trimmed)) return makeNode('DATE', trimmed.toUpperCase());
  return makeNode('DATE', '', [makeNode('PHRASE', trimmed)]);
}

function previewBrowserGedcom(source) {
  return planGedcom(source).report;
}

function importBrowserGedcom(source, rootReference = null) {
  const plan = requireValid(planGedcom(source));
  const idByNode = new Map();
  const usedIds = new Set();

  function allocateId(node, fallbackIndex) {
    const raw = (node.xref ? node.xref.replaceAll('@', '') : `p${fallbackIndex}`)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_');
    let candidate = raw || `p${fallbackIndex}`;
    let n = 2;
    while (usedIds.has(candidate)) {
      candidate = `${raw}_${n++}`;
    }
    usedIds.add(candidate);
    return candidate;
  }

  const family = {};
  plan.individuals.forEach((node, index) => {
    const id = allocateId(node, index + 1);
    idByNode.set(node, id);
    const sex = text(node, 'SEX');
    const gender = ['M', 'F', 'X', 'U'].includes(sex) ? sex : undefined;
    const birthNode = child(node, 'BIRT');
    const deathNode = child(node, 'DEAT');
    const occuNode = child(node, 'OCCU');
    const noteNode = child(node, 'NOTE');

    const birthDate = birthNode ? text(birthNode, 'DATE') || text(child(birthNode, 'DATE'), 'PHRASE') : null;
    const birthplace = birthNode ? text(birthNode, 'PLAC') : null;
    const deathDate = deathNode ? text(deathNode, 'DATE') || text(child(deathNode, 'DATE'), 'PHRASE') : null;
    const occupation = occuNode?.value?.trim() || null;
    const bio = noteNode?.value?.trim() || null;

    family[id] = {
      id,
      name: displayName(node),
      ...(gender && { gender }),
      ...(birthDate && { birth: birthDate }),
      ...(deathDate && { death: deathDate }),
      ...(birthplace && { birthplace }),
      ...(occupation && { occupation }),
      ...(bio && { bio }),
    };
  });

  const preferredByChild = new Map();
  const families = [];

  plan.families.forEach((famNode, index) => {
    const famId = famNode.xref ? famNode.xref.replaceAll('@', '') : `F${index + 1}`;
    const partners = [];
    for (const pNode of famNode.children.filter(plan.isPartner)) {
      const target = plan.parsed.xrefs.get(pNode.pointer);
      const pid = target ? idByNode.get(target) : null;
      if (!pid || partners.some((p) => p.personId === pid)) continue;
      const role = ['HUSB', 'WIFE'].includes(pNode.tag) ? pNode.tag : 'PARTNER';
      const slot = role === 'WIFE' ? 'mother' : role === 'HUSB' ? 'father' : null;
      partners.push({ personId: pid, role, slot });
    }

    const kids = [];
    for (const cNode of children(famNode, 'CHIL')) {
      const target = plan.parsed.xrefs.get(cNode.pointer);
      const cid = target ? idByNode.get(target) : null;
      if (!cid || kids.some((k) => k.personId === cid)) continue;
      const famc = target ? children(target, 'FAMC').find((link) => link.pointer === famNode.xref) : null;
      const pedi = text(famc, 'PEDI');
      const pedigree = ['BIRTH', 'ADOPTED', 'FOSTER', 'SEALING', 'UNKNOWN'].includes(pedi) ? pedi : 'UNKNOWN';
      const preferred = !preferredByChild.has(cid);
      if (preferred) preferredByChild.set(cid, famId);
      kids.push({ personId: cid, pedigree, preferred });
    }

    if (!partners.length && !kids.length) return;
    families.push({ id: famId, partners, children: kids });

    for (const partner of partners) {
      const person = family[partner.personId];
      const spouses = partners.filter((p) => p.personId !== person.id).map((p) => p.personId);
      if (spouses.length) person.spouseIds = [...new Set([...(person.spouseIds || []), ...spouses])];
    }

    for (const kid of kids) {
      const person = family[kid.personId];
      const sibs = kids.filter((c) => c.personId !== person.id).map((c) => c.personId);
      if (sibs.length) person.siblingIds = [...new Set([...(person.siblingIds || []), ...sibs])];
      if (!kid.preferred) continue;

      const unplaced = [];
      for (const partner of partners) {
        const parent = family[partner.personId];
        if (!person.motherId && (partner.slot === 'mother' || (!partner.slot && parent?.gender === 'F'))) {
          person.motherId = partner.personId;
        } else if (!person.fatherId && (partner.slot === 'father' || (!partner.slot && parent?.gender === 'M'))) {
          person.fatherId = partner.personId;
        } else {
          unplaced.push(partner.personId);
        }
      }
      for (const parentId of unplaced) {
        if (person.motherId === parentId || person.fatherId === parentId) continue;
        if (!person.fatherId) person.fatherId = parentId;
        else if (!person.motherId) person.motherId = parentId;
      }
    }
  });

  const chosenRef = rootReference || plan.report.preferredRoot;
  const rootNode = plan.individuals.find((n) => (n.xref || `line:${n.line}`) === chosenRef) || plan.individuals[0];
  const rootId = idByNode.get(rootNode);
  const archive = { rootId, family, families };
  validateArchive(archive);
  return { archive, report: plan.report };
}

function buildExportFamilies(archive) {
  const familyMap = archive.family || {};
  const people = Object.values(familyMap).filter((p) => !p.placeholder);
  const families = [];
  const byKey = new Map();

  function addFamily(partnerIds, childIds) {
    const cleanPartners = [...new Set(partnerIds.filter((id) => familyMap[id]))];
    const cleanChildren = [...new Set(childIds.filter((id) => familyMap[id]))];
    if (!cleanPartners.length && cleanChildren.length < 2) return null;
    const key = cleanPartners.length
      ? `P:${[...cleanPartners].sort().join(',')}`
      : `S:${[...cleanChildren].sort().join(',')}`;
    let fam = byKey.get(key);
    if (!fam) {
      fam = { id: `F${families.length + 1}`, partners: [], children: [] };
      byKey.set(key, fam);
      families.push(fam);
    }
    for (const pid of cleanPartners) {
      if (!fam.partners.some((p) => p.personId === pid)) {
        const person = familyMap[pid];
        fam.partners.push({ personId: pid, slot: person?.gender === 'F' ? 'mother' : person?.gender === 'M' ? 'father' : null });
      }
    }
    for (const cid of cleanChildren) {
      if (!fam.children.some((c) => c.personId === cid)) {
        fam.children.push({ personId: cid, pedigree: 'UNKNOWN' });
      }
    }
    return fam;
  }

  for (const person of people) {
    const parents = [person.motherId, person.fatherId].filter((id) => id && familyMap[id]);
    if (parents.length) {
      const fam = addFamily(parents, [person.id]);
      if (fam) {
        for (const p of fam.partners) {
          if (p.personId === person.motherId) p.slot = 'mother';
          else if (p.personId === person.fatherId) p.slot = 'father';
        }
      }
    }
  }

  for (const person of people) {
    for (const spouse of getSpouses(person.id, familyMap)) {
      addFamily([person.id, spouse.id], []);
    }
  }

  // Partnerless explicit sibling groups (when neither sibling shares a recorded parent family)
  const pairedSiblings = new Set();
  for (const fam of families) {
    for (const a of fam.children) {
      for (const b of fam.children) {
        if (a.personId !== b.personId) pairedSiblings.add([a.personId, b.personId].sort().join(':'));
      }
    }
  }
  for (const person of people) {
    for (const sib of getSiblings(person.id, familyMap)) {
      const pairKey = [person.id, sib.id].sort().join(':');
      if (pairedSiblings.has(pairKey)) continue;
      pairedSiblings.add(pairKey);
      addFamily([], [person.id, sib.id]);
    }
  }

  return families;
}

function exportBrowserGedcom(archive) {
  validateArchive(archive);
  const people = Object.values(archive.family).filter((p) => !p.placeholder);
  const refs = new Map(people.map((p, i) => [p.id, `@I${i + 1}@`]));
  const families = buildExportFamilies(archive);
  const familyRefs = new Map(families.map((f, i) => [f.id, `@F${i + 1}@`]));

  const headChildren = [
    makeNode('GEDC', '', [makeNode('VERS', '7.0')]),
    makeNode('SOUR', 'ROOTLINE'),
    makeNode('SCHMA', '', [
      makeNode('TAG', '_ROOTLINE_ROOT urn:rootline:gedcom:root'),
      makeNode('TAG', '_ROOTLINE_PARTNER urn:rootline:gedcom:partner'),
    ]),
  ];
  if (refs.has(archive.rootId)) {
    headChildren.push(makeNode('_ROOTLINE_ROOT', '', [], refs.get(archive.rootId)));
  }

  const records = [makeNode('HEAD', '', headChildren)];

  for (const person of people) {
    const parts = person.name.trim().split(/\s+/);
    const gedName = parts.length > 1 ? `${parts.slice(0, -1).join(' ')} /${parts.at(-1)}/` : person.name.trim();
    const indiChildren = [makeNode('NAME', gedName)];
    if (person.gender && ['M', 'F', 'X', 'U'].includes(person.gender)) {
      indiChildren.push(makeNode('SEX', person.gender));
    }
    const birthDetails = [];
    const bDate = dateNode(person.birth);
    if (bDate) birthDetails.push(bDate);
    if (person.birthplace) birthDetails.push(makeNode('PLAC', person.birthplace));
    if (birthDetails.length) indiChildren.push(makeNode('BIRT', '', birthDetails));

    const dDate = dateNode(person.death);
    if (dDate) indiChildren.push(makeNode('DEAT', '', [dDate]));
    if (person.occupation) indiChildren.push(makeNode('OCCU', person.occupation));
    if (person.bio) indiChildren.push(makeNode('NOTE', person.bio));

    for (const fam of families) {
      if (fam.partners.some((p) => p.personId === person.id)) {
        indiChildren.push(makeNode('FAMS', '', [], familyRefs.get(fam.id)));
      }
      if (fam.children.some((c) => c.personId === person.id)) {
        indiChildren.push(makeNode('FAMC', '', [], familyRefs.get(fam.id)));
      }
    }
    records.push(makeNode('INDI', '', indiChildren, null, refs.get(person.id)));
  }

  for (const fam of families) {
    const famChildren = [];
    const used = new Set();
    for (const partner of fam.partners) {
      const desired = partner.slot === 'mother' ? 'WIFE' : partner.slot === 'father' ? 'HUSB' : null;
      const tag = desired && !used.has(desired) ? desired : !used.has('HUSB') ? 'HUSB' : !used.has('WIFE') ? 'WIFE' : '_ROOTLINE_PARTNER';
      used.add(tag);
      famChildren.push(makeNode(tag, '', [], refs.get(partner.personId)));
    }
    for (const kid of fam.children) {
      famChildren.push(makeNode('CHIL', '', [], refs.get(kid.personId)));
    }
    records.push(makeNode('FAM', '', famChildren, null, familyRefs.get(fam.id)));
  }

  records.push(makeNode('TRLR'));
  const serialized = serializeGedcom(records);
  return {
    source: serialized.startsWith('\uFEFF') ? serialized : `\uFEFF${serialized}`,
    people: people.length,
    families: families.length,
    warnings: [],
  };
}

module.exports = { previewBrowserGedcom, importBrowserGedcom, exportBrowserGedcom };
