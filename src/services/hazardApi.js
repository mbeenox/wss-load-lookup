// src/services/hazardApi.js
// All external API calls, routed through /api/proxy to avoid CORS.

const PROXY = (url) => `/api/proxy?target=${encodeURIComponent(url)}`;

// ─── GEOCODING ────────────────────────────────────────────────────────────────
export async function geocodeAddress(address) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
  const r = await fetch(PROXY(url));
  const data = await r.json();
  if (!data.length) throw new Error('Address not found');
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), displayName: data[0].display_name };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function arcgisGetSamples(service, lat, lon) {
  const geom = JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } });
  const url = `https://gis.asce.org/arcgis/rest/services/${service}/getSamples`
    + `?geometry=${encodeURIComponent(geom)}&geometryType=esriGeometryPoint&returnFirstValueOnly=true&f=json`;
  return fetch(PROXY(url)).then(r => r.json());
}

function arcgisIdentify(service, lat, lon, layers = 'all') {
  const ext = `${lon - 0.5},${lat - 0.5},${lon + 0.5},${lat + 0.5}`;
  const url = `https://gis.asce.org/arcgis/rest/services/${service}/identify`
    + `?geometry=${lon},${lat}&geometryType=esriGeometryPoint&sr=4326`
    + `&layers=${layers}&tolerance=3&mapExtent=${ext}&imageDisplay=800,600,96`
    + `&returnGeometry=false&f=json`;
  return fetch(PROXY(url)).then(r => r.json());
}

// ─── SEISMIC ──────────────────────────────────────────────────────────────────
const SEISMIC_SLUG = { '7-22': 'asce7-22', '7-16': 'asce7-16', '7-10': 'asce7-10' };

export async function fetchSeismic(lat, lon, standard, riskCategory, siteClass) {
  const slug = SEISMIC_SLUG[standard];
  const url = `https://earthquake.usgs.gov/ws/designmaps/${slug}.json`
    + `?latitude=${lat}&longitude=${lon}&riskCategory=${riskCategory}&siteClass=${siteClass}&title=WSS`;
  const r = await fetch(PROXY(url));
  const data = await r.json();

  // ASCE 7-22 response shape
  if (data.response?.data) {
    const d = data.response.data;
    return {
      ss: d.ss, s1: d.s1, fa: d.fa, fv: d.fv,
      sms: d.sms, sm1: d.sm1, sds: d.sds, sd1: d.sd1,
      sdc: d.sdc, tl: d.tl, pga: d.pga, pgam: d.pgam,
      t0: d.t0, ts: d.ts,
    };
  }
  // ASCE 7-16 / 7-10 response may be array-wrapped
  const resp = Array.isArray(data.response) ? data.response[0] : data.response;
  const d = resp?.data || {};
  return {
    ss: d.ss, s1: d.s1, fa: d.fa, fv: d.fv,
    sms: d.sms, sm1: d.sm1, sds: d.sds, sd1: d.sd1,
    sdc: d.sdc, tl: d.tl || d['t-sub-l'], pga: d.pga, pgam: d.pgam,
    t0: d.t0, ts: d.ts,
  };
}

// ─── WIND ─────────────────────────────────────────────────────────────────────
// All use ImageServer getSamples — confirmed working in validation
// ASCE 7-22: MRI ImageServers per RC (300/700/1700/3000 yr)
const WIND_722 = { I: 'ASCE722/w2022_mri300/ImageServer', II: 'ASCE722/w2022_mri700/ImageServer', III: 'ASCE722/w2022_mri1700/ImageServer', IV: 'ASCE722/w2022_mri3000/ImageServer' };
// ASCE 7-16: MRI ImageServers per RC
const WIND_716 = { I: 'ASCE/wind2016_300/ImageServer', II: 'ASCE/wind2016_700/ImageServer', III: 'ASCE/wind2016_1700/ImageServer', IV: 'ASCE/wind2016_3000/ImageServer' };
// ASCE 7-10: exposure category ImageServers (A=hurricane, B=RC III, C=RC II/IV open)
const WIND_710 = { I: 'ASCE/wind2010_A/ImageServer', II: 'ASCE/wind2010_C/ImageServer', III: 'ASCE/wind2010_B/ImageServer', IV: 'ASCE/wind2010_C/ImageServer' };

export async function fetchWind(lat, lon, standard, riskCategory) {
  let windSpeed = null;

  const svcMap = standard === '7-22' ? WIND_722 : standard === '7-16' ? WIND_716 : WIND_710;
  const svc = svcMap[riskCategory];
  try {
    const data = await arcgisGetSamples(svc, lat, lon);
    const samples = data.samples || [];
    windSpeed = samples.length ? parseFloat(samples[0].value) : null;
  } catch (e) {
    windSpeed = null;
  }

  // Hurricane prone region
  let isHurricane = false;
  try {
    const hData = await arcgisIdentify('ASCE/ASCE_Hurricane_WindBorneDebris/MapServer', lat, lon);
    isHurricane = (hData.results || []).length > 0;
  } catch (e) { /* non-fatal */ }

  // Special wind region
  let isSpecialWind = false;
  try {
    const sData = await arcgisIdentify('ASCE722/w2022_Special_Wind_Regions/MapServer', lat, lon);
    isSpecialWind = (sData.results || []).length > 0;
  } catch (e) { /* non-fatal */ }

  return { windSpeed, isHurricane, isSpecialWind };
}

