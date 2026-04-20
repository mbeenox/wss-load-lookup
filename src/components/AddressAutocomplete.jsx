// src/components/AddressAutocomplete.jsx
import { useState, useRef, useEffect } from 'react';

const DEBOUNCE_MS = 320;

export default function AddressAutocomplete({ value, onChange, onSelect, placeholder }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const debounceRef = useRef(null);
  const wrapRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function fetchSuggestions(query) {
    if (query.length < 3) { setSuggestions([]); setOpen(false); return; }
    setLoading(true);
    try {
      const url = `/api/proxy?target=${encodeURIComponent(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=6&addressdetails=1&countrycodes=us`
      )}`;
      const r = await fetch(url);
      const data = await r.json();
      setSuggestions(data || []);
      setOpen((data || []).length > 0);
      setActiveIdx(-1);
    } catch (e) {
      setSuggestions([]);
      setOpen(false);
    }
    setLoading(false);
  }

  function handleInput(e) {
    const val = e.target.value;
    onChange(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val), DEBOUNCE_MS);
  }

  function handleSelect(item) {
    const display = item.display_name;
    onChange(display);
    setSuggestions([]);
    setOpen(false);
    onSelect({
      lat: parseFloat(item.lat),
      lon: parseFloat(item.lon),
      displayName: display,
    });
  }

  function handleKeyDown(e) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      handleSelect(suggestions[activeIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  // Format suggestion label — show main name + region
  function formatLabel(item) {
    const parts = item.display_name.split(', ');
    const main = parts.slice(0, 2).join(', ');
    const region = parts.slice(2, 4).join(', ');
    return { main, region };
  }

  return (
    <div className="autocomplete-wrap" ref={wrapRef}>
      <div className="autocomplete-input-row">
        <input
          className="input"
          placeholder={placeholder || 'e.g. 1234 Main St, Houston TX'}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          autoComplete="off"
        />
        {loading && <span className="autocomplete-spinner spinner spinner-sm" />}
      </div>

      {open && suggestions.length > 0 && (
        <ul className="autocomplete-list">
          {suggestions.map((item, i) => {
            const { main, region } = formatLabel(item);
            return (
              <li
                key={item.place_id}
                className={`autocomplete-item ${i === activeIdx ? 'active' : ''}`}
                onMouseDown={() => handleSelect(item)}
                onMouseEnter={() => setActiveIdx(i)}
              >
                <span className="autocomplete-icon">📍</span>
                <div className="autocomplete-text">
                  <span className="autocomplete-main">{main}</span>
                  {region && <span className="autocomplete-region">{region}</span>}
                </div>
              </li>
            );
          })}
          <li className="autocomplete-footer">
            Powered by OpenStreetMap · US addresses only
          </li>
        </ul>
      )}
    </div>
  );
}
