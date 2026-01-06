import React, { useMemo, useState } from "react";
import { Statuses, statusMeta } from "../data/dummyData";

function toneToBadgeClass(tone) {
  if (tone === "success") return "badge badgeSuccess";
  if (tone === "error") return "badge badgeError";
  if (tone === "warn") return "badge badgeWarn";
  return "badge";
}

/**
 * Modal for updating task status.
 * Requires reason for on_hold/postponed.
 */
export default function StatusUpdateModal({ open, task, engineer, onClose, onSubmit }) {
  const [toStatus, setToStatus] = useState(task?.status || Statuses.IN_PROGRESS);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const needsReason = useMemo(() => toStatus === Statuses.ON_HOLD || toStatus === Statuses.POSTPONED, [toStatus]);

  if (!open || !task) return null;

  function handleSubmit() {
    setError("");
    const result = onSubmit?.({ toStatus, reason });
    if (result?.ok === false) {
      setError(result.error || "Unable to update status.");
      return;
    }
    onClose?.();
    setReason("");
  }

  const currentTone = statusMeta[task.status]?.tone || "neutral";
  const nextTone = statusMeta[toStatus]?.tone || "neutral";

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label="Update status">
      <div className="modal">
        <div className="modalHeader">
          <div>
            <h3>Update Task Status</h3>
            <p>
              <strong>{task.title}</strong> · {engineer?.name || "Unknown engineer"}
            </p>
          </div>
          <button className="btn btnGhost" onClick={onClose} aria-label="Close modal">
            Close
          </button>
        </div>

        <div className="modalBody">
          <div className="splitRow">
            <span className={toneToBadgeClass(currentTone)}>Current: {statusMeta[task.status]?.label || task.status}</span>
            <span className={toneToBadgeClass(nextTone)}>New: {statusMeta[toStatus]?.label || toStatus}</span>
          </div>

          <label className="input" style={{ minWidth: "100%" }}>
            <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>New status</span>
            <select value={toStatus} onChange={(e) => setToStatus(e.target.value)}>
              <option value={Statuses.ASSIGNED}>Assigned</option>
              <option value={Statuses.IN_PROGRESS}>In Progress</option>
              <option value={Statuses.COMPLETED}>Completed</option>
              <option value={Statuses.ON_HOLD}>On Hold (reason required)</option>
              <option value={Statuses.POSTPONED}>Postponed (reason required)</option>
            </select>
          </label>

          <label className="input" style={{ minWidth: "100%" }}>
            <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>
              Reason {needsReason ? "(required)" : "(optional)"}
            </span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={needsReason ? "Provide a short reason..." : "Add a note (optional)..." }
            />
          </label>

          {error && <div className="notice" style={{ borderColor: "rgba(220,38,38,0.24)", color: "var(--ocean-error)" }}>{error}</div>}

          <div className="notice">
            <strong>Rules:</strong> On Hold / Postponed require a reason. Updates will be appended to status history.
          </div>
        </div>

        <div className="modalFooter">
          <button className="btn btnGhost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btnPrimary" onClick={handleSubmit}>
            Save update
          </button>
        </div>
      </div>
    </div>
  );
}
