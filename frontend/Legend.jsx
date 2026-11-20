import React from "react";
import wheel from "../src/domain/wheel";
import { IcChevs } from "./icons";

const { genColor } = wheel;

export default function Legend({ viewDirection }) {
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
    <div className="glass legend-card">
      <p className="fd legend-title">
        <IcChevs /> Generations
      </p>
      <div className="legend-list">
        {gens.map((g) => (
          <div key={g.i} className="legend-item">
            <span className="legend-swatch" style={{ background: genColor(g.i) }} />
            <span>{g.l}</span>
          </div>
        ))}
        {isAncestorView && (
          <div className="legend-item legend-divider">
            <span className="legend-swatch-dashed" />
            <span>Sibling (not direct ancestor)</span>
          </div>
        )}
        <div className="legend-item">
          <span className="legend-swatch-more" />
          <span>Outer rim arc indicates more generations</span>
        </div>
      </div>
    </div>
  );
}
