import React, { useMemo, useState } from "react";
import { listDemoAccounts, loginAsUserId } from "../state/auth";
import { regions, Roles } from "../data/dummyData";

function regionName(regionId) {
  return regions.find((r) => r.id === regionId)?.name || "—";
}

export default function LoginPage({ onLoggedIn }) {
  const accounts = useMemo(() => listDemoAccounts(), []);
  const [selectedUserId, setSelectedUserId] = useState(accounts[0]?.id || "");
  const [error, setError] = useState("");

  const selected = accounts.find((a) => a.id === selectedUserId);

  function handleLogin() {
    setError("");
    const result = loginAsUserId(selectedUserId);
    if (!result.ok) {
      setError(result.error || "Login failed.");
      return;
    }
    onLoggedIn?.(result.user);
  }

  return (
    <div className="loginWrap">
      <div className="loginCard">
        <aside className="loginAside">
          <div className="brand" style={{ borderBottom: "none", marginBottom: 10, padding: 0 }}>
            <div className="brandMark" />
            <div className="brandTitle">
              <strong>Field Operations</strong>
              <span>Ocean Professional · Classic</span>
            </div>
          </div>

          <h1>Role-based Dashboard</h1>
          <p>
            This demo app uses <strong>dummy local JSON data</strong>. No backend calls. Login by selecting a demo account.
          </p>

          <div className="notice">
            <div style={{ fontWeight: 900, color: "var(--ocean-text)", marginBottom: 6 }}>Permissions</div>
            <div style={{ display: "grid", gap: 6 }}>
              <div>
                <strong>{Roles.ADMIN}</strong>: full visibility across regions.
              </div>
              <div>
                <strong>{Roles.REGIONAL_MANAGER}</strong>: restricted to their region (~8 engineers).
              </div>
              <div>
                <strong>{Roles.FIELD_ENGINEER}</strong>: sees only their assignments and can update task statuses.
              </div>
            </div>
          </div>
        </aside>

        <main className="loginMain">
          <h2>Select a demo account</h2>

          <div className="filters" style={{ marginBottom: 12 }}>
            <label className="input" style={{ minWidth: "100%" }}>
              <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>User</span>
              <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {a.role}
                    {a.role === Roles.REGIONAL_MANAGER || a.role === Roles.FIELD_ENGINEER ? ` (${regionName(a.regionId)})` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {selected && (
            <div className="card" style={{ padding: 12, marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 900 }}>{selected.name}</div>
                  <div className="mini">
                    Role: <strong>{selected.role}</strong>
                    {selected.regionId ? (
                      <>
                        {" "}
                        · Region: <strong>{regionName(selected.regionId)}</strong>
                      </>
                    ) : null}
                  </div>
                </div>
                <button className="btn btnPrimary" onClick={handleLogin}>
                  Login
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="notice" style={{ borderColor: "rgba(220,38,38,0.24)", color: "var(--ocean-error)" }}>
              {error}
            </div>
          )}

          <div className="notice">
            <strong>Tip:</strong> If Google Maps API key is not configured, the Map panel will show a graceful fallback.
          </div>
        </main>
      </div>
    </div>
  );
}
