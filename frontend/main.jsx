import React from "react";
import * as ReactDOM from "react-dom/client";
import "./styles.css";

import { loadFamilyData, savePerson, listTrees } from './data';
import PersonEditor from './PersonEditor';
import LocalMigration from './LocalMigration';
import FamilyDetails from './FamilyDetails';
import ChartViewport from './ChartViewport';
import Modal from './Modal';
import { PeopleDrawer, ToolsDrawer, useMobileLayout } from './WorkspacePanels';
import PersonRecords from './PersonRecords';
import DatabaseRecovery from './DatabaseRecovery';
import GedcomExchange from './GedcomExchange';
import DuplicateReview from './DuplicateReview';
import AccessBoundary, { PrivacyEditor } from './Access';
import Sharing from './Sharing';
import navigationTools from '../src/domain/navigation';
const { resolveNavigationPerson } = navigationTools;
import graph from '../src/domain/graph';
import archiveTools from '../src/domain/archive';
const { fingerprint } = archiveTools;
import { loadLocalState, preserveRecovery } from './storage';
import ArchiveControls from './ArchiveControls';

import wheel from "../src/domain/wheel";
const { SIZE, CX, CY, CENTER_R, MAX_GEN, RW, polar, wedgePath, genColor, getSiblings, getChildren, getSpouses, getSpouse, fanGeometry, insetAngles, buildWheel, buildDescendantWheel } = wheel;

const Ic = ({ d, size = 16 }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);
const IcTree = () => (
  <Ic
    size={20}
    d="M12 22V12M12 12C12 12 7 9 7 5a5 5 0 0 1 10 0c0 4-5 7-5 7zM5 22h14"
  />
);
const IcX = () => <Ic d="M18 6 6 18M6 6l12 12" />;
const IcTarget = () => (
  <svg
    viewBox="0 0 24 24"
    width={16}
    height={16}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="22" y1="12" x2="18" y2="12" />
    <line x1="6" y1="12" x2="2" y2="12" />
    <line x1="12" y1="6" x2="12" y2="2" />
    <line x1="12" y1="22" x2="12" y2="18" />
  </svg>
);
const IcInfo = () => (
  <svg
    viewBox="0 0 24 24"
    width={16}
    height={16}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);
const IcUser = () => (
  <svg
    viewBox="0 0 24 24"
    width={24}
    height={24}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);
const IcPlus = () => <Ic d="M12 5v14M5 12h14" />;
const IcChevs = () => (
  <svg
    viewBox="0 0 24 24"
    width={14}
    height={14}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m7 15 5 5 5-5" />
    <path d="m7 9 5-5 5 5" />
  </svg>
);
const IcSibling = () => (
  <svg
    viewBox="0 0 24 24"
    width={14}
    height={14}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="9" cy="7" r="3" />
    <circle cx="15" cy="7" r="3" />
    <path d="M3 21v-2a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v2" />
  </svg>
);

// ─── LINEAGE WHEEL ────────────────────────────────────────────────────────────
/**
 * The main React component that renders the interactive SVG fan chart.
 * Supports switching between Ancestor and Descendant views, smooth animations
 * for zooming/rotating, and interactivity (hover, click, double-click) for wedges.
 */
