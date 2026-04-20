// src/components/MapPicker.jsx
import { useEffect, useRef, useState } from 'react';

// Leaflet loaded via CDN in index.html — uses window.L

export default function MapPicker({ onLocationSelect, syncLocation }) {
  const mapRef = useRef(null);
  const leafletMap = useRef(null);
  const markerRef = useRef(null);
  const markerIconRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [pinLabel, setPinLabel] = useState('Click anywhere on the map to drop a pin');

  // ── Map initialisation (runs once) ──────────────────────────────────────────
  useEffect(() => {
    const init = () => {
      if (!window.L || leafletMap.current) return;
      const L = window.L;

      const map = L.map(mapRef.current, {
        center: [38.5, -96],
        zoom: 4,
        zoomControl: true,
        attributionControl: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      markerIconRef.current = L.divIcon({
        className: 'wss-map-marker',
        html: `<div class="marker-pin"></div><div class="marker-pulse"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });

      // Click handler — user manually picks a point
      map.on('click', async (e) => {
        const { lat, lng } = e.latlng;
        setLoading(true);
        setPinLabel('Locating address…');
        placeMarker(lat, lng);

        let displayName = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        try {
          const url = `/api/proxy?target=${encodeURIComponent(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`
          )}`;
          const r = await fetch(url);
          const data = await r.json();
          if (data.display_name) displayName = data.display_name;
        } catch (e) { /* fallback to coords */ }

        setPinLabel(displayName);
        setLoading(false);
        onLocationSelect({ lat, lon: lng, displayName });
      });

      leafletMap.current = map;

      // If a syncLocation was already set before the map initialised, apply it now
      if (syncLocation?.lat != null && syncLocation?.lon != null) {
        applySync(syncLocation, map);
      }
    };

    if (window.L) {
      init();
    } else {
      const iv = setInterval(() => { if (window.L) { clearInterval(iv); init(); } }, 100);
      return () => clearInterval(iv);
    }

    return () => {
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
        markerRef.current = null;
      }
    };
  }, []);

  // ── Sync external location into map ─────────────────────────────────────────
  // Runs whenever parent updates syncLocation (address autocomplete or lat/lon entry)
  useEffect(() => {
    if (!syncLocation?.lat || !syncLocation?.lon) return;
    if (!leafletMap.current) return; // map not ready yet — init() handles it
    applySync(syncLocation, leafletMap.current);
  }, [syncLocation]);

  function applySync({ lat, lon, displayName }, map) {
    placeMarker(lat, lon, map);
    // Fly to location with appropriate zoom
    map.flyTo([lat, lon], 14, { animate: true, duration: 1.2 });
    setPinLabel(displayName || `${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}`);
  }

  function placeMarker(lat, lng, map) {
    const m = map || leafletMap.current;
    if (!m || !markerIconRef.current) return;
    const L = window.L;
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
    } else {
      markerRef.current = L.marker([lat, lng], { icon: markerIconRef.current }).addTo(m);
    }
  }

  return (
    <div className="map-picker-wrap">
      <div ref={mapRef} className="map-container" />
      <div className={`map-pin-label ${loading ? 'loading' : ''}`}>
        {loading ? <span className="spinner spinner-sm" /> : '📍'}
        <span>{pinLabel}</span>
      </div>
    </div>
  );
}
