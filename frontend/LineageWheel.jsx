import React from "react";
import { createPortal } from "react-dom";
import wheel from "../src/domain/wheel";
import format from "./format";
import { ChartHudContext } from "./ChartViewport";

const {
  SIZE,
  CX,
  CY,
  CENTER_R,
  MAX_GEN,
  RW,
  polar,
  wedgePath,
  arcPath,
  genColor,
  getSpouses,
  fanGeometry,
  buildWheel,
  buildDescendantWheel,
} = wheel;
const { getInitials, splitDisplayName, truncateLabel, formatLifespan, generationLabel } = format;

export default function LineageWheel({
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
  const [hoverSpouseId, setHoverSpouseId] = React.useState(null);
  const hudHost = React.useContext(ChartHudContext);
  const center = family[centerId];
  const spouses = getSpouses(centerId, family);
  const isAncestorView = viewDirection === "ancestors";

  React.useEffect(() => {
    setHoverKey(null);
    setHoverSpouseId(null);
  }, [centerId, viewDirection]);

  // When a sibling is individually selected it becomes dominant; otherwise no dominant
  const dominantSibId =
    isAncestorView && selectedPid && sibAnchorPid && selectedPid !== sibAnchorPid
      ? selectedPid
      : null;

  const { wedges } = React.useMemo(() => {
    if (isAncestorView) {
      return buildWheel(centerId, family, expanded, sibAnchorPid, dominantSibId);
    }
    return buildDescendantWheel(centerId, family, expanded);
  }, [centerId, family, expanded, sibAnchorPid, dominantSibId, isAncestorView]);

  // Rotation: spin the dominant sibling (if selected) or the anchor to 12 o'clock
  const rotationTargetKey = isAncestorView ? dominantSibId || sibAnchorPid : selectedPid;
  const anchorWedge = rotationTargetKey
    ? wedges.find((w) => w.person?.id === rotationTargetKey)
    : null;
  const wheelRotDeg = React.useMemo(() => {
    if (!anchorWedge) return 0;
    const mid = (anchorWedge.startAngle + anchorWedge.endAngle) / 2;
    return 270 - (mid * 180) / Math.PI;
  }, [anchorWedge]);
  const wheelRotRad = (wheelRotDeg * Math.PI) / 180;

  const occupiedSpouseAngles = React.useMemo(
    () =>
      wedges
        .filter((w) => w.person && w.generation <= 3)
        .map((w) => {
          const start = w.startAngle + wheelRotRad;
          const end = w.endAngle + wheelRotRad;
          return {
            mid: (start + end) / 2,
            half: Math.abs(end - start) / 2 + 0.18,
          };
        }),
    [wedges, wheelRotRad],
  );

  const hoveredWedge = React.useMemo(
    () => (hoverKey ? wedges.find((w) => w.key === hoverKey) || null : null),
    [wedges, hoverKey],
  );
  const selectedWedge = React.useMemo(
    () => (selectedPid ? wedges.find((w) => w.person?.id === selectedPid) || null : null),
    [wedges, selectedPid],
  );
  const activeTrail = React.useMemo(() => {
    const source = hoveredWedge?.person ? hoveredWedge : selectedWedge;
    return new Set(source?.trail || []);
  }, [hoveredWedge, selectedWedge]);

  const renderedWedges = React.useMemo(
    () =>
      [...wedges].sort((a, b) => {
        const ap =
          (activeTrail.has(a.key) ? 1 : 0) +
          (selectedPid === a.person?.id ? 2 : 0) +
          (hoverKey === a.key ? 4 : 0);
        const bp =
          (activeTrail.has(b.key) ? 1 : 0) +
          (selectedPid === b.person?.id ? 2 : 0) +
          (hoverKey === b.key ? 4 : 0);
        return ap - bp;
      }),
    [wedges, activeTrail, selectedPid, hoverKey],
  );

  const initials = getInitials(center?.name);
  const centerLifespan = formatLifespan(center?.birth, center?.death);
  const { startAngle, sweep } = fanGeometry();
  const maternalLabelPos = polar(CX, CY, CENTER_R + MAX_GEN * RW + 22, startAngle + 0.14);
  const paternalLabelPos = polar(CX, CY, CENTER_R + MAX_GEN * RW + 22, startAngle + sweep - 0.14);

  function labelRotation(w, wheelRot) {
    const mid = (w.startAngle + w.endAngle) / 2;
    const midDeg = (mid * 180) / Math.PI + wheelRot;
    let deg = midDeg + 90;
    const n = ((deg % 360) + 360) % 360;
    if (n > 90 && n < 270) deg -= 180;
    return deg - wheelRot;
  }

  function angleDistance(a, b) {
    return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  }

  function spouseAngleIsOpen(angle) {
    return !occupiedSpouseAngles.some(
      (range) => angleDistance(angle, range.mid) <= range.half,
    );
  }

  function openSpouseAngle(preferredAngle) {
    if (spouseAngleIsOpen(preferredAngle)) return preferredAngle;
    const step = 0.035;
    for (let delta = step; delta <= Math.PI; delta += step) {
      const below = preferredAngle - delta;
      if (spouseAngleIsOpen(below)) return below;
      const above = preferredAngle + delta;
      if (spouseAngleIsOpen(above)) return above;
    }
    return preferredAngle;
  }

  const hoveredSpouse = hoverSpouseId ? spouses.find((s) => s.id === hoverSpouseId) || null : null;

  return (
    <div className="lineage-wheel">
      <div className="wheel-ambient-glow" aria-hidden="true" />
      <svg className="wheel-svg" viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <defs>
          <linearGradient id="cg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(276, 82%, 66%)" />
            <stop offset="55%" stopColor="hsl(232, 85%, 64%)" />
            <stop offset="100%" stopColor="hsl(198, 92%, 60%)" />
          </linearGradient>
          <radialGradient id="hub-sheen" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="hsl(0, 0%, 100%)" stopOpacity="0.24" />
            <stop offset="100%" stopColor="hsl(230, 30%, 7%)" stopOpacity="0.16" />
          </radialGradient>
        </defs>

        {/* Guide rings */}
        {Array.from({ length: MAX_GEN + 1 }).map((_, i) => (
          <circle
            key={i}
            cx={CX}
            cy={CY}
            r={CENTER_R + i * RW}
            fill="none"
            stroke="hsl(230, 28%, 26%)"
            strokeWidth={i === MAX_GEN ? 0.9 : 0.6}
            strokeDasharray={i === 0 ? undefined : "2 6"}
            opacity={i === MAX_GEN ? 0.45 : 0.28}
          />
        ))}

        {/* Wedges */}
        <g
          className="wheel-rotor"
          style={{
            transformOrigin: `${CX}px ${CY}px`,
            transform: `rotate(${wheelRotDeg}deg)`,
          }}
        >
          {renderedWedges.map((w) => {
            const isHover = hoverKey === w.key;
            const isSelected = Boolean(w.person && selectedPid === w.person.id);
            const inTrail = activeTrail.has(w.key);
            const hasPerson = Boolean(w.person);
            const canAddHere = Boolean(!hasPerson && canEdit && w.parentChildId && w.slot && onEmptySlotClick);
            const color = genColor(w.generation);
            const labelRot = labelRotation(w, wheelRotDeg);
            const labelWidth = ((w.endAngle - w.startAngle) * (w.innerRadius + w.outerRadius)) / 2;
            const maxChars = Math.max(3, Math.floor(labelWidth / 7.2));
            const { first, rest } = hasPerson ? splitDisplayName(w.person.name) : { first: "", rest: "" };
            const parentName = w.parentChildId ? family[w.parentChildId]?.name : "";
            const lifespan = hasPerson ? formatLifespan(w.person.birth, w.person.death) : "";

            const fillOpacity = hasPerson
              ? isHover || isSelected
                ? 0.98
                : activeTrail.size > 0
                  ? inTrail
                    ? 0.9
                    : w.isSibling
                      ? 0.38
                      : 0.54
                  : w.isSibling
                    ? 0.68
                    : 0.84
              : canAddHere && isHover
                ? 0.42
                : 0.16;

            const arcPad = Math.min(0.03, (w.endAngle - w.startAngle) * 0.22);

            return (
              <g
                key={w.key}
                className={`wheel-wedge${hasPerson || canAddHere ? " is-interactive" : ""}${isHover ? " is-hovered" : ""}`}
                role={hasPerson || canAddHere ? "button" : undefined}
                tabIndex={hasPerson || canAddHere ? 0 : undefined}
                aria-label={
                  hasPerson
                    ? `${w.person.name}${w.isSibling ? ", sibling" : ""}. Enter to select; R to center.`
                    : canAddHere
                      ? `Add ${w.slot} of ${parentName || "person"}`
                      : undefined
                }
                style={{ transformOrigin: `${CX}px ${CY}px` }}
                onMouseEnter={() => (hasPerson || canAddHere) && setHoverKey(w.key)}
                onMouseLeave={() => setHoverKey((current) => (current === w.key ? null : current))}
                onClick={(e) => {
                  e.stopPropagation();
                  if (hasPerson) onWedgeClick(w.person.id, w.isSibling);
                  else if (canAddHere) onEmptySlotClick(w.parentChildId, w.slot);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (hasPerson) onWedgeDoubleClick(w.person.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (hasPerson) onWedgeClick(w.person.id, w.isSibling);
                    else if (canAddHere) onEmptySlotClick(w.parentChildId, w.slot);
                  } else if (hasPerson && e.key.toLowerCase() === "r") {
                    e.preventDefault();
                    onWedgeDoubleClick(w.person.id);
                  }
                }}
              >
                {hasPerson && (
                  <title>
                    {w.person.name}
                    {lifespan ? ` (${lifespan})` : ""}
                  </title>
                )}
                {canAddHere && (
                  <title>{`Add ${w.slot} of ${parentName || "person"}`}</title>
                )}
                <path
                  data-person-id={w.person?.id ?? ""}
                  data-generation={w.generation}
                  data-sibling={w.isSibling ? "true" : "false"}
                  data-slot={w.slot ?? ""}
                  data-start-angle={w.startAngle}
                  data-end-angle={w.endAngle}
                  d={w.path}
                  fill={hasPerson ? color : "hsl(230, 22%, 18%)"}
                  fillOpacity={fillOpacity}
                  stroke={
                    isSelected
                      ? "hsl(280, 92%, 76%)"
                      : isHover && hasPerson
                        ? "hsl(40, 30%, 96%)"
                        : canAddHere && isHover
                          ? "hsl(280, 85%, 68%)"
                          : inTrail && activeTrail.size > 1
                            ? "hsl(200, 90%, 72%)"
                            : "hsl(230, 30%, 7%)"
                  }
                  strokeWidth={isSelected ? 3 : isHover ? 2.2 : w.isSibling ? 1.5 : 1.75}
                  strokeDasharray={w.isSibling ? "6 3" : canAddHere ? "4 4" : undefined}
                  style={{
                    filter:
                      isHover || isSelected
                        ? `drop-shadow(0 0 12px ${hasPerson ? color : "hsl(280, 85%, 65%)"})`
                        : "none",
                    transition: "fill-opacity 0.2s ease, stroke 0.2s ease, filter 0.2s ease",
                  }}
                />
                {hasPerson && w.hasMore && w.endAngle - w.startAngle > 0.05 && (
                  <path
                    d={arcPath(CX, CY, w.outerRadius - 3, w.startAngle + arcPad, w.endAngle - arcPad)}
                    fill="none"
                    stroke="hsl(40, 40%, 96%)"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    opacity={isHover || isSelected ? 0.95 : 0.55}
                    style={{ pointerEvents: "none" }}
                  />
                )}
                {hasPerson && labelWidth >= 20 && (
                  <text
                    x={w.labelPos.x}
                    y={w.labelPos.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={w.generation <= 1 ? 15.5 : w.generation <= 2 ? 12.5 : w.generation === 3 ? 11 : 10}
                    fontWeight={w.isSibling ? 500 : 600}
                    fill={w.isSibling ? "hsl(40, 25%, 86%)" : "hsl(40, 30%, 97%)"}
                    transform={`rotate(${labelRot} ${w.labelPos.x} ${w.labelPos.y})`}
                    className="wheel-label"
                  >
                    <tspan x={w.labelPos.x} dy={rest ? "-0.32em" : "0.05em"}>
                      {truncateLabel(first, maxChars)}
                    </tspan>
                    {rest && (
                      <tspan
                        x={w.labelPos.x}
                        dy="1.15em"
                        fontSize={w.generation <= 2 ? 10 : 8.5}
                        fontWeight={400}
                        opacity={0.88}
                      >
                        {truncateLabel(rest, maxChars + 2)}
                      </tspan>
                    )}
                  </text>
                )}
                {canAddHere && labelWidth >= 26 && (isHover || w.generation <= 2) && (
                  <text
                    x={w.labelPos.x}
                    y={w.labelPos.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={isHover ? 16 : 13}
                    fontWeight={600}
                    fill={isHover ? "hsl(280, 90%, 82%)" : "hsl(230, 18%, 55%)"}
                    transform={`rotate(${labelRot} ${w.labelPos.x} ${w.labelPos.y})`}
                    style={{ pointerEvents: "none" }}
                  >
                    {isHover ? `+ ${w.slot === "mother" ? "Mother" : "Father"}` : "+"}
                  </text>
                )}
              </g>
            );
          })}

          {/* Dynamic orientation labels anchored to the fan sides */}
          {isAncestorView && (
            <>
              <g
                transform={`translate(${maternalLabelPos.x}, ${maternalLabelPos.y}) rotate(${-wheelRotDeg})`}
                className="wheel-side-tag"
                aria-hidden="true"
              >
                <circle cx={-34} cy={0} r={3.5} fill="var(--maternal)" />
                <text x={-26} y={0} dominantBaseline="middle" fontSize={11} fontWeight={500} fill="var(--muted-fg)">
                  Maternal
                </text>
              </g>
              <g
                transform={`translate(${paternalLabelPos.x}, ${paternalLabelPos.y}) rotate(${-wheelRotDeg})`}
                className="wheel-side-tag"
                aria-hidden="true"
              >
                <text x={24} y={0} textAnchor="end" dominantBaseline="middle" fontSize={11} fontWeight={500} fill="var(--muted-fg)">
                  Paternal
                </text>
                <circle cx={32} cy={0} r={3.5} fill="var(--paternal)" />
              </g>
            </>
          )}
        </g>

        {/* Spouse wedges */}
        {spouses.slice(0, 6).map((spouse, i) => {
          const rightSide = i < 3;
          const shownCount = Math.min(spouses.length, 6);
          const rightCount = Math.min(shownCount, 3);
          const leftCount = Math.max(0, shownCount - 3);
          const sideIndex = rightSide ? i : i - 3;
          const sideCount = rightSide ? rightCount : leftCount;
          const offsets =
            sideCount === 1
              ? [0]
              : sideCount === 2
                ? [-0.18, 0.18]
                : [-0.32, 0, 0.32];
          const baseMid = (rightSide ? 0 : Math.PI) + offsets[sideIndex];
          const visualMid = openSpouseAngle(baseMid + wheelRotRad);
          const spouseRotDeg = ((visualMid - baseMid) * 180) / Math.PI;
          const a0 = baseMid - 0.12;
          const a1 = baseMid + 0.12;
          const label = polar(CX, CY, CENTER_R + 68, baseMid);
          const spouseInitials = getInitials(spouse.name);
          const spouseLifespan = formatLifespan(spouse.birth, spouse.death);
          const isSelected = selectedPid === spouse.id;
          const isHover = hoverSpouseId === spouse.id;

          return (
            <g
              key={spouse.id}
              className="scaleIn wheel-spouse"
              role="button"
              tabIndex={0}
              aria-label={`${spouse.name}, spouse. Enter to select; R to center.`}
              style={{
                transformOrigin: `${CX}px ${CY}px`,
                transform: `rotate(${spouseRotDeg}deg)`,
              }}
              onMouseEnter={() => setHoverSpouseId(spouse.id)}
              onMouseLeave={() => setHoverSpouseId((current) => (current === spouse.id ? null : current))}
              onClick={(e) => {
                e.stopPropagation();
                onSpouseClick(spouse.id);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onWedgeDoubleClick(spouse.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSpouseClick(spouse.id);
                } else if (e.key.toLowerCase() === "r") {
                  e.preventDefault();
                  onWedgeDoubleClick(spouse.id);
                }
              }}
            >
              <title>
                {spouse.name} (Spouse{spouseLifespan ? ` · ${spouseLifespan}` : ""})
              </title>
              <path
                d={wedgePath(CX, CY, CENTER_R + 4, CENTER_R + 84, a0, a1)}
                fill="hsl(316, 62%, 44%)"
                fillOpacity={isSelected || isHover ? 0.96 : 0.78}
                stroke={
                  isSelected
                    ? "hsl(280, 92%, 76%)"
                    : isHover
                      ? "hsl(40, 30%, 96%)"
                      : "hsl(230, 30%, 7%)"
                }
                strokeWidth={isSelected ? 3 : 2}
                style={{
                  filter:
                    isSelected || isHover
                      ? "drop-shadow(0 0 12px hsl(316, 70%, 56%))"
                      : "none",
                  transition: "fill-opacity 0.2s ease, stroke 0.2s ease, filter 0.2s ease",
                }}
              />
              <g
                className="wheel-spouse-label"
                style={{
                  transformOrigin: `${label.x}px ${label.y}px`,
                  transform: `rotate(${-spouseRotDeg}deg)`,
                }}
              >
                <text
                  x={label.x}
                  y={label.y - 5}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={12}
                  fontWeight={700}
                  fill="hsl(40, 30%, 97%)"
                  className="wheel-label"
                >
                  {spouseInitials}
                </text>
                <text
                  x={label.x}
                  y={label.y + 10}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={7.5}
                  fontWeight={600}
                  fill="hsl(40, 30%, 96%)"
                  opacity={0.9}
                  className="wheel-label"
                >
                  Spouse
                </text>
              </g>
            </g>
          );
        })}

        {/* Center hub */}
        <g
          role="button"
          tabIndex={0}
          data-center-person-id={centerId}
          aria-label={`Select ${center?.name ?? "center person"}`}
          className="wheel-hub"
          onClick={(e) => {
            e.stopPropagation();
            onCenterClick();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onCenterClick();
            }
          }}
        >
          <title>
            {center?.name ?? ""}
            {centerLifespan ? ` (${centerLifespan})` : ""}
          </title>
          <circle cx={CX} cy={CY} r={CENTER_R} fill="url(#cg)" className="pulse" />
          <circle cx={CX} cy={CY} r={CENTER_R} fill="url(#hub-sheen)" />
          <circle
            cx={CX}
            cy={CY}
            r={CENTER_R - 5}
            fill="none"
            stroke="hsl(40, 30%, 96%)"
            strokeOpacity={0.28}
            strokeWidth={1.2}
          />
          <text
            x={CX}
            y={CY - (centerLifespan ? 14 : 9)}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={28}
            fontWeight={700}
            fill="hsl(230, 32%, 8%)"
            className="fd"
          >
            {initials}
          </text>
          <text
            x={CX}
            y={CY + (centerLifespan ? 14 : 18)}
            textAnchor="middle"
            fontSize={11.5}
            fontWeight={600}
            fill="hsl(230, 32%, 8%)"
            opacity={0.9}
          >
            {truncateLabel(center?.name ?? "", 16)}
          </text>
          {centerLifespan && (
            <text
              x={CX}
              y={CY + 32}
              textAnchor="middle"
              fontSize={9.5}
              fontWeight={500}
              fill="hsl(230, 32%, 8%)"
              opacity={0.72}
            >
              {truncateLabel(centerLifespan, 16)}
            </text>
          )}
        </g>
      </svg>

      {hudHost ? createPortal(
        <>
          {!isAncestorView && (
            <div className="wheel-direction-badge">
              Descendant line
            </div>
          )}

          {/* Floating hover preview HUD or sibling hint */}
          {hoveredWedge?.person ? (
            <div className="wheel-tooltip glass">
              <strong>{hoveredWedge.person.name}</strong>
              {formatLifespan(hoveredWedge.person.birth, hoveredWedge.person.death) && (
                <span className="wheel-tooltip-dates">
                  {formatLifespan(hoveredWedge.person.birth, hoveredWedge.person.death)}
                </span>
              )}
              <span className="wheel-tooltip-meta">
                {generationLabel(hoveredWedge.generation, viewDirection, hoveredWedge.lineageSide, hoveredWedge.isSibling)}
                {hoveredWedge.hasMore ? " · Has more generations" : ""}
              </span>
            </div>
          ) : hoveredWedge && canEdit && hoveredWedge.parentChildId ? (
            <div className="wheel-tooltip glass">
              <strong>Add {hoveredWedge.slot}</strong>
              <span className="wheel-tooltip-meta">
                of {family[hoveredWedge.parentChildId]?.name || "person"} · Click to open form
              </span>
            </div>
          ) : hoveredSpouse ? (
            <div className="wheel-tooltip glass">
              <strong>{hoveredSpouse.name}</strong>
              {formatLifespan(hoveredSpouse.birth, hoveredSpouse.death) && (
                <span className="wheel-tooltip-dates">
                  {formatLifespan(hoveredSpouse.birth, hoveredSpouse.death)}
                </span>
              )}
              <span className="wheel-tooltip-meta">Spouse · Click to inspect · Double-click to center</span>
            </div>
          ) : isAncestorView && sibAnchorPid && sibAnchorPid !== centerId ? (
            <div className="wheel-sibling-hint scaleIn">
              <span className="wheel-sibling-dash" />
              Siblings shown with dashed border · click again to hide
              <span className="wheel-sibling-dash" />
            </div>
          ) : null}
        </>,
        hudHost,
      ) : null}
    </div>
  );
}
