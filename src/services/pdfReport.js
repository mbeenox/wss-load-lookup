// src/services/pdfReport.js
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

function fmt(val, decimals = 3) {
  if (val == null || val === undefined || isNaN(val)) return 'N/A';
  return typeof val === 'number' ? val.toFixed(decimals) : String(val);
}

function sectionHeader(doc, text, y) {
  doc.setFillColor(15, 40, 80);
  doc.rect(14, y, 182, 7, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(text, 16, y + 5);
  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'normal');
  return y + 10;
}

export function generatePDF(inputs, results) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 14;

  // ── Header ──
  doc.setFillColor(15, 40, 80);
  doc.rect(0, 0, pageW, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('WSS Load Lookup', 14, 13);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Site Hazard Report  |  Wind · Seismic · Snow · Ice · Rain · Flood · Tsunami · Tornado', 14, 21);
  doc.text(`Generated: ${new Date().toLocaleString()}`, pageW - 14, 21, { align: 'right' });
  doc.setTextColor(30, 30, 30);
  y = 36;

  // ── Site Info ──
  y = sectionHeader(doc, 'SITE INFORMATION', y);
  autoTable(doc, {
    startY: y,
    head: [],
    body: [
      ['Address', inputs.address || 'N/A', 'Standard', `ASCE 7-${inputs.standard}`],
      ['Latitude', fmt(inputs.lat, 5), 'Risk Category', inputs.riskCategory],
      ['Longitude', fmt(inputs.lon, 5), 'Site Class', inputs.siteClass],
    ],
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 35 }, 2: { fontStyle: 'bold', cellWidth: 35 } },
    margin: { left: 14, right: 14 },
  });
  y = doc.lastAutoTable.finalY + 6;

  // ── Wind ──
  if (results.wind) {
    y = sectionHeader(doc, 'WIND', y);
    const w = results.wind;
    autoTable(doc, {
      startY: y,
      head: [['Parameter', 'Value', 'Notes']],
      body: [
        ['Ultimate Wind Speed (V)', w.windSpeed ? `${fmt(w.windSpeed, 0)} mph` : 'N/A', `ASCE 7-${inputs.standard} Fig. 26.5-1`],
        ['Hurricane-Prone Region', w.isHurricane ? 'YES' : 'NO', w.isHurricane ? 'Wind-borne debris requirements apply' : ''],
        ['Special Wind Region', w.isSpecialWind ? 'YES — See Authority Having Jurisdiction' : 'NO', w.isSpecialWind ? 'Site-specific study may be required' : ''],
      ],
      theme: 'striped',
      headStyles: { fillColor: [15, 40, 80], fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 2 },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  // ── Seismic ──
  if (results.seismic) {
    y = sectionHeader(doc, 'SEISMIC', y);
    const s = results.seismic;
    autoTable(doc, {
      startY: y,
      head: [['Parameter', 'Value', 'Parameter', 'Value']],
      body: [
        ['Ss (0.2 sec)', fmt(s.ss), 'S1 (1.0 sec)', fmt(s.s1)],
        ['Fa', fmt(s.fa), 'Fv', fmt(s.fv)],
        ['SMS', fmt(s.sms), 'SM1', fmt(s.sm1)],
        ['SDS', fmt(s.sds), 'SD1', fmt(s.sd1)],
        ['SDC', s.sdc ?? 'N/A', 'TL (sec)', fmt(s.tl, 1)],
        ['PGA (g)', fmt(s.pga), 'PGAm (g)', fmt(s.pgam)],
        ['T0 (sec)', fmt(s.t0), 'Ts (sec)', fmt(s.ts)],
      ],
      theme: 'striped',
      headStyles: { fillColor: [15, 40, 80], fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 2 },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  // ── Snow ──
  if (results.snow) {
    y = sectionHeader(doc, 'GROUND SNOW LOAD', y);
    const sn = results.snow;
    autoTable(doc, {
      startY: y,
      head: [['Parameter', 'Value', 'Notes']],
      body: [
        ['Ground Snow Load (pg)', sn.groundSnowLoad != null ? `${fmt(sn.groundSnowLoad, 1)} psf` : 'N/A', `ASCE 7-${inputs.standard}`],
        ['Winter Wind Parameter', sn.winterWind ?? 'N/A', ''],
        ['Special Case', sn.specialCase ? 'YES — Site study required' : 'NO', ''],
      ],
      theme: 'striped',
      headStyles: { fillColor: [15, 40, 80], fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 2 },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  // ── Ice ──
  if (results.ice) {
    const ic = results.ice;
    y = sectionHeader(doc, 'ICE', y);
    autoTable(doc, {
      startY: y,
      head: [['Parameter', 'Value']],
      body: [
        ['Radial Ice Thickness', ic.iceThickness != null ? `${fmt(ic.iceThickness, 3)} in` : 'N/A'],
        ['Concurrent Temperature', ic.concurrentTemp != null ? `${ic.concurrentTemp} °F` : 'N/A'],
        ['Concurrent 3-s Gust', ic.concurrentGust != null ? `${fmt(ic.concurrentGust, 1)} mph` : 'N/A'],
      ],
      theme: 'striped',
      headStyles: { fillColor: [15, 40, 80], fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 2 },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  // Check if new page needed
  if (y > 220) { doc.addPage(); y = 14; }

  // ── Flood ──
  if (results.flood) {
    const fl = results.flood;
    y = sectionHeader(doc, 'FLOOD', y);
    autoTable(doc, {
      startY: y,
      head: [['Parameter', 'Value']],
      body: [
        ['FEMA Flood Zone', fl.floodZone ?? 'N/A'],
        ['Special Flood Hazard Area (SFHA)', fl.sfha ? 'YES' : 'NO'],
        ['Base Flood Elevation (BFE)', fl.bfe != null ? `${fl.bfe} ft (${fl.datum})` : 'N/A'],
        ['Zone Subtype', fl.subtype ?? 'N/A'],
      ],
      theme: 'striped',
      headStyles: { fillColor: [15, 40, 80], fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 2 },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  // ── Tsunami ──
  if (results.tsunami) {
    const ts = results.tsunami;
    y = sectionHeader(doc, 'TSUNAMI', y);
    if (!ts.applicable) {
      autoTable(doc, { startY: y, body: [[ts.message]], theme: 'plain', styles: { fontSize: 9 }, margin: { left: 14, right: 14 } });
    } else {
      autoTable(doc, {
        startY: y,
        head: [['Parameter', 'Value']],
        body: [
          ['In Tsunami Design Zone (TDZ)', ts.inTDZ ? 'YES' : 'NO'],
          ['Runup Elevation (MHW)', ts.runupMHW != null ? `${fmt(ts.runupMHW, 2)} ft` : 'N/A'],
          ['Runup Elevation (NAVD88)', ts.runupNAVD != null ? `${fmt(ts.runupNAVD, 2)} ft` : 'N/A'],
        ],
        theme: 'striped',
        headStyles: { fillColor: [15, 40, 80], fontSize: 9 },
        styles: { fontSize: 9, cellPadding: 2 },
        margin: { left: 14, right: 14 },
      });
    }
    y = doc.lastAutoTable.finalY + 6;
  }

  // ── Tornado ──
  if (results.tornado) {
    const tor = results.tornado;
    y = sectionHeader(doc, 'TORNADO', y);
    if (!tor.applicable) {
      autoTable(doc, { startY: y, body: [[tor.message]], theme: 'plain', styles: { fontSize: 9 }, margin: { left: 14, right: 14 } });
    } else {
      const rows = Object.entries(tor.speeds || {}).map(([rp, v]) => [
        rp.replace('RP', '').replace('K', ',000').replace('M', ',000,000') + '-yr MRI',
        v != null ? `${fmt(v, 0)} mph` : 'N/A',
      ]);
      autoTable(doc, {
        startY: y,
        head: [['Return Period (PT — 1 sq ft)', 'Tornado Wind Speed']],
        body: [['In Tornado-Prone Area', tor.inPronArea ? 'YES' : 'NO'], ...rows],
        theme: 'striped',
        headStyles: { fillColor: [15, 40, 80], fontSize: 9 },
        styles: { fontSize: 9, cellPadding: 2 },
        margin: { left: 14, right: 14 },
      });
    }
    y = doc.lastAutoTable.finalY + 6;
  }

  // ── Rain ──
  if (results.rain?.table) {
    if (y > 180) { doc.addPage(); y = 14; }
    y = sectionHeader(doc, 'RAIN (NOAA Atlas 14 — Precipitation Frequency, in/hr)', y);
    const highlightRows = results.rain.table.filter(r =>
      ['60-min','24-hr'].includes(r.duration)
    );
    const allRows = results.rain.table;
    autoTable(doc, {
      startY: y,
      head: [['Duration', '2-yr', '5-yr', '10-yr', '25-yr', '50-yr', '100-yr', '200-yr', '500-yr', '1000-yr']],
      body: allRows.map(r => [
        r.duration,
        ...['2yr','5yr','10yr','25yr','50yr','100yr','200yr','500yr','1000yr'].map(p => fmt(r.values[p], 3)),
      ]),
      theme: 'striped',
      headStyles: { fillColor: [15, 40, 80], fontSize: 8 },
      styles: { fontSize: 7.5, cellPadding: 1.5 },
      margin: { left: 14, right: 14 },
      didParseCell: (data) => {
        const dur = allRows[data.row.index]?.duration;
        if (dur && ['60-min','24-hr'].includes(dur)) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [220, 235, 255];
        }
      },
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  // ── Footer ──
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    doc.text(
      'WSS Load Lookup  |  Data sourced from USGS, ASCE GIS, FEMA NFHL, NOAA Atlas 14  |  Verify all values against governing code before use.',
      14, doc.internal.pageSize.getHeight() - 8
    );
    doc.text(`Page ${i} of ${pageCount}`, pageW - 14, doc.internal.pageSize.getHeight() - 8, { align: 'right' });
  }

  const siteName = (inputs.address || 'site').replace(/[^a-z0-9]/gi, '_').substring(0, 30);
  doc.save(`WSS_Report_${siteName}_${new Date().toISOString().slice(0,10)}.pdf`);
}
