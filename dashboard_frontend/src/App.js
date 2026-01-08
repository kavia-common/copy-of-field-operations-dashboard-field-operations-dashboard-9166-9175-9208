import React, { useEffect, useMemo, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import "./App.css";

import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import EngineersPage from "./pages/EngineersPage";
import TasksPage from "./pages/TasksPage";
import DPRPage from "./pages/DPRPage";
import AllocationPage from "./pages/AllocationPage";
import RoutesConfigPage from "./pages/RoutesConfigPage";

import AppShell from "./components/AppShell";
import { loadSession, logout } from "./state/auth";
import { getScopedDomain, loadDomainState, resetDomainState } from "./state/domainStore";
import { Roles } from "./data/dummyData";
import { fetchDomainStateFromApi } from "./state/apiClient";
import { getDemoModeEnabled, setDemoModeEnabled } from "./state/dataMode";

function isLoginRoleAllowed(role) {
  return role === Roles.ADMIN || role === Roles.REGIONAL_MANAGER;
}

function RequireAuth({ user, children }) {
  const location = useLocation();

  // If any stale/invalid role makes it through, force a clean login.
  if (user && !isLoginRoleAllowed(user.role)) {
    logout();
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return children;
}

function RequireRole({ user, allowRoles, children }) {
  if (!user) return null;
  if (!allowRoles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return children;
}

function miniToggleTextStyle() {
  return { fontSize: 12, fontWeight: 900, color: "var(--ocean-text)" };
}

function miniStatusStyle() {
  return { fontSize: 12, color: "var(--ocean-muted)" };
}

function getApiStatusTone(status) {
  if (status === "connected") return "badgeSuccess";
  if (status === "error") return "badgeError";
  if (status === "loading") return "badgeWarn";
  return "";
}

// PUBLIC_INTERFACE
function App() {
  /**
   * Main application entry: handles login, routing, role-based access control,
   * and data sourcing:
   *  - Demo Mode ON: local domain state (localStorage-backed) + simulated refresh.
   *  - Demo Mode OFF: fetch domain state from API endpoints (with graceful fallback).
   */
  const [currentUser, setCurrentUser] = useState(null);

  // Demo Mode persisted preference
  const [demoModeEnabled, setDemoModeEnabledState] = useState(() => getDemoModeEnabled());

  // Domain state (used in both modes; in API mode this becomes "last-known" state)
  const [domainState, setDomainState] = useState(() => loadDomainState());

  const [routeFilterId, setRouteFilterId] = useState("");

  // API status (only relevant when demo mode is OFF)
  const [apiStatus, setApiStatus] = useState(() => ({
    state: demoModeEnabled ? "idle" : "loading", // idle | loading | connected | error
    message: demoModeEnabled ? "" : "Loading from API…",
    lastUpdatedAt: "",
  }));

  useEffect(() => {
    // loadSession() already purges invalid/FE sessions.
    setCurrentUser(loadSession());
  }, []);

  // When switching to API mode, attempt to load state from API immediately.
  useEffect(() => {
    let cancelled = false;

    async function loadFromApi() {
      if (demoModeEnabled) return;

      setApiStatus({ state: "loading", message: "Loading from API…", lastUpdatedAt: "" });

      const res = await fetchDomainStateFromApi();
      if (cancelled) return;

      if (res.ok) {
        setDomainState(res.state);
        setApiStatus({
          state: "connected",
          message: "Using API data",
          lastUpdatedAt: new Date().toISOString(),
        });
      } else {
        // Keep the current local/last-known state so the dashboard remains usable.
        setApiStatus({
          state: "error",
          message: res.error || "API is currently unavailable. Showing last known data.",
          lastUpdatedAt: new Date().toISOString(),
        });
      }
    }

    loadFromApi();

    return () => {
      cancelled = true;
    };
  }, [demoModeEnabled]);

  const scopedState = useMemo(() => {
    if (!currentUser) return null;
    return getScopedDomain(domainState, currentUser);
  }, [domainState, currentUser]);

  function handleLogout() {
    logout();
    setCurrentUser(null);
    setRouteFilterId("");
  }

  function handleResetData() {
    const next = resetDomainState();
    setDomainState(next);
    setRouteFilterId("");
  }

  function handleToggleDemoMode(nextEnabled) {
    setDemoModeEnabled(nextEnabled);
    setDemoModeEnabledState(nextEnabled);

    // When returning to demo mode, keep the app responsive and clear any API messaging.
    if (nextEnabled) {
      setApiStatus({ state: "idle", message: "", lastUpdatedAt: "" });
      // Reset is still available in demo mode; do not auto-reset when toggling.
    }
  }

  const topBarControls = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {/* <label
        style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}
        aria-label="Demo Mode toggle"
      >
        <input
          type="checkbox"
          checked={demoModeEnabled}
          onChange={(e) => handleToggleDemoMode(e.target.checked)}
          aria-checked={demoModeEnabled}
        />
        <span style={miniToggleTextStyle()}>Demo Mode</span>
      </label> */}

      {!demoModeEnabled ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={`badge ${getApiStatusTone(apiStatus.state)}`} aria-label="API connection status">
            {apiStatus.state === "loading"
              ? "Connecting"
              : apiStatus.state === "connected"
                ? "Connected"
                : apiStatus.state === "error"
                  ? "Issue"
                  : "Status"}
          </span>
          <span style={miniStatusStyle()} aria-label="API status message">
            {apiStatus.message}
          </span>
        </div>
      ) : (
        <button className="btn btnGhost" onClick={handleResetData} style={{ padding: "8px 10px", fontSize: 12 }}>
          Reset Data
        </button>
      )}
    </div>
  );

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            currentUser ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <LoginPage
                onLoggedIn={(u) => {
                  // Defensive: even if someone hacks the UI, do not accept FE.
                  if (!isLoginRoleAllowed(u?.role)) {
                    handleLogout();
                    return;
                  }
                  setCurrentUser(u);
                }}
              />
            )
          }
        />

        <Route
          path="/"
          element={
            <RequireAuth user={currentUser}>
              <Navigate to="/dashboard" replace />
            </RequireAuth>
          }
        />

        <Route
          path="/dashboard"
          element={
            <RequireAuth user={currentUser}>
              <AppShell currentUser={currentUser} onLogout={handleLogout} topBarControls={topBarControls}>
                <DashboardPage
                  scopedState={scopedState}
                  fullState={domainState}
                  setFullState={setDomainState}
                  currentUser={currentUser}
                  demoModeEnabled={demoModeEnabled}
                  apiStatus={apiStatus}
                />
              </AppShell>
            </RequireAuth>
          }
        />

        <Route
          path="/engineers"
          element={
            <RequireAuth user={currentUser}>
              <RequireRole user={currentUser} allowRoles={[Roles.ADMIN, Roles.REGIONAL_MANAGER]}>
                <AppShell currentUser={currentUser} onLogout={handleLogout} topBarControls={topBarControls}>
                  <EngineersPage scopedState={scopedState} currentUser={currentUser} routeFilterId={routeFilterId} />
                </AppShell>
              </RequireRole>
            </RequireAuth>
          }
        />

        <Route
          path="/tasks"
          element={
            <RequireAuth user={currentUser}>
              <RequireRole user={currentUser} allowRoles={[Roles.ADMIN, Roles.REGIONAL_MANAGER]}>
                <AppShell currentUser={currentUser} onLogout={handleLogout} topBarControls={topBarControls}>
                  <TasksPage scopedState={scopedState} currentUser={currentUser} routeFilterId={routeFilterId} />
                </AppShell>
              </RequireRole>
            </RequireAuth>
          }
        />

        <Route
          path="/allocation"
          element={
            <RequireAuth user={currentUser}>
              <RequireRole user={currentUser} allowRoles={[Roles.ADMIN, Roles.REGIONAL_MANAGER]}>
                <AppShell currentUser={currentUser} onLogout={handleLogout} topBarControls={topBarControls}>
                  <AllocationPage
                    scopedState={scopedState}
                    fullState={domainState}
                    setFullState={setDomainState}
                    currentUser={currentUser}
                  />
                </AppShell>
              </RequireRole>
            </RequireAuth>
          }
        />

        <Route
          path="/routes"
          element={
            <RequireAuth user={currentUser}>
              <RequireRole user={currentUser} allowRoles={[Roles.ADMIN, Roles.REGIONAL_MANAGER]}>
                <AppShell currentUser={currentUser} onLogout={handleLogout} topBarControls={topBarControls}>
                  <RoutesConfigPage
                    scopedState={scopedState}
                    fullState={domainState}
                    setFullState={setDomainState}
                    currentUser={currentUser}
                  />
                </AppShell>
              </RequireRole>
            </RequireAuth>
          }
        />

        <Route
          path="/dpr"
          element={
            <RequireAuth user={currentUser}>
              <RequireRole user={currentUser} allowRoles={[Roles.ADMIN, Roles.REGIONAL_MANAGER]}>
                <AppShell currentUser={currentUser} onLogout={handleLogout} topBarControls={topBarControls}>
                  <DPRPage currentUser={currentUser} fullState={domainState} />
                </AppShell>
              </RequireRole>
            </RequireAuth>
          }
        />

        <Route path="*" element={<Navigate to={currentUser ? "/dashboard" : "/login"} replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
