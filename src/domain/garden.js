// ─── BOTANICAL GARDEN LAYOUT ENGINE ──────────────────────────────────────────
// Pure, deterministic layout engine for Rootline's "Sprouting Family Blooms"
// Garden view. Imports read-only helpers from wheel.js and graph.js without
// modifying either module.

const {
  MAX_GEN,
  buildWheel,
  buildDescendantWheel,
  extractYear,
} = require('./wheel');
const {
  getSiblings,
  getChildren,
  getSpouses,
} = require('./graph');

const GARDEN_WORLD = 1000;
const GARDEN_HUB = { x: 500, y: 500, r: 48 };
const GARDEN_BOUNDS = { minX: 35, maxX: 965, minY: 45, maxY: 605 };

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const GENERATIONAL_SUFFIX = /^(?:jr\.?|sr\.?|ii|iii|iv|v)$/i;

// Adaptive concentric ring radii (from hub center) keyed by max visible gen.
// Default Gen 1+2 fills ~72-78% of the visible chart frame gracefully, while
// deeper expanded trees scale smoothly up to Gen 6 inside GARDEN_BOUNDS.
const BLOOM_RING_RADII = {
  1: [0, 0],
  2: [0, 0, 316],
  3: [0, 0, 248, 358],
  4: [0, 0, 218, 304, 384],
  5: [0, 0, 198, 270, 336, 394],
  6: [0, 0, 184, 244, 298, 348, 398],
};

// Lush, broad obovate botanical petal proportions per generation (scaled slightly when maxGen is deep).
const BASE_PETAL_LEN = [0, 162, 124, 90, 68, 56, 48];
const BASE_PETAL_HALF_W = [0, 58, 48, 36, 26, 21, 18];
const BASE_SEED_R = [48, 0, 14.5, 11.5, 9.5, 8, 6.5];

