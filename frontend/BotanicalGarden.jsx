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

function computePetalLabelLayout(petal) {
  const name = petal.person?.name || "";
  const { first, rest } = splitDisplayName(name);
  const halfW = petal.halfW || 24;
  const len = petal.len || 60;
  // Tapered botanical petal belly width with comfortable inner margin so white
  // labels always remain strictly inside the petal fill.
  const availW = Math.max(18, halfW * 1.38);

  // Tiny outer petals: crisp 2-letter initials
  if (halfW < 18 || len < 42 || availW < 28) {
    return {
      mode: "initials",
      primary: getInitials(name),
      secondary: "",
      primarySize: 9,
      secondarySize: 0,
    };
  }

  // Hero Gen 1 petals: two-line full name
  if (petal.generation === 1 && !petal.isSibling) {
    const primarySize = halfW >= 44 ? 13.5 : 12;
    const secondarySize = halfW >= 44 ? 9.5 : 8.5;
    const firstMax = Math.max(3, Math.min(12, Math.floor(availW / (primarySize * 0.62))));
    const restMax = Math.max(3, Math.min(13, Math.floor(availW / (secondarySize * 0.62))));
    return {
      mode: rest ? "two-line" : "single",
      primary: truncateLabel(first, firstMax),
      secondary: rest ? truncateLabel(rest, restMax) : "",
      primarySize,
      secondarySize,
    };
  }

  // Gen 2 petals or generous Gen 1 sibling petals
  if ((petal.generation === 2 && !petal.isSibling && halfW >= 24 && len >= 64) || (petal.generation === 1 && petal.isSibling && halfW >= 26)) {
    const primarySize = petal.isSibling ? 10 : 11;
    const secondarySize = 8.2;
    const firstMax = Math.max(3, Math.min(10, Math.floor(availW / (primarySize * 0.63))));
    const restMax = Math.max(3, Math.min(11, Math.floor(availW / (secondarySize * 0.63))));
    const showTwoLine = Boolean(rest && len >= 70 && halfW >= 28);
    return {
      mode: showTwoLine ? "two-line" : "single",
      primary: truncateLabel(first, firstMax),
      secondary: showTwoLine ? truncateLabel(rest, restMax) : "",
      primarySize,
      secondarySize,
    };
  }

  // Outer petals (Gen 3+ or compact siblings): first name only, or initials if narrow
  const primarySize = petal.generation <= 3 ? 9.5 : 8.8;
  const firstMax = Math.floor(availW / (primarySize * 0.64));
  if (firstMax < 3) {
    return {
      mode: "initials",
      primary: getInitials(name),
      secondary: "",
      primarySize: 8.8,
      secondarySize: 0,
    };
  }
  return {
    mode: "single",
    primary: truncateLabel(first, Math.min(10, firstMax)),
    secondary: "",
    primarySize,
    secondarySize: 0,
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

          {/* Subtle petal sheen overlay */}
          <linearGradient id="garden-petal-sheen" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="var(--garden-focus-inner)" stopOpacity="0.22" />
            <stop offset="55%" stopColor="var(--garden-focus-inner)" stopOpacity="0.04" />
            <stop offset="100%" stopColor="var(--garden-stamen-ring)" stopOpacity="0.18" />
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

        {/* Layer 2: Main lower stem & ground leaves */}
        {mainStem && (
          <g className="garden-main-stem-layer" aria-hidden="true">
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
                  onMouseEnter={() => setHoverBudKey(bud.key)}
                  onMouseLeave={() => setHoverBudKey((cur) => (cur === bud.key ? null : cur))}
                  onFocus={() => setFocusBudKey(bud.key)}
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
                    cx={bud.x}
                    cy={bud.y - budR * 0.4}
                    r={hitR}
                    fill="transparent"
                  />
                  <g transform={`translate(${bud.x}, ${bud.y}) rotate(${bud.angleDeg || 0})`}>
                    <path
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

        {/* Layer 5: Companion spouse leaf-blooms on lower stem */}
        {spouses.length > 0 && (
          <g className="garden-spouses-layer">
            {spouses.map((s) => {
              const isSelected = selectedPid === s.personId;
              const isHover = hoverSpouseId === s.personId;
              const isFocused = focusSpouseId === s.personId;
              const spouseName = s.person?.name || "Spouse";
              const spouseLife = formatLifespan(s.person?.birth, s.person?.death);
              const { first } = splitDisplayName(spouseName);
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
                  onMouseEnter={() => setHoverSpouseId(s.personId)}
                  onMouseLeave={() => setHoverSpouseId((cur) => (cur === s.personId ? null : cur))}
                  onFocus={() => setFocusSpouseId(s.personId)}
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
                  <circle cx={s.labelX} cy={s.labelY} r={hitR} fill="transparent" />
                  <g transform={`translate(${s.cx}, ${s.cy}) rotate(${s.angleDeg})`}>
                    <path
                      d={s.pathD}
                      fill="var(--garden-spouse)"
                      fillOpacity={isSelected || isHover ? 0.98 : 0.88}
                      stroke="var(--garden-stamen-ring)"
                      strokeWidth={isSelected ? 2.2 : 1.3}
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
                        strokeOpacity={0.28}
                        strokeWidth={1}
                        strokeLinecap="round"
                        style={{ pointerEvents: "none" }}
                      />
                    )}
                  </g>
                  {/* Always-upright spouse label */}
                  <text
                    x={s.labelX}
                    y={s.labelY}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="var(--garden-petal-text)"
                    className="garden-petal-label"
                    style={{ pointerEvents: "none" }}
                  >
                    <tspan x={s.labelX} dy="-0.32em" fontSize={10.5} fontWeight={700}>
                      {truncateLabel(first, 10)}
                    </tspan>
                    <tspan x={s.labelX} dy="1.2em" fontSize={7.8} fontWeight={500} opacity={0.92}>
                      Spouse
                    </tspan>
                  </text>
                </g>
              );
            })}
          </g>
        )}

        {/* Layer 6: Person petals (siblings first, then main petals; stable DOM order) */}
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

            const fillOpacity = isHover || isSelected || isFocused
              ? 0.98
              : isDimmed
                ? p.isSibling
                  ? 0.42
                  : 0.56
                : p.isSibling
                  ? 0.78
                  : 0.92;

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
                onMouseEnter={() => setHoverKey(p.key)}
                onMouseLeave={() => setHoverKey((cur) => (cur === p.key ? null : cur))}
                onFocus={() => setFocusKey(p.key)}
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
                    strokeOpacity={p.isSibling ? 0.72 : inTrail ? 0.92 : 0.42}
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
                      strokeOpacity={0.26}
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
                <text
                  x={p.labelX}
                  y={p.labelY}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="var(--garden-petal-text)"
                  className="garden-petal-label"
                  style={{ pointerEvents: "none" }}
                >
                  {label.mode === "two-line" ? (
                    <>
                      <tspan
                        x={p.labelX}
                        dy="-0.34em"
                        fontSize={label.primarySize}
                        fontWeight={p.isSibling ? 600 : 700}
                      >
                        {label.primary}
                      </tspan>
                      <tspan
                        x={p.labelX}
                        dy="1.18em"
                        fontSize={label.secondarySize}
                        fontWeight={500}
                        opacity={0.94}
                      >
                        {label.secondary}
                      </tspan>
                    </>
                  ) : (
                    <tspan
                      x={p.labelX}
                      dy="0.04em"
                      fontSize={label.primarySize}
                      fontWeight={label.mode === "initials" ? 700 : 600}
                    >
                      {label.primary}
                    </tspan>
                  )}
                </text>
              </g>
            );
          })}
        </g>

        {/* Layer 7: Unlabeled golden seed-head circles for satellite blooms */}
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

        {/* Layer 8: Hero golden pollen-ringed stamen hub */}
        <g
          role="button"
          tabIndex={0}
          data-center-person-id={centerId}
          aria-pressed={selectedPid === centerId}
          aria-label={`Select ${center?.name ?? "center person"}`}
          className={`garden-hub${selectedPid === centerId ? " is-selected" : ""}${focusHub ? " is-focused" : ""}`}
          onFocus={() => setFocusHub(true)}
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

        {/* Layer 9: Top lift & focus-ring layer (preserves DOM tab order) + Maternal/Paternal markers */}
        <g className="garden-lift-layer" aria-hidden="true" style={{ pointerEvents: "none" }}>
          {liftPetals.map(({ petal: p, isSelected, isHovered, isFocused }) => (
            <g key={`lift-${p.key}`} transform={`translate(${p.cx}, ${p.cy}) rotate(${p.angleDeg})`}>
              {isFocused ? (
                <>
                  <path
                    d={p.pathD}
                    fill="none"
                    stroke="var(--garden-focus-outer)"
                    strokeWidth={5.5}
                    strokeLinejoin="round"
                  />
                  <path
                    d={p.pathD}
                    fill="none"
                    stroke="var(--garden-focus-inner)"
                    strokeWidth={2.5}
                    strokeLinejoin="round"
                  />
                </>
              ) : (
                <path
                  d={p.pathD}
                  fill="none"
                  stroke={isSelected ? "var(--garden-focus-outer)" : "var(--garden-focus-inner)"}
                  strokeWidth={isSelected ? 3.2 : isHovered ? 2.2 : 0}
                  strokeOpacity={isSelected ? 0.95 : 0.85}
                  strokeLinejoin="round"
                />
              )}
            </g>
          ))}

          {liftSpouses.map(({ spouse: s, isSelected, isHovered, isFocused }) => (
            <g key={`lift-spouse-${s.key}`} transform={`translate(${s.cx}, ${s.cy}) rotate(${s.angleDeg})`}>
              {isFocused ? (
                <>
                  <path
                    d={s.pathD}
                    fill="none"
                    stroke="var(--garden-focus-outer)"
                    strokeWidth={5}
                    strokeLinejoin="round"
                  />
                  <path
                    d={s.pathD}
                    fill="none"
                    stroke="var(--garden-focus-inner)"
                    strokeWidth={2.2}
                    strokeLinejoin="round"
                  />
                </>
              ) : (
                <path
                  d={s.pathD}
                  fill="none"
                  stroke={isSelected ? "var(--garden-focus-outer)" : "var(--garden-focus-inner)"}
                  strokeWidth={isSelected ? 2.8 : isHovered ? 2 : 0}
                  strokeLinejoin="round"
                />
              )}
            </g>
          ))}

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
            <circle
              cx={hub.x}
              cy={hub.y}
              r={hub.r + 2.5}
              fill="none"
              stroke="var(--garden-focus-outer)"
              strokeWidth={3}
            />
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
