import React, { useMemo, useState } from "react";
import { Statuses, statusMeta } from "../data/dummyData";

function toneToBadgeClass(tone) {
  if (tone === "success") return "badge badgeSuccess";
  if (tone === "error") return "badge badgeError";
  if (tone === "warn") return "badge badgeWarn";
  return "badge";
}

// PUBLIC_INTERFACE
export default function TaskExceptionModal({ open, task, mode, onClose, onSubmit }) {
  /**
   * Modal for:
   * - mode="reject": Mark as Rejected (reason required)
   * - mode="redo": Request Redo (reason required)
   * - mode="redo_complete": Mark Redo Completed (no reason required)
   */
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const title = mode === "reject" ? "Mark Task as Rejected" : mode === "redo" ? "Request Redo" : "Mark Redo Completed";
  const toStatus = mode === "reject" ? Statuses.REJECTED : mode === "redo" ? Statuses.REDO : Statuses.COMPLETED;

  const needsReason = useMemo(() => mode === "reject" || mode === "redo", [mode]);

  if (!open || !task) return null;

  function handleSubmit() {
    setError("");
    const res = onSubmit?.({ toStatus, reason });
    if (res?.ok === false) {
      setError(res.error || "Unable to update task.");
      return;
    }
    setReason("");
    onClose?.();
  }

  const currentTone = statusMeta[task.status]?.tone || "neutral";
  const nextTone = statusMeta[toStatus]?.tone || "neutral";

  const placeholder =
    mode === "reject"
      ? "Provide a rejection reason..."
      : mode === "redo"
      ? "Provide a redo reason (what needs to be fixed)..."
      : "Optional note...";

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal">
        <div className="modalHeader">
          <div>
            <h3>{title}</h3>
            <p>
              <strong>{task.title}</strong> · {task.id}
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

          {(mode === "reject" || mode === "redo" || mode === "redo_complete") && (
            <label className="input" style={{ minWidth: "100%" }}>
              <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ocean-muted)" }}>
                Reason {needsReason ? "(required)" : "(optional)"}
              </span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={placeholder} />
            </label>
          )}

          {error && <div className="notice" style={{ borderColor: "rgba(220,38,38,0.24)", color: "var(--ocean-error)" }}>{error}</div>}

          <div className="notice">
            <strong>Note:</strong> This action will append a status history entry. Reasons are stored on the task for quick reference.
          </div>
        </div>

        <div className="modalFooter">
          <button className="btn btnGhost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btnPrimary" onClick={handleSubmit}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
