import React from "react";
import { createPortal } from "react-dom";
import gardenModel from "../src/domain/garden";
import format from "./format";
import { ChartHudContext } from "./ChartViewport";

const { GARDEN_WORLD = 1000, buildGarden } = gardenModel;
const { getInitials, splitDisplayName, truncateLabel, formatLifespan, generationLabel } = format;

function petalColorVar(generation) {
  const g = Math.max(1, Math.min(6, Number(generation) || 1));
  return `var(--garden-g${g})`;
}

function leafPathD(len, width) {
  const l = Math.max(8, len || 18);
  const hw = Math.max(3, (width || 10) * 0.52);
  return `M 0,0 C ${-hw},${(-l * 0.34).toFixed(2)} ${(-hw * 0.85).toFixed(2)},${(-l * 0.76).toFixed(2)} 0,${(-l).toFixed(2)} C ${(hw * 0.85).toFixed(2)},${(-l * 0.76).toFixed(2)} ${hw},${(-l * 0.34).toFixed(2)} 0,0 Z`;
}

function budPathD(r) {
  const w = r * 0.72;
  const h = r * 1.9;
  return `M 0,${(r * 0.35).toFixed(2)} C ${(-w * 1.08).toFixed(2)},${(-r * 0.15).toFixed(2)} ${(-w * 0.92).toFixed(2)},${(-h * 0.65).toFixed(2)} 0,${(-h).toFixed(2)} C ${(w * 0.92).toFixed(2)},${(-h * 0.65).toFixed(2)} ${(w * 1.08).toFixed(2)},${(-r * 0.15).toFixed(2)} 0,${(r * 0.35).toFixed(2)} Z`;
}

function budSepalD(r, side) {
  const s = side < 0 ? -1 : 1;
  return `M 0,${(r * 0.42).toFixed(2)} C ${(s * r * 0.68).toFixed(2)},${(r * 0.25).toFixed(2)} ${(s * r * 0.88).toFixed(2)},${(-r * 0.28).toFixed(2)} ${(s * r * 0.54).toFixed(2)},${(-r * 0.68).toFixed(2)} C ${(s * r * 0.32).toFixed(2)},${(-r * 0.22).toFixed(2)} ${(s * r * 0.18).toFixed(2)},${(r * 0.12).toFixed(2)} 0,${(r * 0.42).toFixed(2)} Z`;
}

function stemStrokeWidth(generation) {
  if (generation <= 2) return 3.6;
  if (generation === 3) return 2.8;
  if (generation === 4) return 2.2;
  return 1.75;
}

function charWidthEm(ch) {
  if ("ijlI|!.,:;'` ".includes(ch)) return 0.3;
  if ("ftJr()[]{}\"-".includes(ch)) return 0.39;
  if ("mwMW@".includes(ch)) return 0.86;
  if (ch === "…") return 0.82;
  if (ch >= "A" && ch <= "Z") return 0.68;
  if (ch >= "0" && ch <= "9") return 0.56;
  return 0.55;
}

function estimateTextWidthPx(text, fontSize, weight = 600) {
  const s = String(text || "");
  let em = 0;
  for (let i = 0; i < s.length; i += 1) {
    em += charWidthEm(s[i]);
  }
  const weightMul = weight >= 700 ? 1.04 : weight >= 600 ? 1 : 0.96;
  return em * fontSize * weightMul;
}

function fitLineToWidth(text, availW, maxFontSize, minFontSize, weight) {
  const clean = String(text || "").trim();
  if (!clean) return { text: "", fontSize: maxFontSize, truncated: false };
  const fullW = estimateTextWidthPx(clean, maxFontSize, weight);
  if (fullW <= availW) {
    return { text: clean, fontSize: maxFontSize, truncated: false };
  }
  const neededSize = maxFontSize * (availW / fullW);
  if (neededSize >= minFontSize) {
    return {
      text: clean,
      fontSize: Math.round(neededSize * 2) / 2,
      truncated: false,
    };
  }
  let cut = clean.length - 1;
  while (
    cut > 1 &&
    estimateTextWidthPx(`${clean.slice(0, cut).trimEnd()}…`, minFontSize, weight) > availW
  ) {
    cut -= 1;
  }
  const clipped = `${clean.slice(0, Math.max(1, cut)).trimEnd()}…`;
  return { text: clipped, fontSize: minFontSize, truncated: true, keptChars: Math.max(1, cut) };
}

