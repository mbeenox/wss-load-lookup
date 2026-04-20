// src/components/MapPicker.jsx
import { useEffect, useRef, useState } from 'react';

// Leaflet loaded via CDN in index.html to avoid bundle size issues
// This component uses window.L

export default function MapPicker({ onLocationSelect }) {
  const mapRef = useRef(null);
  const leafletMap = useRef(null);
  const markerRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [pinLabel, setPinLabel] = useState('Click anywhere on the map to drop a pin');

  useEffect(() => {
    // Wait for Leaflet to be available
    const init = () => {
      if (!window.L || leafletMap.current) return;

      const L = window.L;

      // Init map centered on contiguous US
      const map = L.map(mapRef.current, {
        center: [38.5, -96],
        zoom: 4,
        zoomControl: true,
        attributionControl: true,
      });

      // Tile layer — OpenStreetMap
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      // Custom marker icon
      const markerIcon = L.divIcon({
        className: 'wss-map-marker',
        html: `<div class="marker-pin"></div><div class="marker-pulse"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });

      // Click handler
      map.on('click', async (e) => {
        const { lat, lng } = e.latlng;
        setLoading(true);
        setPinLabel('Locating address…');

        // Place or move marker
        if (markerRef.current) {
          markerRef.current.setLatLng([lat, lng]);
        } else {
          markerRef.current = L.marker([lat, lng], { icon: markerIcon }).addTo(map);
        }

        // Reverse geocode
        let displayName = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        try {
          const url = `/api/proxy?target=${encodeURIComponent(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`
          )}`;
          const r = await fetch(url);
          const data = await r.json();
          if (data.display_name) displayName = data.display_name;
        } catch (e) { /* use coords as fallback */ }

        setPinLabel(displayName);
        setLoading(false);
        onLocationSelect({ lat, lon: lng, displayName });
      });

      leafletMap.current = map;
    };

    // Leaflet may already be loaded or need a moment
    if (window.L) {
      init();
    } else {
      const interval = setInterval(() => {
        if (window.L) { clearInterval(interval); init(); }
      }, 100);
      return () => clearInterval(interval);
    }

    return () => {
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
        markerRef.current = null;
      }
    };
  }, []);

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
