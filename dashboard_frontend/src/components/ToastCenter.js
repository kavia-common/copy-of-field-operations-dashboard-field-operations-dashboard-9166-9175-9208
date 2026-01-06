import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Lightweight in-app toast/alert center.
 *
 * Design goals:
 * - No external dependencies
 * - De-duplicate alerts within a short window (configurable)
 * - Persist minimal metadata in localStorage (so refresh doesn't spam)
 * - Allow dismiss + quick actions
 */

const STORAGE_KEY = "fod_compliance_toasts_v1";

function nowMs() {
  return Date.now();
}

function safeParseJson(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function loadPersisted() {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return { recentKeys: {}, dismissedIds: {} };
  const parsed = safeParseJson(raw, { recentKeys: {}, dismissedIds: {} });
  if (!parsed || typeof parsed !== "object") return { recentKeys: {}, dismissedIds: {} };
  return {
    recentKeys: parsed.recentKeys && typeof parsed.recentKeys === "object" ? parsed.recentKeys : {},
    dismissedIds: parsed.dismissedIds && typeof parsed.dismissedIds === "object" ? parsed.dismissedIds : {},
  };
}

function savePersisted(persisted) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

function severityTone(severity) {
  if (severity === "high") return "error";
  if (severity === "medium") return "warn";
  return "default";
}

// PUBLIC_INTERFACE
export default function ToastCenter({
  toasts,
  onDismiss,
  onOpenDetails,
  onOpenOnMap,
  dedupeWindowMs = 2 * 60_000,
  maxVisible = 4,
}) {
  /** Renders toast stack and persists minimal de-dupe/dismiss state in localStorage. */
  const [persisted, setPersisted] = useState(() => loadPersisted());
  const persistedRef = useRef(persisted);

  useEffect(() => {
    persistedRef.current = persisted;
    savePersisted(persisted);
  }, [persisted]);

  // Garbage-collect persisted keys so the storage doesn't grow unbounded.
  useEffect(() => {
    const id = window.setInterval(() => {
      const cutoff = nowMs() - 24 * 60 * 60_000;
      const next = { ...persistedRef.current };
      const nextRecent = { ...(next.recentKeys || {}) };
      Object.keys(nextRecent).forEach((k) => {
        if ((nextRecent[k] || 0) < cutoff) delete nextRecent[k];
      });

      // Dismissed IDs can also be trimmed after ~7 days.
      const dismissedCutoff = nowMs() - 7 * 24 * 60 * 60_000;
      const nextDismissed = { ...(next.dismissedIds || {}) };
      Object.keys(nextDismissed).forEach((k) => {
        if ((nextDismissed[k] || 0) < dismissedCutoff) delete nextDismissed[k];
      });

      next.recentKeys = nextRecent;
      next.dismissedIds = nextDismissed;
      setPersisted(next);
    }, 60_000);

    return () => window.clearInterval(id);
  }, []);

  const visibleToasts = useMemo(() => {
    // Filter out dismissed + auto de-dupe using persisted windowed keys.
    const recentKeys = persisted.recentKeys || {};
    const dismissedIds = persisted.dismissedIds || {};
    const cutoff = nowMs() - dedupeWindowMs;

    const filtered = (toasts || [])
      .filter((t) => t && t.id)
      .filter((t) => !dismissedIds[t.id])
      .filter((t) => {
        if (!t.dedupeKey) return true;
        const last = recentKeys[t.dedupeKey];
        return !last || last < cutoff;
      })
      .slice(0, maxVisible);

    return filtered;
  }, [toasts, persisted, dedupeWindowMs, maxVisible]);

  // When new visible toasts appear, mark their dedupe keys as "seen" in persisted store.
  useEffect(() => {
    if (!visibleToasts.length) return;

    const next = { ...persistedRef.current };
    const nextRecent = { ...(next.recentKeys || {}) };

    visibleToasts.forEach((t) => {
      if (t.dedupeKey) nextRecent[t.dedupeKey] = nowMs();
    });

    next.recentKeys = nextRecent;
    setPersisted(next);
  }, [visibleToasts]);

  if (!visibleToasts.length) return null;

  return (
    <div className="toastCenter" aria-live="polite" aria-relevant="additions">
      {visibleToasts.map((t) => {
        const tone = severityTone(t.severity);
        const toneClass =
          tone === "error" ? "toast toastError" : tone === "warn" ? "toast toastWarn" : "toast";

        return (
          <div key={t.id} className={toneClass} role="status">
            <div className="toastTop">
              <div className="toastTitle">
                <strong>{t.title}</strong>
                {t.subtitle ? <span className="mini">{t.subtitle}</span> : null}
              </div>

              <button
                className="toastClose"
                onClick={() => {
                  setPersisted((p) => ({
                    ...p,
                    dismissedIds: { ...(p.dismissedIds || {}), [t.id]: nowMs() },
                  }));
                  onDismiss?.(t.id);
                }}
                aria-label="Dismiss alert"
                title="Dismiss"
              >
                ✕
              </button>
            </div>

            {t.message ? <div className="toastMsg mini">{t.message}</div> : null}

            <div className="toastActions">
              <button className="btn btnGhost" onClick={() => onOpenDetails?.(t)} style={{ padding: "8px 10px", fontSize: 12 }}>
                Details
              </button>

              <button className="btn btnPrimary" onClick={() => onOpenOnMap?.(t)} style={{ padding: "8px 10px", fontSize: 12 }}>
                Open on map
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// PUBLIC_INTERFACE
export function clearAllPersistedToasts() {
  /** Clears localStorage metadata used by ToastCenter (dedupe + dismissed). */
  window.localStorage.removeItem(STORAGE_KEY);
}
