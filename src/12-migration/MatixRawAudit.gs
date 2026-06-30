// ============================================================
// MatixRawAudit.gs — BLC Nexus Diagnostic
// src/12-migration/MatixRawAudit.gs
//
// HOW TO RUN (Apps Script editor):
//   runMatixRawAudit()
//
// Raw diagnostic: all FACT_WORK_LOGS rows for DBG and DBS in
// the 2026-06 partition, joined to VW_JOB_CURRENT_STATE for
// client_code. No filters, no exclusions, no engine logic.
//
// Colour key in output sheet:
//   Green  — client_code contains MATIX (what we're looking for)
//   Orange — row has migration_batch set (would be excluded by engine)
//   White  — normal row
//
// NOTE: DAL.readAll with periodId:'2026-06' matches on the
// period_id column. Migrated rows with a Date-object period_id
// (known defect) will NOT be returned by this filter. If the
// sheet shows 0 MATIX rows, re-run runMatixRawAudit_AllPeriods()
// which reads the full table and filters by work_date instead.
//
// Output → _TEMP_AUDIT_MATIX_RAW (read-only, no FACT writes)
// ============================================================

var MATIX_RAW_TAB_     = '_TEMP_AUDIT_MATIX_RAW';
var MATIX_RAW_ACTORS_  = { 'DBG': true, 'DBS': true };
var MATIX_RAW_COLS_    = [
  'actor_code', 'job_number', 'work_date', 'hours',
  'event_type', 'migration_batch', 'client_code (VW)'
];

/**
 * Raw diagnostic: all FACT_WORK_LOGS rows for DBG and DBS
 * in the 2026-06 partition, joined to VW for client_code.
 * Uses standard periodId filter — may miss rows with malformed period_id.
 */
function runMatixRawAudit() {
  runMatixRawAudit_(false);
}

/**
 * Same as runMatixRawAudit() but reads ALL partitions and
 * filters by work_date (June 2026). Use this if the standard
 * run returns 0 rows — it bypasses the period_id column defect.
 */
function runMatixRawAudit_AllPeriods() {
  runMatixRawAudit_(true);
}

