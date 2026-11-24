const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rootId, family } = require('../../family-data.json');
const { buildWheel, buildDescendantWheel } = require('../../src/domain/wheel');
const {
  GARDEN_WORLD,
  GARDEN_HUB,
  GARDEN_BOUNDS,
  buildGarden,
} = require('../../src/domain/garden');

// Parse a stem's "M x,y C ... [C ...]" SVG path into sampled points for crossing checks.
function sampleStemPath(d, stepsPerCubic = 16) {
  const nums = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const pts = [{ x: nums[0], y: nums[1] }];
  let x0 = nums[0], y0 = nums[1];
  for (let i = 2; i + 5 < nums.length; i += 6) {
    const [c1x, c1y, c2x, c2y, x1, y1] = nums.slice(i, i + 6);
    for (let s = 1; s <= stepsPerCubic; s++) {
      const t = s / stepsPerCubic;
      const u = 1 - t;
      const x = u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x1;
      const y = u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y1;
      pts.push({ x, y });
    }
    x0 = x1;
    y0 = y1;
  }
  return pts;
}

function segmentsIntersect(a, b, c, d) {
  const ccw = (p1, p2, p3) => (p3.y - p1.y) * (p2.x - p1.x) - (p2.y - p1.y) * (p3.x - p1.x);
  const eps = 1e-6;
  const d1 = ccw(a, b, c);
  const d2 = ccw(a, b, d);
  const d3 = ccw(c, d, a);
  const d4 = ccw(c, d, b);
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
         ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps));
}

function assertGeometricInvariants(garden, label) {
  // 1. Bounds check
  assert.ok(garden.bounds.minX >= GARDEN_BOUNDS.minX, `${label}: minX ${garden.bounds.minX} < ${GARDEN_BOUNDS.minX}`);
  assert.ok(garden.bounds.maxX <= GARDEN_BOUNDS.maxX, `${label}: maxX ${garden.bounds.maxX} > ${GARDEN_BOUNDS.maxX}`);
  assert.ok(garden.bounds.minY >= GARDEN_BOUNDS.minY, `${label}: minY ${garden.bounds.minY} < ${GARDEN_BOUNDS.minY}`);
  assert.ok(garden.bounds.maxY <= GARDEN_BOUNDS.maxY, `${label}: maxY ${garden.bounds.maxY} > ${GARDEN_BOUNDS.maxY}`);

  for (const b of garden.blooms) {
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y) && b.r > 0, `${label}: bloom ${b.key} finite`);
    assert.ok(b.x - b.r >= GARDEN_BOUNDS.minX && b.x + b.r <= GARDEN_BOUNDS.maxX, `${label}: bloom ${b.key} X in bounds`);
    assert.ok(b.y - b.r >= GARDEN_BOUNDS.minY && b.y + b.r <= GARDEN_BOUNDS.maxY, `${label}: bloom ${b.key} Y in bounds`);
  }

  for (const p of garden.petals) {
    assert.ok(p.tipX >= GARDEN_BOUNDS.minX && p.tipX <= GARDEN_BOUNDS.maxX, `${label}: petal ${p.key} tipX in bounds`);
    assert.ok(p.tipY >= GARDEN_BOUNDS.minY && p.tipY <= GARDEN_BOUNDS.maxY, `${label}: petal ${p.key} tipY in bounds`);
    assert.ok(p.pathD.startsWith('M 0,0 C '), `${label}: petal ${p.key} local cubic Bezier path`);
    assert.ok(p.veinD.startsWith('M 0,'), `${label}: petal ${p.key} local vein path`);
  }

  for (const bud of garden.buds) {
    assert.ok(bud.x >= GARDEN_BOUNDS.minX && bud.x <= GARDEN_BOUNDS.maxX, `${label}: bud ${bud.key} X in bounds`);
    assert.ok(bud.y >= GARDEN_BOUNDS.minY && bud.y <= GARDEN_BOUNDS.maxY, `${label}: bud ${bud.key} Y in bounds`);
    assert.ok(bud.slot === 'mother' || bud.slot === 'father', `${label}: bud slot valid`);
    assert.ok(Boolean(bud.childId), `${label}: bud childId present`);
  }

  // 2. Pairwise bloom non-overlap
  for (let i = 0; i < garden.blooms.length; i++) {
    for (let j = i + 1; j < garden.blooms.length; j++) {
      const a = garden.blooms[i];
      const b = garden.blooms[j];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      assert.ok(
        dist > a.r + b.r,
        `${label}: bloom collision between ${a.key} and ${b.key} (dist=${dist.toFixed(2)}, rSum=${(a.r + b.r).toFixed(2)})`,
      );
    }
  }

  // 3. Zero stem crossings
  const sampled = garden.stems.map((s) => ({ id: s.id, pts: sampleStemPath(s.d) }));
  for (let i = 0; i < sampled.length; i++) {
    for (let j = i + 1; j < sampled.length; j++) {
      const A = sampled[i].pts;
      const B = sampled[j].pts;
      for (let ai = 0; ai < A.length - 1; ai++) {
        for (let bi = 0; bi < B.length - 1; bi++) {
          assert.equal(
            segmentsIntersect(A[ai], A[ai + 1], B[bi], B[bi + 1]),
            false,
            `${label}: stem crossing between ${sampled[i].id} and ${sampled[j].id}`,
          );
        }
      }
    }
  }
}