// ─── DETERMINISTIC PRNG ───────────────────────────────────────────────────────
function hashString(str) {
  let h = 2166136261 >>> 0;
  const text = String(str || '');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededJitterDeg(id, maxDeg = 2.2) {
  const rng = mulberry32(hashString(`garden:${id}`));
  return (rng() * 2 - 1) * maxDeg;
}

// ─── FORMATTING HELPERS (domain-local, matching frontend/format.js) ───────────
function r2(n) {
  return Math.round(n * 100) / 100;
}

function getInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  while (parts.length > 1 && GENERATIONAL_SUFFIX.test(parts[parts.length - 1].replace(/,+$/, ''))) {
    parts.pop();
  }
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatLifespan(birth, death) {
  const b = String(birth || '').trim();
  const d = String(death || '').trim();
  if (b && d) return `${b}–${d}`;
  if (b) return `b. ${b}`;
  if (d) return `d. ${d}`;
  return '';
}

function slotCodeFromKey(key, direction) {
  if (direction === 'descendants') return 'C';
  const parts = String(key || '').split(':');
  const path = parts[1] || '';
  const last = path.split('-').pop();
  return last === 'M' || last === 'F' ? last : 'M';
}

function relationLabel(generation, direction, side, isSibling, slotCode) {
  if (direction === 'descendants') {
    if (generation === 1) return 'Child';
    if (generation === 2) return 'Grandchild';
    if (generation === 3) return 'Great-grandchild';
    return `${generation - 2}× Great-grandchild`;
  }
  const sidePrefix = side === 'maternal' ? 'Maternal ' : side === 'paternal' ? 'Paternal ' : '';
  if (isSibling) return `${sidePrefix}Sibling`;
  const isMother = slotCode === 'M';
  if (generation === 1) return isMother ? 'Mother' : 'Father';
  if (generation === 2) return `${sidePrefix}${isMother ? 'Grandmother' : 'Grandfather'}`;
  if (generation === 3) return `${sidePrefix}Great-${isMother ? 'grandmother' : 'grandfather'}`;
  return `${sidePrefix}${generation - 2}× Great-${isMother ? 'grandmother' : 'grandfather'}`;
}

// ─── POLAR & PATH GEOMETRY ────────────────────────────────────────────────────
// Garden angle convention: 0° = straight up (-Y), negative = left (-X), positive = right (+X).
function upPolar(cx, cy, radius, angleDeg) {
  const rad = angleDeg * DEG_TO_RAD;
  return {
    x: r2(cx + radius * Math.sin(rad)),
    y: r2(cy - radius * Math.cos(rad)),
  };
}

function toHubPolar(x, y) {
  const dx = x - GARDEN_HUB.x;
  const dy = GARDEN_HUB.y - y; // positive upward
  return {
    r: Math.hypot(dx, dy),
    angleDeg: Math.atan2(dx, dy) * RAD_TO_DEG,
  };
}

// Convert wheel.js radians (π = left, 3π/2 = up, 2π = right) to garden degrees [-90, +90].
function wheelRadToGardenDeg(rad) {
  return ((rad - 1.5 * Math.PI) * RAD_TO_DEG);
}

// Local-origin lush obovate / magnolia petal path pointing straight up (-Y) from
// (0, 0) to (0, -len). Tapers gracefully at the base, swells to its full width
// (±halfW) across the upper-mid belly (y = -0.38L .. -0.80L), and closes with a
// soft C1-smooth rounded crown (horizontal tangent at (0, -len)) for generous
// upright text room and an authentic botanical silhouette.
function petalPathD(len, halfW) {
  const w = halfW;
  const L = len;
  return [
    'M 0,0',
    `C ${r2(0.24 * w)},${r2(-0.16 * L)} ${r2(1.0 * w)},${r2(-0.38 * L)} ${r2(1.0 * w)},${r2(-0.63 * L)}`,
    `C ${r2(1.0 * w)},${r2(-0.85 * L)} ${r2(0.48 * w)},${r2(-1.0 * L)} 0,${r2(-L)}`,
    `C ${r2(-0.48 * w)},${r2(-1.0 * L)} ${r2(-1.0 * w)},${r2(-0.85 * L)} ${r2(-1.0 * w)},${r2(-0.63 * L)}`,
    `C ${r2(-1.0 * w)},${r2(-0.38 * L)} ${r2(-0.24 * w)},${r2(-0.16 * L)} 0,0 Z`,
  ].join(' ');
}

// Delicate midrib vein along petal center.
function petalVeinD(len) {
  return `M 0,${r2(-0.12 * len)} Q ${r2(0.025 * len)},${r2(-0.46 * len)} 0,${r2(-0.8 * len)}`;
}

// Optical center of the visible petal belly, accounting for the golden hub or
// seed-head disc (radius baseR) that covers the petal's base.
function opticalLabelRadius(len, baseR) {
  const visibleCenter = baseR + (len - baseR) * 0.49;
  return r2(Math.min(len * 0.72, Math.max(len * 0.58, visibleCenter)));
}

// Monotone polar cubic Bezier stem from (x0, y0) to (x1, y1), split into 2 cubics
// if |Δθ| > 35° so curved stems stay strictly inside their angular sector and never cross.
function buildStemCurve(x0, y0, x1, y1, generation) {
  const p0 = toHubPolar(x0, y0);
  const p1 = toHubPolar(x1, y1);
  const r0 = p0.r;
  const r1 = Math.max(p1.r, r0 + 10);
  const a0 = p0.angleDeg * DEG_TO_RAD;
  const a1 = p1.angleDeg * DEG_TO_RAD;
  const dr = r1 - r0;
  const da = a1 - a0;
  const absDeg = Math.abs(da * RAD_TO_DEG);

  // Unit radial vectors u(a) = (sin a, -cos a)
  const u0x = Math.sin(a0), u0y = -Math.cos(a0);
  const u1x = Math.sin(a1), u1y = -Math.cos(a1);

  let d;
  let midX, midY, tanAngleDeg;

  if (absDeg <= 35) {
    const h = dr / 3;
    const c1x = r2(x0 + h * u0x), c1y = r2(y0 + h * u0y);
    const c2x = r2(x1 - h * u1x), c2y = r2(y1 - h * u1y);
    d = `M ${r2(x0)},${r2(y0)} C ${c1x},${c1y} ${c2x},${c2y} ${r2(x1)},${r2(y1)}`;

    // Evaluate cubic at t = 0.5 for mid-stem leaf
    midX = r2(0.125 * x0 + 0.375 * c1x + 0.375 * c2x + 0.125 * x1);
    midY = r2(0.125 * y0 + 0.375 * c1y + 0.375 * c2y + 0.125 * y1);
    const tx = 0.75 * (c2x - c1x) + 0.75 * (x1 - x0) * 0.5 - 0.75 * (c2x - c1x) * 0.5;
    const ty = 0.75 * (c2y - c1y) + 0.75 * (y1 - y0) * 0.5 - 0.75 * (c2y - c1y) * 0.5;
    tanAngleDeg = Math.atan2(tx, -ty) * RAD_TO_DEG;
  } else {
    const rm = (r0 + r1) / 2;
    const am = (a0 + a1) / 2;
    const mx = r2(GARDEN_HUB.x + rm * Math.sin(am));
    const my = r2(GARDEN_HUB.y - rm * Math.cos(am));
    // Polar smoothstep velocity at t = 0.5: dr/dt = dr, dθ/dt = 1.5 * da
    const vx = dr * Math.sin(am) + rm * (1.5 * da) * Math.cos(am);
    const vy = -dr * Math.cos(am) + rm * (1.5 * da) * Math.sin(am);
    const c1x = r2(x0 + (dr / 6) * u0x), c1y = r2(y0 + (dr / 6) * u0y);
    const c2x = r2(mx - vx / 6), c2y = r2(my - vy / 6);
    const c3x = r2(mx + vx / 6), c3y = r2(my + vy / 6);
    const c4x = r2(x1 - (dr / 6) * u1x), c4y = r2(y1 - (dr / 6) * u1y);
    d = `M ${r2(x0)},${r2(y0)} C ${c1x},${c1y} ${c2x},${c2y} ${mx},${my} C ${c3x},${c3y} ${c4x},${c4y} ${r2(x1)},${r2(y1)}`;
    midX = mx;
    midY = my;
    tanAngleDeg = Math.atan2(vx, -vy) * RAD_TO_DEG;
  }

  let leaf = null;
  if (generation <= 3 && Math.hypot(x1 - x0, y1 - y0) >= 48) {
    const tilt = tanAngleDeg >= 0 ? 44 : -44;
    const len = r2(Math.max(12, 22 - generation * 3));
    leaf = {
      x: midX,
      y: midY,
      angleDeg: r2(tanAngleDeg + tilt),
      len,
      width: r2(len * 0.44),
    };
  }

  return { d, leaf };
}

function buildTwigD(cx, cy, x, y) {
  const mx = (cx + x) / 2;
  const my = (cy + y) / 2;
  const dx = x - cx;
  const dy = y - cy;
  const bend = 0.14;
  const qx = r2(mx - dy * bend);
  const qy = r2(my + dx * bend);
  return `M ${r2(cx)},${r2(cy)} Q ${qx},${qy} ${r2(x)},${r2(y)}`;
}

// ─── MAIN BUILDER ─────────────────────────────────────────────────────────────
function buildGarden(centerId, family, expanded, opts = {}) {
  const people =
    family && typeof family === 'object' && family.family && !family[centerId]
      ? family.family
      : family || {};
  const expandedSet = expanded instanceof Set ? expanded : new Set(expanded || []);
  const {
    direction = 'ancestors',
    sibAnchorPid = null,
    dominantSibId = null,
    canEdit = false,
  } = opts;
  const isAncestors = direction !== 'descendants';
  const center = people[centerId] || null;

  const hub = {
    x: GARDEN_HUB.x,
    y: GARDEN_HUB.y,
    r: GARDEN_HUB.r,
    personId: centerId || null,
    name: center?.name || '',
    lifespan: formatLifespan(center?.birth, center?.death),
    initials: getInitials(center?.name),
  };

  // Build structural wedges using the existing wheel engine for exact key/trail parity.
  const { wedges } = isAncestors
    ? buildWheel(centerId, people, expandedSet, sibAnchorPid, dominantSibId)
    : buildDescendantWheel(centerId, people, expandedSet);

  // Separate real person wedges and empty parent slot wedges.
  const personWedges = wedges.filter((w) => Boolean(w.person));
  const emptyWedges = canEdit && isAncestors
    ? wedges.filter((w) => !w.person && w.parentChildId && w.slot)
    : [];

  const maxGen = personWedges.reduce((m, w) => Math.max(m, w.generation), 0);
  const depthKey = Math.max(1, Math.min(MAX_GEN, maxGen));
  const ringRadii = BLOOM_RING_RADII[depthKey] || BLOOM_RING_RADII[MAX_GEN];
  const depthScale = maxGen <= 2 ? 1 : maxGen === 3 ? 0.9 : maxGen === 4 ? 0.82 : maxGen === 5 ? 0.76 : 0.7;

  // Map wheel fan [-90°, +90°] into garden upper fan [-80°, +80°] so all stems/blooms
  // spread lushly across the parchment while staying cleanly above the lower stem & spouses.
  const FAN_COMPRESS = 80 / 90;
  function wedgeSectorDeg(w) {
    const a0 = wheelRadToGardenDeg(w.startAngle) * FAN_COMPRESS;
    const a1 = wheelRadToGardenDeg(w.endAngle) * FAN_COMPRESS;
    return { a0, a1, mid: (a0 + a1) / 2, span: Math.max(1, a1 - a0) };
  }

  // Group wedges by parent key (null for Gen 1).
  const childrenByParentKey = new Map();
  const emptyByParentKey = new Map();
  for (const w of personWedges) {
    const parentKey = w.trail.length >= 2 ? w.trail[w.trail.length - 2] : null;
    if (!childrenByParentKey.has(parentKey)) childrenByParentKey.set(parentKey, []);
    childrenByParentKey.get(parentKey).push(w);
  }
  for (const w of emptyWedges) {
    const parentKey = w.trail.length >= 2 ? w.trail[w.trail.length - 2] : null;
    if (!emptyByParentKey.has(parentKey)) emptyByParentKey.set(parentKey, []);
    emptyByParentKey.get(parentKey).push(w);
  }

  // Index non-sibling anchor keys per (parentKey, lineageSide) for siblingAnchorKey lookup.
  function findSiblingAnchorKey(w) {
    if (!w.isSibling) return null;
    const parentKey = w.trail.length >= 2 ? w.trail[w.trail.length - 2] : null;
    const group = childrenByParentKey.get(parentKey) || [];
    const anchor = group.find((other) => !other.isSibling && other.lineageSide === w.lineageSide);
    return anchor ? anchor.key : null;
  }

  const blooms = [];
  const stems = [];
  const petals = [];
  const buds = [];

  const petalByKey = new Map();
  const bloomByParentKey = new Map();

  // Compute safe bloom radius at generation g for a sector of width spanDeg.
  function computeBloomRadius(gen, spanDeg) {
    const R = ringRadii[gen] || ringRadii[ringRadii.length - 1];
    const baseR = BASE_SEED_R[Math.min(gen, MAX_GEN)] || 6;
    const chordBound = R * Math.sin((spanDeg * DEG_TO_RAD) / 2) * 0.36;
    return r2(Math.max(4.5, Math.min(baseR, chordBound)));
  }

  // Compute safe petal length & half-width for a petal at generation g.
  function computePetalSize(gen, isSibling, angularStepDeg, maxOuterR) {
    const genScale = gen === 1 ? (maxGen <= 2 ? 1 : Math.max(0.8, depthScale + 0.06)) : depthScale;
    const rawLen = (BASE_PETAL_LEN[Math.min(gen, MAX_GEN)] || 48) * genScale;
    const rawW = (BASE_PETAL_HALF_W[Math.min(gen, MAX_GEN)] || 18) * genScale;
    const sibFactor = isSibling ? 0.8 : 1;

    // Ensure tip stays inside radial envelope (maxOuterR <= 442 from hub)
    const len = r2(Math.max(30, Math.min(rawLen * sibFactor, maxOuterR)));

    // Keep adjacent petals on the same bloom lush yet non-overlapping at their
    // widest obovate belly (r ≈ 0.63 * len) using actual neighbor angle step.
    const safeStep = Math.max(18, Math.min(96, angularStepDeg));
    const widthBound = (0.63 * len) * Math.sin((safeStep * DEG_TO_RAD) / 2) * 0.94;
    const minW = gen === 1 ? 30 : gen === 2 ? 26 : 15;
    const halfW = r2(Math.max(minW, Math.min(rawW * sibFactor, Math.max(minW, widthBound))));
    return { len, halfW };
  }

  // ── 1. GEN 1 HERO PETALS (anchored at GARDEN_HUB) ───────────────────────────
  const gen1Wedges = childrenByParentKey.get(null) || [];
  const gen1NonSibs = gen1Wedges.filter((w) => !w.isSibling);

  for (const w of gen1Wedges) {
    const sec = wedgeSectorDeg(w);
    let angleDeg;
    let neighborStepDeg;
    if (isAncestors && gen1Wedges.length <= 2 && !w.isSibling) {
      // Lush balanced hero pair: Mother ~ -42°, Father ~ +42° (84° apart)
      const base = w.lineageSide === 'maternal' ? -42 : 42;
      angleDeg = base + seededJitterDeg(w.person.id, 2.0);
      neighborStepDeg = 84;
    } else if (!isAncestors) {
      // Descendants: fan children broadly across [-66°, +66°]
      const idx = gen1NonSibs.indexOf(w);
      const n = gen1NonSibs.length;
      const spread = n <= 1 ? 0 : Math.min(66, 30 * (n - 1));
      const base = n <= 1 ? 0 : -spread + (2 * spread * idx) / (n - 1);
      const clamped = Math.max(sec.a0 + 3, Math.min(sec.a1 - 3, base));
      angleDeg = clamped + seededJitterDeg(w.person.id, 1.8);
      neighborStepDeg = n <= 1 ? 90 : (2 * spread) / (n - 1);
    } else {
      // Ancestors with siblings expanded at Gen 1: use wedge sector midpoints so
      // chronological sibling order and non-overlap are strictly preserved.
      const jitter = seededJitterDeg(w.person.id, Math.min(1.6, sec.span * 0.08));
      angleDeg = sec.mid + jitter;
      neighborStepDeg = Math.max(24, sec.span);
    }

    // Clamp angle into its own sector with a small margin so stems never cross.
    const margin = Math.min(2.5, sec.span * 0.12);
    angleDeg = r2(Math.max(sec.a0 + margin, Math.min(sec.a1 - margin, angleDeg)));

    const { len, halfW } = computePetalSize(
      1,
      w.isSibling,
      neighborStepDeg,
      166,
    );

    const slotCode = slotCodeFromKey(w.key, direction);
    const labelPt = upPolar(GARDEN_HUB.x, GARDEN_HUB.y, opticalLabelRadius(len, GARDEN_HUB.r), angleDeg);
    const tipPt = upPolar(GARDEN_HUB.x, GARDEN_HUB.y, len, angleDeg);
    const hasChildBloom = (childrenByParentKey.get(w.key) || []).length > 0;

    const petal = {
      key: w.key,
      personId: w.person.id,
      person: w.person,
      generation: 1,
      side: w.lineageSide,
      cx: GARDEN_HUB.x,
      cy: GARDEN_HUB.y,
      baseR: GARDEN_HUB.r,
      angleDeg,
      len,
      halfW,
      pathD: petalPathD(len, halfW),
      veinD: petalVeinD(len),
      labelX: labelPt.x,
      labelY: labelPt.y,
      tipX: tipPt.x,
      tipY: tipPt.y,
      isSibling: Boolean(w.isSibling),
      siblingAnchorKey: findSiblingAnchorKey(w),
      slot: slotCode,
      trail: w.trail,
      hasMore: Boolean(w.hasMore),
      isSprouted: hasChildBloom,
      canExpandSiblings: Boolean(isAncestors && !w.isSibling && getSiblings(w.person.id, people).length > 0),
      relLabel: relationLabel(1, direction, w.lineageSide, w.isSibling, slotCode),
      _sector: sec,
    };

    petals.push(petal);
    petalByKey.set(petal.key, petal);
  }

  // Gen 1 empty parent buds (e.g. single-person tree or single parent)
  const gen1Empties = emptyByParentKey.get(null) || [];
  for (const w of gen1Empties) {
    const baseAngle = w.slot === 'mother' ? -40 : 40;
    const angleDeg = r2(baseAngle);
    const startPt = upPolar(GARDEN_HUB.x, GARDEN_HUB.y, GARDEN_HUB.r - 4, angleDeg);
    const budPt = upPolar(GARDEN_HUB.x, GARDEN_HUB.y, 140, angleDeg);
    const parentName = people[w.parentChildId]?.name || 'person';
    buds.push({
      key: `empty:${w.key.replace(/:empty$/, '')}`,
      slot: w.slot,
      childId: w.parentChildId,
      cx: startPt.x,
      cy: startPt.y,
      x: budPt.x,
      y: budPt.y,
      stemD: buildTwigD(startPt.x, startPt.y, budPt.x, budPt.y),
      angleDeg,
      generation: 1,
      side: w.lineageSide,
      label: w.slot === 'mother' ? '+ Mother' : '+ Father',
      ariaLabel: `Add ${w.slot} for ${parentName}`,
    });
  }

  // ── 2. GEN 2..MAX_GEN SATELLITE BLOOMS, STEMS & PETALS ─────────────────────
  for (let gen = 2; gen <= MAX_GEN; gen++) {
    const genWedges = personWedges.filter((w) => w.generation === gen);
    if (!genWedges.length) continue;

    // Group by parentKey so each parent petal with visible children gets one satellite bloom.
    const groups = new Map();
    for (const w of genWedges) {
      const parentKey = w.trail[w.trail.length - 2];
      if (!groups.has(parentKey)) groups.set(parentKey, []);
      groups.get(parentKey).push(w);
    }

    const R = ringRadii[gen] || ringRadii[ringRadii.length - 1];
    const nextRingR = gen < MAX_GEN ? ringRadii[gen + 1] || null : null;
    const maxPetalAllowance = Math.max(24, 442 - R);

    for (const [parentKey, groupWedges] of groups.entries()) {
      const parentPetal = petalByKey.get(parentKey);
      if (!parentPetal) continue;

      // Compute bloom angular center from the parent petal's sector (clamped inside parent sector).
      const pSec = parentPetal._sector;
      const bloomAngleDeg = r2(pSec.mid);
      const bloomPos = upPolar(GARDEN_HUB.x, GARDEN_HUB.y, R, bloomAngleDeg);
      const bloomR = computeBloomRadius(gen, pSec.span);

      const bloom = {
        key: parentKey,
        x: bloomPos.x,
        y: bloomPos.y,
        r: bloomR,
        generation: gen,
        side: parentPetal.side,
        parentKey,
        trail: parentPetal.trail,
      };
      blooms.push(bloom);
      bloomByParentKey.set(parentKey, bloom);
      parentPetal.isSprouted = true;

      // Curved Bezier stem from parent petal's tip to this bloom's seed-head.
      const { d: stemD, leaf } = buildStemCurve(
        parentPetal.tipX,
        parentPetal.tipY,
        bloom.x,
        bloom.y,
        gen,
      );
      stems.push({
        id: `stem:${parentKey}`,
        d: stemD,
        generation: gen,
        side: parentPetal.side,
        fromKey: parentKey,
        toKey: bloom.key,
        trail: parentPetal.trail,
        leaf,
      });

      // Place petals around the bloom's seed-head, fanning outward along bloomAngleDeg.
      // Derive local fan spread from the physical arc width of the parent's sector so
      // Gen 2 & Gen 3 petals open luxuriously without squeezing narrow or colliding.
      const n = groupWedges.length;
      const estLen = Math.min((BASE_PETAL_LEN[Math.min(gen, MAX_GEN)] || 48) * depthScale, maxPetalAllowance);
      const sectorHalfArc = (R + 0.55 * estLen) * Math.sin((pSec.span * DEG_TO_RAD) / 2);
      const sinMaxSpread = Math.min(1, (0.64 * sectorHalfArc) / Math.max(estLen, 1));
      const arcSpreadDeg = Math.asin(sinMaxSpread) * RAD_TO_DEG;
      const maxLocalSpread = Math.min(48, Math.max(22, arcSpreadDeg));
      const neighborStepDeg = n <= 1 ? 90 : (2 * maxLocalSpread) / (n - 1);

      for (let i = 0; i < n; i++) {
        const w = groupWedges[i];
        const sec = wedgeSectorDeg(w);
        const slotCode = slotCodeFromKey(w.key, direction);
        const hasChildBloom = (childrenByParentKey.get(w.key) || []).length > 0;

        // Local fan angle centered on bloomAngleDeg:
        // Spread children symmetrically, capped so tips stay inside their sub-sector.
        const localOffset =
          n === 1
            ? isAncestors
              ? slotCode === 'M'
                ? -Math.min(26, maxLocalSpread * 0.55)
                : Math.min(26, maxLocalSpread * 0.55)
              : 0
            : -maxLocalSpread + (2 * maxLocalSpread * i) / (n - 1);

        const jitter = seededJitterDeg(w.person.id, Math.min(2.0, sec.span * 0.08));
        let angleDeg = r2(bloomAngleDeg + localOffset + jitter);

        let { len, halfW } = computePetalSize(
          gen,
          w.isSibling,
          neighborStepDeg,
          maxPetalAllowance,
        );

        // Verify the petal's tip stays inside its sub-sector [sec.a0, sec.a1] so any
        // deeper stem sprouted from this tip can NEVER cross a sibling or cousin stem.
        let tipPt = upPolar(bloom.x, bloom.y, len, angleDeg);
        let tipPol = toHubPolar(tipPt.x, tipPt.y);
        const secMargin = Math.min(1.2, sec.span * 0.1);
        const minSec = sec.a0 + secMargin;
        const maxSec = sec.a1 - secMargin;
        if (tipPol.angleDeg < minSec || tipPol.angleDeg > maxSec) {
          // Aim directly toward a point at radius (R + len * 0.85) on the sub-sector midpoint.
          const targetPt = upPolar(GARDEN_HUB.x, GARDEN_HUB.y, Math.min(442, R + len * 0.85), sec.mid);
          angleDeg = r2(Math.atan2(targetPt.x - bloom.x, bloom.y - targetPt.y) * RAD_TO_DEG);
          tipPt = upPolar(bloom.x, bloom.y, len, angleDeg);
          tipPol = toHubPolar(tipPt.x, tipPt.y);
        }

        // Keep sprouted petal tips safely inside the next generation's ring so stems
        // always grow gracefully outward to their child bloom.
        if (hasChildBloom && nextRingR && tipPol.r > nextRingR - 14) {
          const trimRatio = Math.max(0.55, (nextRingR - 14 - R) / Math.max(1, tipPol.r - R));
          const trimmedLen = r2(Math.max(30, len * trimRatio));
          if (trimmedLen < len) {
            len = trimmedLen;
            halfW = r2(Math.min(halfW, Math.max(15, (0.63 * len) * Math.sin((Math.max(18, Math.min(96, neighborStepDeg)) * DEG_TO_RAD) / 2) * 0.94)));
            tipPt = upPolar(bloom.x, bloom.y, len, angleDeg);
          }
        }

        const labelPt = upPolar(bloom.x, bloom.y, opticalLabelRadius(len, bloomR), angleDeg);

        const petal = {
          key: w.key,
          personId: w.person.id,
          person: w.person,
          generation: gen,
          side: w.lineageSide,
          cx: bloom.x,
          cy: bloom.y,
          baseR: bloomR,
          angleDeg,
          len,
          halfW,
          pathD: petalPathD(len, halfW),
          veinD: petalVeinD(len),
          labelX: labelPt.x,
          labelY: labelPt.y,
          tipX: tipPt.x,
          tipY: tipPt.y,
          isSibling: Boolean(w.isSibling),
          siblingAnchorKey: findSiblingAnchorKey(w),
          slot: slotCode,
          trail: w.trail,
          hasMore: Boolean(w.hasMore),
          isSprouted: hasChildBloom,
          canExpandSiblings: Boolean(isAncestors && !w.isSibling && getSiblings(w.person.id, people).length > 0),
          relLabel: relationLabel(gen, direction, w.lineageSide, w.isSibling, slotCode),
          _sector: sec,
        };

        petals.push(petal);
        petalByKey.set(petal.key, petal);
      }
    }
  }

  // ── 3. EMPTY PARENT BUDS FOR GEN >= 2 ───────────────────────────────────────
  for (const [parentKey, emptyGroup] of emptyByParentKey.entries()) {
    if (parentKey === null) continue;
    const parentPetal = petalByKey.get(parentKey);
    if (!parentPetal) continue;
    const existingBloom = bloomByParentKey.get(parentKey) || null;

    for (const w of emptyGroup) {
      const gen = w.generation;
      const parentName = people[w.parentChildId]?.name || 'person';
      const sec = wedgeSectorDeg(w);
      let cx, cy, angleDeg, dist;

      if (existingBloom) {
        cx = existingBloom.x;
        cy = existingBloom.y;
        const baseOff = w.slot === 'mother' ? -28 : 28;
        angleDeg = r2(parentPetal._sector.mid + baseOff);
        dist = Math.min(52, Math.max(26, 430 - toHubPolar(cx, cy).r));
      } else {
        // Attach neatly off the parent petal's tip so no empty orphan seed-head floats.
        cx = parentPetal.tipX;
        cy = parentPetal.tipY;
        const baseOff = w.slot === 'mother' ? -22 : 22;
        angleDeg = r2(parentPetal.angleDeg + baseOff);
        dist = Math.min(40, Math.max(22, 430 - toHubPolar(cx, cy).r));
      }

      let budPt = upPolar(cx, cy, dist, angleDeg);
      // Clamp within GARDEN_BOUNDS
      budPt = {
        x: r2(Math.max(GARDEN_BOUNDS.minX + 12, Math.min(GARDEN_BOUNDS.maxX - 12, budPt.x))),
        y: r2(Math.max(GARDEN_BOUNDS.minY + 12, Math.min(GARDEN_BOUNDS.maxY - 12, budPt.y))),
      };

      buds.push({
        key: `empty:${w.key.replace(/:empty$/, '')}`,
        slot: w.slot,
        childId: w.parentChildId,
        cx: r2(cx),
        cy: r2(cy),
        x: budPt.x,
        y: budPt.y,
        stemD: buildTwigD(cx, cy, budPt.x, budPt.y),
        angleDeg,
        generation: gen,
        side: w.lineageSide,
        label: gen <= 2 ? (w.slot === 'mother' ? '+ Mother' : '+ Father') : '+',
        ariaLabel: `Add ${w.slot} for ${parentName}`,
      });
    }
  }

  // ── 4. COMPANION SPOUSE LEAF-BLOOMS ON LOWER MAIN STEM ──────────────────────
  const spouseRecords = getSpouses(centerId, people).slice(0, 6);
  const spouses = spouseRecords.map((spouse, i) => {
    const rightSide = i % 2 === 0;
    const row = Math.floor(i / 2);
    const cx = GARDEN_HUB.x;
    const cy = r2(552 + row * 11);
    const angleDeg = r2((rightSide ? 1 : -1) * (98 + row * 2.5));
    const len = r2(Math.max(88, 108 - row * 8));
    const halfW = r2(Math.max(26, 36 - row * 4));
    const baseR = 5;
    const labelPt = upPolar(cx, cy, opticalLabelRadius(len, baseR), angleDeg);
    return {
      key: `spouse:${spouse.id}`,
      personId: spouse.id,
      person: spouse,
      cx,
      cy,
      baseR,
      angleDeg,
      len,
      halfW,
      pathD: petalPathD(len, halfW),
      veinD: petalVeinD(len),
      labelX: labelPt.x,
      labelY: labelPt.y,
      relLabel: 'Spouse',
    };
  });

  // ── 5. MAIN LOWER STEM & GROUND LEAVES ──────────────────────────────────────
  const mainStem = {
    d: 'M 500,598 C 494,568 506,532 500,500',
    leaves: [
      { x: 498, y: 582, angleDeg: -66, len: 34, width: 14 },
      { x: 502, y: 576, angleDeg: 66, len: 32, width: 13 },
    ],
  };

  // Strip internal _sector helper from public petal objects and compute tight bounds.
  let minX = GARDEN_HUB.x - GARDEN_HUB.r;
  let maxX = GARDEN_HUB.x + GARDEN_HUB.r;
  let minY = GARDEN_HUB.y - GARDEN_HUB.r;
  let maxY = 598;

  const includePt = (x, y, pad = 0) => {
    if (x - pad < minX) minX = x - pad;
    if (x + pad > maxX) maxX = x + pad;
    if (y - pad < minY) minY = y - pad;
    if (y + pad > maxY) maxY = y + pad;
  };

  for (const b of blooms) includePt(b.x, b.y, b.r);
  for (const p of petals) {
    delete p._sector;
    includePt(p.cx, p.cy);
    includePt(p.tipX, p.tipY);
    includePt(p.labelX, p.labelY, p.halfW);
  }
  for (const s of spouses) {
    const tip = upPolar(s.cx, s.cy, s.len, s.angleDeg);
    includePt(tip.x, tip.y);
    includePt(s.labelX, s.labelY, s.halfW * 0.6);
  }
  for (const bud of buds) includePt(bud.x, bud.y, 10);

  const showSides = isAncestors && (petals.length > 0 || buds.length > 0);
  const sideLabels = {
    maternal: { x: 112, y: 472, visible: showSides },
    paternal: { x: 888, y: 472, visible: showSides },
  };

  return {
    hub,
    blooms,
    stems,
    petals,
    spouses,
    buds,
    mainStem,
    maxGen,
    hasSiblings: petals.some((p) => p.isSibling),
    sideLabels,
    bounds: {
      minX: r2(minX),
      maxX: r2(maxX),
      minY: r2(minY),
      maxY: r2(maxY),
    },
  };
}

module.exports = {
  GARDEN_WORLD,
  GARDEN_HUB,
  GARDEN_BOUNDS,
  buildGarden,
};
