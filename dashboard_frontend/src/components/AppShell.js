import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faDigging } from "@fortawesome/free-solid-svg-icons";
import { Roles } from "../data/dummyData";

function navItemClass({ isActive }) {
  return `navItem ${isActive ? "navItemActive" : ""}`;
}

export default function AppShell({ currentUser, onLogout, children }) {
  // Login is restricted to Admin / Regional Manager. Navigation should reflect manager experience.
  const canSeeAllocation = currentUser?.role === Roles.ADMIN || currentUser?.role === Roles.REGIONAL_MANAGER;
  const canSeeRoutesConfig = currentUser?.role === Roles.ADMIN || currentUser?.role === Roles.REGIONAL_MANAGER;

  const navigate = useNavigate();

  return (
    <div className="appShell">
      <aside className="sidebar" aria-label="Sidebar navigation">
        <div className="brand">
          <div className="brandMark" aria-label="Field Ops" title="Field Ops">
            <FontAwesomeIcon icon={faDigging} className="brandIcon" aria-hidden="true" />
          </div>
          <div className="brandTitle">
            <strong>Field Ops</strong>
            <span>Dashboard</span>
          </div>
        </div>

        <div className="navGroupLabel">Navigation</div>

        <NavLink className={navItemClass} to="/dashboard">
          <span className="navIcon">D</span>
          Dashboard
        </NavLink>

        <NavLink className={navItemClass} to="/tasks">
          <span className="navIcon">T</span>
          Tasks
        </NavLink>

        <NavLink className={navItemClass} to="/engineers">
          <span className="navIcon">E</span>
          Engineers
        </NavLink>

        {canSeeAllocation && (
          <NavLink className={navItemClass} to="/allocation">
            <span className="navIcon">A</span>
            Allocation
          </NavLink>
        )}

        {canSeeRoutesConfig && (
          <NavLink className={navItemClass} to="/routes">
            <span className="navIcon">R</span>
            Routes
          </NavLink>
        )}

        <NavLink className={navItemClass} to="/dpr">
          <span className="navIcon">R</span>
          DPR
        </NavLink>

        <div className="sidebarFooter">
          <div style={{ fontWeight: 900, color: "var(--ocean-text)" }}>{currentUser?.name}</div>
          <div style={{ marginTop: 4 }}>
            <span className="mini">Role:</span> <strong>{currentUser?.role}</strong>
          </div>
          {currentUser?.regionId && (
            <div style={{ marginTop: 4 }}>
              <span className="mini">Region:</span> <strong>{currentUser.regionId}</strong>
            </div>
          )}

          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn btnGhost" onClick={() => navigate("/dpr")}>
              Open DPR
            </button>
            <button className="btn btnDanger" onClick={onLogout}>
              Logout
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="topBar">
          <div className="topBarInner">
            <div className="pageTitle">
              <h1>Field Operations Dashboard</h1>
              <p>Role-based visibility · Dummy local data · Status tracking</p>
            </div>

            <div className="userPill" aria-label="Current user">
              <div className="userAvatar">{(currentUser?.name || "?").split(" ").map((p) => p[0]).slice(0, 2).join("")}</div>
              <div className="userMeta">
                <strong>{currentUser?.name}</strong>
                <span>{currentUser?.role}</span>
              </div>
            </div>
          </div>
        </div>

        {children}
      </main>
    </div>
  );
}
