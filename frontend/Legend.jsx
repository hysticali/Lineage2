import React from "react";
import wheel from "../src/domain/wheel";
import { IcChevs } from "./icons";

const { genColor } = wheel;

export default function Legend({ viewDirection, chartView = "atlas" }) {
  const isAncestorView = viewDirection === "ancestors";
  const isGarden = chartView === "garden";
  const gens = isAncestorView
    ? [
        { i: 0, l: isGarden ? "Self (stamen)" : "Self" },
        { i: 1, l: "Parents" },
        { i: 2, l: "Grandparents" },
        { i: 3, l: "Great-grandparents" },
        { i: 4, l: "2× Great" },
        { i: 5, l: "3× Great" },
        { i: 6, l: "4× Great" },
      ]
    : [
        { i: 0, l: isGarden ? "Self (stamen)" : "Self" },
        { i: 1, l: "Children" },
        { i: 2, l: "Grandchildren" },
        { i: 3, l: "Great-grandchildren" },
        { i: 4, l: "2× Great" },
        { i: 5, l: "3× Great" },
        { i: 6, l: "4× Great" },
      ];

  const gardenSwatches = [
    "var(--garden-stamen)",
    "var(--garden-g1)",
    "var(--garden-g2)",
    "var(--garden-g3)",
    "var(--garden-g4)",
    "var(--garden-g5)",
    "var(--garden-g6)",
  ];

  return (
    <div className="glass legend-card">
      <p className="fd legend-title">
        <IcChevs /> {isGarden ? "Garden guide" : "Generations"}
      </p>
      <div className="legend-list">
        {gens.map((g) => (
          <div key={g.i} className="legend-item">
            <span
              className={
                isGarden && g.i === 0
                  ? "legend-swatch legend-swatch-stamen"
                  : isGarden
                    ? "legend-swatch legend-swatch-petal"
                    : "legend-swatch"
              }
              style={{ background: isGarden ? gardenSwatches[g.i] : genColor(g.i) }}
            />
            <span>{g.l}</span>
          </div>
        ))}
        {isGarden ? (
          <>
            <div className="legend-item legend-divider">
              <span className="legend-swatch-stem" />
              <span>Curved stems branch into family blooms</span>
            </div>
            {isAncestorView && (
              <div className="legend-item">
                <span className="legend-swatch-dashed" />
                <span>Dashed petals are siblings</span>
              </div>
            )}
            <div className="legend-item">
              <span className="legend-swatch-spouse" />
              <span>Lower leaf-bloom is spouse</span>
            </div>
            <div className="legend-item">
              <span className="legend-swatch-bud" />
              <span>Green buds add a parent or sprout more</span>
            </div>
          </>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
