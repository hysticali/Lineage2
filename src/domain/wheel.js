// ─── GEOMETRY ─────────────────────────────────────────────────────────────────
const SIZE = 1000,
  CX = SIZE / 2,
  CY = SIZE / 2,
  CENTER_R = 80,
  MAX_GEN = 6;
const RW = 58; // ring width: 80 + 6 * 58 = 428, leaving a 72px safety margin
const FAN_SWEEP = Math.PI;
const ROOT_BRANCH_GAP = (8 * Math.PI) / 180;
const MAX_WEDGE = (2 * Math.PI) / 5; // no single wedge may exceed 1/5 of the full circle

function polar(cx, cy, r, a) {
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function wedgePath(cx, cy, r0, r1, a0, a1) {
  const p0 = polar(cx, cy, r0, a0),
    p1 = polar(cx, cy, r1, a0),
    p2 = polar(cx, cy, r1, a1),
    p3 = polar(cx, cy, r0, a1);
  const la = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p0.x} ${p0.y} L${p1.x} ${p1.y} A${r1} ${r1} 0 ${la} 1 ${p2.x} ${p2.y} L${p3.x} ${p3.y} A${r0} ${r0} 0 ${la} 0 ${p0.x} ${p0.y} Z`;
}

function genColor(gen) {
  return [
    "hsl(284,84%,66%)",
    "hsl(248,84%,68%)",
    "hsl(214,90%,64%)",
    "hsl(188,82%,56%)",
    "hsl(164,72%,50%)",
    "hsl(118,62%,55%)",
    "hsl(58,88%,62%)",
    "hsl(34,92%,61%)",
    "hsl(14,88%,62%)",
    "hsl(342,82%,65%)",
    "hsl(312,78%,66%)",
  ][Math.min(gen, 10)];
}

const { getSiblings, getChildren, getSpouses, getSpouse } = require('./graph');

function fanGeometry() {
  const fullCircle = false;
  const sweep = FAN_SWEEP;
  const startAngle = (3 * Math.PI) / 2 - sweep / 2;
  return { fullCircle, sweep, startAngle };
}

function insetAngles(a0, a1) {
  const childGap = Math.min(
    (6 * Math.PI) / 180,
    ((a1 - a0) * 0.18) / 2,
  );
  return { ca0: a0 + childGap, ca1: a1 - childGap };
}

// ─── WHEEL BUILDER ────────────────────────────────────────────────────────────
/**
 * Constructs the wedges for the Ancestor Wheel.
 * Calculates the geometry (inner/outer radius, start/end angle) for each ancestor,
 * proportionally sizing wedges based on the number of known leaf ancestors they have.
 *
 * @param {string} centerId - The ID of the person at the center of the wheel.
 * @param {Object} family - The family dataset mapping IDs to person objects.
 * @param {Set<string>} expanded - Set of person IDs whose ancestry is expanded.
 * @param {string|null} sibAnchorPid - ID of the sibling group anchor.
 * @param {string|null} dominantSibId - ID of the selected sibling to emphasize.
 * @returns {Object} An object containing the generated `wedges` array and `fullCircle` boolean.
 */
// sibAnchorPid: whose siblings to show (independent of card selection)
function buildWheel(
  centerId,
  family,
  expanded,
  sibAnchorPid,
  dominantSibId,
) {
  const wedges = [];
  const showSibs = sibAnchorPid ? new Set([sibAnchorPid]) : new Set();

  function ownLeaves(pid, gen) {
    if (gen > MAX_GEN || !pid) return 1;
    const p = family[pid];
    if (!p) return 1;
    if (gen >= 2 && !expanded.has(pid)) return 1;
    return (
      ownLeaves(p.motherId, gen + 1) + ownLeaves(p.fatherId, gen + 1)
    );
  }

  function allocSlots(pid, gen) {
    const own = ownLeaves(pid, gen);
    if (!pid || !showSibs.has(pid)) return own;
    return own + getSiblings(pid, family).length;
  }

  const cp = family[centerId] || {};
  const ms0 = allocSlots(cp.motherId, 1);
  const fs0 = allocSlots(cp.fatherId, 1);
  const totalRoot = ms0 + fs0;

  // Fan is a 180 degree arc centered on the 12 o'clock line.
  // CY never changes — the container clips/reveals the bottom arc.
  const { fullCircle, sweep, startAngle } = fanGeometry();

  function build(pid, gen, a0, a1) {
    if (gen < 1 || gen > MAX_GEN) return;
    const p = pid ? family[pid] : null;
    const r0 = CENTER_R + (gen - 1) * RW,
      r1 = CENTER_R + gen * RW;

    let group;
    if (pid && showSibs.has(pid)) {
      const sibs = getSiblings(pid, family);
      const all = [...sibs, p].sort(
        (a, b) =>
          (parseInt(a?.birth) || 9999) - (parseInt(b?.birth) || 9999),
      );
      group = all.map((m) => ({
        pid: m.id,
        isSelf: m.id === pid,
        leaves: m.id === pid ? ownLeaves(pid, gen) : 1,
      }));
    } else {
      group = [{ pid, isSelf: true, leaves: ownLeaves(pid, gen) }];
    }

    // Guarantee the dominant sibling has strictly more leaves than any other member
    if (dominantSibId) {
      const maxOther = group
        .filter((g) => g.pid !== dominantSibId)
        .reduce((m, g) => Math.max(m, g.leaves), 0);
      group = group.map((g) =>
        g.pid === dominantSibId
          ? { ...g, leaves: Math.max(g.leaves, maxOther + 1) }
          : g,
      );
    }

    // Scale all widths so the largest wedge = MAX_WEDGE; leftover arc stays empty
    const totalAngle = a1 - a0;
    const sumL = group.reduce((s, g) => s + g.leaves, 0);
    let widths = group.map((g) => (totalAngle * g.leaves) / sumL);
    const maxW = Math.max(...widths);
    if (group.length > 1 && maxW > MAX_WEDGE) {
      const scale = MAX_WEDGE / maxW;
      widths = widths.map((w) => w * scale);
    }

    let cursor = a0;
    let gi = 0;

    for (const g of group) {
      const gw = widths[gi++];
      const ga0 = cursor,
        ga1 = cursor + gw;
      cursor = ga1;
      const gp = g.pid ? family[g.pid] : null;
      const mid = (ga0 + ga1) / 2;
      const lp = polar(CX, CY, (r0 + r1) / 2, mid);

      wedges.push({
        person: gp,
        generation: gen,
        startAngle: ga0,
        endAngle: ga1,
        innerRadius: r0,
        outerRadius: r1,
        path: wedgePath(CX, CY, r0, r1, ga0, ga1),
        labelPos: { x: lp.x, y: lp.y },
        key: `${g.pid || "empty"}:${gen}:${ga0}:${ga1}`,
        isSibling: !g.isSelf,
      });

      if (g.isSelf) {
        const shouldExpand = gen < 2 || (p && expanded.has(pid));
        if (shouldExpand) {
          const ms = allocSlots(p?.motherId, gen + 1);
          const fs = allocSlots(p?.fatherId, gen + 1);
          const tot = ms + fs;
          if (tot > 0) {
            const { ca0, ca1 } = insetAngles(ga0, ga1);
            const mw = ((ca1 - ca0) * ms) / tot;
            build(p?.motherId, gen + 1, ca0, ca0 + mw);
            build(p?.fatherId, gen + 1, ca0 + mw, ca1);
          }
        }
      }
    }
  }

  const rootHasSiblingFan =
    showSibs.has(cp.motherId) || showSibs.has(cp.fatherId);
  const rootGap = ms0 > 0 && fs0 > 0 && rootHasSiblingFan ? ROOT_BRANCH_GAP : 0;
  const usableSweep = sweep - rootGap;
  const mw = (usableSweep * ms0) / totalRoot;
  build(cp.motherId, 1, startAngle, startAngle + mw);
  build(cp.fatherId, 1, startAngle + mw + rootGap, startAngle + sweep);

  return { wedges, fullCircle };
}

/**
 * Constructs the wedges for the Descendant Wheel.
 * Iterates through children and further descendants, calculating fan wedges
 * starting from the center outward.
 *
 * @param {string} centerId - The ID of the person at the center of the wheel.
 * @param {Object} family - The family dataset mapping IDs to person objects.
 * @param {Set<string>} expanded - Set of person IDs whose descendants are expanded.
 * @returns {Object} An object containing the generated `wedges` array and `fullCircle` boolean.
 */
function buildDescendantWheel(centerId, family, expanded) {
  const wedges = [];

  function ownLeaves(pid, gen) {
    if (gen > MAX_GEN || !pid) return 1;
    const children = getChildren(pid, family);
    if (children.length === 0) return 1;
    if (gen >= 2 && !expanded.has(pid)) return 1;
    return children.reduce(
      (sum, child) => sum + ownLeaves(child.id, gen + 1),
      0,
    );
  }

  function build(pid, gen, a0, a1) {
    if (gen < 1 || gen > MAX_GEN || !pid) return;
    const children = getChildren(pid, family);
    if (children.length === 0) return;

    const r0 = CENTER_R + (gen - 1) * RW,
      r1 = CENTER_R + gen * RW;
    const totalLeaves = children.reduce(
      (sum, child) => sum + ownLeaves(child.id, gen),
      0,
    );
    let cursor = a0;

    for (const child of children) {
      const leaves = ownLeaves(child.id, gen);
      const gw = ((a1 - a0) * leaves) / totalLeaves;
      const ga0 = cursor,
        ga1 = cursor + gw;
      cursor = ga1;
      const mid = (ga0 + ga1) / 2;
      const lp = polar(CX, CY, (r0 + r1) / 2, mid);

      wedges.push({
        person: child,
        generation: gen,
        startAngle: ga0,
        endAngle: ga1,
        innerRadius: r0,
        outerRadius: r1,
        path: wedgePath(CX, CY, r0, r1, ga0, ga1),
        labelPos: { x: lp.x, y: lp.y },
        key: `${child.id}:${gen}:${ga0}:${ga1}`,
        isSibling: false,
      });

      if (gen < 2 || expanded.has(child.id)) {
        const { ca0, ca1 } = insetAngles(ga0, ga1);
        build(child.id, gen + 1, ca0, ca1);
      }
    }
  }

  const children = getChildren(centerId, family);
  const { fullCircle, sweep, startAngle } = fanGeometry();

  if (children.length > 0) {
    build(centerId, 1, startAngle, startAngle + sweep);
  }

  return { wedges, fullCircle };
}

// ─── ICONS ────────────────────────────────────────────────────────────────────

module.exports = { SIZE, CX, CY, CENTER_R, MAX_GEN, RW, polar, wedgePath, genColor, getSiblings, getChildren, getSpouses, getSpouse, fanGeometry, insetAngles, buildWheel, buildDescendantWheel };