function LineageWheel({
  centerId,
  family,
  expanded,
  selectedPid,
  sibAnchorPid,
  viewDirection,
  canGoBack,
  onWedgeClick,
  onWedgeDoubleClick,
  onCenterClick,
  onHistoryBack,
  onSpouseClick,
}) {
  const [hoverKey, setHoverKey] = React.useState(null);
  const center = family[centerId];
  const spouses = getSpouses(centerId, family);
  const isAncestorView = viewDirection === "ancestors";

  // When a sibling is individually selected it becomes dominant; otherwise no dominant
  const dominantSibId =
    isAncestorView && selectedPid && sibAnchorPid && selectedPid !== sibAnchorPid
      ? selectedPid
      : null;

  // Build wheel — dominant sibling gets extra leaf slots so its wedge is wider
  const { wedges } = React.useMemo(
    () => {
      if (isAncestorView) {
        return buildWheel(
          centerId,
          family,
          expanded,
          sibAnchorPid,
          dominantSibId,
        );
      }
      return buildDescendantWheel(centerId, family, expanded);
    },
    [
      centerId,
      family,
      expanded,
      sibAnchorPid,
      dominantSibId,
      isAncestorView,
    ],
  );

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
  const renderedWedges = React.useMemo(
    () =>
      [...wedges].sort((a, b) => {
        const ap = (selectedPid === a.person?.id ? 1 : 0) + (hoverKey === a.key ? 2 : 0);
        const bp = (selectedPid === b.person?.id ? 1 : 0) + (hoverKey === b.key ? 2 : 0);
        return ap - bp;
      }),
    [wedges, selectedPid, hoverKey],
  );

  const initials =
    center?.name
      .split(" ")
      .map((p) => p[0])
      .slice(0, 2)
      .join("") ?? "?";
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

  return (
    <div
      className="lineage-wheel"
      style={{ position: "relative", width: "100%", height: "100%" }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(circle,hsl(280 90% 65%/0.35) 0%,transparent 70%)",
          filter: "blur(40px)",
        }}
      />
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{ width: "100%", display: "block", overflow: "visible" }}
      >
        <defs>
          <linearGradient id="cg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(280,85%,65%)" />
            <stop offset="100%" stopColor="hsl(200,95%,60%)" />
          </linearGradient>
        </defs>

        {/* Guide rings */}
        {Array.from({ length: MAX_GEN + 1 }).map((_, i) => (
          <circle
            key={i}
            cx={CX}
            cy={CY}
            r={CENTER_R + i * RW}
            fill="none"
            stroke="hsl(230,25%,20%)"
            strokeWidth={0.5}
            strokeDasharray="2 6"
            opacity={0.3}
          />
        ))}

        {/* Wedges */}
        <g
          style={{
            transformOrigin: `${CX}px ${CY}px`,
            transform: `rotate(${wheelRotDeg}deg)`,
            transition: "transform 0.7s cubic-bezier(0.34,1.3,0.64,1)",
          }}
        >
          {renderedWedges.map((w) => {
            const isHover = hoverKey === w.key;
            const isSelected = selectedPid === w.person?.id;
            const hasPerson = !!w.person;
            const color = genColor(w.generation);
            const labelRot = labelRotation(w, wheelRotDeg);
            const labelWidth = (w.endAngle - w.startAngle) * (w.innerRadius + w.outerRadius) / 2;
            const shorten = (value) => {
              const length = Math.max(3, Math.floor(labelWidth / 7));
              return value.length > length ? value.slice(0, length - 1) + '…' : value;
            };

            return (
              <g
                key={w.key}
                role={hasPerson ? "button" : undefined}
                tabIndex={hasPerson ? 0 : undefined}
                aria-label={
                  hasPerson
                    ? `${w.person.name}${w.isSibling ? ", sibling" : ""}. Enter to select; R to center.`
                    : undefined
                }
                style={{
                  transformOrigin: `${CX}px ${CY}px`,
                  transform: isHover ? "scale(1.026)" : "scale(1)",
                  transition: "transform 0.25s ease",
                  cursor: "pointer",
                  outline: "none",
                }}
                onMouseEnter={() => setHoverKey(w.key)}
                onMouseLeave={() => setHoverKey(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  onWedgeClick(w.person?.id ?? null, w.isSibling);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (w.person) onWedgeDoubleClick(w.person.id);
                }}
                onKeyDown={(e) => {
                  if (!w.person) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onWedgeClick(w.person.id, w.isSibling);
                  } else if (e.key.toLowerCase() === "r") {
                    e.preventDefault();
                    onWedgeDoubleClick(w.person.id);
                  }
                }}
              >
                {hasPerson && <title>{w.person.name}{w.person.birth ? ` (${w.person.birth})` : ''}</title>}
                <path
                  data-person-id={w.person?.id ?? ""}
                  data-generation={w.generation}
                  data-sibling={w.isSibling ? "true" : "false"}
                  data-start-angle={w.startAngle}
                  data-end-angle={w.endAngle}
                  d={w.path}
                  fill={hasPerson ? color : "hsl(230,20%,18%)"}
                  fillOpacity={
                    hasPerson
                      ? isHover || isSelected
                        ? 0.95
                        : w.isSibling
                          ? 0.65
                          : 0.78
                      : 0.2
                  }
                  stroke={
                    isSelected ? "hsl(280,85%,65%)" : "hsl(230,30%,7%)"
                  }
                  strokeWidth={isSelected ? 3 : w.isSibling ? 1.5 : 2}
                  strokeDasharray={w.isSibling ? "6 3" : "none"}
                  style={{
                    filter:
                      isHover || isSelected
                        ? `drop-shadow(0 0 12px ${color})`
                        : "none",
                    transition: "all 0.2s ease",
                  }}
                />
                {hasPerson && labelWidth >= 20 && (
                  <text
                    x={w.labelPos.x}
                    y={w.labelPos.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={
                      w.generation <= 1 ? 15 : w.generation <= 2 ? 12 : 10
                    }
                    fontWeight={w.isSibling ? 400 : 600}
                    fill={
                      w.isSibling ? "hsl(40,30%,80%)" : "hsl(40,30%,96%)"
                    }
                    transform={`rotate(${labelRot} ${w.labelPos.x} ${w.labelPos.y})`}
                    style={{
                      pointerEvents: "none",
                      fontFamily: "Inter,sans-serif",
                      textShadow: "0 1px 2px hsl(230 30% 7%/0.9)",
                    }}
                  >
                    <tspan x={w.labelPos.x} dy="-0.3em">
                      {shorten(w.person.name.split(" ")[0])}
                    </tspan>
                    <tspan
                      x={w.labelPos.x}
                      dy="1.1em"
                      fontSize={w.generation <= 2 ? 9 : 8}
                      fontWeight={400}
                      opacity={0.85}
                    >
                      {shorten(w.person.name.split(" ").slice(1).join(" "))}
                    </tspan>
                  </text>
                )}
              </g>
            );
          })}
        </g>

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
          const label = polar(CX, CY, CENTER_R + 70, baseMid);
          const initials = spouse.name
            .split(" ")
            .map((p) => p[0])
            .slice(0, 2)
            .join("");

          return (
            <g
              key={spouse.id}
              className="scaleIn"
              role="button"
              tabIndex={0}
              aria-label={`${spouse.name}, spouse. Enter to select; R to center.`}
              style={{
                cursor: "pointer",
                transformOrigin: `${CX}px ${CY}px`,
                transform: `rotate(${spouseRotDeg}deg)`,
                transition:
                  "transform 0.7s cubic-bezier(0.34,1.3,0.64,1)",
                outline: "none",
              }}
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
              <path
                d={wedgePath(
                  CX,
                  CY,
                  CENTER_R + 4,
                  CENTER_R + 84,
                  a0,
                  a1,
                )}
                fill="hsl(312,78%,66%)"
                fillOpacity={selectedPid === spouse.id ? 0.95 : 0.72}
                stroke={
                  selectedPid === spouse.id
                    ? "hsl(280,85%,65%)"
                    : "hsl(230,30%,7%)"
                }
                strokeWidth={selectedPid === spouse.id ? 3 : 2}
                style={{
                  filter:
                    selectedPid === spouse.id
                      ? "drop-shadow(0 0 12px hsl(312,78%,66%))"
                      : "none",
                  transition: "all 0.2s ease",
                }}
              />
              <g
                style={{
                  transformOrigin: `${label.x}px ${label.y}px`,
                  transform: `rotate(${-spouseRotDeg}deg)`,
                  transition:
                    "transform 0.7s cubic-bezier(0.34,1.3,0.64,1)",
                }}
              >
                <text
                  x={label.x}
                  y={label.y - 5}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={12}
                  fontWeight={700}
                  fill="hsl(40,30%,96%)"
                  style={{
                    pointerEvents: "none",
                    fontFamily: "Inter,sans-serif",
                    textShadow: "0 1px 2px hsl(230 30% 7%/0.9)",
                  }}
                >
                  {initials}
                </text>
                <text
                  x={label.x}
                  y={label.y + 10}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={7}
                  fontWeight={600}
                  fill="hsl(40,30%,96%)"
                  opacity={0.88}
                  style={{
                    pointerEvents: "none",
                    fontFamily: "Inter,sans-serif",
                    textShadow: "0 1px 2px hsl(230 30% 7%/0.9)",
                  }}
                >
                  Spouse
                </text>
              </g>
            </g>
          );
        })}

        {/* Center */}
        <g
          role="button"
          tabIndex={0}
          data-center-person-id={centerId}
          aria-label={`Select ${center?.name ?? "center person"}`}
          style={{ cursor: "pointer", outline: "none" }}
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
          <circle
            cx={CX}
            cy={CY}
            r={CENTER_R}
            fill="url(#cg)"
            className="pulse"
          />
          <circle
            cx={CX}
            cy={CY}
            r={CENTER_R - 6}
            fill="hsl(230,30%,7%)"
            opacity={0.12}
          />
          <g
            role={canGoBack ? "button" : undefined}
            tabIndex={canGoBack ? 0 : undefined}
            aria-label={canGoBack ? "Return to previous center person" : undefined}
            style={{
              cursor: canGoBack ? "pointer" : "default",
              pointerEvents: canGoBack ? "auto" : "none",
              outline: "none",
            }}
            opacity={canGoBack ? 0.9 : 0.28}
            onClick={(e) => {
              e.stopPropagation();
              if (canGoBack) onHistoryBack();
            }}
            onKeyDown={(e) => {
              if (canGoBack && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                e.stopPropagation();
                onHistoryBack();
              }
            }}
          >
            <path
              d={`M${CX - CENTER_R + 10} ${CY + 10} A${CENTER_R - 10} ${CENTER_R - 10} 0 0 0 ${CX + CENTER_R - 10} ${CY + 10} L${CX + CENTER_R - 28} ${CY + 10} A${CENTER_R - 28} ${CENTER_R - 28} 0 0 1 ${CX - CENTER_R + 28} ${CY + 10} Z`}
              fill="hsl(230,30%,7%)"
              fillOpacity={0.22}
              stroke="hsl(230,30%,7%)"
              strokeOpacity={0.24}
            />
            <text
              x={CX}
              y={CY + 53}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={10}
              fontWeight={700}
              fill="hsl(230,30%,7%)"
              opacity={0.8}
              style={{
                fontFamily: "Inter,sans-serif",
                letterSpacing: 0,
                pointerEvents: "none",
              }}
            >
              Back
            </text>
          </g>
          <text
            x={CX}
            y={CY - 9}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={28}
            fontWeight={700}
            fill="hsl(230,30%,7%)"
            style={{ fontFamily: "'Playfair Display',serif" }}
          >
            {initials}
          </text>
          <text
            x={CX}
            y={CY + 22}
            textAnchor="middle"
            fontSize={11}
            fill="hsl(230,30%,7%)"
            opacity={0.85}
            style={{ fontFamily: "Inter,sans-serif", fontWeight: 500 }}
          >
            {center?.name ?? ""}
          </text>
        </g>
      </svg>

      {/* Line labels */}
      {isAncestorView ? (
        <>
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 16,
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              fontWeight: 500,
              color: "var(--muted-fg)",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "var(--maternal)",
                display: "inline-block",
              }}
            />
            Maternal
          </div>
          <div
            style={{
              position: "absolute",
              top: 8,
              right: 16,
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              fontWeight: 500,
              color: "var(--muted-fg)",
            }}
          >
            Paternal
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "var(--paternal)",
                display: "inline-block",
              }}
            />
          </div>
        </>
      ) : (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            fontWeight: 500,
            color: "var(--muted-fg)",
          }}
        >
          Descendant line
        </div>
      )}

      {/* Sibling hint */}
      {isAncestorView && sibAnchorPid && sibAnchorPid !== centerId && (
        <div
          className="scaleIn"
          style={{
            position: "absolute",
            bottom: 8,
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: 11,
            color: "var(--muted-fg)",
            display: "flex",
            alignItems: "center",
            gap: 5,
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              width: 24,
              borderTop: "1px dashed hsl(280,85%,65%,0.5)",
            }}
          />
          Siblings shown with dashed border · click again to hide
          <span
            style={{
              width: 24,
              borderTop: "1px dashed hsl(280,85%,65%,0.5)",
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── LEGEND ───────────────────────────────────────────────────────────────────
function Legend({ viewDirection }) {
  const isAncestorView = viewDirection === "ancestors";
  const gens = isAncestorView
    ? [
        { i: 0, l: "Self" },
        { i: 1, l: "Parents" },
        { i: 2, l: "Grandparents" },
        { i: 3, l: "Great-grandparents" },
        { i: 4, l: "2× Great" },
        { i: 5, l: "3× Great" },
        { i: 6, l: "4× Great" },
      ]
    : [
        { i: 0, l: "Self" },
        { i: 1, l: "Children" },
        { i: 2, l: "Grandchildren" },
        { i: 3, l: "Great-grandchildren" },
        { i: 4, l: "2× Great" },
        { i: 5, l: "3× Great" },
        { i: 6, l: "4× Great" },
      ];
  return (
    <div
      className="glass"
      style={{
        border: "1px solid var(--border)",
        borderRadius: 16,
        padding: 16,
        fontSize: 12,
      }}
    >
      <p
        className="fd"
        style={{
          fontSize: 14,
          marginBottom: 12,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <IcChevs /> Generations
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {gens.map((g) => (
          <div
            key={g.i}
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                background: genColor(g.i),
                flexShrink: 0,
              }}
            />
            <span style={{ color: "var(--muted-fg)" }}>{g.l}</span>
          </div>
        ))}
        {isAncestorView && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 4,
              paddingTop: 8,
              borderTop: "1px solid var(--border)",
            }}
          >
            <span
              style={{
                width: 20,
                height: 10,
                borderRadius: 2,
                background: "hsl(200,95%,60%,0.5)",
                border: "1px dashed hsl(200,95%,60%)",
                flexShrink: 0,
              }}
            />
            <span style={{ color: "var(--muted-fg)" }}>
              Sibling (not direct ancestor)
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PERSON CARD ──────────────────────────────────────────────────────────────
function PersonCard({
  person,
  isCenter,
  family,
  viewDirection,
  onRecenter,
  onClose,
  onAddPerson,
  canEdit = true,
  database = false,
}) {
  const cs = {
    border: "1px solid var(--border)",
    borderRadius: 16,
    padding: 24,
    boxShadow: "var(--shadow)",
  };

  if (!person)
    return (
      <div className="glass scaleIn" style={cs}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: "var(--muted)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--muted-fg)",
              }}
            >
              <IcUser />
            </div>
            <div>
              <h3 className="fd" style={{ fontSize: 20 }}>
                Unknown Ancestor
              </h3>
              <p style={{ fontSize: 13, color: "var(--muted-fg)" }}>
                No records found
              </p>
            </div>
          </div>
          <Btn variant="ghost" onClick={onClose} ariaLabel="Close person details">
            <IcX />
          </Btn>
        </div>
        <p
          style={{
            fontSize: 13,
            color: "var(--muted-fg)",
            fontStyle: "italic",
          }}
        >
          The threads of this lineage are lost to time.
        </p>
      </div>
    );

  const initials = person.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
  const grad = `linear-gradient(135deg,${person.gender === "F" ? "hsl(320,70%,60%)" : "hsl(210,80%,60%)"},hsl(280,85%,65%))`;
  const sibs = getSiblings(person.id, family);
  const spouses = getSpouses(person.id, family);
  const hasMother = !!person.motherId,
    hasFather = !!person.fatherId;
  const isAncestorView = viewDirection === "ancestors";

  return (
    <div className="glass scaleIn" style={cs}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 54,
              height: 54,
              borderRadius: "50%",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "'Playfair Display',serif",
              fontSize: 18,
              fontWeight: 600,
              color: "hsl(230,30%,7%)",
              background: grad,
            }}
          >
            {initials}
          </div>
          <div>
            <h3 className="fd" style={{ fontSize: 21, lineHeight: 1.2 }}>
              {person.name}
            </h3>
            <div
              style={{
                display: "flex",
                gap: 6,
                marginTop: 4,
                flexWrap: "wrap",
              }}
            >
              <Tag>{{ F: "♀ Female", M: "♂ Male", X: "Non-binary", U: "Unknown" }[person.gender] || "Unknown"}</Tag>
              {(person.birth || person.death) && (
                <Tag outline>
                  {person.birth ?? "?"}–{person.death ?? "?"}
                </Tag>
              )}
            </div>
          </div>
        </div>
        <Btn variant="ghost" onClick={onClose} ariaLabel="Close person details">
          <IcX />
        </Btn>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          marginBottom: person.bio ? 16 : 12,
          fontSize: 13,
        }}
      >
      {person.birthplace && (
        <Row label="Birthplace" value={person.birthplace} />
      )}
      {person.occupation && (
        <Row label="Occupation" value={person.occupation} />
      )}
      {spouses.length > 0 && (
        <Row
          label={spouses.length === 1 ? "Spouse" : "Spouses"}
          value={spouses.map((s) => s.name).join(", ")}
        />
      )}
      {sibs.length > 0 && (
        <Row
            label={`Known siblings`}
            value={sibs.map((s) => s.name.split(" ")[0]).join(", ")}
          />
        )}
      </div>

      {person.bio && (
        <p
          style={{
            fontSize: 13,
            color: "var(--muted-fg)",
            fontStyle: "italic",
            marginBottom: 16,
            lineHeight: 1.6,
            borderLeft: "2px solid hsl(280,85%,65%,0.4)",
            paddingLeft: 12,
          }}
        >
          {person.bio}
        </p>
      )}

      {/* Actions */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {!isCenter && (
          <Btn full gradient onClick={() => onRecenter(person.id)}>
            <IcTarget /> Center wheel on {person.name.split(" ")[0]}
          </Btn>
        )}
        {isCenter && (
          <p
            style={{
              fontSize: 12,
              textAlign: "center",
              color: "var(--muted-fg)",
            }}
          >
            ✨ Currently the center of the lineage
          </p>
        )}

        {canEdit && <details className="relative-actions"><summary>Add relative</summary><div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 6,
            marginTop: 4,
          }}
        >
          <Btn
            variant="outline"
            onClick={() => onAddPerson(person.id, "sibling")}
          >
            <IcSibling /> Add Sibling
          </Btn>
          <Btn
            variant="outline"
            onClick={() => onAddPerson(person.id, "spouse")}
          >
            <IcPlus /> Add Spouse
          </Btn>
          {!isAncestorView && (
            <Btn
              variant="outline"
              onClick={() => onAddPerson(person.id, "child")}
            >
              <IcPlus /> Add Child
            </Btn>
          )}
          {isAncestorView && !hasMother && (
            <Btn
              variant="outline"
              onClick={() => onAddPerson(person.id, "mother")}
            >
              ♀ Add Mother
            </Btn>
          )}
          {isAncestorView && !hasFather && (
            <Btn
              variant="outline"
              onClick={() => onAddPerson(person.id, "father")}
            >
              ♂ Add Father
            </Btn>
          )}
          {database && <Btn variant="outline" onClick={() => onAddPerson(person.id, 'parent')}>Add another parent family</Btn>}
        </div></details>}
      </div>
    </div>
  );
}