test('exports constants and builds default Gen 1+2 ancestors garden for family-data.json', () => {
  assert.equal(GARDEN_WORLD, 1000);
  assert.deepEqual(GARDEN_HUB, { x: 500, y: 500, r: 48 });
  assert.deepEqual(GARDEN_BOUNDS, { minX: 35, maxX: 965, minY: 45, maxY: 605 });

  const g = buildGarden(rootId, family, new Set(), { direction: 'ancestors', canEdit: true });
  assert.equal(g.hub.personId, rootId);
  assert.equal(g.hub.name, 'Aria Hartwell');
  assert.equal(g.hub.initials, 'AH');
  assert.equal(g.hub.lifespan, 'b. 1995');

  // Gen 1 Mother & Father + Gen 2 grandparents already sprouted by default
  const gen1 = g.petals.filter((p) => p.generation === 1);
  const gen2 = g.petals.filter((p) => p.generation === 2);
  assert.equal(gen1.length, 2);
  assert.equal(gen2.length, 4);
  assert.equal(g.blooms.length, 2);
  assert.equal(g.stems.length, 2);
  assert.equal(g.maxGen, 2);
  assert.equal(g.hasSiblings, false);
  assert.equal(g.spouses.length, 1);
  assert.equal(g.spouses[0].personId, 'dylan');
  assert.ok(g.spouses[0].labelY > 530 && g.spouses[0].labelY < 600);
  assert.equal(g.sideLabels.maternal.visible, true);
  assert.equal(g.sideLabels.paternal.visible, true);
  assert.ok(g.mainStem.d.includes('500,598'));
  assert.equal(g.mainStem.leaves.length, 2);

  // Gen 1 petals are marked sprouted and have left/right mother/father angles
  const mom = gen1.find((p) => p.side === 'maternal');
  const dad = gen1.find((p) => p.side === 'paternal');
  assert.ok(mom.angleDeg < -20 && mom.angleDeg > -50);
  assert.ok(dad.angleDeg > 20 && dad.angleDeg < 50);
  assert.equal(mom.isSprouted, true);
  assert.equal(dad.isSprouted, true);
  assert.equal(mom.canExpandSiblings, true);
  assert.equal(dad.canExpandSiblings, true);

  assertGeometricInvariants(g, 'default-ancestors');
});