// ─── SNOW ─────────────────────────────────────────────────────────────────────
// Helper: extract snow load from 7-10/7-16 attribute objects.
// Returns { load, elevTable } where elevTable is non-null for elevation-dependent regions.
function extractSnowLoad(attrs) {
  // Build elevation-dependent table if present (Load1/Elevation1 ... Load4/Elevation4)
  const elevTable = [];
  for (let i = 1; i <= 4; i++) {
    const elev = attrs[`Elevation${i}`];
    const load = attrs[`Load${i}`];
    if (elev != null && elev !== 'Null' && elev !== '0' && elev !== 0 &&
        load != null && load !== 'Null') {
      elevTable.push({ elevation: parseFloat(elev), load: parseFloat(load) });
    }
  }

  // Display field = ground-level design value
  const display = attrs['Display'];
  const baseLoad = (display != null && display !== 'Null' && display !== '' && !isNaN(parseFloat(display)))
    ? parseFloat(display)
    : (elevTable.length ? elevTable[0].load : null);

  return {
    load: baseLoad,
    elevTable: elevTable.length > 0 ? elevTable : null,
  };
}

// Use ImageServer getSamples for pixel values — more reliable than MapServer identify
const SNOW_722 = { I: 'ASCE722/s2022_RiskCategory1/ImageServer', II: 'ASCE722/s2022_RiskCategory2/ImageServer', III: 'ASCE722/s2022_RiskCategory3/ImageServer', IV: 'ASCE722/s2022_RiskCategory4/ImageServer' };

export async function fetchSnow(lat, lon, standard, riskCategory) {
  let groundSnowLoad = null;
  let winterWind = null;
  let specialCase = false;
  let elevationTable = null;

  if (standard === '7-22') {
    // Primary: ImageServer getSamples for snow load
    try {
      const data = await arcgisGetSamples(SNOW_722[riskCategory], lat, lon);
      const samples = data.samples || [];
      if (samples.length && samples[0].value !== 'NoData') {
        groundSnowLoad = parseFloat(samples[0].value);
      }
    } catch (e) { /* try fallback */ }

    // Winter wind via MapServer identify (layer 0)
    try {
      const wData = await arcgisIdentify(`ASCE722/s2022_Tile_RC_${riskCategory}/MapServer`, lat, lon, 'all:0');
      const results = wData.results || [];
      if (results.length) {
        const attrs = results[0].attributes || {};
        winterWind = attrs.value ?? attrs.SI_Label ?? null;
      }
    } catch (e) { /* non-fatal */ }

    // Special case check (layer 1)
    try {
      const spData = await arcgisIdentify(`ASCE722/s2022_Tile_RC_${riskCategory}/MapServer`, lat, lon, 'all:1');
      specialCase = (spData.results || []).length > 0;
    } catch (e) { /* non-fatal */ }

  } else if (standard === '7-16') {
    // Layer 1 = Snow Load (lb/ft^2), key field = Display
    try {
      const data = await arcgisIdentify('ASCE/Snow_2016_Tile/MapServer', lat, lon, 'all:1');
      const results = data.results || [];
      if (results.length) {
        const extracted = extractSnowLoad(results[0].attributes || {});
        groundSnowLoad = extracted.load;
        if (extracted.elevTable) elevationTable = extracted.elevTable;
      }
    } catch (e) { /* non-fatal */ }
    try {
      const spData = await arcgisIdentify('ASCE/Snow_2016_Tile/MapServer', lat, lon, 'all:2');
      specialCase = (spData.results || []).length > 0;
    } catch (e) { /* non-fatal */ }

  } else {
    // 7-10 — Layer 2 = Snow Load (lb/ft^2), key field = Display
    try {
      const data = await arcgisIdentify('ASCE/SnowLoad/MapServer', lat, lon, 'all:2');
      const results = data.results || [];
      if (results.length) {
        const extracted = extractSnowLoad(results[0].attributes || {});
        groundSnowLoad = extracted.load;
        if (extracted.elevTable) elevationTable = extracted.elevTable;
      }
    } catch (e) { /* non-fatal */ }
    try {
      const spData = await arcgisIdentify('ASCE/SnowLoad/MapServer', lat, lon, 'all:1');
      specialCase = (spData.results || []).length > 0;
    } catch (e) { /* non-fatal */ }
  }

  return { groundSnowLoad, winterWind, specialCase, elevationTable };
}

// ─── ICE ──────────────────────────────────────────────────────────────────────
const ICE_MRI = { I: '0250', II: '0500', III: '1000', IV: '1400' };