// ─── ADD PERSON MODAL ─────────────────────────────────────────────────────────
function Btn({
  variant = "default",
  full,
  gradient,
  onClick,
  children,
  type = "button",
  ariaLabel,
  disabled = false,
}) {
  const base = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    border: "none",
    cursor: "pointer",
    fontFamily: "'Inter',sans-serif",
    fontWeight: 500,
    borderRadius: 8,
    transition: "all 0.15s",
    padding: "8px 14px",
    fontSize: 13,
    width: full ? "100%" : "auto",
  };
  const vars = {
    default: {
      ...base,
      background: "hsl(230,25%,16%)",
      color: "var(--fg)",
    },
    gradient: {
      ...base,
      background: "var(--grad-center)",
      color: "hsl(230,30%,7%)",
      fontWeight: 600,
    },
    outline: {
      ...base,
      background: "transparent",
      border: "1px solid var(--border)",
      color: "var(--fg)",
    },
    ghost: {
      ...base,
      background: "transparent",
      color: "var(--muted-fg)",
      padding: "6px",
    },
    "ghost-sm": {
      ...base,
      background: "transparent",
      color: "var(--muted-fg)",
      padding: "6px 10px",
      fontSize: 12,
    },
  };
  const s = gradient ? vars.gradient : vars[variant] || vars.default;
  return (
    <button
      style={s}
      onClick={onClick}
      type={type}
      aria-label={ariaLabel}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function Tag({ outline, children }) {
  return (
    <span
      style={{
        background: outline ? "transparent" : "hsl(230,25%,15%)",
        border: outline ? "1px solid var(--border)" : "none",
        borderRadius: 6,
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 500,
        display: "inline-block",
      }}
    >
      {children}
    </span>
  );
}
function Row({ label, value }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <span style={{ color: "var(--muted-fg)" }}>{label}</span>
      <span
        style={{
          fontWeight: 500,
          textAlign: "right",
          wordBreak: "break-word",
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── INFO PANEL ───────────────────────────────────────────────────────────────
function InfoPanel({ canEdit = true }) {
  return (
    <div
      className="glass"
      style={{
        border: "1px solid var(--border)",
        borderRadius: 16,
        padding: 24,
        boxShadow: "var(--shadow)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "hsl(280 85% 65%/0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--primary)",
            flexShrink: 0,
          }}
        >
          <IcInfo />
        </div>
        <div>
          <h3 className="fd" style={{ fontSize: 18, lineHeight: 1.2 }}>
            Explore the wheel
          </h3>
          <p style={{ fontSize: 12, color: "var(--muted-fg)" }}>
            A few ways to navigate
          </p>
        </div>
      </div>
      <ul
        style={{
          fontSize: 13,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          color: "var(--muted-fg)",
          listStyle: "none",
        }}
      >
        {[
          [
            "→",
            "Click any wedge to select and reveal siblings in the same ring",
          ],
          ["→", "Double-click to make that ancestor the new center"],
          [
            "→",
            "Dashed-border wedges are siblings (not direct ancestors)",
          ],
          ["→", canEdit ? "Select a person, then use Add relative in their details" : "Select a person to inspect their approved details"],
          ["→", "Wheel stays in fan mode with a 180° sweep"],
        ].map(([a, b], i) => (
          <li key={i} style={{ display: "flex", gap: 8 }}>
            <span style={{ color: "var(--primary)", flexShrink: 0 }}>
              {a}
            </span>
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────
function App({ source, trees, onSelectTree, accountControl }) {
  const canEdit = source.permissions?.canEdit !== false;
  const privateMode = ['private', 'shared'].includes(source.permissions?.mode);
  const [storage] = React.useState(() => {
    if (!privateMode) return localStorage;
    const memory = new Map();
    return { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  });
  const [local] = React.useState(() => loadLocalState(storage, source));
  const [archive, setArchive] = React.useState(local.archive);
  const family = archive.family;
  const rootId = archive.rootId;
  const setFamily = (update) => setArchive((current) => ({
    ...current,
    family: typeof update === 'function' ? update(current.family) : update,
  }));
  const navigation = new URLSearchParams(location.search);
  const [aliases, setAliases] = React.useState(source.aliases || {});
  const [centerId, setCenterId] = React.useState(() => resolveNavigationPerson(family, source.aliases, navigation.get('person'), resolveNavigationPerson(family, source.aliases, local.centerId, rootId)));
  const [zoom, setZoom] = React.useState(1);
  const [viewReset, setViewReset] = React.useState(0);
  const [panel, setPanel] = React.useState(null);
  const [toolGroup, setToolGroup] = React.useState(null);
  const mobile = useMobileLayout();
  const openTools = (group = null) => { setToolGroup(group); setPanel('tools'); };
  React.useEffect(() => {
    const search = event => {
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.closest('input, textarea, select, [contenteditable]') && !document.querySelector('[role="dialog"]')) {
        event.preventDefault(); setPanel('people');
      }
    };
    addEventListener('keydown', search); return () => removeEventListener('keydown', search);
  }, []);
  const [expanded, setExpanded] = React.useState(() => new Set());
  const [selectedPid, setSelectedPid] = React.useState(() => resolveNavigationPerson(family, source.aliases, navigation.get('selected')));
  const [sibAnchorPid, setSibAnchorPid] = React.useState(null);
  const [viewDirection, setViewDirection] = React.useState(navigation.get('view') === 'descendants' ? 'descendants' : 'ancestors');
  const [centerHistory, setCenterHistory] = React.useState([]);
  const [addCtx, setAddCtx] = React.useState(null);
  const [recordPersonId, setRecordPersonId] = React.useState(null);
  const [privacyPerson, setPrivacyPerson] = React.useState(null);
  const [recoveries, setRecoveries] = React.useState(local.recoveries);
  const [saveStatus, setSaveStatus] = React.useState('Saving in this browser…');
  const [baseFingerprint, setBaseFingerprint] = React.useState(local.baseFingerprint);
  const [revision, setRevision] = React.useState(source.revision || 0);
  const [serverStatus, setServerStatus] = React.useState(source.mode === 'database' ? 'Loaded from database' : '');
  const loadedSource = React.useRef({ rootId: source.rootId, family: source.family, ...(source.families && { families: source.families }) });

  function writeNavigation(id, direction, selected, push = false) {
    const url = new URL(location.href);
    if (source.mode === 'database' && !source.shared) url.searchParams.set('tree', source.treeId);
    url.searchParams.set('person', id);
    url.searchParams.set('view', direction);
    if (selected) url.searchParams.set('selected', selected);
    else url.searchParams.delete('selected');
    history[push ? 'pushState' : 'replaceState'](null, '', url);
  }

  React.useLayoutEffect(() => {
    writeNavigation(centerId, viewDirection, selectedPid);
  }, [centerId, viewDirection, selectedPid]);

  React.useLayoutEffect(() => {
    // Focus with the committed view. Deferring this to an animation frame can
    // steal focus after the user has already moved to another chart person.
    document.querySelector('[data-center-person-id]')?.focus({ preventScroll: true });
  }, [centerId, viewDirection]);

  React.useEffect(() => {
    function pop() {
      const params = new URLSearchParams(location.search);
      if ((params.get('tree') || '') !== (source.mode === 'database' && !source.shared ? source.treeId : '')) return;
      setCenterId(resolveNavigationPerson(family, aliases, params.get('person'), rootId));
      setViewDirection(params.get('view') === 'descendants' ? 'descendants' : 'ancestors');
      setSelectedPid(resolveNavigationPerson(family, aliases, params.get('selected')));
      setExpanded(new Set()); setSibAnchorPid(null); setCenterHistory([]);
    }
    addEventListener('popstate', pop);
    return () => removeEventListener('popstate', pop);
  }, [family, aliases, rootId, source.treeId, source.mode]);

  function acceptServer(data) {
    const next = { rootId: data.rootId, family: data.family, ...(data.families && { families: data.families }) };
    loadedSource.current = next;
    setBaseFingerprint(fingerprint(next));
    setRevision(data.revision);
    setArchive(next);
    setAliases(data.aliases || {});
    setServerStatus('Saved in database');
    const resolve = (id, fallback = null) => resolveNavigationPerson(data.family, data.aliases, id, fallback);
    setCenterId(resolve(centerId, data.rootId));
    setSelectedPid(current => resolve(current));
    setSibAnchorPid(current => resolve(current));
    setExpanded(current => new Set([...current].map(id => resolve(id)).filter(Boolean)));
    setCenterHistory(current => current.map(entry => ({ ...entry, id: resolve(entry.id), selected: resolve(entry.selected) })).filter(entry => entry.id));
  }

  async function refreshTree() {
    const data = await loadFamilyData(source.treeId);
    setRecoveries(preserveRecovery(storage, local.key, JSON.stringify({ archive, centerId }), 'Before refreshing database'));
    acceptServer(data);
  }

  React.useEffect(() => {
    if (local.blocked) {
      setSaveStatus('Not saved — browser storage is unavailable');
      return;
    }
    try {
      storage.setItem(local.key, JSON.stringify({
        version: 3, treeId: source.treeId, baseFingerprint,
        archive, centerId,
      }));
      setSaveStatus(privateMode ? 'Private workspace — browser persistence disabled' : source.mode === 'database' ? 'Browser recovery saved' : 'Saved in this browser only');
    } catch {
      setSaveStatus('Not saved — browser storage is full or unavailable. Download a backup.');
    }
  }, [archive, centerId, local, source.treeId, source.mode, baseFingerprint]);

  function replaceArchive(nextArchive, reason) {
    if (local.blocked) throw new Error('Restore is blocked because browser storage is unavailable. Download your current archive first.');
    const raw = JSON.stringify({ archive, centerId });
    try {
      setRecoveries(preserveRecovery(storage, local.key, raw, reason));
      // Persist before replacing the visible tree. Storage failures leave the
      // current archive intact and the preview open for retry or cancellation.
      storage.setItem(local.key, JSON.stringify({
        version: 3, treeId: source.treeId, baseFingerprint,
        archive: nextArchive, centerId: nextArchive.rootId,
      }));
    } catch {
      throw new Error('Could not save a recovery copy and restored archive. Free browser storage or download a backup before trying again.');
    }
    setArchive(nextArchive);
    if (source.mode === 'database') setServerStatus('Local edits only — migrate before database editing');
    setCenterId(nextArchive.rootId);
    setExpanded(new Set());
    setSelectedPid(null);
    setSibAnchorPid(null);
    setCenterHistory([]);
  }

  const center = family[centerId];
  const selectedPerson = selectedPid ? family[selectedPid] : null;

  function lineageExpansionFor(personId) {
    return graph.lineagePath(centerId, personId, family, 'ancestors');
  }

  function descendantExpansionFor(personId) {
    return graph.lineagePath(centerId, personId, family, 'descendants');
  }

  function handleWedgeClick(personId, isSibling) {
    if (!personId) return;
    if (viewDirection === "descendants") {
      setSelectedPid(personId);
      setSibAnchorPid(null);
      setExpanded(descendantExpansionFor(personId));
      return;
    }
    if (isSibling) {
      setSelectedPid((prev) =>
        prev === personId ? sibAnchorPid : personId,
      );
    } else {
      if (sibAnchorPid === personId) {
        if (selectedPid === personId) {
          setExpanded(lineageExpansionFor(personId));
        } else {
          // Sibling was dominant — re-click anchor rotates it back to center, fan stays open
          setSelectedPid(personId);
          setExpanded(lineageExpansionFor(personId));
        }
      } else {
        setSelectedPid(personId);
        setSibAnchorPid(personId);
        setExpanded(lineageExpansionFor(personId));
      }
    }
  }

  function rememberView() {
    setCenterHistory((prev) => [...prev, { id: centerId, direction: viewDirection, selected: selectedPid }]);
  }

  function handleRecenter(id, keepSelection = false) {
    if (id !== centerId) rememberView();
    writeNavigation(id, viewDirection, keepSelection ? id : null, id !== centerId);
    setCenterId(id);
    setExpanded(new Set());
    setSelectedPid(keepSelection ? id : null);
    setSibAnchorPid(null);
  }

  function handleHistoryBack() {
    if (centerHistory.length === 0) return;
    const previous = centerHistory.at(-1);
    setCenterHistory((prev) => prev.slice(0, -1));
    setCenterId(previous.id);
    setViewDirection(previous.direction);
    setExpanded(new Set());
    setSelectedPid(previous.selected);
    setSibAnchorPid(null);
  }

  function handleToggleDirection() {
    const direction = viewDirection === 'ancestors' ? 'descendants' : 'ancestors';
    const id = selectedPid || centerId;
    rememberView();
    writeNavigation(id, direction, selectedPid, true);
    setCenterId(id);
    setViewDirection(direction);
    setExpanded(new Set());
    setSibAnchorPid(null);
  }

  function handleSpouseClick(id) {
    setSelectedPid(id);
    setSibAnchorPid(null);
    setExpanded(new Set());
  }

  function handleReset() {
    setZoom(1);
    setViewReset(value => value + 1);
    setCenterId(rootId);
    setExpanded(new Set());
    setSelectedPid(null);
    setSibAnchorPid(null);
    setViewDirection("ancestors");
    setCenterHistory([]);
  }

  async function handleAddPerson(newId, formData, ctx) {
    const { personId, type } = ctx;
    if (source.mode === 'database') {
      if (fingerprint(archive) !== baseFingerprint) {
        throw new Error('This archive has local-only edits. Migrate them before editing the database, or discard them after downloading a backup.');
      }
      setServerStatus('Saving to database…');
      try {
        const next = await savePerson(source.treeId, type === 'edit' ? personId : null, {
          requestId: ctx.requestId, expectedRevision: revision, person: formData,
          type, targetId: personId, existingPersonId: ctx.existingPersonId || undefined,
          coParentId: ctx.coParentId || undefined, pedigree: ctx.pedigree, preferred: ctx.preferred,
          parentSlot: type === 'child' ? family[personId]?.gender === 'F' ? 'mother' : family[personId]?.gender === 'M' ? 'father' : undefined : undefined,
        });
        acceptServer(next);
      } catch (error) { setServerStatus('Save failed — form preserved'); throw error; }
      return;
    }
    if (type === 'edit') {
      setFamily((prev) => ({ ...prev, [personId]: { ...prev[personId], ...formData, name: formData.name.trim() } }));
      return;
    }

    const newPerson = {
      id: newId,
      name: formData.name.trim(),
      gender: formData.gender,
      ...(formData.birth && { birth: formData.birth }),
      ...(formData.death && { death: formData.death }),
      ...(formData.birthplace && { birthplace: formData.birthplace }),
      ...(formData.occupation && { occupation: formData.occupation }),
      ...(formData.bio && { bio: formData.bio }),
    };

    setFamily((prev) => {
      const next = { ...prev };

      if (type === "sibling") {
        const currentTarget = prev[personId];
        const knownSiblings = getSiblings(personId, prev);
        const relatedIds = [
          ...new Set([personId, ...knownSiblings.map((p) => p.id)]),
        ];
        newPerson.motherId = currentTarget?.motherId;
        newPerson.fatherId = currentTarget?.fatherId;
        newPerson.siblingIds = relatedIds;
        next[newId] = newPerson;
        for (const relatedId of relatedIds) {
          const related = next[relatedId];
          if (!related) continue;
          next[relatedId] = {
            ...related,
            siblingIds: [
              ...new Set([...(related.siblingIds || []), newId]),
            ],
          };
        }
      } else if (type === "spouse") {
        newPerson.spouseIds = [personId];
        next[newId] = newPerson;
        const existing = new Set(next[personId]?.spouseIds || []);
        if (next[personId]?.spouseId) existing.add(next[personId].spouseId);
        existing.add(newId);
        next[personId] = {
          ...next[personId],
          spouseIds: [...existing],
          spouseId: undefined,
        };
      } else if (type === "child") {
        // Place the selected person by gender; if they have exactly one
        // spouse, link that spouse as the other parent. Anyone without a
        // binary gender takes whichever slot the spouse leaves open.
        const coParent = ctx.coParentId ? prev[ctx.coParentId] : null;
        const parents = [prev[personId], coParent].filter(Boolean);
        const flexible = [];
        for (const parent of parents) {
          if (parent.gender === "M" && !newPerson.fatherId) {
            newPerson.fatherId = parent.id;
          } else if (parent.gender === "F" && !newPerson.motherId) {
            newPerson.motherId = parent.id;
          } else {
            flexible.push(parent.id);
          }
        }
        for (const parentId of flexible) {
          if (!newPerson.motherId) newPerson.motherId = parentId;
          else if (!newPerson.fatherId) newPerson.fatherId = parentId;
        }
        next[newId] = newPerson;
      } else if (
        type === "mother" ||
        (type === "parent" && formData.gender === "F")
      ) {
        next[newId] = newPerson;
        next[personId] = { ...next[personId], motherId: newId };
      } else if (
        type === "father" ||
        (type === "parent" && formData.gender === "M")
      ) {
        next[newId] = newPerson;
        next[personId] = { ...next[personId], fatherId: newId };
      } else {
        // generic parent — use gender to determine
        next[newId] = newPerson;
        if (formData.gender === "F")
          next[personId] = { ...next[personId], motherId: newId };
        else next[personId] = { ...next[personId], fatherId: newId };
      }
      return next;
    });

    if (type === "child") {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(personId);
        return next;
      });
    }
  }

  const stats = React.useMemo(
    () => ({
      total: Object.values(family).filter(person => !person.placeholder).length,
      expanded: expanded.size,
    }),
    [family, expanded],
  );

  const draft = source.mode === 'database' && fingerprint(archive) !== baseFingerprint;
  const status = saveStatus.startsWith('Not saved') ? saveStatus : serverStatus.includes('failed') ? serverStatus : draft ? 'Browser draft — review before editing' : serverStatus.startsWith('Saving') ? serverStatus : source.mode === 'database' ? 'Saved in database' : 'Saved in this browser only';
  const acceptToolServer = data => { acceptServer(data); setPanel(null); };
  const groups = [
    ...(source.mode === 'database' ? [{ id: 'exchange', title: 'Import and export', description: 'GEDCOM files and original import sources', content: <>
      {source.privacyNotice && <p className="notice">{source.privacyNotice}</p>}
      <GedcomExchange privateMode={privateMode} treeId={source.treeId} shareToken={source.shareToken} readOnly={!canEdit} draft={draft} onImported={onSelectTree} onSaved={acceptToolServer} />
    </> }] : []),
    ...(canEdit && source.mode === 'database' ? [{ id: 'backups', title: 'Backups and history', description: 'Full-tree backup, restore, and edit history', content: <DatabaseRecovery treeId={source.treeId} blocked={draft} onSaved={acceptToolServer} onRestored={onSelectTree} /> },
      { id: 'research', title: 'Research', description: 'Add a person or review possible duplicates', content: <>
        <button onClick={() => { setPanel(null); setAddCtx({ type: 'person' }); }}>Add person</button>
        <DuplicateReview treeId={source.treeId} archive={archive} selectedId={selectedPid} blocked={draft} onSaved={acceptToolServer} />
      </> }] : []),
    ...(source.permissions?.canManage ? [{ id: 'sharing', title: 'Sharing', description: 'Members, invitations, and read-only links', content: <Sharing treeId={source.treeId} /> }] : []),
    ...(canEdit ? [{ id: 'browser', title: 'Browser drafts', description: source.mode === 'database' ? 'Local drafts, migration, and projection recovery' : 'Backup and recover this browser archive', content: <>
      <ArchiveControls archive={archive} source={source} saveStatus={status} notice={local.notice} recoveries={recoveries}
        onRestore={next => { replaceArchive(next, 'Before backup restore'); setPanel(null); }}
        onDiscard={() => { replaceArchive(loadedSource.current, 'Before discarding local edits'); setPanel(null); }} />
      {source.mode === 'database' && draft && <LocalMigration treeId={source.treeId} archive={archive}
        onBeforeApply={() => setRecoveries(preserveRecovery(storage, local.key, JSON.stringify({ archive, centerId }), 'Before database migration'))}
        onApplied={acceptToolServer} />}
    </> }] : []),
  ];
  const details = <>
    {selectedPerson ? <>
      <PersonCard person={selectedPerson} isCenter={selectedPid === centerId} family={family} viewDirection={viewDirection} canEdit={canEdit} database={source.mode === 'database'}
        onRecenter={id => { handleRecenter(id); if (mobile) setPanel(null); }}
        onClose={() => { setSelectedPid(null); setSibAnchorPid(null); setPanel(null); }}
        onAddPerson={(personId, type) => { if (mobile) setPanel(null); setAddCtx({ personId, type }); }} />
      {canEdit && <Btn full onClick={() => { if (mobile) setPanel(null); setAddCtx({ type: 'edit', personId: selectedPid }); }}>Edit person</Btn>}
      {source.mode === 'database' && canEdit && <Btn full disabled={draft} onClick={() => { if (mobile) setPanel(null); setRecordPersonId(selectedPid); }}>Records and evidence</Btn>}
      {canEdit && privateMode && <Btn full disabled={draft} onClick={() => { if (mobile) setPanel(null); setPrivacyPerson(selectedPid); }}>Privacy and sharing</Btn>}
      <FamilyDetails personId={selectedPid} archive={archive} />
    </> : <InfoPanel canEdit={canEdit} />}
    {canEdit && source.mode === 'database' && <button className="add-independent" onClick={() => { if (mobile) setPanel(null); setAddCtx({ type: 'person' }); }}>Add person</button>}
    <details className="legend-disclosure"><summary>Chart legend</summary><Legend viewDirection={viewDirection} /></details>
  </>;

  return <div className="workspace">
    <header className="workspace-header glass">
      <div className="header-inner">
        <div className="workspace-brand"><IcTree /><h1 className="fd">Rootline</h1></div>
        {source.mode === 'database' && !source.shared ? <label className="workspace-tree"><span className="sr-only">Tree</span>
          <select aria-label="Tree" value={source.treeId} onChange={event => onSelectTree(event.target.value)}>
            {(trees.length ? trees : [{ id: source.treeId, name: source.treeName }]).map(tree => <option key={tree.id} value={tree.id}>{tree.name}</option>)}
          </select></label> : <span className="workspace-tree-name">{source.treeName}</span>}
        <span className="workspace-count">{stats.total} people</span>
        <nav className="workspace-actions" aria-label="Workspace">
          <button onClick={() => setPanel('people')} title="Find a person (/)" aria-keyshortcuts="/">Find person <kbd aria-hidden="true">/</kbd></button>
          <button onClick={() => openTools()}>Tree tools</button>
          {accountControl}
        </nav>
      </div>
      <div className="workspace-status" aria-label="Archive status">
        <span className="source-badge">{source.shared || !canEdit ? 'Read only' : privateMode ? 'Private workspace' : source.mode === 'database' ? 'Local database' : 'Browser archive'}</span>
        <span role="status" className={draft || saveStatus.startsWith('Not saved') || status.includes('failed') ? 'notice' : ''}>{status}</span>
        {draft && <button onClick={() => openTools('browser')}>Review draft</button>}
        {saveStatus.startsWith('Not saved') && <button onClick={() => openTools('browser')}>Back up now</button>}
        {!draft && local.notice && <button onClick={() => openTools('browser')}>Review recovery</button>}
        {source.privacyNotice && <button onClick={() => openTools('exchange')}>Visibility details</button>}
      </div>
    </header>
    {local.notice && <div className="workspace-warning" role="status"><span>{local.notice}</span></div>}
    <main className="app-layout">
      <section className="chart-section">
        <div className="chart-heading">
          <div><h2 className="fd">{viewDirection === 'ancestors' ? 'The Lineage of ' : 'Descendants of '}<span>{center?.name}</span></h2>
            <p>Click a person for details · Double-click to center</p></div>
          <div className="view-switch" role="group" aria-label="View direction">
            <button aria-label="Show ancestors" aria-pressed={viewDirection === 'ancestors'} onClick={() => { if (viewDirection !== 'ancestors') handleToggleDirection(); }}>Ancestors</button>
            <button aria-label="Show descendants" aria-pressed={viewDirection === 'descendants'} onClick={() => { if (viewDirection !== 'descendants') handleToggleDirection(); }}>Descendants</button>
          </div>
        </div>
        <div className="chart-card glass">
          <ChartViewport zoom={zoom} onZoom={setZoom} centerKey={`${centerId}:${viewDirection}:${viewReset}`} canGoBack={centerHistory.length > 0} onBack={handleHistoryBack} onReset={handleReset}>
            <LineageWheel centerId={centerId} family={family} expanded={expanded} selectedPid={selectedPid} sibAnchorPid={sibAnchorPid}
              viewDirection={viewDirection} canGoBack={centerHistory.length > 0} onWedgeClick={handleWedgeClick} onWedgeDoubleClick={handleRecenter}
              onCenterClick={() => { setSelectedPid(centerId); setSibAnchorPid(null); }} onHistoryBack={handleHistoryBack} onSpouseClick={handleSpouseClick} />
          </ChartViewport>
          {(viewDirection === 'ancestors' ? !center.motherId && !center.fatherId : getChildren(centerId, family).length === 0) &&
            <p className="chart-empty" role="status">No {viewDirection} recorded for {center.name}. {canEdit ? 'Select this person to add relatives.' : 'Only approved relationships are shown.'}</p>}
        </div>
        <div className="chart-footnote"><span>{stats.expanded} branches expanded</span><span>Zoom in, then drag to pan · Center wheel to return</span></div>
        {mobile && <div className="mobile-person-summary"><span>{selectedPerson ? selectedPerson.name : 'Explore your family'}<small>{selectedPerson ? 'Selected individual' : 'Select a person in the wheel'}</small></span><button onClick={() => setPanel('details')}>Person details</button></div>}
      </section>
      {!mobile && <aside className="app-sidebar" aria-label="Person details">{details}</aside>}
    </main>
    <footer className="workspace-footer">Rootline · {source.treeName}</footer>
    {panel === 'people' && <PeopleDrawer family={family} onSelect={id => handleRecenter(id, true)} onClose={() => setPanel(null)} />}
    {panel === 'tools' && <ToolsDrawer groups={groups} initialGroup={toolGroup} onClose={() => setPanel(null)} />}
    {panel === 'details' && mobile && <Modal title="Person details" variant="drawer" onClose={() => setPanel(null)}><div className="person-details-sheet">{details}</div></Modal>}
    {privacyPerson && <PrivacyEditor treeId={source.treeId} person={family[privacyPerson]} revision={revision} onSaved={acceptServer} onClose={() => setPrivacyPerson(null)} />}
    {recordPersonId && <PersonRecords treeId={source.treeId} personId={recordPersonId} personName={family[recordPersonId]?.name || 'Person'} onSaved={acceptServer} onClose={() => setRecordPersonId(null)} />}
    {addCtx && <PersonEditor context={addCtx} family={family} onSubmit={handleAddPerson} database={source.mode === 'database'} onRefresh={refreshTree} onClose={() => setAddCtx(null)} />}
  </div>;
}

function Bootstrap({ session, shareToken, onSessionChange, accountControl }) {
  const [source, setSource] = React.useState(null);
  const [accessNotice, setAccessNotice] = React.useState('');
  const [error, setError] = React.useState('');
  const [attempt, setAttempt] = React.useState(0);
  const [treeId, setTreeId] = React.useState(new URLSearchParams(location.search).get('tree') || '');
  const [trees, setTrees] = React.useState([]);
  React.useEffect(() => {
    let active = true;
    setError('');
    async function load() {
      if (shareToken) {
        const response = await fetch(`/api/share/${encodeURIComponent(shareToken)}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Shared archive is unavailable');
        archiveTools.validateArchive(data);
        return { ...data, mode: 'database', shareToken };
      }
      return loadFamilyData(treeId);
    }
    load().then((data) => {
      if (!active) return;
      setSource(data);
      if (data.mode === 'database' && !shareToken) listTrees().then((items) => { if (active) setTrees(items); }).catch(() => {});
    }).catch((error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [attempt, treeId, shareToken]);
  React.useEffect(() => {
    if (session.mode !== 'private' || !source) return;
    let active = true;
    async function checkAccess() {
      try {
        const url = shareToken ? `/api/share/${encodeURIComponent(shareToken)}` : `/api/trees/${source.treeId}/family-data`;
        const response = await fetch(url);
        if (!active) return;
        if (!response.ok) {
          if ([401, 403, 404].includes(response.status)) {
            setSource(null); setError('Access is unavailable. Sign in again or ask the owner for access.');
            if (response.status === 401) onSessionChange();
          } else setAccessNotice('Tree access could not be checked. Unsaved forms are retained in memory while reconnecting.');
          return;
        }
        const next = await response.json();
        if (!active) return;
        setAccessNotice('');
        // Replace the entire mounted workspace when access changes. Never keep
        // editor state or forms alive behind a newly filtered viewer tree.
        if (next.permissions?.role !== source.permissions?.role || (source.redacted && next.revision !== source.revision)) {
          setSource({ ...next, mode: 'database', ...(shareToken && { shareToken }) });
          setAttempt(value => value + 1);
        }
      } catch { if (active) setAccessNotice('Tree access could not be checked. Unsaved forms are retained in memory while reconnecting.'); }
    }
    const timer = setInterval(checkAccess, 5000);
    addEventListener('focus', checkAccess);
    return () => { active = false; clearInterval(timer); removeEventListener('focus', checkAccess); };
  }, [session.mode, source, shareToken, onSessionChange]);
  React.useEffect(() => {
    function pop() {
      if (shareToken) return;
      const id = new URLSearchParams(location.search).get('tree') || '';
      if (id !== treeId && id !== source?.treeId) { setSource(null); setTreeId(id); }
    }
    addEventListener('popstate', pop);
    return () => removeEventListener('popstate', pop);
  }, [treeId, source?.treeId, shareToken]);
  if (source) return <>{accessNotice && <p role="status" className="account-bar">{accessNotice}</p>}<App key={`${source.treeId}:${source.permissions?.role || 'local'}:${source.redacted ? source.revision : ''}`} source={source} trees={trees} accountControl={accountControl} onSelectTree={(id) => {
    const url = new URL(location.href);
    url.searchParams.set('tree', id);
    for (const key of ['person', 'view', 'selected']) url.searchParams.delete(key);
    history.pushState(null, '', url);
    setSource(null); setTreeId(id);
  }} /></>;
  return <main className="load-state">
    <h1>Rootline</h1>
    {error ? <><p role="alert">{error}</p><button onClick={() => setAttempt((value) => value + 1)}>Retry loading archive</button></> : <p role="status">Loading family archive…</p>}
    {!shareToken && error && document.querySelector('meta[name="lineage-mode"]')?.content === 'database' && <>
      <DatabaseRecovery onRestored={(id) => { setTreeId(id); setAttempt(value => value + 1); }} />
      <GedcomExchange privateMode={session.mode === 'private'} onImported={(id) => { setTreeId(id); setAttempt(value => value + 1); }} />
    </>}
  </main>;
}

ReactDOM.createRoot(document.getElementById('root')).render(<AccessBoundary>{context => <Bootstrap {...context} />}</AccessBoundary>);
