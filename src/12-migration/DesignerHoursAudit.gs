// ============================================================
// DesignerHoursAudit.gs — BLC Nexus Billing Accuracy Audit
// src/12-migration/DesignerHoursAudit.gs
//
// HOW TO RUN (Apps Script editor — after confirming actor_code):
//   runDesignerHoursAudit('ABC', '2026-06B')
//
// Four-section reconciliation for a single designer in a period:
//   Section 1 — Raw FACT_WORK_LOGS rows (no filters, ground truth)
//   Section 2 — Rows that survived the timesheet engine's filters
//   Section 3 — Rows excluded, with reason per row
//   Section 4 — Summary: raw vs included vs excluded hours
//
// Mirrors the filter chain in ClientTimesheetEngine.buildWorkLogEntries_
// exactly so the two outputs can be directly compared.
//
// Read-only. No writes to any FACT or VW table.
// ============================================================

var AUDIT_TAB_DESIGNER_HOURS = '_TEMP_AUDIT_DESIGNER_HOURS';

// Columns shared across all sections (reason is blank for S1/S2)
var DESIGNER_AUDIT_COLS = [
  'work_date', 'job_number', 'hours', 'event_type', 'notes', 'period_id', 'client_code', 'reason'
];

/**
 * Reconciles FACT_WORK_LOGS hours for one designer against what the
 * timesheet engine included. Output → _TEMP_AUDIT_DESIGNER_HOURS.
 *
 * @param {string} actorCode  e.g. 'ABC'
 * @param {string} periodId   e.g. '2026-06B'
 */
