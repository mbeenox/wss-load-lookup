import { useState } from 'react';
import {
  geocodeAddress, fetchSeismic, fetchWind, fetchSnow,
  fetchIce, fetchRain, fetchFlood, fetchTornado, fetchTsunami,
} from './services/hazardApi';
import { generatePDF } from './services/pdfReport';
import './App.css';

const STANDARDS = ['7-22', '7-16', '7-10'];
const RISK_CATEGORIES = ['I', 'II', 'III', 'IV'];
const SITE_CLASSES_722 = ['A', 'B', 'BC', 'C', 'CD', 'D', 'DE', 'E'];
const SITE_CLASSES_716 = ['A', 'B', 'C', 'D', 'E', 'F'];
const SITE_CLASSES_710 = ['A', 'B', 'C', 'D', 'E', 'F'];

const HAZARDS = ['wind', 'seismic', 'snow', 'ice', 'rain', 'flood', 'tsunami', 'tornado'];
const HAZARD_LABELS = {
  wind: 'Wind', seismic: 'Seismic', snow: 'Snow', ice: 'Ice',
  rain: 'Rain', flood: 'Flood', tsunami: 'Tsunami', tornado: 'Tornado',
};
const HAZARD_ICONS = {
  wind: '🌬', seismic: '🌍', snow: '❄', ice: '🧊',
  rain: '🌧', flood: '🌊', tsunami: '🌊', tornado: '🌪',
};

function StatusBadge({ status }) {
  const map = { loading: ['loading', '…'], success: ['success', '✓'], error: ['error', '✗'], idle: ['idle', '—'] };
  const [cls, sym] = map[status] || map.idle;
  return <span className={`badge badge-${cls}`}>{sym}</span>;
}

function ResultCard({ title, icon, status, children }) {
  return (
    <div className={`result-card ${status}`}>
      <div className="card-header">
        <span className="card-icon">{icon}</span>
        <span className="card-title">{title}</span>
        <StatusBadge status={status} />
      </div>
      <div className="card-body">{children}</div>
    </div>
  );
}

function Row({ label, value, highlight }) {
  return (
    <div className={`data-row ${highlight ? 'highlight' : ''}`}>
      <span className="data-label">{label}</span>
      <span className="data-value">{value ?? 'N/A'}</span>
    </div>
  );
}