test('key and trail parity with buildWheel and buildDescendantWheel', () => {
  const expanded = new Set(['clara', 'robert']);
  const wheelAnc = buildWheel(rootId, family, expanded, 'elena', null).wedges.filter((w) => w.person);
  const gardenAnc = buildGarden(rootId, family, expanded, {
    direction: 'ancestors',
    sibAnchorPid: 'elena',
    canEdit: true,
  });

  assert.deepEqual(
    gardenAnc.petals.map((p) => p.key).sort(),
    wheelAnc.map((w) => w.key).sort(),
  );
  for (const w of wheelAnc) {
    const p = gardenAnc.petals.find((x) => x.key === w.key);
    assert.ok(p);
    assert.deepEqual(p.trail, w.trail);
    assert.equal(p.isSibling, w.isSibling);
    assert.equal(p.hasMore, w.hasMore);
  }
  assert.equal(gardenAnc.hasSiblings, true);
  assertGeometricInvariants(gardenAnc, 'expanded-siblings-ancestors');

  const wheelDesc = buildDescendantWheel(rootId, family, new Set()).wedges.filter((w) => w.person);
  const gardenDesc = buildGarden(rootId, family, new Set(), { direction: 'descendants' });
  assert.deepEqual(
    gardenDesc.petals.map((p) => p.key).sort(),
    wheelDesc.map((w) => w.key).sort(),
  );
  assert.equal(gardenDesc.sideLabels.maternal.visible, false);
  assertGeometricInvariants(gardenDesc, 'default-descendants');
});

test('stress test: all ancestors and all descendants expanded to MAX_GEN have zero collisions and zero crossings', () => {
  const allIds = new Set(Object.keys(family));

  const fullAnc = buildGarden(rootId, family, allIds, {
    direction: 'ancestors',
    canEdit: true,
  });
  assert.ok(fullAnc.maxGen >= 4, `expected deep ancestors, got maxGen=${fullAnc.maxGen}`);
  assert.ok(fullAnc.blooms.length >= 4);
  assertGeometricInvariants(fullAnc, 'all-expanded-ancestors');

  const fullAncSibs = buildGarden(rootId, family, allIds, {
    direction: 'ancestors',
    sibAnchorPid: 'marcus',
    canEdit: true,
  });
  assert.equal(fullAncSibs.hasSiblings, true);
  assertGeometricInvariants(fullAncSibs, 'all-expanded-ancestors-with-sibs');

  // Find oldest ancestor with descendants to stress-test deep descendant tree
  const oldest = Object.values(family).find((p) => !p.motherId && !p.fatherId);
  const fullDesc = buildGarden(oldest.id, family, allIds, { direction: 'descendants' });
  assert.ok(fullDesc.petals.length >= 3);
  assertGeometricInvariants(fullDesc, 'all-expanded-descendants');
});

test('deterministic output across repeated calls', () => {
  const expanded = new Set(['elena', 'marcus']);
  const opts = { direction: 'ancestors', sibAnchorPid: 'elena', canEdit: true };
  const a = buildGarden(rootId, family, expanded, opts);
  const b = buildGarden(rootId, family, expanded, opts);
  assert.deepEqual(a, b);
});

test('single-person tree renders golden hub + two unopened buds when canEdit is true', () => {
  const soloFamily = {
    solo: { id: 'solo', name: 'Jordan Rivera', birth: '1992' },
  };
  const editable = buildGarden('solo', soloFamily, new Set(), {
    direction: 'ancestors',
    canEdit: true,
  });
  assert.equal(editable.petals.length, 0);
  assert.equal(editable.blooms.length, 0);
  assert.equal(editable.stems.length, 0);
  assert.equal(editable.buds.length, 2);
  assert.deepEqual(editable.buds.map((b) => b.slot).sort(), ['father', 'mother']);
  assert.ok(editable.buds.every((b) => b.childId === 'solo'));
  assert.ok(editable.buds.some((b) => b.label === '+ Mother'));
  assert.ok(editable.buds.some((b) => b.label === '+ Father'));
  assertGeometricInvariants(editable, 'single-person-editable');

  const readOnly = buildGarden('solo', soloFamily, new Set(), {
    direction: 'ancestors',
    canEdit: false,
  });
  assert.equal(readOnly.buds.length, 0);
  assertGeometricInvariants(readOnly, 'single-person-readonly');
});
