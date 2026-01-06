import React from "react";
import AllocationPanel from "../components/AllocationPanel";
import { Roles } from "../data/dummyData";

// PUBLIC_INTERFACE
export default function AllocationPage({ scopedState, fullState, setFullState, currentUser }) {
  /** Allocation page route. Visible to Admin + Regional Manager. */
  const canSee = currentUser?.role === Roles.ADMIN || currentUser?.role === Roles.REGIONAL_MANAGER;

  if (!canSee) {
    return (
      <div className="content">
        <div className="card">
          <div className="cardHeader">
            <div>
              <h2>Allocation</h2>
              <p>Access restricted</p>
            </div>
          </div>
          <div className="notice">Allocation is available to Admin and Regional Manager roles.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="content">
      <AllocationPanel scopedState={scopedState} fullState={fullState} setFullState={setFullState} currentUser={currentUser} />
    </div>
  );
}
