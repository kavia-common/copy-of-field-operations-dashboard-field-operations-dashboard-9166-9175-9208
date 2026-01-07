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

// PUBLIC_INTERFACE
function App() {
  /**
   * Main application entry: handles login, routing, role-based access control,
   * and dummy-data state management (localStorage-backed).
   */
  const [currentUser, setCurrentUser] = useState(null);
  const [domainState, setDomainState] = useState(() => loadDomainState());
  const [routeFilterId, setRouteFilterId] = useState("");

  useEffect(() => {
    // loadSession() already purges invalid/FE sessions.
    setCurrentUser(loadSession());
  }, []);

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
              <AppShell currentUser={currentUser} onLogout={handleLogout}>
                {/* Provide reset action as an inline card */}
                <div className="content">
                  <div className="card">
                    <div className="cardHeader">
                      <div>
                        <h2>Data Controls</h2>
                        <p>All data is local dummy JSON (stored in localStorage)</p>
                      </div>
                      <button className="btn btnGhost" onClick={handleResetData}>
                        Reset dummy data
                      </button>
                    </div>
                    <div className="mini">
                      Reset will restore default tasks/status history. This is useful for demoing role-based updates repeatedly.
                    </div>
                  </div>
                </div>

                <DashboardPage
                  scopedState={scopedState}
                  fullState={domainState}
                  setFullState={setDomainState}
                  currentUser={currentUser}
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
                <AppShell currentUser={currentUser} onLogout={handleLogout}>
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
                <AppShell currentUser={currentUser} onLogout={handleLogout}>
                  <TasksPage
                    scopedState={scopedState}
                    currentUser={currentUser}
                    routeFilterId={routeFilterId}
                  />
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
                <AppShell currentUser={currentUser} onLogout={handleLogout}>
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
                <AppShell currentUser={currentUser} onLogout={handleLogout}>
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
                <AppShell currentUser={currentUser} onLogout={handleLogout}>
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
