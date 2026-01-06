import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader } from "@googlemaps/js-api-loader";

/**
 * Google Maps panel: renders markers for engineers and polylines for routes.
 * Graceful fallback if REACT_APP_GOOGLE_MAPS_API_KEY is missing.
 */
export default function MapPanel({ scopedState, selectedRouteId, onSelectRouteId }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const polylinesRef = useRef([]);

  const [mapsEnabled, setMapsEnabled] = useState(false);
  const [mapsError, setMapsError] = useState("");

  const apiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;

  const activeRoutes = useMemo(() => {
    if (!scopedState) return [];
    return scopedState.routes;
  }, [scopedState]);

  const activeLocations = useMemo(() => {
    if (!scopedState) return [];
    return scopedState.engineerLiveLocations;
  }, [scopedState]);

  const center = useMemo(() => {
    // center on first visible location, else default US center-ish
    const first = activeLocations[0];
    return first ? { lat: first.lat, lng: first.lng } : { lat: 39.8283, lng: -98.5795 };
  }, [activeLocations]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!apiKey) {
        setMapsEnabled(false);
        setMapsError("Missing Google Maps API key.");
        return;
      }

      try {
        const loader = new Loader({
          apiKey,
          version: "weekly",
        });
        const google = await loader.load();
        if (cancelled) return;

        setMapsEnabled(true);
        setMapsError("");

        if (!mapRef.current) return;

        mapInstanceRef.current = new google.maps.Map(mapRef.current, {
          center,
          zoom: 12,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
      } catch (e) {
        if (cancelled) return;
        setMapsEnabled(false);
        setMapsError("Unable to load Google Maps. Check API key/network.");
      }
    }

    init();

    return () => {
      cancelled = true;
    };
  }, [apiKey, center]);

  useEffect(() => {
    if (!mapsEnabled || !mapInstanceRef.current) return;
    // eslint-disable-next-line no-undef
    const google = window.google;
    if (!google?.maps) return;

    // Clear old markers/polylines
    markersRef.current.forEach((m) => m.setMap(null));
    polylinesRef.current.forEach((p) => p.setMap(null));
    markersRef.current = [];
    polylinesRef.current = [];

    // Draw routes
    activeRoutes.forEach((r) => {
      const isSelected = selectedRouteId ? r.id === selectedRouteId : false;
      const poly = new google.maps.Polyline({
        path: r.polyline,
        geodesic: true,
        strokeColor: isSelected ? "#1E3A8A" : "rgba(30,58,138,0.35)",
        strokeOpacity: 1.0,
        strokeWeight: isSelected ? 5 : 3,
      });
      poly.setMap(mapInstanceRef.current);
      poly.addListener("click", () => onSelectRouteId?.(r.id));
      polylinesRef.current.push(poly);
    });

    // Draw engineer markers
    activeLocations.forEach((loc) => {
      const marker = new google.maps.Marker({
        position: { lat: loc.lat, lng: loc.lng },
        map: mapInstanceRef.current,
        title: loc.engineerId,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: "#F59E0B",
          fillOpacity: 1,
          scale: 7,
          strokeColor: "#1E3A8A",
          strokeWeight: 2,
        },
      });
      markersRef.current.push(marker);
    });

    // Fit bounds to visible stuff if possible
    const bounds = new google.maps.LatLngBounds();
    let hasAny = false;
    activeLocations.forEach((loc) => {
      bounds.extend(new google.maps.LatLng(loc.lat, loc.lng));
      hasAny = true;
    });
    activeRoutes.forEach((r) => {
      r.polyline.forEach((p) => {
        bounds.extend(new google.maps.LatLng(p.lat, p.lng));
        hasAny = true;
      });
    });
    if (hasAny) {
      mapInstanceRef.current.fitBounds(bounds, 40);
    }
  }, [mapsEnabled, scopedState, activeRoutes, activeLocations, selectedRouteId, onSelectRouteId]);

  return (
    <div className="card">
      <div className="cardHeader">
        <div>
          <h2>Map Overview</h2>
          <p>Engineer locations and route polylines</p>
        </div>
        <span className="badge">{mapsEnabled ? "Maps: Enabled" : "Maps: Fallback"}</span>
      </div>

      <div className="mapBox">
        <div ref={mapRef} style={{ height: "100%", width: "100%" }} />
        {!mapsEnabled && (
          <div className="mapFallback" aria-live="polite">
            <div className="mapFallbackInner">
              <h3>Google Maps is disabled</h3>
              <p>
                {mapsError ||
                  "To enable maps, set environment variable REACT_APP_GOOGLE_MAPS_API_KEY and restart the dev server."}
              </p>
              <div className="notice">
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Fallback view</div>
                <div style={{ display: "grid", gap: 6 }}>
                  <div>
                    <strong>Visible engineers:</strong> {activeLocations.length}
                  </div>
                  <div>
                    <strong>Visible routes:</strong> {activeRoutes.length}
                  </div>
                  <div className="mini">You can still use dashboards, lists, filtering, and status updates.</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <hr className="hr" />

      <div className="splitRow">
        <div className="mini">
          Click a route polyline (when enabled) to filter list views by route. Selected route:{" "}
          <strong>{selectedRouteId || "None"}</strong>
        </div>
        <button className="btn btnGhost" onClick={() => onSelectRouteId?.("")} disabled={!selectedRouteId}>
          Clear route filter
        </button>
      </div>
    </div>
  );
}
