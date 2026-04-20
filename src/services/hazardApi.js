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
// Standard slug map
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
  // ASCE 7-16 / 7-10 — response may be array wrapped
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
// MRI-based ImageServers for each RC (ASCE 7-22)
const WIND_MRI_722 = { I: '300', II: '700', III: '1700', IV: '3000' };
// ASCE 7-16 MapServers (tile services, layer 2)
const WIND_SVC_716 = { I: 'ASCE/Wind_2016_300_Tile', II: 'ASCE/Wind_2016_700_Tile', III: 'ASCE/Wind_2016_1700_Tile', IV: 'ASCE/Wind_2016_3000_Tile' };
// ASCE 7-10 MapServers (tile services, layer 2)
const WIND_SVC_710 = { I: 'ASCE/Wind_1A_Tiled', II: 'ASCE/Wind_1C_Tiled', III: 'ASCE/Wind_1B_Tiled', IV: 'ASCE/Wind_1C_Tiled' };

export async function fetchWind(lat, lon, standard, riskCategory) {
  let windSpeed = null;

  if (standard === '7-22') {
    const mri = WIND_MRI_722[riskCategory];
    const data = await arcgisGetSamples(`ASCE722/w2022_mri${mri}/ImageServer`, lat, lon);
    const samples = data.samples || [];
    windSpeed = samples.length ? parseFloat(samples[0].value) : null;
  } else if (standard === '7-16') {
    const svc = WIND_SVC_716[riskCategory];
    const data = await arcgisIdentify(`${svc}/MapServer`, lat, lon, 'all:2');
    const results = data.results || [];
    windSpeed = results.length ? parseFloat(results[0].attributes?.['Classify.Pixel Value']) : null;
  } else {
    // 7-10
    const svc = WIND_SVC_710[riskCategory];
    const data = await arcgisIdentify(`${svc}/MapServer`, lat, lon, 'all:2');
    const results = data.results || [];
    windSpeed = results.length ? parseFloat(results[0].attributes?.['Classify.Pixel Value']) : null;
  }

  // Hurricane prone region
  const hurricaneData = await arcgisIdentify('ASCE/ASCE_Hurricane_WindBorneDebris/MapServer', lat, lon);
  const isHurricane = (hurricaneData.results || []).length > 0;

  // Special wind region
  const specialData = await arcgisIdentify('ASCE722/w2022_Special_Wind_Regions/MapServer', lat, lon);
  const isSpecialWind = (specialData.results || []).length > 0;

  return { windSpeed, isHurricane, isSpecialWind };
}

// ─── SNOW ─────────────────────────────────────────────────────────────────────
const SNOW_RC = { I: 'I', II: 'II', III: 'III', IV: 'IV' };
const SNOW_SVC_722 = (rc) => `ASCE722/s2022_Tile_RC_${SNOW_RC[rc]}/MapServer`;
const SNOW_SVC_716 = () => 'ASCE/Snow_2016_Tile/MapServer';
const SNOW_SVC_710 = () => 'ASCE/SnowLoad/MapServer';

export async function fetchSnow(lat, lon, standard, riskCategory) {
  let svc;
  if (standard === '7-22') svc = SNOW_SVC_722(riskCategory);
  else if (standard === '7-16') svc = SNOW_SVC_716();
  else svc = SNOW_SVC_710();

  const data = await arcgisIdentify(svc, lat, lon);
  const results = data.results || [];

  let groundSnowLoad = null;
  let winterWind = null;
  let specialCase = null;

  for (const r of results) {
    const attrs = r.attributes || {};
    if (r.layerName?.includes('Snow Load') || r.layerName?.includes('snow')) {
      const pv = attrs['Classify.Pixel Value'] ?? attrs['Pixel Value'] ?? attrs['value'];
      if (pv != null) groundSnowLoad = parseFloat(pv);
    }
    if (r.layerName?.includes('Winter Wind')) {
      winterWind = attrs.value ?? attrs.SI_Label ?? null;
    }
    if (r.layerName?.includes('Special')) {
      specialCase = true;
    }
  }

  return { groundSnowLoad, winterWind, specialCase };
}

// ─── ICE ──────────────────────────────────────────────────────────────────────
// MRI services per Risk Category
const ICE_MRI = { I: '0250', II: '0500', III: '1000', IV: '1400' };

export async function fetchIce(lat, lon, standard, riskCategory) {
  if (standard === '7-10') {
    // 7-10 uses single 500-yr value
    const data = await arcgisIdentify('ASCE/IceLoad/MapServer', lat, lon);
    const results = data.results || [];
    const attrs = results[0]?.attributes || {};
    return {
      iceThickness: parseFloat(attrs['Classify.Pixel Value'] ?? attrs.value ?? 0),
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

  const iceThickness = parseFloat(thickData.samples?.[0]?.value ?? 0);
  const concurrentGust = parseFloat(gustData.samples?.[0]?.value ?? 0);
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

  // Response format: quantiles = [['val',...], ...];
  const match = text.match(/quantiles\s*=\s*(\[[\s\S]+?\]);/);
  if (!match) return { raw: text, parsed: null };

  const raw = JSON.parse(match[1]);
  // 19 duration rows × 9 return period columns
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
// Ae sizes and RP values per ASCE 7-22 Chapter 32
const TORNADO_AE  = ['PT', '2KSF', '10KSF', '40KSF', '100KSF', '250KSF', '1MSF', '4MSF'];
const TORNADO_RP  = ['RP1700', 'RP3K', 'RP10K', 'RP100K', 'RP1M', 'RP10M'];

export async function fetchTornado(lat, lon, riskCategory) {
  if (riskCategory === 'I' || riskCategory === 'II') {
    return { applicable: false, message: 'Tornado hazard data only applies to Risk Category III or IV.' };
  }

  // Fetch a representative set: 1 sq ft point source (PT) across all return periods
  const results = {};
  await Promise.all(
    TORNADO_RP.map(async (rp) => {
      const svc = `ASCE722/t2022_PT_${rp}/ImageServer`;
      try {
        const data = await arcgisGetSamples(svc, lat, lon);
        const val = data.samples?.[0]?.value;
        results[rp] = val != null ? parseFloat(val) : null;
      } catch {
        results[rp] = null;
      }
    })
  );

  // Also check tornado prone area
  const proneData = await arcgisIdentify('ASCE722/t2022_tornado_prone_area/MapServer', lat, lon);
  const inPronArea = (proneData.results || []).length > 0;

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
