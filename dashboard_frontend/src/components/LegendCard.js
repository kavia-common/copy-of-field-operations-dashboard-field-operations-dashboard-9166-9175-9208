import React from "react";

/**
 * Dedicated map legend card (outside Leaflet map).
 * Keeps styling consistent with Ocean Professional theme cards.
 */

// PUBLIC_INTERFACE
export default function LegendCard() {
  /** Renders the dashboard legend card for status fills, paths, and markers. */
  const swatch = (bg, { border = "rgba(17,24,39,0.18)" } = {}) => ({
    width: 12,
    height: 12,
    borderRadius: 6,
    background: bg,
    border: `1px solid ${border}`,
    flex: "0 0 auto",
  });

  const line = (color, { dashed = false } = {}) => ({
    width: 28,
    height: 0,
    borderTop: `4px ${dashed ? "dashed" : "solid"} ${color}`,
    borderRadius: 999,
    flex: "0 0 auto",
  });

  // Simple icon tokens (kept inline—no new assets or dependencies).
  const engineerAvatar = {
    width: 18,
    height: 18,
    borderRadius: 999,
    background: "#2563EB",
    border: "2px solid rgba(255,255,255,0.95)",
    boxShadow: "0 6px 14px rgba(17,24,39,0.18)",
    flex: "0 0 auto",
  };

  const pin = (color) => (
    <span
      aria-hidden="true"
      style={{
        width: 16,
        height: 16,
        borderRadius: "10px 10px 10px 0",
        transform: "rotate(-45deg)",
        background: color,
        border: "1px solid rgba(17,24,39,0.18)",
        boxShadow: "0 6px 14px rgba(17,24,39,0.14)",
        position: "relative",
        flex: "0 0 auto",
      }}
    >
      <span
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          transform: "rotate(45deg)",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: "rgba(255,255,255,0.92)",
          }}
        />
      </span>
    </span>
  );

  return (
    <aside className="card legendCard" aria-label="Map legend">
      <div className="cardHeader" style={{ marginBottom: 10 }}>
        <div>
          <h2>Legend</h2>
          <p>Status, paths, and markers</p>
        </div>
      </div>

      <div className="legendBody">
        <div className="legendSection">
          <div className="legendSectionTitle">Status fill</div>
          <div className="legendList">
            <div className="legendRow">
              <span style={swatch("#059669")} />
              <span className="mini">
                <strong style={{ color: "var(--ocean-success)" }}>Completed</strong>
              </span>
            </div>
            <div className="legendRow">
              <span style={swatch("#F59E0B")} />
              <span className="mini">
                <strong style={{ color: "#92400e" }}>In Progress</strong>
              </span>
            </div>
            <div className="legendRow">
              <span style={swatch("#9CA3AF")} />
              <span className="mini">
                <strong style={{ color: "var(--ocean-muted)" }}>Not Started</strong>
              </span>
            </div>
          </div>
        </div>

        <hr className="hr" style={{ margin: "10px 0" }} />

        <div className="legendSection">
          <div className="legendSectionTitle">Paths</div>
          <div className="legendList">
            <div className="legendRow">
              <span style={line("#2563EB", { dashed: true })} />
              <span className="mini">
                Planned route: <strong style={{ color: "#2563EB" }}>blue dashed</strong>
              </span>
            </div>

            <div className="legendRow">
              <span style={line("#059669")} />
              <span className="mini">
                Actual (on-route): <strong style={{ color: "#059669" }}>blue/green (configured)</strong>
              </span>
            </div>

            <div className="legendRow">
              <span style={line("#DC2626")} />
              <span className="mini">
                Off-route / deviation: <strong style={{ color: "var(--ocean-error)" }}>red</strong>
              </span>
            </div>

            <div className="mini" style={{ marginTop: 6, color: "var(--ocean-muted)" }}>
              Fill = Status (Completed/In Progress/Not Started) · Stroke = Actual path & deviations.
            </div>
          </div>
        </div>

        <hr className="hr" style={{ margin: "10px 0" }} />

        <div className="legendSection">
          <div className="legendSectionTitle">Markers</div>
          <div className="legendList">
            <div className="legendRow">
              <span aria-hidden="true" style={engineerAvatar} />
              <span className="mini">
                Engineer: <strong style={{ color: "#2563EB" }}>blue circle avatar</strong>
              </span>
            </div>
            <div className="legendRow">
              {pin("#059669")}
              <span className="mini">
                Start: <strong style={{ color: "var(--ocean-success)" }}>green pin</strong>
              </span>
            </div>
            <div className="legendRow">
              {pin("#EA4335")}
              <span className="mini">
                Destination: <strong>pin</strong>
              </span>
            </div>
          </div>
        </div>

        <div className="mini" style={{ marginTop: 10, color: "var(--ocean-muted)" }}>
          The legend is outside the map to avoid interfering with Leaflet controls and to keep modal/toast z-index layering unchanged.
        </div>
      </div>
    </aside>
  );
}
