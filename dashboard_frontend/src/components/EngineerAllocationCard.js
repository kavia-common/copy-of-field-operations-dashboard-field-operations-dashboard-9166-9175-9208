import React, { useMemo } from "react";
import { computeEngineerAllocationSummary } from "../state/domainStore";

function pct(n) {
  return `${Math.round(Number(n || 0))}%`;
}

function dotStyle(color) {
  return {
    width: 10,
    height: 10,
    borderRadius: 999,
    display: "inline-block",
    background: color,
    boxShadow: "0 0 0 3px rgba(17,24,39,0.06)",
  };
}

function rowStyle() {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 10px",
    borderRadius: 12,
    border: "1px solid var(--ocean-border)",
    background: "rgba(255,255,255,0.7)",
  };
}

function iconTextStyle(tone) {
  if (tone === "warn") return { color: "var(--ocean-secondary)" };
  if (tone === "error") return { color: "var(--ocean-error)" };
  if (tone === "success") return { color: "var(--ocean-success)" };
  return { color: "var(--ocean-text)" };
}

// PUBLIC_INTERFACE
export default function EngineerAllocationCard({ scopedState, dateIso, complianceSnapshot }) {
  /** Dashboard KPI card: Engineer Allocation (totals, utilization trend, status breakdown, alerts). */
  const summary = useMemo(
    () => computeEngineerAllocationSummary(scopedState, { dateIso, complianceSnapshot, persistTrend: true }),
    [scopedState, dateIso, complianceSnapshot]
  );

  const trend = summary.totals.utilizationTrend;
  const arrow = trend === "up" ? "↑" : trend === "down" ? "↓" : "→";
  const arrowTone = trend === "up" ? "success" : trend === "down" ? "warn" : "neutral";

  // Ocean theme legend equivalents for 🟢🔵🟡🔴
  const colors = {
    green: "var(--ocean-success)",
    blue: "var(--ocean-primary)",
    yellow: "var(--ocean-secondary)",
    red: "var(--ocean-error)",
  };

  return (
    <div className="card" aria-label="Engineer Allocation">
      <div className="cardHeader">
        <div>
          <h2>Engineer Allocation</h2>
          <p>Live allocation, utilization, status, and alerts</p>
        </div>
        <span className="badge" aria-label="Total engineers in current scope">
          <strong>{summary.totals.totalEngineers}</strong> total
        </span>
      </div>

      {/* Two-part layout:
          (A) Summary block (totals/utilization)
          (B) Grid/rows (status breakdown + alerts)
      */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 1fr)",
          gap: 14,
        }}
      >
        {/* (A) Summary */}
        <div
          style={{
            border: "1px solid var(--ocean-border)",
            borderRadius: 14,
            padding: 12,
            background: "linear-gradient(135deg, rgba(30,58,138,0.06), rgba(245,158,11,0.06))",
          }}
        >
          <div style={{ display: "grid", gap: 10 }}>
            <div style={rowStyle()}>
              <div style={{ fontWeight: 900 }}>Total Engineers</div>
              <div style={{ fontWeight: 950, fontSize: 18 }}>{summary.totals.totalEngineers}</div>
            </div>

            <div style={rowStyle()}>
              <div style={{ fontWeight: 900 }}>Active / On Duty</div>
              <div style={{ fontWeight: 950, fontSize: 18 }}>{summary.totals.activeOnDuty}</div>
            </div>

            <div style={rowStyle()}>
              <div style={{ fontWeight: 900 }}>Allocated</div>
              <div style={{ fontWeight: 950, fontSize: 18 }}>{summary.totals.allocated}</div>
            </div>

            <div style={rowStyle()}>
              <div style={{ fontWeight: 900 }}>Idle</div>
              <div style={{ fontWeight: 950, fontSize: 18 }}>{summary.totals.idle}</div>
            </div>

            <div style={rowStyle()}>
              <div style={{ fontWeight: 900 }}>Utilization</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontWeight: 950, fontSize: 18 }}>{pct(summary.totals.utilizationPercent)}</span>
                <span
                  aria-label={
                    trend === "up"
                      ? "Utilization increased"
                      : trend === "down"
                        ? "Utilization decreased"
                        : "Utilization unchanged"
                  }
                  style={{ fontWeight: 950, ...iconTextStyle(arrowTone) }}
                >
                  {arrow}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* (B) Status + Alerts */}
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 950, fontSize: 12, color: "var(--ocean-muted)" }}>Status breakdown</div>

            <div style={rowStyle()}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={dotStyle(colors.green)} aria-hidden="true" />
                <span style={{ fontWeight: 900 }}>On Route</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 950 }}>{summary.status.onRoute}</span>
                <span aria-label="Green status dot" style={{ ...iconTextStyle("success") }}>
                  🟢
                </span>
              </div>
            </div>

            <div style={rowStyle()}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={dotStyle(colors.blue)} aria-hidden="true" />
                <span style={{ fontWeight: 900 }}>Paused</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 950 }}>{summary.status.paused}</span>
                <span aria-label="Blue status dot" style={{ ...iconTextStyle("neutral") }}>
                  🔵
                </span>
              </div>
            </div>

            <div style={rowStyle()}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={dotStyle(colors.yellow)} aria-hidden="true" />
                <span style={{ fontWeight: 900 }}>Idle</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 950 }}>{summary.status.idle}</span>
                <span aria-label="Yellow status dot" style={{ ...iconTextStyle("warn") }}>
                  🟡
                </span>
              </div>
            </div>

            <div style={rowStyle()}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={dotStyle(colors.red)} aria-hidden="true" />
                <span style={{ fontWeight: 900 }}>Offline</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 950 }}>{summary.status.offline}</span>
                <span aria-label="Red status dot" style={{ ...iconTextStyle("error") }}>
                  🔴
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 950, fontSize: 12, color: "var(--ocean-muted)" }}>Alerts</div>

            <div style={rowStyle()}>
              <div style={{ fontWeight: 900 }}>Deviations</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 950 }}>{summary.alerts.deviations}</span>
                <span aria-label="Warning icon" style={{ ...iconTextStyle("warn") }}>
                  ⚠
                </span>
              </div>
            </div>

            <div style={rowStyle()}>
              <div style={{ fontWeight: 900 }}>GPS Issues</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 950 }}>{summary.alerts.gpsIssues}</span>
                <span aria-label="Blocked icon" style={{ ...iconTextStyle("error") }}>
                  ⛔
                </span>
              </div>
            </div>

            <div className="mini" style={{ marginTop: 2 }}>
              Note: Paused is inferred from <strong>On Hold</strong> tasks; GPS Issues from missing/invalid or stale location.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
