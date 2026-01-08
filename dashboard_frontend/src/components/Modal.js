import React, { useEffect } from "react";

/**
 * Simple accessible modal wrapper (overlay + dialog).
 * Uses existing app CSS classes: modalOverlay, modal, modalHeader, modalBody, modalFooter.
 */

/**
 * NOTE: This component historically used `open` in some call sites and `isOpen` in others.
 * To prevent regressions, we support both props:
 * - `open` (preferred)
 * - `isOpen` (back-compat)
 */
// PUBLIC_INTERFACE
export default function Modal({
  open,
  isOpen,
  title,
  description,
  onClose,
  children,
  footer,
  maxWidth = 980,
  ariaLabelledBy,
  ariaDescribedBy,
}) {
  /** Accessible modal dialog. Closes on ESC and overlay click. */
  const resolvedOpen = typeof open === "boolean" ? open : Boolean(isOpen);

  useEffect(() => {
    if (!resolvedOpen) return undefined;

    function onKeyDown(e) {
      if (e.key === "Escape") onClose?.();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [resolvedOpen, onClose]);

  if (!resolvedOpen) return null;

  const ariaProps =
    ariaLabelledBy || ariaDescribedBy
      ? { "aria-labelledby": ariaLabelledBy, "aria-describedby": ariaDescribedBy }
      : { "aria-label": title };

  return (
    <div
      className="modalOverlay"
      role="presentation"
      onMouseDown={(e) => {
        // Close only if user clicks on the overlay itself (not inside modal content).
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" {...ariaProps} style={{ maxWidth, width: "100%" }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div>
            <h3>{title}</h3>
            {description ? <p>{description}</p> : null}
          </div>
          <button
            type="button"
            className="modalCloseIconBtn"
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="modalBody">{children}</div>

        {footer ? <div className="modalFooter">{footer}</div> : null}
      </div>
    </div>
  );
}