function runDesignerHoursAudit(actorCode, periodId) {
  var MODULE = 'DesignerHoursAudit';
  var ac     = String(actorCode || '').trim().toUpperCase();
  if (!ac) throw new Error('DesignerHoursAudit: actorCode is required');

  // ── Parse period ─────────────────────────────────────────────
  var pm = (periodId || '').match(/^(\d{4})-(\d{2})([AB])$/);
  if (!pm) throw new Error('DesignerHoursAudit: invalid periodId "' + periodId + '"');

  var year           = parseInt(pm[1], 10);
  var monthIdx       = parseInt(pm[2], 10) - 1;
  var half           = pm[3];
  var fromDate       = half === 'A' ? new Date(year, monthIdx, 1)  : new Date(year, monthIdx, 16);
  var toDate         = half === 'A' ? new Date(year, monthIdx, 15) : new Date(year, monthIdx + 1, 0);
  var monthPartition = pm[1] + '-' + pm[2];

  function ymd_(d) { return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
  var fromYMD = ymd_(fromDate), toYMD = ymd_(toDate);

  Logger.info('DESIGNER_HOURS_AUDIT_START', { module: MODULE, actor_code: ac, period_id: periodId });

  // ── Load VW_JOB_CURRENT_STATE → jobMap ───────────────────────
  var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
  var jobMap = {};
  for (var v = 0; v < vwRows.length; v++) {
    var jn = String(vwRows[v].job_number || '').trim();
    if (jn) jobMap[jn] = vwRows[v];
  }

  // ── Read FACT_WORK_LOGS for month partition ───────────────────
  var allWl = [];
  try {
    allWl = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
      callerModule: MODULE,
      periodId:     monthPartition
    });
  } catch (e) {
    Logger.warn('DESIGNER_HOURS_AUDIT_WL_FAIL', { module: MODULE, error: e.message });
  }

  // Filter to this actor only (Section 1 = ground truth)
  var rawRows = [];
  for (var w = 0; w < allWl.length; w++) {
    var r = allWl[w];
    if (String(r.actor_code || '').trim().toUpperCase() === ac) rawRows.push(r);
  }

  // ── Engine filter chain (mirrors buildWorkLogEntries_) ────────
  // SUPERSEDED_MIGRATED: actors whose WORK_LOG_MIGRATED rows were
  // overwritten by corrections (BTD→BIT, SNA→SVN).
  var SUPERSEDED_MIGRATED = { 'BTD': true, 'SNA': true };

  // Pass 1: apply per-row filters, classify each raw row
  var passing  = [];  // { row, jn, hrs, clientCode } — survived individual filters
  var excluded = [];  // { row, reason, clientCode }

  for (var i = 0; i < rawRows.length; i++) {
    var row = rawRows[i];
    var jn  = String(row.job_number || '').trim().split(/\s+/)[0];
    var hrs = parseFloat(row.hours);
    var etype = String(row.event_type || '').trim();

    // Reason 1: migration_batch set
    if (row.migration_batch) {
      excluded.push({ row: row, reason: 'migration_batch excluded', clientCode: jobClientCode_(jobMap, jn) });
      continue;
    }

    // Reason 2: superseded migrated actor
    if (etype === 'WORK_LOG_MIGRATED' && SUPERSEDED_MIGRATED[ac]) {
      excluded.push({ row: row, reason: 'superseded actor excluded (WORK_LOG_MIGRATED for ' + ac + ')', clientCode: jobClientCode_(jobMap, jn) });
      continue;
    }

    // Reason 3: outside date window (or unparseable date)
    var d = parseAuditDate_(row.work_date, year);
    if (!d) {
      excluded.push({ row: row, reason: 'unparseable work_date', clientCode: jobClientCode_(jobMap, jn) });
      continue;
    }
    var wd = ymd_(d);
    if (wd < fromYMD || wd > toYMD) {
      excluded.push({ row: row, reason: 'outside date window (' + fmtDate_(d) + ' not in ' + fmtDate_(fromDate) + '–' + fmtDate_(toDate) + ')', clientCode: jobClientCode_(jobMap, jn) });
      continue;
    }

    // Reason 4: zero hours (engine skips hrs === 0)
    if (isNaN(hrs) || hrs === 0) {
      excluded.push({ row: row, reason: 'zero or invalid hours', clientCode: jobClientCode_(jobMap, jn) });
      continue;
    }

    // Reason 5: no VW match
    if (!jn || !jobMap[jn]) {
      excluded.push({ row: row, reason: 'no VW match for job ' + (jn || '(blank)'), clientCode: '' });
      continue;
    }

    passing.push({ row: row, jn: jn, hrs: hrs, clientCode: String(jobMap[jn].client_code || '') });
  }

  // Pass 2: net hours by job_number, classify netted-to-zero rows
  var nets = {};
  for (var p = 0; p < passing.length; p++) {
    nets[passing[p].jn] = (nets[passing[p].jn] || 0) + passing[p].hrs;
  }

  var included = [];
  for (var q = 0; q < passing.length; q++) {
    var entry = passing[q];
    if (nets[entry.jn] > 0) {
      included.push(entry);
    } else {
      excluded.push({
        row:        entry.row,
        reason:     'netted to zero or negative (job ' + entry.jn + ' net = ' + Math.round(nets[entry.jn] * 100) / 100 + 'h)',
        clientCode: entry.clientCode
      });
    }
  }

  // ── Section 4 totals ─────────────────────────────────────────
  var rawTotal = 0;
  for (var ri = 0; ri < rawRows.length; ri++) rawTotal += parseFloat(rawRows[ri].hours) || 0;

  // Included total = net per job (what the timesheet actually shows)
  var seenJobs   = {};
  var inclNetTotal = 0;
  for (var ii = 0; ii < included.length; ii++) {
    if (!seenJobs[included[ii].jn]) {
      seenJobs[included[ii].jn] = true;
      inclNetTotal += nets[included[ii].jn];
    }
  }

  var exclHrsTotal = 0;
  for (var ei = 0; ei < excluded.length; ei++) exclHrsTotal += parseFloat(excluded[ei].row.hours) || 0;

  rawTotal     = Math.round(rawTotal     * 100) / 100;
  inclNetTotal = Math.round(inclNetTotal * 100) / 100;
  exclHrsTotal = Math.round(exclHrsTotal * 100) / 100;

  Logger.info('DESIGNER_HOURS_AUDIT_DONE', {
    module:         MODULE,
    actor_code:     ac,
    period_id:      periodId,
    rawRows:        rawRows.length,
    includedRows:   included.length,
    excludedRows:   excluded.length,
    rawTotal:       rawTotal,
    inclNetTotal:   inclNetTotal,
    exclHrsTotal:   exclHrsTotal
  });

  // ── Build sheet data ─────────────────────────────────────────
  var cols      = DESIGNER_AUDIT_COLS;
  var colCount  = cols.length;
  var sheetData = [];
  var runStamp  = new Date().toISOString();

  function blankRow_() { return ['', '', '', '', '', '', '', '']; }
  function sectionHeader_(label, bg) { return { row: [label, '', '', '', '', '', '', ''], bg: bg }; }

  // ── Section 1: Raw data ──────────────────────────────────────
  sheetData.push({ row: [
    'AUDIT: Designer Hours Reconciliation — Actor: ' + ac + ' — Period: ' + periodId,
    'Run: ' + runStamp, 'Raw rows: ' + rawRows.length,
    'Included rows: ' + included.length, 'Excluded rows: ' + excluded.length,
    '', '', ''
  ], bg: '#fff2cc', bold: true });
  sheetData.push({ row: blankRow_(), bg: null });

  sheetData.push({ row: ['SECTION 1 — Raw FACT_WORK_LOGS (no filters applied)', '', '', '', '', '', '', ''], bg: '#d9ead3', bold: true });
  sheetData.push({ row: cols, bg: '#274e13', fontColor: '#ffffff', bold: true });

  if (rawRows.length === 0) {
    sheetData.push({ row: ['(no rows found for actor ' + ac + ' in partition ' + monthPartition + ')', '', '', '', '', '', '', ''], bg: null });
  } else {
    for (var s1 = 0; s1 < rawRows.length; s1++) {
      var r1 = rawRows[s1];
      sheetData.push({ row: [
        fmtDate_(parseAuditDate_(r1.work_date, year)) || String(r1.work_date || ''),
        String(r1.job_number  || ''),
        parseFloat(r1.hours)  || 0,
        String(r1.event_type  || ''),
        String(r1.notes       || ''),
        String(r1.period_id   || monthPartition),
        jobClientCode_(jobMap, String(r1.job_number || '').trim().split(/\s+/)[0]),
        ''
      ], bg: null });
    }
  }

  sheetData.push({ row: blankRow_(), bg: null });

  // ── Section 2: Included ──────────────────────────────────────
  sheetData.push({ row: ['SECTION 2 — Included by timesheet engine (survived all filters)', '', '', '', '', '', '', ''], bg: '#cfe2f3', bold: true });
  sheetData.push({ row: cols, bg: '#1a3c5e', fontColor: '#ffffff', bold: true });

  if (included.length === 0) {
    sheetData.push({ row: ['(no rows passed all filters for this actor)', '', '', '', '', '', '', ''], bg: null });
  } else {
    for (var s2 = 0; s2 < included.length; s2++) {
      var r2 = included[s2].row;
      sheetData.push({ row: [
        fmtDate_(parseAuditDate_(r2.work_date, year)) || String(r2.work_date || ''),
        String(r2.job_number  || ''),
        parseFloat(r2.hours)  || 0,
        String(r2.event_type  || ''),
        String(r2.notes       || ''),
        String(r2.period_id   || monthPartition),
        included[s2].clientCode,
        ''
      ], bg: null });
    }
  }
  // Net-per-job totals for Section 2
  var netLines = Object.keys(seenJobs);
  if (netLines.length > 0) {
    sheetData.push({ row: ['', '', '', '', '', '', '', ''], bg: null });
    sheetData.push({ row: ['Timesheet net hours per job (what client sees):', '', '', '', '', '', '', ''], bg: '#e8f0fe', bold: true });
    for (var nl = 0; nl < netLines.length; nl++) {
      var njn = netLines[nl];
      sheetData.push({ row: [
        '', njn, Math.round(nets[njn] * 100) / 100,
        'NET', '', '', jobClientCode_(jobMap, njn), ''
      ], bg: '#e8f0fe' });
    }
  }

  sheetData.push({ row: blankRow_(), bg: null });

  // ── Section 3: Excluded ──────────────────────────────────────
  sheetData.push({ row: ['SECTION 3 — Excluded rows and reason', '', '', '', '', '', '', ''], bg: '#fce5cd', bold: true });
  sheetData.push({ row: cols, bg: '#b45f06', fontColor: '#ffffff', bold: true });

  if (excluded.length === 0) {
    sheetData.push({ row: ['✅ No rows excluded — all raw rows appear in the timesheet', '', '', '', '', '', '', ''], bg: null });
  } else {
    for (var s3 = 0; s3 < excluded.length; s3++) {
      var r3 = excluded[s3].row;
      sheetData.push({ row: [
        fmtDate_(parseAuditDate_(r3.work_date, year)) || String(r3.work_date || ''),
        String(r3.job_number  || ''),
        parseFloat(r3.hours)  || 0,
        String(r3.event_type  || ''),
        String(r3.notes       || ''),
        String(r3.period_id   || monthPartition),
        excluded[s3].clientCode,
        excluded[s3].reason
      ], bg: null });
    }
  }

  sheetData.push({ row: blankRow_(), bg: null });

  // ── Section 4: Summary ───────────────────────────────────────
  sheetData.push({ row: ['SECTION 4 — Hours Summary', '', '', '', '', '', '', ''], bg: '#ead1dc', bold: true });
  sheetData.push({ row: ['Metric', 'Value', '', '', '', '', '', ''], bg: '#741b47', fontColor: '#ffffff', bold: true });
  sheetData.push({ row: ['Actor code',                   ac,            '', '', '', '', '', ''], bg: null });
  sheetData.push({ row: ['Period',                       periodId,      '', '', '', '', '', ''], bg: null });
  sheetData.push({ row: ['Raw rows (Section 1)',          rawRows.length,'', '', '', '', '', ''], bg: null });
  sheetData.push({ row: ['Total raw hours',               rawTotal,      '', '', '', '', '', ''], bg: null });
  sheetData.push({ row: ['Included rows (Section 2)',     included.length,'','', '', '', '', ''], bg: null });
  sheetData.push({ row: ['Timesheet net hours',           inclNetTotal,  '', '', '', '', '', ''], bg: '#e8f0fe', bold: true });
  sheetData.push({ row: ['Excluded rows (Section 3)',     excluded.length,'','', '', '', '', ''], bg: null });
  sheetData.push({ row: ['Excluded hours (row sum)',      exclHrsTotal,  '', '', '', '', '', ''], bg: null });
  sheetData.push({ row: ['Delta (raw − net − excluded)',
    Math.round((rawTotal - inclNetTotal - exclHrsTotal) * 100) / 100,
    '(0 = balanced)', '', '', '', '', ''
  ], bg: '#fff2cc', bold: true });

  // ── Write to sheet ───────────────────────────────────────────
  // Direct SpreadsheetApp: _TEMP_AUDIT tabs are diagnostic output,
  // not FACT tables. DAL does not support tab creation or arbitrary-layout writes.
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(AUDIT_TAB_DESIGNER_HOURS);
  if (tab) {
    tab.clearContents();
    tab.clearFormats();
  } else {
    tab = ss.insertSheet(AUDIT_TAB_DESIGNER_HOURS);
  }

  // Write values then apply formatting row by row
  var values = sheetData.map(function(item) { return item.row; });
  tab.getRange(1, 1, values.length, colCount).setValues(values);

  for (var fi = 0; fi < sheetData.length; fi++) {
    var item  = sheetData[fi];
    var range = tab.getRange(fi + 1, 1, 1, colCount);
    if (item.bg)        range.setBackground(item.bg);
    if (item.bold)      range.setFontWeight('bold');
    if (item.fontColor) range.setFontColor(item.fontColor);
  }

  tab.setFrozenRows(2);
  tab.autoResizeColumns(1, colCount);

  console.log('[DesignerHoursAudit] Actor: ' + ac + ' | Period: ' + periodId);
  console.log('[DesignerHoursAudit] Raw rows: ' + rawRows.length + ' (' + rawTotal + 'h)');
  console.log('[DesignerHoursAudit] Timesheet net: ' + inclNetTotal + 'h | Excluded: ' + exclHrsTotal + 'h');
  console.log('[DesignerHoursAudit] Delta: ' + Math.round((rawTotal - inclNetTotal - exclHrsTotal) * 100) / 100 + ' (0 = balanced)');

  return { actor_code: ac, period_id: periodId, rawRows: rawRows.length, rawTotal: rawTotal, inclNetTotal: inclNetTotal, exclHrsTotal: exclHrsTotal };
}

// ── Private helpers ───────────────────────────────────────────

var AUDIT_MONTH_MAP_ = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };

function parseAuditDate_(raw, year) {
  if (!raw) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  var s   = String(raw).trim();
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
  var mg  = s.match(/[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})/);
  if (mg) {
    var mi = AUDIT_MONTH_MAP_[mg[1].toLowerCase()];
    if (mi !== undefined) return new Date(year, mi, parseInt(mg[2]));
  }
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate_(d) {
  if (!d) return '';
  return d.getFullYear() + '-' +
         (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) + '-' +
         (d.getDate()    < 10 ? '0' : '') +  d.getDate();
}

function jobClientCode_(jobMap, jn) {
  return jn && jobMap[jn] ? String(jobMap[jn].client_code || '') : '';
}