function RainCard({ rain }) {
  const [showTable, setShowTable] = useState(false);
  const table = rain.table || [];

  const get = (duration, period) => {
    const row = table.find(r => r.duration === duration);
    return row ? fmt(row.values[period], 3) : 'N/A';
  };

  const periods = ['1yr','2yr','5yr','10yr','25yr','50yr','100yr','200yr','500yr','1000yr'];
  const headers = ['1-yr','2-yr','5-yr','10-yr','25-yr','50-yr','100-yr','200-yr','500-yr','1000-yr'];

  return (
    <div className="rain-card-inner">
      {/* ASCE 7 Design Values */}
      <div className="rain-design-values">
        <div className="rain-design-label">ASCE 7 Design Values (100-yr MRI)</div>
        <div className="rain-design-row">
          <div className="rain-design-item">
            <span className="rain-design-item-label">15-min Intensity</span>
            <span className="rain-design-item-value">{get('15-min', '100yr')} in/hr</span>
            <span className="rain-design-item-sub">100-yr, 15-min</span>
          </div>
          <div className="rain-design-divider" />
          <div className="rain-design-item">
            <span className="rain-design-item-label">60-min Intensity</span>
            <span className="rain-design-item-value">{get('60-min', '100yr')} in/hr</span>
            <span className="rain-design-item-sub">100-yr, 60-min · ASCE 7 §8.3</span>
          </div>
        </div>
      </div>

      {/* Toggle button */}
      <button className="rain-toggle-btn" onClick={() => setShowTable(s => !s)}>
        {showTable ? '▲ Hide Full Atlas 14 Table' : '▼ Show Full Atlas 14 Table (19 durations × 10 return periods)'}
      </button>

      {/* Full table - collapsible */}
      {showTable && (
        <div className="rain-table-wrap">
          <table className="rain-table">
            <thead>
              <tr>
                <th>Duration</th>
                {headers.map((h, i) => (
                  <th key={h} className={i === 6 ? 'rain-col-100yr' : ''}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.map(row => {
                const isHighlight = ['15-min', '60-min'].includes(row.duration);
                return (
                  <tr key={row.duration} className={isHighlight ? 'rain-highlight' : ''}>
                    <td>{row.duration}</td>
                    {periods.map((p, i) => (
                      <td key={p} className={
                        i === 6 && isHighlight ? 'rain-cell-star' :
                        i === 6 ? 'rain-col-100yr' : ''
                      }>
                        {fmt(row.values[p], 3)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="rain-table-note">
            Highlighted rows = ASCE 7 design durations. Highlighted cells = 100-yr MRI design values per ASCE 7 §8.3.
            Source: NOAA Atlas 14, Precipitation Frequency Data Server.
          </div>
        </div>
      )}
    </div>
  );
}

function fmt(v, d = 3) {
  if (v == null || isNaN(v)) return 'N/A';
  return typeof v === 'number' ? v.toFixed(d) : String(v);
}

export default function App() {
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [useLatLon, setUseLatLon] = useState(false);
  const [standard, setStandard] = useState('7-22');
  const [riskCategory, setRiskCategory] = useState('II');
  const [siteClass, setSiteClass] = useState('D');
  const [resolvedAddress, setResolvedAddress] = useState('');
  const [siteElevFt, setSiteElevFt] = useState(null);

  const [statuses, setStatuses] = useState({});
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);
  const [globalError, setGlobalError] = useState('');

  const siteClasses = standard === '7-22' ? SITE_CLASSES_722
    : standard === '7-16' ? SITE_CLASSES_716
    : SITE_CLASSES_710;

  function setStatus(hazard, status) {
    setStatuses(prev => ({ ...prev, [hazard]: status }));
  }
  function setResult(hazard, data) {
    setResults(prev => ({ ...prev, [hazard]: data }));
  }

  async function handleRun() {
    setGlobalError('');
    setResults({});
    setStatuses({});
    setSiteElevFt(null);
    setRunning(true);

    let finalLat, finalLon, displayAddr;

    try {
      if (useLatLon) {
        finalLat = parseFloat(lat);
        finalLon = parseFloat(lon);
        if (isNaN(finalLat) || isNaN(finalLon)) throw new Error('Invalid lat/lon values');
        displayAddr = `${finalLat.toFixed(5)}, ${finalLon.toFixed(5)}`;
      } else {
        if (!address.trim()) throw new Error('Please enter an address');
        const geo = await geocodeAddress(address);
        finalLat = geo.lat;
        finalLon = geo.lon;
        displayAddr = geo.displayName;
      }
      setResolvedAddress(displayAddr);
    } catch (e) {
      setGlobalError(e.message);
      setRunning(false);
      return;
    }

    const inputs = { lat: finalLat, lon: finalLon, standard, riskCategory, siteClass, address: displayAddr };

    // Run all hazards in parallel
    const run = async (hazard, fn) => {
      setStatus(hazard, 'loading');
      try {
        const data = await fn();
        setResult(hazard, data);
        setStatus(hazard, 'success');
      } catch (e) {
        setResult(hazard, { error: e.message });
        setStatus(hazard, 'error');
      }
    };

    await Promise.all([
      run('wind',    () => fetchWind(finalLat, finalLon, standard, riskCategory)),
      run('seismic', () => fetchSeismic(finalLat, finalLon, standard, riskCategory, siteClass)),
      run('snow',    async () => {
        const data = await fetchSnow(finalLat, finalLon, standard, riskCategory);
        if (data.siteElevFt != null) setSiteElevFt(data.siteElevFt);
        return data;
      }),
      run('ice',     () => fetchIce(finalLat, finalLon, standard, riskCategory)),
      run('rain',    () => fetchRain(finalLat, finalLon)),
      run('flood',   () => fetchFlood(finalLat, finalLon)),
      run('tsunami', () => fetchTsunami(finalLat, finalLon, standard)),
      run('tornado', () => fetchTornado(finalLat, finalLon, riskCategory)),
    ]);

    setRunning(false);
  }

  function handleDownloadPDF() {
    const inputs = {
      address: resolvedAddress,
      lat: useLatLon ? parseFloat(lat) : null,
      lon: useLatLon ? parseFloat(lon) : null,
      standard, riskCategory, siteClass,
    };
    generatePDF(inputs, results);
  }

  const hasResults = Object.keys(results).length > 0;
  const allDone = hasResults && !running;

  const w = results.wind || {};
  const s = results.seismic || {};
  const sn = results.snow || {};
  const ic = results.ice || {};
  const fl = results.flood || {};
  const ts = results.tsunami || {};
  const tor = results.tornado || {};
  const rain = results.rain || {};

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="header-inner">
          <div className="logo-block">
            <span className="logo-abbr">WSS</span>
            <div className="logo-text">
              <span className="logo-title">Load Lookup</span>
              <span className="logo-sub">Wind · Seismic · Snow · Ice · Rain · Flood · Tsunami · Tornado</span>
            </div>
          </div>
          {allDone && (
            <button className="btn btn-pdf" onClick={handleDownloadPDF}>
              ↓ Download PDF Report
            </button>
          )}
        </div>
      </header>

      <main className="app-main">
        {/* ── Input Panel ── */}
        <section className="input-panel">
          <div className="input-panel-inner">
            <h2 className="panel-title">Site Information</h2>

            {/* Location toggle */}
            <div className="toggle-row">
              <button
                className={`toggle-btn ${!useLatLon ? 'active' : ''}`}
                onClick={() => setUseLatLon(false)}
              >Address</button>
              <button
                className={`toggle-btn ${useLatLon ? 'active' : ''}`}
                onClick={() => setUseLatLon(true)}
              >Lat / Lon</button>
            </div>

            {!useLatLon ? (
              <div className="field">
                <label>Street Address</label>
                <input
                  className="input"
                  placeholder="e.g. 1234 Main St, Houston TX"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleRun()}
                />
              </div>
            ) : (
              <div className="field-row">
                <div className="field">
                  <label>Latitude</label>
                  <input className="input" placeholder="e.g. 32.7767" value={lat} onChange={e => setLat(e.target.value)} />
                </div>
                <div className="field">
                  <label>Longitude</label>
                  <input className="input" placeholder="e.g. -96.7970" value={lon} onChange={e => setLon(e.target.value)} />
                </div>
              </div>
            )}

            <div className="field-row three-col">
              <div className="field">
                <label>ASCE Standard</label>
                <select className="input" value={standard} onChange={e => { setStandard(e.target.value); setSiteClass('D'); }}>
                  {STANDARDS.map(s => <option key={s} value={s}>ASCE 7-{s}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Risk Category</label>
                <select className="input" value={riskCategory} onChange={e => setRiskCategory(e.target.value)}>
                  {RISK_CATEGORIES.map(rc => <option key={rc} value={rc}>RC {rc}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Site Soil Class</label>
                <select className="input" value={siteClass} onChange={e => setSiteClass(e.target.value)}>
                  {siteClasses.map(sc => <option key={sc} value={sc}>{sc}</option>)}
                </select>
              </div>
            </div>

            {globalError && <div className="error-msg">{globalError}</div>}

            <button className="btn btn-run" onClick={handleRun} disabled={running}>
              {running ? (
                <><span className="spinner" /> Running…</>
              ) : 'Run Hazard Lookup'}
            </button>
          </div>
        </section>

        {/* ── Results ── */}
        {hasResults && (
          <section className="results-section">
            {resolvedAddress && (
              <div className="resolved-address">
                <span className="addr-label">📍</span>
                <span>{resolvedAddress}</span>
                <div className="addr-tags">
                  <span className="addr-tag">ASCE 7-{standard} · RC {riskCategory} · Site Class {siteClass}</span>
                  {siteElevFt != null && (
                    <span className="addr-tag addr-tag-elev">⛰ {Math.round(siteElevFt).toLocaleString()} ft NAVD88</span>
                  )}
                </div>
              </div>
            )}

            <div className="results-grid">

              {/* WIND */}
              <ResultCard title="Wind" icon="🌬" status={statuses.wind || 'idle'}>
                {w.error ? <div className="err">{w.error}</div> : <>
                  <Row label="Ultimate Wind Speed (V)" value={w.windSpeed ? `${fmt(w.windSpeed, 0)} mph` : 'N/A'} highlight />
                  <Row label="Hurricane-Prone Region" value={w.isHurricane ? '⚠ YES' : 'No'} />
                  <Row label="Special Wind Region" value={w.isSpecialWind ? '⚠ YES — Verify with AHJ' : 'No'} />
                </>}
              </ResultCard>

              {/* SEISMIC */}
              <ResultCard title="Seismic" icon="🌍" status={statuses.seismic || 'idle'}>
                {s.error ? <div className="err">{s.error}</div> : <>
                  <Row label="Ss (0.2 sec)" value={fmt(s.ss)} highlight />
                  <Row label="S1 (1.0 sec)" value={fmt(s.s1)} highlight />
                  <Row label="SDS" value={fmt(s.sds)} />
                  <Row label="SD1" value={fmt(s.sd1)} />
                  <Row label="Seismic Design Category" value={s.sdc ?? 'N/A'} />
                  <Row label="Fa / Fv"
                    value={s.fa != null && s.fv != null
                      ? `${fmt(s.fa)} / ${fmt(s.fv)}`
                      : standard === '7-22' ? 'N/A (multi-period)' : 'N/A'} />
                  <Row label="TL (sec)" value={fmt(s.tl, 1)} />
                </>}
              </ResultCard>

              {/* SNOW */}
              <ResultCard title="Snow" icon="❄" status={statuses.snow || 'idle'}>
                {sn.error ? <div className="err">{sn.error}</div> : <>
                  <Row
                    label="Ground Snow Load (pg)"
                    value={sn.groundSnowLoad != null
                      ? `${Math.round(sn.groundSnowLoad)} psf${sn.elevationTable ? ' *' : ''}`
                      : 'N/A'}
                    highlight
                  />
                  {sn.siteElevFt != null && (
                    <Row label="Site Elevation (DEM)" value={`${Math.round(sn.siteElevFt).toLocaleString()} ft`} />
                  )}
                  {sn.elevationTable && (
                    <div className="elev-table-wrap">
                      <div className="elev-table-label">* Elevation-dependent — pg by elevation:</div>
                      <table className="elev-table">
                        <thead><tr><th>Up to Elev (ft)</th><th>pg (psf)</th></tr></thead>
                        <tbody>
                          {sn.elevationTable.map((row, i) => (
                            <tr key={i} className={sn.siteElevFt != null && (
                              i === 0 ? sn.siteElevFt <= row.elevation :
                              sn.siteElevFt <= row.elevation && sn.siteElevFt > sn.elevationTable[i-1].elevation
                            ) ? 'elev-active' : ''}>
                              <td>{row.elevation.toLocaleString()}</td>
                              <td>{fmt(row.load, 1)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <Row label="Winter Wind Parameter" value={sn.winterWind ?? 'N/A'} />
                  <Row label="Special Case" value={sn.specialCase ? '⚠ Site study required' : 'No'} />
                </>}
              </ResultCard>

              {/* ICE */}
              <ResultCard title="Ice" icon="🧊" status={statuses.ice || 'idle'}>
                {ic.error ? <div className="err">{ic.error}</div> : <>
                  <Row label="Radial Ice Thickness" value={ic.iceThickness != null ? `${fmt(ic.iceThickness, 3)} in` : 'N/A'} highlight />
                  <Row label="Concurrent Temperature" value={ic.concurrentTemp != null ? `${ic.concurrentTemp} °F` : 'N/A'} />
                  <Row label="Concurrent 3-s Gust" value={ic.concurrentGust != null ? `${fmt(ic.concurrentGust, 1)} mph` : 'N/A'} />
                </>}
              </ResultCard>

              {/* FLOOD */}
              <ResultCard title="Flood" icon="🌊" status={statuses.flood || 'idle'}>
                {fl.error ? <div className="err">{fl.error}</div> : <>
                  <Row label="FEMA Flood Zone" value={fl.floodZone ?? 'N/A'} highlight />
                  <Row label="Special Flood Hazard Area" value={fl.sfha ? '⚠ YES' : 'No'} />
                  <Row label="Base Flood Elevation" value={fl.bfe != null ? `${fl.bfe} ft (${fl.datum})` : 'N/A'} />
                  <Row label="Zone Subtype" value={fl.subtype ?? 'N/A'} />
                </>}
              </ResultCard>

              {/* TSUNAMI */}
              <ResultCard title="Tsunami" icon="🌊" status={statuses.tsunami || 'idle'}>
                {ts.error ? <div className="err">{ts.error}</div>
                  : !ts.applicable ? <div className="muted">{ts.message}</div>
                  : <>
                    <Row label="In Tsunami Design Zone" value={ts.inTDZ ? '⚠ YES' : 'No'} highlight />
                    <Row label="Runup Elevation (MHW)" value={ts.runupMHW != null ? `${fmt(ts.runupMHW, 2)} ft` : 'N/A'} />
                    <Row label="Runup Elevation (NAVD88)" value={ts.runupNAVD != null ? `${fmt(ts.runupNAVD, 2)} ft` : 'N/A'} />
                  </>}
              </ResultCard>

              {/* TORNADO */}
              <ResultCard title="Tornado" icon="🌪" status={statuses.tornado || 'idle'}>
                {tor.error ? <div className="err">{tor.error}</div>
                  : !tor.applicable ? <div className="muted">{tor.message}</div>
                  : <>
                    <Row label="In Tornado-Prone Area" value={tor.inPronArea ? '⚠ YES' : 'No'} highlight />
                    {Object.entries(tor.speeds || {}).map(([rp, v]) => (
                      <Row key={rp}
                        label={rp.replace('RP','').replace('K','K').replace('M','M') + '-yr MRI (PT)'}
                        value={v != null ? `${fmt(v, 0)} mph` : 'N/A'}
                      />
                    ))}
                  </>}
              </ResultCard>

              {/* RAIN — full width */}
              <ResultCard title="Rain (NOAA Atlas 14)" icon="🌧" status={statuses.rain || 'idle'}>
                {rain.error ? <div className="err">{rain.error}</div>
                  : rain.table ? (
                    <RainCard rain={rain} />
                  ) : <div className="muted">No data</div>}
              </ResultCard>

            </div>

            {allDone && (
              <div className="pdf-footer">
                <button className="btn btn-pdf btn-pdf-lg" onClick={handleDownloadPDF}>
                  ↓ Download Full PDF Report
                </button>
                <p className="disclaimer">
                  Data sourced from USGS, ASCE GIS Services, FEMA NFHL, and NOAA Atlas 14.
                  Verify all values against governing code documents before use in design.
                </p>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