function runMatixRawAudit_(allPeriods) {
  var MODULE    = 'MatixRawAudit';
  var PARTITION = '2026-06';

  // ── Build job_number → client_code from VW ──────────────────
  var jobToClient = {};
  var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
  for (var v = 0; v < vwRows.length; v++) {
    var vr = vwRows[v];
    var jn = String(vr.job_number || '').trim();
    if (jn) jobToClient[jn] = String(vr.client_code || '').trim();
  }

  // ── Read FACT_WORK_LOGS ──────────────────────────────────────
  var readOpts = { callerModule: MODULE };
  if (!allPeriods) readOpts.periodId = PARTITION;

  var wlRows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, readOpts);

  // ── Filter to DBG / DBS; optionally filter by work_date ──────
  var rows = [];
  for (var i = 0; i < wlRows.length; i++) {
    var row = wlRows[i];
    var ac  = String(row.actor_code || '').trim().toUpperCase();
    if (!MATIX_RAW_ACTORS_[ac]) continue;

    // When reading all periods, scope to June 2026 by work_date
    if (allPeriods) {
      var wd = normMatixDate_(row.work_date);
      if (!wd || wd.substr(0, 7) !== '2026-06') continue;
    }

    var jnFull  = String(row.job_number || '').trim();
    var jnToken = jnFull.split(/\s+/)[0];
    var cc      = jobToClient[jnToken] || jobToClient[jnFull] || '(not in VW)';

    rows.push([
      ac,
      jnFull,
      normMatixDate_(row.work_date) || String(row.work_date || ''),
      isNaN(parseFloat(row.hours)) ? row.hours : parseFloat(row.hours),
      String(row.event_type      || ''),
      String(row.migration_batch || ''),
      cc
    ]);
  }

  // Sort: actor_code ASC, work_date ASC
  rows.sort(function(a, b) {
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
    return String(a[2]) < String(b[2]) ? -1 : 1;
  });

  var matixRows = rows.filter(function(r) {
    return String(r[6]).toUpperCase().indexOf('MATIX') >= 0;
  });

  // ── Write to sheet ───────────────────────────────────────────
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(MATIX_RAW_TAB_);
  if (tab) { tab.clearContents(); tab.clearFormats(); }
  else     { tab = ss.insertSheet(MATIX_RAW_TAB_); }

  var numCols = MATIX_RAW_COLS_.length;

  var mode   = allPeriods ? 'ALL PARTITIONS filtered by work_date=2026-06'
                          : 'partition 2026-06 (periodId filter)';
  var banner = [
    'RAW DIAGNOSTIC: FACT_WORK_LOGS — DBG + DBS — ' + mode,
    'Run: ' + new Date().toISOString(),
    'Total rows: ' + rows.length + '   MATIX-SK rows: ' + matixRows.length,
    '', '', '', ''
  ];
  var spacer  = new Array(numCols).fill('');

  var allValues = [banner, spacer, MATIX_RAW_COLS_].concat(rows);
  tab.getRange(1, 1, allValues.length, numCols).setValues(allValues);

  // Formatting
  tab.getRange(1, 1, 1, numCols).setBackground('#fff2cc').setFontWeight('bold');
  tab.getRange(3, 1, 1, numCols).setBackground('#cfe2f3').setFontWeight('bold');

  var dataStart = 4;
  for (var fr = 0; fr < rows.length; fr++) {
    var rng = tab.getRange(dataStart + fr, 1, 1, numCols);
    var cc2 = String(rows[fr][6]).toUpperCase();
    var mb  = String(rows[fr][5]);
    if (cc2.indexOf('MATIX') >= 0) {
      rng.setBackground('#d9ead3');
    } else if (mb && mb !== '') {
      rng.setBackground('#fce5cd');
    }
  }

  tab.setFrozenRows(3);
  tab.autoResizeColumns(1, numCols);

  console.log('[MatixRawAudit] Mode: ' + mode);
  console.log('[MatixRawAudit] DBG+DBS total rows: ' + rows.length +
              ' | MATIX-SK rows: ' + matixRows.length);

  if (matixRows.length === 0) {
    console.log('[MatixRawAudit] ⚠️  0 MATIX-SK rows found.' +
                (allPeriods ? ' Data may not exist in system.'
                            : ' Try runMatixRawAudit_AllPeriods() to bypass periodId filter.'));
  } else {
    for (var mr = 0; mr < matixRows.length; mr++) {
      var m = matixRows[mr];
      console.log('  MATIX: ' + m[0] + ' | ' + m[1] + ' | ' + m[2] +
                  ' | ' + m[3] + 'h | ' + m[4] +
                  (m[5] ? ' | batch=' + m[5] : ''));
    }
  }

  return { total_rows: rows.length, matix_rows: matixRows.length };
}

// ── Private helpers ───────────────────────────────────────────

var MR_MONTH_MAP_ = {
  jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11
};

function normMatixDate_(raw) {
  if (!raw) return '';
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return '';
    var y = raw.getFullYear(), mo = raw.getMonth() + 1, d = raw.getDate();
    return y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (d < 10 ? '0' : '') + d;
  }
  var s   = String(raw).trim();
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
  var mg  = s.match(/[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/);
  if (mg) {
    var mi = MR_MONTH_MAP_[mg[1].toLowerCase()];
    if (mi !== undefined) {
      var dd = parseInt(mg[2], 10), yr = parseInt(mg[3], 10);
      return yr + '-' + (mi + 1 < 10 ? '0' : '') + (mi + 1) + '-' + (dd < 10 ? '0' : '') + dd;
    }
  }
  var p = new Date(s);
  if (!isNaN(p.getTime())) {
    var py = p.getFullYear(), pm = p.getMonth() + 1, pd = p.getDate();
    return py + '-' + (pm < 10 ? '0' : '') + pm + '-' + (pd < 10 ? '0' : '') + pd;
  }
  return s;
}
