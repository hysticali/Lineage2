import React from "react";
import { IcInfo } from "./icons";

export default function InfoPanel({ canEdit = true }) {
  const tips = [
    "Click any wedge to inspect details, trace their line, and reveal siblings",
    "Double-click (or press R) to center the wheel on that person",
    "Dashed-border wedges are siblings; click the anchor again to hide them",
    canEdit
      ? "Click an empty parent slot or open Add relative in a person’s details"
      : "Select a person to inspect their approved details",
    "Zoom with +, −, Ctrl/Cmd + scroll, or the toolbar; drag to pan",
  ];

  return (
    <div className="glass info-panel">
      <div className="info-panel-head">
        <div className="info-panel-icon" aria-hidden="true">
          <IcInfo />
        </div>
        <div>
          <h3 className="fd">Explore the wheel</h3>
          <p>A few ways to navigate</p>
        </div>
      </div>
      <ul className="info-panel-list">
        {tips.map((tip, i) => (
          <li key={i}>
            <span className="info-panel-arrow" aria-hidden="true">→</span>
            <span>{tip}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