function petalBellyMetrics(petal, scale = 1) {
  const halfW = (petal.halfW || 24) * scale;
  const len = (petal.len || 60) * scale;
  const baseR =
    typeof petal.baseR === "number"
      ? petal.baseR
      : petal.generation === 1
        ? 48
        : petal.generation === 2
          ? 14.5
          : 10;
  const visLen = Math.max(24, len - baseR);
  // Safe inscribed ellipse inside the fuller obovate magnolia petal belly (>= 1.88 * halfW)
  // so labels fit cleanly at 100% zoom with comfortable inner margin on all OS fonts.
  const a = halfW * 0.86;
  const b = visLen * 0.44;
  const rad = ((petal.angleDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const centerW = 2 / Math.hypot(cos / a, sin / b);
  const vertH = Math.hypot(a * sin, b * cos);

  function availWAtOffset(dy) {
    if (dy <= 0) return Math.max(14, centerW * 0.94);
    if (vertH <= dy + 2) return 0;
    const ratio = Math.sqrt(Math.max(0, 1 - (dy / vertH) ** 2));
    return Math.max(0, centerW * ratio * 0.94);
  }

  return { halfW, len, visLen, centerW, vertH, availWAtOffset };
}

function computePetalLabelLayout(petal, opts = {}) {
  const scale = opts.scale || 1;
  const showLifespan = Boolean(opts.showLifespan);
  const name = petal.person?.name || "";
  const { first, rest } = splitDisplayName(name);
  const lifespan = showLifespan ? formatLifespan(petal.person?.birth, petal.person?.death) : "";
  const { halfW, len, vertH, availWAtOffset } = petalBellyMetrics(petal, scale);
  const avail1 = availWAtOffset(0);

  // Tiny outer petals: crisp 2-letter initials
  if (halfW < 14 || len < 36 || avail1 < 25) {
    return {
      mode: "initials",
      primary: getInitials(name),
      secondary: "",
      lifespan: "",
      primarySize: halfW < 12 ? 9 : 10,
      secondarySize: 0,
      lifespanSize: 0,
      isTruncated: true,
      showsFullWithLife: false,
    };
  }

  const sizeBoost = scale > 1 ? 1.07 : 1;
  let primaryMax;
  let primaryMin;
  let secondaryMax;
  let secondaryMin;

  if (petal.generation === 1 && !petal.isSibling) {
    primaryMax = 16 * sizeBoost;
    primaryMin = 13;
    secondaryMax = 12 * sizeBoost;
    secondaryMin = 10;
  } else if (petal.generation === 1 && petal.isSibling) {
    primaryMax = 13.5 * sizeBoost;
    primaryMin = 11;
    secondaryMax = 10.5 * sizeBoost;
    secondaryMin = 9;
  } else if (petal.generation === 2 && !petal.isSibling) {
    primaryMax = 14 * sizeBoost;
    primaryMin = 11.5;
    secondaryMax = 11 * sizeBoost;
    secondaryMin = 9.5;
  } else if (petal.generation === 2 && petal.isSibling) {
    primaryMax = 12 * sizeBoost;
    primaryMin = 10;
    secondaryMax = 9.5 * sizeBoost;
    secondaryMin = 8.5;
  } else if (petal.generation === 3) {
    primaryMax = 12 * sizeBoost;
    primaryMin = 10;
    secondaryMax = 10 * sizeBoost;
    secondaryMin = 8.5;
  } else {
    primaryMax = 11.5 * sizeBoost;
    primaryMin = 9.5;
    secondaryMax = 9.5 * sizeBoost;
    secondaryMin = 8.5;
  }

  primaryMax = Math.round(primaryMax * 2) / 2;
  secondaryMax = Math.round(secondaryMax * 2) / 2;

  const primaryWeight = petal.isSibling ? 600 : 700;
  const twoLineOffset = (primaryMax + secondaryMax) * 0.32;
  const avail2 = availWAtOffset(twoLineOffset);
  const canTwoLine = Boolean(rest && vertH >= (primaryMax + secondaryMax) * 0.56 && avail2 >= 30);

  if (canTwoLine) {
    const f1 = fitLineToWidth(first, avail2, primaryMax, primaryMin, primaryWeight);
    const f2 = fitLineToWidth(rest, avail2, secondaryMax, secondaryMin, 600);
    const isTruncated = f1.truncated || f2.truncated;

    if (showLifespan && lifespan && !isTruncated) {
      const lifeSize = 10;
      const threeLineOffset = (f1.fontSize + f2.fontSize + lifeSize) * 0.42;
      const avail3 = availWAtOffset(threeLineOffset);
      if (
        vertH >= (f1.fontSize + f2.fontSize + lifeSize) * 0.74 &&
        avail3 >= estimateTextWidthPx(lifespan, lifeSize, 500) + 4
      ) {
        return {
          mode: "three-line",
          primary: f1.text,
          secondary: f2.text,
          lifespan,
          primarySize: f1.fontSize,
          secondarySize: f2.fontSize,
          lifespanSize: lifeSize,
          isTruncated: false,
          showsFullWithLife: true,
        };
      }
    }

    return {
      mode: "two-line",
      primary: f1.text,
      secondary: f2.text,
      lifespan: "",
      primarySize: f1.fontSize,
      secondarySize: f2.fontSize,
      lifespanSize: 0,
      isTruncated,
      showsFullWithLife: !isTruncated && !lifespan,
    };
  }

  // Single-line first name (or initials if very cramped)
  const f1 = fitLineToWidth(first, avail1, primaryMax, primaryMin, primaryWeight);
  if (f1.truncated && (f1.keptChars || 0) < 3) {
    return {
      mode: "initials",
      primary: getInitials(name),
      secondary: "",
      lifespan: "",
      primarySize: 9.5,
      secondarySize: 0,
      lifespanSize: 0,
      isTruncated: true,
      showsFullWithLife: false,
    };
  }

  return {
    mode: "single",
    primary: f1.text,
    secondary: "",
    lifespan: "",
    primarySize: f1.fontSize,
    secondarySize: 0,
    lifespanSize: 0,
    isTruncated: Boolean(rest) || f1.truncated,
    showsFullWithLife: !rest && !f1.truncated && !lifespan,
  };
}

function computeSpouseLabelLayout(spouse, opts = {}) {
  const scale = opts.scale || 1;
  const name = spouse.person?.name || "Spouse";
  const { first, rest } = splitDisplayName(name);
  const { availWAtOffset } = petalBellyMetrics(
    { ...spouse, generation: 1, baseR: typeof spouse.baseR === "number" ? spouse.baseR : 10 },
    scale,
  );
  const primaryMax = scale > 1 ? 14 : 13;
  const secondaryMax = scale > 1 ? 11 : 10.5;
  const avail2 = Math.max(36, availWAtOffset(7));
  const f1 = fitLineToWidth(first, avail2, primaryMax, 11, 700);
  const secondWord = rest || "Spouse";
  const f2 = fitLineToWidth(secondWord, avail2, secondaryMax, 9, 600);
  return {
    mode: "two-line",
    primary: f1.text,
    secondary: f2.text,
    lifespan: "",
    primarySize: f1.fontSize,
    secondarySize: f2.fontSize,
    lifespanSize: 0,
    isTruncated: f1.truncated || (Boolean(rest) && f2.truncated),
    showsFullWithLife: false,
  };
}

function renderPetalLabelContent(x, y, label, isSibling = false) {
  if (label.mode === "three-line") {
    return (
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="var(--garden-petal-text)"
        className="garden-petal-label"
        style={{ pointerEvents: "none" }}
      >
        <tspan x={x} dy="-0.85em" fontSize={label.primarySize} fontWeight={700}>
          {label.primary}
        </tspan>
        <tspan x={x} dy="1.18em" fontSize={label.secondarySize} fontWeight={600} opacity={0.96}>
          {label.secondary}
        </tspan>
        <tspan x={x} dy="1.3em" fontSize={label.lifespanSize} fontWeight={500} opacity={0.9}>
          {label.lifespan}
        </tspan>
      </text>
    );
  }
  if (label.mode === "two-line") {
    return (
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="var(--garden-petal-text)"
        className="garden-petal-label"
        style={{ pointerEvents: "none" }}
      >
        <tspan
          x={x}
          dy="-0.34em"
          fontSize={label.primarySize}
          fontWeight={isSibling ? 600 : 700}
        >
          {label.primary}
        </tspan>
        <tspan x={x} dy="1.18em" fontSize={label.secondarySize} fontWeight={600} opacity={0.96}>
          {label.secondary}
        </tspan>
      </text>
    );
  }
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      dominantBaseline="middle"
      fill="var(--garden-petal-text)"
      className="garden-petal-label"
      style={{ pointerEvents: "none" }}
    >
      <tspan
        x={x}
        dy="0.04em"
        fontSize={label.primarySize}
        fontWeight={label.mode === "initials" ? 700 : 700}
      >
        {label.primary}
      </tspan>
    </text>
  );
}

function rectCircleOverlapDepth(rx0, ry0, rx1, ry1, cx, cy, r) {
  const closestX = Math.max(rx0, Math.min(cx, rx1));
  const closestY = Math.max(ry0, Math.min(cy, ry1));
  const dist = Math.hypot(cx - closestX, cy - closestY);
  return dist < r ? r - dist : 0;
}

function computeSpecimenTagLayout(target, kind, obstacles = {}) {
  const person = target?.person;
  if (!person) return null;
  const fullName = person.name || "Unknown";
  const life = formatLifespan(person.birth, person.death);
  const metaText =
    kind === "spouse"
      ? life
        ? `${life} · Spouse`
        : "Spouse"
      : life || target.relLabel || "";

  const nameSize = 12.5;
  const metaSize = 10.5;
  const nameW = estimateTextWidthPx(fullName, nameSize, 700);
  const metaW = metaText ? estimateTextWidthPx(metaText, metaSize, 600) : 0;

  const singleRowW = 24 + nameW + (metaText ? 14 + metaW : 0) + 18;
  const twoLine = Boolean(metaText && singleRowW > 300);
  const pillW = Math.min(
    370,
    Math.max(88, twoLine ? 26 + Math.max(nameW, metaW) + 18 : singleRowW),
  );
  const pillH = twoLine ? 40 : 28;

  const rad = ((target.angleDeg || 0) * Math.PI) / 180;
  const ux = Math.sin(rad);
  const uy = -Math.cos(rad);
  const expandScale = kind === "spouse" ? 1.1 : 1.12;
  const expLabelX = target.cx + (target.labelX - target.cx) * expandScale;
  const expLabelY = target.cy + (target.labelY - target.cy) * expandScale;
  const tipX =
    typeof target.tipX === "number"
      ? target.cx + (target.tipX - target.cx) * expandScale
      : target.cx + ux * (target.len || 80) * expandScale;
  const tipY =
    typeof target.tipY === "number"
      ? target.cy + (target.tipY - target.cy) * expandScale
      : target.cy + uy * (target.len || 80) * expandScale;

  const minX = 14 + pillW / 2;
  const maxX = GARDEN_WORLD - 14 - pillW / 2;
  const minY = 48 + pillH / 2;
  const maxY = GARDEN_WORLD - 16 - pillH / 2;
  const clampPt = (px, py) => ({
    x: Math.max(minX, Math.min(maxX, px)),
    y: Math.max(minY, Math.min(maxY, py)),
  });

  const hasSprout = Boolean(target.hasMore && !target.isSprouted);
  const halfWExp = (target.halfW || 30) * expandScale;
  const vertClear = halfWExp * 0.96 + pillH / 2 + 10;
  const tipClear = (hasSprout ? 30 : 14) + pillH / 2;

  const candidates = [];
  if (kind === "spouse") {
    candidates.push(
      { ...clampPt(expLabelX + ux * 8, Math.max(tipY, expLabelY) + halfWExp * 0.8 + pillH / 2 + 10), bias: 0 },
      { ...clampPt(tipX + ux * (pillW * 0.5 + 12), expLabelY + 4), bias: 6 },
      { ...clampPt(expLabelX, Math.min(tipY, expLabelY) - vertClear), bias: 14 },
    );
  } else {
    const preferAbove = uy <= -0.45;
    candidates.push(
      // Outward past expanded tip
      {
        ...clampPt(
          tipX + ux * (Math.abs(ux) > 0.6 ? pillW * 0.48 + 14 : 12),
          tipY + uy * tipClear,
        ),
        bias: preferAbove ? 0 : 8,
      },
      // Below petal belly (ideal open parchment for sideways outer petals like Carmen / Lucia / Samuel)
      {
        ...clampPt(expLabelX + ux * 12, Math.max(tipY, expLabelY) + vertClear),
        bias: preferAbove ? 12 : 2,
      },
      // Above petal belly (ideal open parchment for upward petals)
      {
        ...clampPt(expLabelX + ux * 12, Math.min(tipY, expLabelY) - vertClear),
        bias: preferAbove ? 2 : 10,
      },
      // Outward-below diagonal
      {
        ...clampPt(tipX + ux * 20, Math.max(tipY, expLabelY) + vertClear + 4),
        bias: 14,
      },
      // Outward-above diagonal
      {
        ...clampPt(tipX + ux * 20, Math.min(tipY, expLabelY) - vertClear - 4),
        bias: 14,
      },
    );
  }

  // Build circular collision proxies for petals, blooms, spouses, and hub
  const allPetals = obstacles.petals || [];
  const allBlooms = obstacles.blooms || [];
  const allSpouses = obstacles.spouses || [];
  const hubObj = obstacles.hub || null;

  let best = candidates[0];
  let bestScore = Infinity;

  for (const cand of candidates) {
    const rx0 = cand.x - pillW / 2 - 4;
    const ry0 = cand.y - pillH / 2 - 4;
    const rx1 = cand.x + pillW / 2 + 4;
    const ry1 = cand.y + pillH / 2 + 4;

    let penalty = cand.bias + Math.hypot(cand.x - tipX, cand.y - tipY) * 0.12;

    // Strongly avoid covering the hovered/focused petal itself
    const selfBellyHit = rectCircleOverlapDepth(rx0, ry0, rx1, ry1, expLabelX, expLabelY, halfWExp * 0.94);
    const selfTipHit = rectCircleOverlapDepth(rx0, ry0, rx1, ry1, tipX, tipY, halfWExp * 0.52);
    if (selfBellyHit > 0) penalty += 5000 + selfBellyHit * 90;
    if (selfTipHit > 0) penalty += 3000 + selfTipHit * 60;

    // Strongly avoid covering neighboring petals (e.g. Joaquin above Carmen)
    for (const p of allPetals) {
      if (p.key === target.key) continue;
      const rBelly = (p.halfW || 24) * 0.94;
      const h1 = rectCircleOverlapDepth(rx0, ry0, rx1, ry1, p.labelX, p.labelY, rBelly);
      if (h1 > 0) penalty += 2200 + h1 * 70;
      if (typeof p.tipX === "number" && typeof p.tipY === "number") {
        const h2 = rectCircleOverlapDepth(rx0, ry0, rx1, ry1, p.tipX, p.tipY, rBelly * 0.55);
        if (h2 > 0) penalty += 1200 + h2 * 40;
      }
    }

    // Avoid golden seed-heads and hero hub
    for (const b of allBlooms) {
      const h = rectCircleOverlapDepth(rx0, ry0, rx1, ry1, b.x, b.y, (b.r || 12) + 8);
      if (h > 0) penalty += 2400 + h * 70;
    }
    if (hubObj) {
      const h = rectCircleOverlapDepth(rx0, ry0, rx1, ry1, hubObj.x, hubObj.y, (hubObj.r || 48) + 12);
      if (h > 0) penalty += 2800 + h * 80;
    }
    for (const s of allSpouses) {
      if (s.key === target.key) continue;
      const h = rectCircleOverlapDepth(rx0, ry0, rx1, ry1, s.labelX, s.labelY, (s.halfW || 26) * 0.9);
      if (h > 0) penalty += 1800 + h * 50;
    }

    if (penalty < bestScore) {
      bestScore = penalty;
      best = cand;
    }
  }

  return {
    x: best.x,
    y: best.y,
    pillW,
    pillH,
    twoLine,
    fullName,
    metaText,
    nameW,
    nameSize,
    metaSize,
    swatchFill: kind === "spouse" ? "var(--garden-spouse)" : petalColorVar(target.generation),
  };
}

function pollenDots(cx, cy, r, count) {
  const dots = [];
  for (let i = 0; i < count; i += 1) {
    const theta = (i / count) * Math.PI * 2 - Math.PI / 2;
    dots.push({
      x: cx + Math.cos(theta) * r,
      y: cy + Math.sin(theta) * r,
    });
  }
  return dots;
}

export default function BotanicalGarden({
  centerId,
  family,
  expanded,
  selectedPid,
  sibAnchorPid,
  viewDirection,
  canEdit = false,
  onWedgeClick,
  onWedgeDoubleClick,
  onEmptySlotClick,
  onCenterClick,
  onSpouseClick,
}) {
  const [hoverKey, setHoverKey] = React.useState(null);
  const [focusKey, setFocusKey] = React.useState(null);
  const [hoverBudKey, setHoverBudKey] = React.useState(null);
  const [focusBudKey, setFocusBudKey] = React.useState(null);
  const [hoverSpouseId, setHoverSpouseId] = React.useState(null);
  const [focusSpouseId, setFocusSpouseId] = React.useState(null);
  const [focusHub, setFocusHub] = React.useState(false);
  const pointerFocusRef = React.useRef(false);
  const hudHost = React.useContext(ChartHudContext);

  const center = family[centerId];
  const isAncestorView = viewDirection === "ancestors";

  React.useEffect(() => {
    setHoverKey(null);
    setFocusKey(null);
    setHoverBudKey(null);
    setFocusBudKey(null);
    setHoverSpouseId(null);
    setFocusSpouseId(null);
    setFocusHub(false);
  }, [centerId, viewDirection]);

  const dominantSibId =
    isAncestorView && selectedPid && sibAnchorPid && selectedPid !== sibAnchorPid
      ? selectedPid
      : null;

  const garden = React.useMemo(
    () =>
      buildGarden(centerId, family, expanded, {
        direction: viewDirection,
        sibAnchorPid,
        dominantSibId,
        canEdit,
      }),
    [centerId, family, expanded, viewDirection, sibAnchorPid, dominantSibId, canEdit],
  );

  const petals = garden?.petals || [];
  const blooms = garden?.blooms || [];
  const stems = garden?.stems || [];
  const spouses = garden?.spouses || [];
  const buds = garden?.buds || [];
  const hub = garden?.hub || {
    x: 500,
    y: 500,
    r: 48,
    personId: centerId,
    name: center?.name || "",
    lifespan: formatLifespan(center?.birth, center?.death),
    initials: getInitials(center?.name),
  };
  const mainStem = garden?.mainStem || null;
  const sideLabels = garden?.sideLabels || null;

  // Stable DOM order: sibling petals first, then main petals (NEVER reordered on hover/focus)
  const orderedPetals = React.useMemo(() => {
    const sibs = [];
    const main = [];
    for (const p of petals) {
      if (p.isSibling) sibs.push(p);
      else main.push(p);
    }
    return [...sibs, ...main];
  }, [petals]);

  const hoveredPetal = React.useMemo(
    () => (hoverKey ? petals.find((p) => p.key === hoverKey) || null : null),
    [petals, hoverKey],
  );
  const focusedPetal = React.useMemo(
    () => (focusKey ? petals.find((p) => p.key === focusKey) || null : null),
    [petals, focusKey],
  );
  const previewPetal = hoveredPetal || focusedPetal;

  const selectedPetal = React.useMemo(
    () => (selectedPid ? petals.find((p) => p.personId === selectedPid) || null : null),
    [petals, selectedPid],
  );

  const hoveredBud = React.useMemo(
    () => (hoverBudKey ? buds.find((b) => b.key === hoverBudKey) || null : null),
    [buds, hoverBudKey],
  );
  const focusedBud = React.useMemo(
    () => (focusBudKey ? buds.find((b) => b.key === focusBudKey) || null : null),
    [buds, focusBudKey],
  );
  const previewBud = hoveredBud || focusedBud;

  const hoveredSpouse = React.useMemo(
    () => (hoverSpouseId ? spouses.find((s) => s.personId === hoverSpouseId) || null : null),
    [spouses, hoverSpouseId],
  );
  const focusedSpouse = React.useMemo(
    () => (focusSpouseId ? spouses.find((s) => s.personId === focusSpouseId) || null : null),
    [spouses, focusSpouseId],
  );
  const previewSpouse = hoveredSpouse || focusedSpouse;
  const selectedSpouse = React.useMemo(
    () => (selectedPid ? spouses.find((s) => s.personId === selectedPid) || null : null),
    [spouses, selectedPid],
  );

  const activeTrail = React.useMemo(() => {
    const source = previewPetal || selectedPetal;
    return new Set(source?.trail || []);
  }, [previewPetal, selectedPetal]);

  const hasTooltip = Boolean(previewPetal || previewBud || previewSpouse);
  const showEmptyTreePrompt = Boolean(
    isAncestorView &&
      center &&
      !center.motherId &&
      !center.fatherId &&
      canEdit &&
      !hasTooltip,
  );

  const centerLifespan = hub.lifespan || formatLifespan(center?.birth, center?.death);

  const selectionAnnouncement = React.useMemo(() => {
    if (!selectedPid) return "";
    if (selectedPetal?.person) {
      const life = formatLifespan(selectedPetal.person.birth, selectedPetal.person.death);
      const rel =
        selectedPetal.relLabel ||
        generationLabel(selectedPetal.generation, viewDirection, selectedPetal.side, selectedPetal.isSibling);
      return `${selectedPetal.person.name}${life ? `, ${life}` : ""}, ${rel} selected.`;
    }
    if (selectedSpouse?.person) {
      const life = formatLifespan(selectedSpouse.person.birth, selectedSpouse.person.death);
      return `${selectedSpouse.person.name}${life ? `, ${life}` : ""}, Spouse selected.`;
    }
    if (selectedPid === centerId && center) {
      return `${center.name}${centerLifespan ? `, ${centerLifespan}` : ""}, Center person selected.`;
    }
    const person = family[selectedPid];
    if (!person) return "";
    const life = formatLifespan(person.birth, person.death);
    return `${person.name}${life ? `, ${life}` : ""} selected.`;
  }, [selectedPid, selectedPetal, selectedSpouse, centerId, center, centerLifespan, family, viewDirection]);

  const hubPollen = React.useMemo(() => pollenDots(hub.x, hub.y, hub.r + 3.5, 18), [hub.x, hub.y, hub.r]);

  const liftPetals = React.useMemo(() => {
    const items = [];
    const seen = new Set();
    for (const candidate of [selectedPetal, hoveredPetal, focusedPetal]) {
      if (candidate && !seen.has(candidate.key)) {
        seen.add(candidate.key);
        items.push({
          petal: candidate,
          isSelected: Boolean(selectedPid && candidate.personId === selectedPid),
          isHovered: hoverKey === candidate.key,
          isFocused: focusKey === candidate.key,
        });
      }
    }
    return items;
  }, [selectedPetal, hoveredPetal, focusedPetal, selectedPid, hoverKey, focusKey]);

  const liftSpouses = React.useMemo(() => {
    const items = [];
    const seen = new Set();
    for (const candidate of [selectedSpouse, hoveredSpouse, focusedSpouse]) {
      if (candidate && !seen.has(candidate.key)) {
        seen.add(candidate.key);
        items.push({
          spouse: candidate,
          isSelected: Boolean(selectedPid && candidate.personId === selectedPid),
          isHovered: hoverSpouseId === candidate.personId,
          isFocused: focusSpouseId === candidate.personId,
        });
      }
    }
    return items;
  }, [selectedSpouse, hoveredSpouse, focusedSpouse, selectedPid, hoverSpouseId, focusSpouseId]);

  const specimenTag = React.useMemo(() => {
    const obstacles = { petals, blooms, spouses, hub };
    if (previewSpouse?.person) {
      return computeSpecimenTagLayout(previewSpouse, "spouse", obstacles);
    }
    if (previewPetal?.person) {
      const restLabel = computePetalLabelLayout(previewPetal);
      const expandedLabel = computePetalLabelLayout(previewPetal, {
        scale: 1,
        showLifespan: true,
      });
      if (restLabel.isTruncated || !expandedLabel.showsFullWithLife) {
        return computeSpecimenTagLayout(previewPetal, "petal", obstacles);
      }
    }
    return null;
  }, [previewPetal, previewSpouse, petals, blooms, spouses, hub]);

  function isStemInTrail(stem) {
    if (activeTrail.size === 0) return false;
    if (stem.toKey && activeTrail.has(stem.toKey)) {
      if (stem.fromKey !== stem.toKey) return true;
      return activeTrail.size > 1;
    }
    if (stem.fromKey && activeTrail.has(stem.fromKey) && activeTrail.size > 1) {
      return petals.some(
        (p) =>
          activeTrail.has(p.key) &&
          p.generation >= stem.generation &&
          Array.isArray(p.trail) &&
          p.trail.includes(stem.fromKey),
      );
    }
    return false;
  }

  return (
    <div className="lineage-wheel botanical-garden">
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {selectionAnnouncement}
      </div>

      <svg
        className="garden-svg"
        viewBox={`0 0 ${GARDEN_WORLD} ${GARDEN_WORLD}`}
        role="img"
        aria-label={`${isAncestorView ? "Ancestor" : "Descendant"} botanical family garden centered on ${center?.name || "person"}`}
      >
        <defs>
          {/* Soft botanical paper aura behind the hero bloom */}
          <radialGradient id="garden-paper-aura" cx="50%" cy="46%" r="48%">
            <stop offset="0%" stopColor="var(--garden-stamen)" stopOpacity="0.16" />
            <stop offset="48%" stopColor="var(--garden-leaf)" stopOpacity="0.06" />
            <stop offset="100%" stopColor="var(--garden-leaf)" stopOpacity="0" />
          </radialGradient>

          {/* Golden stamen radial gradient */}
          <radialGradient id="garden-stamen-grad" cx="38%" cy="32%" r="68%">
            <stop offset="0%" stopColor="var(--garden-focus-inner)" stopOpacity="0.82" />
            <stop offset="32%" stopColor="var(--garden-stamen)" stopOpacity="1" />
            <stop offset="100%" stopColor="var(--garden-stamen-ring)" stopOpacity="0.96" />
          </radialGradient>

          {/* Subtle petal sheen overlay (gentle highlight preserving >=5.9:1 text contrast) */}
          <linearGradient id="garden-petal-sheen" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="var(--garden-focus-inner)" stopOpacity="0.12" />
            <stop offset="55%" stopColor="var(--garden-focus-inner)" stopOpacity="0.02" />
            <stop offset="100%" stopColor="var(--garden-stamen-ring)" stopOpacity="0.14" />
          </linearGradient>

          {/* Sap-gold glow filter for active trail stems */}
          <filter id="garden-trail-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Layer 1: Subtle botanical paper aura & sunlit ambient glow */}
        <g className="garden-aura-layer" aria-hidden="true">
          <ellipse
            cx={hub.x}
            cy={hub.y - 90}
            rx={440}
            ry={320}
            fill="url(#garden-paper-aura)"
          />
          <circle
            cx={hub.x}
            cy={hub.y}
            r={hub.r + 36}
            fill="none"
            stroke="var(--garden-stamen-ring)"
            strokeOpacity={0.14}
            strokeWidth={1}
            strokeDasharray="3 7"
          />
        </g>

        {/* Layer 2: Ground leaves behind lower stem & spouses */}
        {mainStem && (mainStem.leaves || []).length > 0 && (
          <g className="garden-ground-leaves-layer" aria-hidden="true">
            {(mainStem.leaves || []).map((leaf, idx) => (
              <g
                key={`ground-leaf-${idx}`}
                className="garden-leaf"
                transform={`translate(${leaf.x}, ${leaf.y}) rotate(${leaf.angleDeg})`}
              >
                <path
                  d={leafPathD(leaf.len, leaf.width)}
                  fill="var(--garden-leaf)"
                  stroke="var(--garden-leaf-stroke, var(--garden-stem))"
                  strokeWidth={1.3}
                  strokeLinejoin="round"
                />
                <path
                  d={`M 0,${(-leaf.len * 0.12).toFixed(2)} L 0,${(-leaf.len * 0.84).toFixed(2)}`}
                  fill="none"
                  stroke="var(--garden-focus-inner)"
                  strokeOpacity={0.35}
                  strokeWidth={0.9}
                  strokeLinecap="round"
                />
              </g>
            ))}
          </g>
        )}

        {/* Layer 3: Curved Bezier stems + mid-stem botanical leaves */}
        <g className="garden-stems-layer" aria-hidden="true">
          {stems.map((stem, idx) => {
            const inTrail = isStemInTrail(stem);
            const sw = stemStrokeWidth(stem.generation);
            const delayMs = Math.min(320, (stem.generation - 2) * 90 + (idx % 4) * 35);
            return (
              <g key={stem.id} className={`garden-stem-group${inTrail ? " is-trail" : ""}`}>
                {inTrail && (
                  <path
                    d={stem.d}
                    fill="none"
                    stroke="var(--garden-stem-glow)"
                    strokeWidth={sw + 4}
                    strokeLinecap="round"
                    strokeOpacity={0.32}
                    filter="url(#garden-trail-glow)"
                  />
                )}
                <path
                  className={`garden-stem${inTrail ? " is-trail" : ""}`}
                  pathLength={1}
                  d={stem.d}
                  fill="none"
                  stroke={inTrail ? "var(--garden-stem-glow)" : "var(--garden-stem)"}
                  strokeWidth={inTrail ? sw + 0.9 : sw}
                  strokeLinecap="round"
                  style={{ "--stem-delay": `${delayMs}ms` }}
                />
                {stem.leaf && (
                  <g
                    className="garden-leaf"
                    transform={`translate(${stem.leaf.x}, ${stem.leaf.y}) rotate(${stem.leaf.angleDeg})`}
                  >
                    <path
                      d={leafPathD(stem.leaf.len, stem.leaf.width)}
                      fill={inTrail ? "var(--garden-stem-glow)" : "var(--garden-leaf)"}
                      fillOpacity={inTrail ? 0.85 : 0.92}
                      stroke="var(--garden-leaf-stroke, var(--garden-stem))"
                      strokeWidth={1.1}
                      strokeLinejoin="round"
                    />
                    <path
                      d={`M 0,${(-stem.leaf.len * 0.14).toFixed(2)} L 0,${(-stem.leaf.len * 0.82).toFixed(2)}`}
                      fill="none"
                      stroke="var(--garden-focus-inner)"
                      strokeOpacity={0.35}
                      strokeWidth={0.8}
                      strokeLinecap="round"
                    />
                  </g>
                )}
              </g>
            );
          })}
        </g>

        {/* Layer 4: Unopened green buds for empty parent slots */}
        {buds.length > 0 && (
          <g className="garden-buds-layer">
            {buds.map((bud) => {
              const isHover = hoverBudKey === bud.key;
              const isFocused = focusBudKey === bud.key;
              const budR = bud.generation <= 1 ? 18 : 13;
              const hitR = Math.max(26, budR + 10);
              const parentName = family[bud.childId]?.name || "person";
              const ariaText = bud.ariaLabel || `Add ${bud.slot} of ${parentName}`;
              const showFullLabel = bud.generation <= 1 || isHover || isFocused;
              const labelOffsetY = bud.generation <= 1 ? -budR * 2.15 - 6 : -budR * 1.9 - 6;

              return (
                <g
                  key={bud.key}
                  className={`garden-bud${isHover ? " is-hovered" : ""}${isFocused ? " is-focused" : ""}`}
                  role="button"
                  tabIndex={0}
                  data-slot={bud.slot}
                  data-generation={bud.generation}
                  aria-label={ariaText}
                  onMouseDown={() => {
                    pointerFocusRef.current = true;
                  }}
                  onMouseEnter={() => setHoverBudKey(bud.key)}
                  onMouseLeave={() => setHoverBudKey((cur) => (cur === bud.key ? null : cur))}
                  onFocus={() => {
                    if (pointerFocusRef.current) {
                      pointerFocusRef.current = false;
                      return;
                    }
                    setFocusBudKey(bud.key);
                  }}
                  onBlur={() => setFocusBudKey((cur) => (cur === bud.key ? null : cur))}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onEmptySlotClick) onEmptySlotClick(bud.childId, bud.slot);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (onEmptySlotClick) onEmptySlotClick(bud.childId, bud.slot);
                    }
                  }}
                >
                  <title>{ariaText}</title>
                  {bud.stemD && (
                    <path
                      d={bud.stemD}
                      fill="none"
                      stroke="var(--garden-bud-stroke)"
                      strokeWidth={bud.generation <= 1 ? 2.8 : 2}
                      strokeDasharray="4 3"
                      strokeLinecap="round"
                    />
                  )}
                  {/* Generous invisible touch target for mobile */}
                  <circle
                    className="garden-hit-target"
                    cx={bud.x}
                    cy={bud.y - budR * 0.4}
                    r={hitR}
                    fill="transparent"
                  />
                  <g transform={`translate(${bud.x}, ${bud.y}) rotate(${bud.angleDeg || 0})`}>
                    <path
                      className="garden-bud-shape"
                      d={budPathD(budR)}
                      fill="var(--garden-bud-fill)"
                      stroke="var(--garden-bud-stroke)"
                      strokeWidth={isHover || isFocused ? 2.2 : 1.6}
                      strokeDasharray="4 2.5"
                      strokeLinejoin="round"
                    />
                    <path
                      d={budSepalD(budR, -1)}
                      fill="var(--garden-leaf)"
                      stroke="var(--garden-bud-stroke)"
                      strokeWidth={1}
                    />
                    <path
                      d={budSepalD(budR, 1)}
                      fill="var(--garden-leaf)"
                      stroke="var(--garden-bud-stroke)"
                      strokeWidth={1}
                    />
                  </g>
                  {/* Upright + badge inside bud */}
                  <text
                    x={bud.x}
                    y={bud.y - budR * 0.65}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={bud.generation <= 1 ? 15 : 12}
                    fontWeight={700}
                    fill="var(--garden-bud-stroke)"
                    style={{ pointerEvents: "none" }}
                  >
                    +
                  </text>
                  {showFullLabel && bud.label && bud.label !== "+" && (
                    <text
                      x={bud.x}
                      y={bud.y + labelOffsetY}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={bud.generation <= 1 ? 12 : 10.5}
                      fontWeight={600}
                      fill="var(--fg)"
                      className="garden-bud-label"
                      style={{ pointerEvents: "none" }}
                    >
                      {bud.label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        )}

        {/* Layer 5: Companion spouse leaf-blooms on lower stem (stationary hit targets; tucked behind main stem & hub) */}
        {spouses.length > 0 && (
          <g className="garden-spouses-layer">
            {spouses.map((s) => {
              const isSelected = selectedPid === s.personId;
              const isHover = hoverSpouseId === s.personId;
              const isFocused = focusSpouseId === s.personId;
              const spouseName = s.person?.name || "Spouse";
              const spouseLife = formatLifespan(s.person?.birth, s.person?.death);
              const spouseLabel = computeSpouseLabelLayout(s);
              const hitR = Math.max(24, (s.halfW || 18) + 8);

              return (
                <g
                  key={s.key}
                  className={`garden-spouse${isSelected ? " is-selected" : ""}${isHover ? " is-hovered" : ""}${isFocused ? " is-focused" : ""}`}
                  role="button"
                  tabIndex={0}
                  data-person-id={s.personId}
                  data-slot="spouse"
                  aria-pressed={isSelected}
                  aria-label={`${spouseName}, spouse. Enter to select; R to center.`}
                  onMouseDown={() => {
                    pointerFocusRef.current = true;
                  }}
                  onMouseEnter={() => setHoverSpouseId(s.personId)}
                  onMouseLeave={() => setHoverSpouseId((cur) => (cur === s.personId ? null : cur))}
                  onFocus={() => {
                    if (pointerFocusRef.current) {
                      pointerFocusRef.current = false;
                      return;
                    }
                    setFocusSpouseId(s.personId);
                  }}
                  onBlur={() => setFocusSpouseId((cur) => (cur === s.personId ? null : cur))}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onSpouseClick) onSpouseClick(s.personId);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (onWedgeDoubleClick) onWedgeDoubleClick(s.personId);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (onSpouseClick) onSpouseClick(s.personId);
                    } else if (e.key.toLowerCase() === "r") {
                      e.preventDefault();
                      if (onWedgeDoubleClick) onWedgeDoubleClick(s.personId);
                    }
                  }}
                >
                  <title>
                    {spouseName} (Spouse{spouseLife ? ` · ${spouseLife}` : ""})
                  </title>
                  <circle className="garden-hit-target" cx={s.labelX} cy={s.labelY} r={hitR} fill="transparent" />
                  <g transform={`translate(${s.cx}, ${s.cy}) rotate(${s.angleDeg})`}>
                    <path
                      className="garden-spouse-shape"
                      d={s.pathD}
                      fill="var(--garden-spouse)"
                      fillOpacity={isSelected || isHover || isFocused ? 0.98 : 0.94}
                      stroke="var(--garden-stamen-ring)"
                      strokeWidth={1.3}
                      strokeOpacity={0.5}
                      strokeLinejoin="round"
                    />
                    <path
                      d={s.pathD}
                      fill="url(#garden-petal-sheen)"
                      style={{ pointerEvents: "none" }}
                    />
                    {s.veinD && (
                      <path
                        d={s.veinD}
                        fill="none"
                        stroke="var(--garden-petal-text)"
                        strokeOpacity={0.22}
                        strokeWidth={1}
                        strokeLinecap="round"
                        style={{ pointerEvents: "none" }}
                      />
                    )}
                  </g>
                  {/* Always-upright spouse label */}
                  {renderPetalLabelContent(s.labelX, s.labelY, spouseLabel, false)}
                </g>
              );
            })}
          </g>
        )}

        {/* Layer 6: Person petals (siblings first, then main petals; stable DOM order & stationary hit targets) */}
        <g className="garden-petals-layer">
          {orderedPetals.map((p, idx) => {
            const isHover = hoverKey === p.key;
            const isFocused = focusKey === p.key;
            const isSelected = Boolean(selectedPid && selectedPid === p.personId);
            const inTrail = activeTrail.has(p.key);
            const isDimmed = activeTrail.size > 0 && !inTrail && !isHover && !isFocused && !isSelected;
            const fillColor = petalColorVar(p.generation);
            const personName = p.person?.name || "Unknown";
            const lifespan = formatLifespan(p.person?.birth, p.person?.death);
            const relText =
              p.relLabel ||
              generationLabel(p.generation, viewDirection, p.side, p.isSibling);

            const ariaExpanded =
              p.hasMore || p.canExpandSiblings
                ? Boolean(
                    (p.canExpandSiblings && sibAnchorPid === p.personId) ||
                      (p.hasMore && (p.isSprouted || expanded?.has?.(p.personId))),
                  )
                : undefined;

            // Keep fillOpacity rich so CSS .is-dimmed (opacity: 0.70) recedes gently without faint text
            const fillOpacity = isHover || isSelected || isFocused
              ? 0.98
              : p.isSibling
                ? 0.9
                : 0.96;

            const label = computePetalLabelLayout(p);
            const bloomDelayMs = Math.min(360, (p.generation - 1) * 75 + (idx % 6) * 28);
            const needsHitCircle = (p.halfW || 0) < 24 || (p.len || 0) < 62;
            const showSproutTendril = Boolean(p.hasMore && !p.isSprouted);

            return (
              <g
                key={p.key}
                className={`garden-petal${p.isSibling ? " is-sibling" : ""}${isHover ? " is-hovered" : ""}${isFocused ? " is-focused" : ""}${isSelected ? " is-selected" : ""}${inTrail ? " is-trail" : ""}${isDimmed ? " is-dimmed" : ""}`}
                role="button"
                tabIndex={0}
                data-person-id={p.personId}
                data-generation={p.generation}
                data-sibling={p.isSibling ? "true" : "false"}
                data-slot={p.slot ?? ""}
                aria-pressed={isSelected}
                aria-expanded={ariaExpanded}
                aria-label={`${personName}${p.isSibling ? ", sibling" : ""}. Enter to select; R to center.`}
                style={{ "--bloom-delay": `${bloomDelayMs}ms` }}
                onMouseDown={() => {
                  pointerFocusRef.current = true;
                }}
                onMouseEnter={() => setHoverKey(p.key)}
                onMouseLeave={() => setHoverKey((cur) => (cur === p.key ? null : cur))}
                onFocus={() => {
                  if (pointerFocusRef.current) {
                    pointerFocusRef.current = false;
                    return;
                  }
                  setFocusKey(p.key);
                }}
                onBlur={() => setFocusKey((cur) => (cur === p.key ? null : cur))}
                onClick={(e) => {
                  e.stopPropagation();
                  if (onWedgeClick) onWedgeClick(p.personId, p.isSibling);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (onWedgeDoubleClick) onWedgeDoubleClick(p.personId);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (onWedgeClick) onWedgeClick(p.personId, p.isSibling);
                  } else if (e.key.toLowerCase() === "r") {
                    e.preventDefault();
                    if (onWedgeDoubleClick) onWedgeDoubleClick(p.personId);
                  }
                }}
              >
                <title>
                  {personName}
                  {lifespan ? ` (${lifespan})` : ""}
                  {relText ? ` · ${relText}` : ""}
                </title>

                {/* Generous transparent hit area for smaller outer petals */}
                {needsHitCircle && (
                  <circle
                    className="garden-hit-target"
                    cx={p.labelX}
                    cy={p.labelY}
                    r={Math.max(24, (p.halfW || 16) + 10)}
                    fill="transparent"
                  />
                )}

                {/* Petal geometry anchored at (cx, cy), rotated by angleDeg */}
                <g transform={`translate(${p.cx}, ${p.cy}) rotate(${p.angleDeg})`}>
                  <path
                    className="garden-petal-shape"
                    d={p.pathD}
                    fill={fillColor}
                    fillOpacity={fillOpacity}
                    stroke={
                      inTrail && activeTrail.size > 1
                        ? "var(--garden-stem-glow)"
                        : p.isSibling
                          ? "var(--garden-petal-text)"
                          : "var(--garden-stamen-ring)"
                    }
                    strokeOpacity={p.isSibling ? 0.72 : inTrail ? 0.92 : 0.44}
                    strokeWidth={p.isSibling ? 1.5 : inTrail ? 2 : 1.3}
                    strokeDasharray={p.isSibling ? "5 3.5" : undefined}
                    strokeLinejoin="round"
                  />
                  {/* Soft sunlit sheen */}
                  <path
                    d={p.pathD}
                    fill="url(#garden-petal-sheen)"
                    style={{ pointerEvents: "none" }}
                  />
                  {/* Delicate botanical midrib vein */}
                  {p.veinD && (
                    <path
                      className="garden-petal-vein"
                      d={p.veinD}
                      fill="none"
                      stroke="var(--garden-petal-text)"
                      strokeOpacity={0.22}
                      strokeWidth={p.generation <= 1 ? 1.25 : 0.95}
                      strokeLinecap="round"
                      style={{ pointerEvents: "none" }}
                    />
                  )}
                </g>

                {/* Curled tendril + sprout indicator at petal tip when expandable */}
                {showSproutTendril && Number.isFinite(p.tipX) && Number.isFinite(p.tipY) && (
                  <g
                    className="garden-sprout-tendril"
                    transform={`translate(${p.tipX}, ${p.tipY}) rotate(${p.angleDeg})`}
                    style={{ opacity: isHover || isFocused ? 0 : 1 }}
                  >
                    <path
                      d="M 0,0 C 4,-5 5,-10 0,-13"
                      fill="none"
                      stroke="var(--garden-stem)"
                      strokeWidth={1.6}
                      strokeLinecap="round"
                    />
                    <circle
                      cx={0}
                      cy={-14}
                      r={7.5}
                      fill="var(--garden-bud-fill)"
                      stroke="var(--garden-bud-stroke)"
                      strokeWidth={1.4}
                    />
                    <g transform={`translate(0, -14) rotate(${-p.angleDeg})`}>
                      <text
                        x={0}
                        y={0.5}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize={10}
                        fontWeight={700}
                        fill="var(--garden-bud-stroke)"
                        style={{ pointerEvents: "none" }}
                      >
                        +
                      </text>
                    </g>
                  </g>
                )}

                {/* Always-upright horizontal label at petal belly */}
                {renderPetalLabelContent(p.labelX, p.labelY, label, p.isSibling)}
              </g>
            );
          })}
        </g>

        {/* Layer 6b: Under-hub petal & spouse lift/expansion layer (tucked cleanly BEHIND main stem, blooms & hub) */}
        <g className="garden-petal-lift" aria-hidden="true" pointerEvents="none" style={{ pointerEvents: "none" }}>
          {liftSpouses.map(({ spouse: s, isSelected, isHovered, isFocused }) => {
            const isExpanded = isHovered || isFocused;
            const outerWidth = isFocused ? 4.8 : isSelected ? 4.2 : 3.4;
            const innerWidth = isFocused ? 2.1 : isSelected ? 1.8 : 1.6;

            if (isExpanded) {
              const expandedLabel = computeSpouseLabelLayout(s, { scale: 1 });
              return (
                <g key={`lift-spouse-${s.key}`} transform={`translate(${s.cx}, ${s.cy})`}>
                  <g className="garden-spouse-expand">
                    <g transform={`rotate(${s.angleDeg})`}>
                      <path
                        d={s.pathD}
                        fill="var(--garden-spouse)"
                        fillOpacity={0.99}
                        stroke="none"
                      />
                      <path d={s.pathD} fill="url(#garden-petal-sheen)" />
                      {s.veinD && (
                        <path
                          d={s.veinD}
                          fill="none"
                          stroke="var(--garden-petal-text)"
                          strokeOpacity={0.22}
                          strokeWidth={1}
                          strokeLinecap="round"
                        />
                      )}
                      <path
                        d={s.pathD}
                        fill="none"
                        stroke="var(--garden-focus-outer)"
                        strokeWidth={outerWidth}
                        strokeOpacity={isFocused || isSelected ? 0.96 : 0.84}
                        strokeLinejoin="round"
                      />
                      <path
                        d={s.pathD}
                        fill="none"
                        stroke="var(--garden-focus-inner)"
                        strokeWidth={innerWidth}
                        strokeLinejoin="round"
                      />
                    </g>
                    {renderPetalLabelContent(s.labelX - s.cx, s.labelY - s.cy, expandedLabel, false)}
                  </g>
                </g>
              );
            }

            return (
              <g
                key={`lift-spouse-${s.key}`}
                transform={`translate(${s.cx}, ${s.cy}) rotate(${s.angleDeg})`}
              >
                <path
                  d={s.pathD}
                  fill="none"
                  stroke="var(--garden-focus-outer)"
                  strokeWidth={4.2}
                  strokeOpacity={0.95}
                  strokeLinejoin="round"
                />
                <path
                  d={s.pathD}
                  fill="none"
                  stroke="var(--garden-focus-inner)"
                  strokeWidth={1.8}
                  strokeLinejoin="round"
                />
              </g>
            );
          })}

          {liftPetals.map(({ petal: p, isSelected, isHovered, isFocused }) => {
            const isExpanded = isHovered || isFocused;
            const fillColor = petalColorVar(p.generation);
            const showSproutTendril = Boolean(p.hasMore && !p.isSprouted);

            if (isExpanded) {
              const expandedLabel = computePetalLabelLayout(p, {
                scale: 1,
                showLifespan: true,
              });
              const outerWidth = isFocused ? 4.8 : isSelected ? 4.4 : 3.6;
              const innerWidth = isFocused ? 2.1 : isSelected ? 1.9 : 1.7;

              return (
                <g key={`lift-${p.key}`} transform={`translate(${p.cx}, ${p.cy})`}>
                  <g className="garden-petal-expand">
                    <g transform={`rotate(${p.angleDeg})`}>
                      <path
                        d={p.pathD}
                        fill={fillColor}
                        fillOpacity={0.99}
                        stroke="none"
                      />
                      <path d={p.pathD} fill="url(#garden-petal-sheen)" />
                      {p.veinD && (
                        <path
                          className="garden-petal-vein"
                          d={p.veinD}
                          fill="none"
                          stroke="var(--garden-petal-text)"
                          strokeOpacity={0.22}
                          strokeWidth={p.generation <= 1 ? 1.25 : 0.95}
                          strokeLinecap="round"
                        />
                      )}
                      <path
                        d={p.pathD}
                        fill="none"
                        stroke="var(--garden-focus-outer)"
                        strokeWidth={outerWidth}
                        strokeOpacity={isFocused || isSelected ? 0.96 : 0.86}
                        strokeLinejoin="round"
                      />
                      <path
                        d={p.pathD}
                        fill="none"
                        stroke="var(--garden-focus-inner)"
                        strokeWidth={innerWidth}
                        strokeLinejoin="round"
                      />
                      {showSproutTendril && (
                        <g transform={`translate(0, ${-p.len})`}>
                          <path
                            d="M 0,0 C 4,-5 5,-10 0,-13"
                            fill="none"
                            stroke="var(--garden-stem)"
                            strokeWidth={1.6}
                            strokeLinecap="round"
                          />
                          <circle
                            cx={0}
                            cy={-14}
                            r={7.5}
                            fill="var(--garden-bud-fill)"
                            stroke="var(--garden-bud-stroke)"
                            strokeWidth={1.4}
                          />
                          <g transform={`translate(0, -14) rotate(${-p.angleDeg})`}>
                            <text
                              x={0}
                              y={0.5}
                              textAnchor="middle"
                              dominantBaseline="middle"
                              fontSize={10}
                              fontWeight={700}
                              fill="var(--garden-bud-stroke)"
                            >
                              +
                            </text>
                          </g>
                        </g>
                      )}
                    </g>
                    {renderPetalLabelContent(p.labelX - p.cx, p.labelY - p.cy, expandedLabel, p.isSibling)}
                  </g>
                </g>
              );
            }

            return (
              <g
                key={`lift-${p.key}`}
                transform={`translate(${p.cx}, ${p.cy}) rotate(${p.angleDeg})`}
              >
                <path
                  d={p.pathD}
                  fill="none"
                  stroke="var(--garden-focus-outer)"
                  strokeWidth={4.4}
                  strokeOpacity={0.95}
                  strokeLinejoin="round"
                />
                <path
                  d={p.pathD}
                  fill="none"
                  stroke="var(--garden-focus-inner)"
                  strokeWidth={1.9}
                  strokeLinejoin="round"
                />
              </g>
            );
          })}
        </g>

        {/* Layer 7: Main lower stem stalk (over spouse bases, tucked cleanly behind hero hub) */}
        {mainStem && (
          <g className="garden-main-stem-layer" aria-hidden="true" style={{ pointerEvents: "none" }}>
            <path
              className="garden-main-stem"
              d={mainStem.d}
              fill="none"
              stroke="var(--garden-stem)"
              strokeWidth={6}
              strokeLinecap="round"
            />
            <path
              d={mainStem.d}
              fill="none"
              stroke="var(--garden-leaf)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeOpacity={0.55}
            />
          </g>
        )}

        {/* Layer 8: Unlabeled golden seed-head circles for satellite blooms (ABOVE petal fills & petal lift outlines) */}
        {blooms.length > 0 && (
          <g className="garden-blooms-layer" aria-hidden="true">
            {blooms.map((b) => {
              const r = b.r || 11;
              const inTrail = activeTrail.has(b.key) || (b.parentKey && activeTrail.has(b.parentKey));
              const dots = r >= 9 ? pollenDots(b.x, b.y, r + 2, 8) : [];
              return (
                <g key={`bloom-${b.key}`} className={`garden-bloom-seed${inTrail ? " is-trail" : ""}`}>
                  {dots.map((pt, i) => (
                    <circle
                      key={i}
                      cx={pt.x}
                      cy={pt.y}
                      r={1.3}
                      fill="var(--garden-stamen)"
                      stroke="var(--garden-stamen-ring)"
                      strokeWidth={0.5}
                    />
                  ))}
                  <circle
                    cx={b.x}
                    cy={b.y}
                    r={r}
                    fill="url(#garden-stamen-grad)"
                    stroke={inTrail ? "var(--garden-stem-glow)" : "var(--garden-stamen-ring)"}
                    strokeWidth={inTrail ? 2 : 1.4}
                  />
                  <circle
                    cx={b.x}
                    cy={b.y}
                    r={Math.max(2.5, r * 0.48)}
                    fill="none"
                    stroke="var(--garden-stamen-ring)"
                    strokeOpacity={0.45}
                    strokeWidth={0.9}
                  />
                </g>
              );
            })}
          </g>
        )}

        {/* Layer 9: Hero golden pollen-ringed stamen hub (ABOVE Gen 1 petal fills & petal lift outlines) */}
        <g
          role="button"
          tabIndex={0}
          data-center-person-id={centerId}
          aria-pressed={selectedPid === centerId}
          aria-label={`Select ${center?.name ?? "center person"}`}
          className={`garden-hub${selectedPid === centerId ? " is-selected" : ""}${focusHub ? " is-focused" : ""}`}
          onMouseDown={() => {
            pointerFocusRef.current = true;
          }}
          onFocus={() => {
            if (pointerFocusRef.current) {
              pointerFocusRef.current = false;
              return;
            }
            setFocusHub(true);
          }}
          onBlur={() => setFocusHub(false)}
          onClick={(e) => {
            e.stopPropagation();
            if (onCenterClick) onCenterClick();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (onCenterClick) onCenterClick();
            }
          }}
        >
          <title>
            {center?.name ?? ""}
            {centerLifespan ? ` (${centerLifespan})` : ""}
          </title>

          {/* Outer pollen dot wreath */}
          <g className="garden-hub-pollen" aria-hidden="true">
            {hubPollen.map((pt, idx) => (
              <circle
                key={idx}
                cx={pt.x}
                cy={pt.y}
                r={2.4}
                fill="var(--garden-stamen)"
                stroke="var(--garden-stamen-ring)"
                strokeWidth={0.8}
              />
            ))}
          </g>

          <circle
            cx={hub.x}
            cy={hub.y}
            r={hub.r}
            fill="url(#garden-stamen-grad)"
            stroke="var(--garden-stamen-ring)"
            strokeWidth={2.2}
            className="hub-outer"
          />
          <circle
            cx={hub.x}
            cy={hub.y}
            r={hub.r - 5.5}
            fill="none"
            stroke="var(--garden-stamen-ring)"
            strokeOpacity={0.42}
            strokeWidth={1.1}
            strokeDasharray="2 3"
          />
          <text
            x={hub.x}
            y={hub.y - (centerLifespan ? 13 : 8)}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={24}
            fontWeight={700}
            fill="var(--fg)"
            className="fd"
            style={{ pointerEvents: "none" }}
          >
            {hub.initials || getInitials(center?.name)}
          </text>
          <text
            x={hub.x}
            y={hub.y + (centerLifespan ? 12 : 16)}
            textAnchor="middle"
            fontSize={10.5}
            fontWeight={600}
            fill="var(--fg)"
            style={{ pointerEvents: "none" }}
          >
            {truncateLabel(hub.name || center?.name || "", 15)}
          </text>
          {centerLifespan && (
            <text
              x={hub.x}
              y={hub.y + 27}
              textAnchor="middle"
              fontSize={8.8}
              fontWeight={500}
              fill="var(--fg)"
              opacity={0.88}
              style={{ pointerEvents: "none" }}
            >
              {truncateLabel(centerLifespan, 15)}
            </text>
          )}
        </g>

        {/* Layer 10: Top overlay — ONLY hub/bud focus rings, specimen name tags & Maternal/Paternal markers */}
        <g className="garden-lift-layer" aria-hidden="true" pointerEvents="none" style={{ pointerEvents: "none" }}>
          {focusedBud && (
            <g transform={`translate(${focusedBud.x}, ${focusedBud.y}) rotate(${focusedBud.angleDeg || 0})`}>
              <path
                d={budPathD(focusedBud.generation <= 1 ? 18 : 13)}
                fill="none"
                stroke="var(--garden-focus-outer)"
                strokeWidth={5}
                strokeLinejoin="round"
              />
              <path
                d={budPathD(focusedBud.generation <= 1 ? 18 : 13)}
                fill="none"
                stroke="var(--garden-focus-inner)"
                strokeWidth={2.2}
                strokeLinejoin="round"
              />
            </g>
          )}

          {focusHub && (
            <>
              <circle
                cx={hub.x}
                cy={hub.y}
                r={hub.r + 3}
                fill="none"
                stroke="var(--garden-focus-outer)"
                strokeWidth={5.5}
              />
              <circle
                cx={hub.x}
                cy={hub.y}
                r={hub.r + 3}
                fill="none"
                stroke="var(--garden-focus-inner)"
                strokeWidth={2.5}
              />
            </>
          )}

          {selectedPid === centerId && !focusHub && (
            <>
              <circle
                cx={hub.x}
                cy={hub.y}
                r={hub.r + 2.5}
                fill="none"
                stroke="var(--garden-focus-outer)"
                strokeWidth={4.2}
              />
              <circle
                cx={hub.x}
                cy={hub.y}
                r={hub.r + 2.5}
                fill="none"
                stroke="var(--garden-focus-inner)"
                strokeWidth={1.8}
              />
            </>
          )}

          {/* High-contrast botanical parchment specimen pill for hovered/focused petals & spouses */}
          {specimenTag && (
            <g className="garden-specimen-tag" pointerEvents="none">
              <rect
                x={specimenTag.x - specimenTag.pillW / 2}
                y={specimenTag.y - specimenTag.pillH / 2}
                width={specimenTag.pillW}
                height={specimenTag.pillH}
                rx={specimenTag.twoLine ? 12 : 14}
                fill="var(--bg-elevated, #FBF7EE)"
                stroke="var(--garden-focus-outer, #1E3A28)"
                strokeWidth={1.5}
              />
              <circle
                cx={specimenTag.x - specimenTag.pillW / 2 + 13}
                cy={specimenTag.y}
                r={4.2}
                fill={specimenTag.swatchFill}
              />
              {specimenTag.twoLine ? (
                <>
                  <text
                    x={specimenTag.x - specimenTag.pillW / 2 + 24}
                    y={specimenTag.y - 6.5}
                    textAnchor="start"
                    dominantBaseline="middle"
                    fontSize={specimenTag.nameSize}
                    fontWeight={700}
                    fill="var(--fg, #2A2A1E)"
                  >
                    {specimenTag.fullName}
                  </text>
                  <text
                    x={specimenTag.x - specimenTag.pillW / 2 + 24}
                    y={specimenTag.y + 9}
                    textAnchor="start"
                    dominantBaseline="middle"
                    fontSize={specimenTag.metaSize}
                    fontWeight={600}
                    fill="var(--muted-fg, #5A5642)"
                  >
                    {specimenTag.metaText}
                  </text>
                </>
              ) : (
                <text
                  x={specimenTag.x - specimenTag.pillW / 2 + 24}
                  y={specimenTag.y + 0.5}
                  textAnchor="start"
                  dominantBaseline="middle"
                >
                  <tspan
                    fontSize={specimenTag.nameSize}
                    fontWeight={700}
                    fill="var(--fg, #2A2A1E)"
                  >
                    {specimenTag.fullName}
                  </tspan>
                  {specimenTag.metaText && (
                    <tspan
                      dx={8}
                      fontSize={specimenTag.metaSize}
                      fontWeight={600}
                      fill="var(--muted-fg, #5A5642)"
                    >
                      {specimenTag.metaText}
                    </tspan>
                  )}
                </text>
              )}
            </g>
          )}

          {/* Subtle Maternal / Paternal garden markers */}
          {isAncestorView && sideLabels?.maternal?.visible && (
            <g
              transform={`translate(${sideLabels.maternal.x}, ${sideLabels.maternal.y})`}
              className="garden-side-tag"
            >
              <circle cx={-38} cy={0} r={3.5} fill="var(--maternal)" />
              <text
                x={-30}
                y={0}
                dominantBaseline="middle"
                fontSize={11.5}
                fontWeight={600}
                fill="var(--muted-fg)"
              >
                Maternal
              </text>
            </g>
          )}
          {isAncestorView && sideLabels?.paternal?.visible && (
            <g
              transform={`translate(${sideLabels.paternal.x}, ${sideLabels.paternal.y})`}
              className="garden-side-tag"
            >
              <text
                x={28}
                y={0}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={11.5}
                fontWeight={600}
                fill="var(--muted-fg)"
              >
                Paternal
              </text>
              <circle cx={36} cy={0} r={3.5} fill="var(--paternal)" />
            </g>
          )}
        </g>
      </svg>

      {hudHost
        ? createPortal(
            <>
              {!isAncestorView && !hasTooltip && (
                <div className="wheel-direction-badge">Descendant garden</div>
              )}

              {previewPetal?.person ? (
                <div className="wheel-tooltip glass">
                  <strong>{previewPetal.person.name}</strong>
                  {formatLifespan(previewPetal.person.birth, previewPetal.person.death) && (
                    <span className="wheel-tooltip-dates">
                      {formatLifespan(previewPetal.person.birth, previewPetal.person.death)}
                    </span>
                  )}
                  <span className="wheel-tooltip-meta">
                    {previewPetal.relLabel ||
                      generationLabel(
                        previewPetal.generation,
                        viewDirection,
                        previewPetal.side,
                        previewPetal.isSibling,
                      )}
                    {previewPetal.hasMore && !previewPetal.isSprouted
                      ? " · Click to sprout branch"
                      : previewPetal.hasMore
                        ? " · Branch sprouted"
                        : ""}
                  </span>
                </div>
              ) : previewBud ? (
                <div className="wheel-tooltip glass">
                  <strong>Add {previewBud.slot}</strong>
                  <span className="wheel-tooltip-meta">
                    of {family[previewBud.childId]?.name || "person"} · Click to grow your garden
                  </span>
                </div>
              ) : previewSpouse?.person ? (
                <div className="wheel-tooltip glass">
                  <strong>{previewSpouse.person.name}</strong>
                  {formatLifespan(previewSpouse.person.birth, previewSpouse.person.death) && (
                    <span className="wheel-tooltip-dates">
                      {formatLifespan(previewSpouse.person.birth, previewSpouse.person.death)}
                    </span>
                  )}
                  <span className="wheel-tooltip-meta">
                    Spouse · Click to inspect · Double-click to center
                  </span>
                </div>
              ) : isAncestorView &&
                sibAnchorPid &&
                sibAnchorPid !== centerId &&
                garden?.hasSiblings ? (
                <div className="wheel-sibling-hint scaleIn">
                  <span className="wheel-sibling-dash" />
                  Siblings shown with dashed petals · click again to hide
                  <span className="wheel-sibling-dash" />
                </div>
              ) : showEmptyTreePrompt ? (
                <div className="wheel-empty-prompt wheel-tooltip glass">
                  <span className="wheel-tooltip-meta">
                    Click a + Mother or + Father bud to grow your garden
                  </span>
                </div>
              ) : null}
            </>,
            hudHost,
          )
        : null}
    </div>
  );
}