export async function fetchIce(lat, lon, standard, riskCategory) {
  if (standard === '7-10') {
    const data = await arcgisIdentify('ASCE/IceLoad/MapServer', lat, lon);
    const results = data.results || [];
    const attrs = results[0]?.attributes || {};
    return {
      iceThickness: parseFloat(attrs['Classify.Pixel Value'] ?? attrs.value ?? 0) || null,
      concurrentTemp: null,
      concurrentGust: null,
    };
  }

  const mri = ICE_MRI[riskCategory];
  const [thickData, gustData, tempData] = await Promise.all([
    arcgisGetSamples(`ASCE722/i2022_mri${mri}/ImageServer`, lat, lon),
    arcgisGetSamples('ASCE722/i2022_gust/ImageServer', lat, lon),
    arcgisIdentify('ASCE722/i2022_ConcurrentTemp/MapServer', lat, lon),
  ]);

  const iceThickness = parseFloat(thickData.samples?.[0]?.value ?? 0) || null;
  const concurrentGust = parseFloat(gustData.samples?.[0]?.value ?? 0) || null;
  const tempAttrs = tempData.results?.[0]?.attributes || {};
  const concurrentTemp = tempAttrs.conc_temp ?? null;

  return { iceThickness, concurrentTemp, concurrentGust };
}

// ─── RAIN ─────────────────────────────────────────────────────────────────────
export async function fetchRain(lat, lon) {
  const url = `https://hdsc.nws.noaa.gov/cgi-bin/hdsc/new/cgi_readH5.py`
    + `?lat=${lat}&lon=${lon}&type=pf&data=intensity&units=english&series=pds`;
  const r = await fetch(PROXY(url));
  const text = await r.text();

  const match = text.match(/quantiles\s*=\s*(\[[\s\S]+?\]);/);
  if (!match) return { raw: text, parsed: null };

  const raw = JSON.parse(match[1]);
  const durations = ['5-min','10-min','15-min','30-min','60-min','2-hr','3-hr','6-hr','12-hr','24-hr','2-day','3-day','4-day','7-day','10-day','20-day','30-day','45-day','60-day'];
  const periods = ['2yr','5yr','10yr','25yr','50yr','100yr','200yr','500yr','1000yr'];
  const table = raw.map((row, i) => ({
    duration: durations[i] || `row${i}`,
    values: Object.fromEntries(row.map((v, j) => [periods[j] || `p${j}`, parseFloat(v)])),
  }));
  return { table };
}

// ─── FLOOD ────────────────────────────────────────────────────────────────────
export async function fetchFlood(lat, lon) {
  const url = `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query`
    + `?geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326`
    + `&spatialRel=esriSpatialRelIntersects&outFields=FLD_ZONE,STATIC_BFE,V_DATUM,ZONE_SUBTY,SFHA_TF`
    + `&returnGeometry=false&f=json`;
  const r = await fetch(PROXY(url));
  const data = await r.json();
  const features = data.features || [];
  if (!features.length) return { floodZone: 'Not Available', bfe: null, datum: null, sfha: false, subtype: null };
  const a = features[0].attributes;
  return {
    floodZone: a.FLD_ZONE,
    bfe: a.STATIC_BFE === -9999 ? null : a.STATIC_BFE,
    datum: a.V_DATUM || null,
    sfha: a.SFHA_TF === 'T',
    subtype: a.ZONE_SUBTY,
  };
}

// ─── TORNADO ──────────────────────────────────────────────────────────────────
const TORNADO_RP = ['RP1700', 'RP3K', 'RP10K', 'RP100K', 'RP1M', 'RP10M'];

export async function fetchTornado(lat, lon, riskCategory) {
  if (riskCategory === 'I' || riskCategory === 'II') {
    return { applicable: false, message: 'Tornado hazard data only applies to Risk Category III or IV.' };
  }

  const results = {};
  await Promise.all(
    TORNADO_RP.map(async (rp) => {
      try {
        const data = await arcgisGetSamples(`ASCE722/t2022_PT_${rp}/ImageServer`, lat, lon);
        const val = data.samples?.[0]?.value;
        results[rp] = (val != null && val !== 'NoData') ? parseFloat(val) : null;
      } catch {
        results[rp] = null;
      }
    })
  );

  let inPronArea = false;
  try {
    const proneData = await arcgisIdentify('ASCE722/t2022_tornado_prone_area/MapServer', lat, lon);
    inPronArea = (proneData.results || []).length > 0;
  } catch (e) { /* non-fatal */ }

  return { applicable: true, speeds: results, inPronArea };
}

// ─── TSUNAMI ──────────────────────────────────────────────────────────────────
export async function fetchTsunami(lat, lon, standard) {
  if (standard === '7-10') return { applicable: false, message: 'Tsunami data not available for ASCE 7-10.' };

  const data = await arcgisIdentify('TDZ_Call_20211112/MapServer', lat, lon);
  const results = data.results || [];
  const inZone = results.length > 0;
  const attrs = results[0]?.attributes || {};

  return {
    applicable: true,
    inTDZ: inZone,
    runupMHW: inZone ? parseFloat(attrs.runup_mhw) : null,
    runupNAVD: inZone ? (attrs.runup_navd !== 'Null' ? parseFloat(attrs.runup_navd) : null) : null,
  };
}
