// ============================================================
// DbgDailyCapAudit.gs — BLC Nexus Diagnostic
// src/12-migration/DbgDailyCapAudit.gs
//
// HOW TO RUN (Apps Script editor):
//   runDbgDailyCapAudit()
//
// Finds every work_date in June 2026 where DBG's net logged
// hours exceed 16h. For each such day, lists every FACT row
// (job_number, hours, client_code from VW) so the details
// can be included in a clarification email.
//
// Output → _TEMP_AUDIT_DBG_DAILY_CAP (read-only, no FACT writes)
// ============================================================

function runDbgDailyCapAudit() {
  var MODULE    = 'DbgDailyCapAudit';
  var ACTOR     = 'DBG';
  var MONTH     = '2026-06';
  var CAP       = 16;
  var OUT_TAB   = '_TEMP_AUDIT_DBG_DAILY_CAP';

  // ── Build job_number → client_code from VW ──────────────────
  var jobToClient = {};
  var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
  for (var v = 0; v < vwRows.length; v++) {
    var jn = String(vwRows[v].job_number || '').trim();
    if (jn) jobToClient[jn] = String(vwRows[v].client_code || '').trim();
  }

  // ── Read FACT_WORK_LOGS for DBG in June 2026 ────────────────
  var wlRows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
    callerModule: MODULE,
    periodId:     MONTH
  });

  var dbgRows = [];
  for (var i = 0; i < wlRows.length; i++) {
    var r  = wlRows[i];
    var ac = String(r.actor_code || '').trim().toUpperCase();
    if (ac !== ACTOR) continue;
    if (r.migration_batch) continue;
    if (String(r.event_type || '') === 'WORK_LOG_MIGRATED') continue;
    var wd = normDbgDate_(r.work_date);
    if (!wd || wd.substr(0, 7) !== MONTH) continue;
    dbgRows.push(r);
  }

  // ── Group by work_date → sum hours ──────────────────────────
  var dateMap = {};
  for (var j = 0; j < dbgRows.length; j++) {
    var row = dbgRows[j];
    var d   = normDbgDate_(row.work_date);
    if (!dateMap[d]) dateMap[d] = { total: 0, rows: [] };
    var h = parseFloat(row.hours) || 0;
    dateMap[d].total = Math.round((dateMap[d].total + h) * 100) / 100;
    dateMap[d].rows.push(row);
  }

  // ── Find days over cap ───────────────────────────────────────
  var overCapDates = [];
  for (var date in dateMap) {
    if (dateMap[date].total > CAP) overCapDates.push(date);
  }
  overCapDates.sort();

  // ── Build output rows ────────────────────────────────────────
  var COLS = ['work_date', 'day_total_h', 'job_number', 'hours', 'event_type', 'client_code'];
  var outputRows = [];

  for (var di = 0; di < overCapDates.length; di++) {
    var dt    = overCapDates[di];
    var entry = dateMap[dt];
    var dayRows = entry.rows.slice().sort(function(a, b) {
      return (parseFloat(b.hours) || 0) - (parseFloat(a.hours) || 0);
    });

    outputRows.push(['── ' + dt + ' ── Total: ' + entry.total + 'h (cap ' + CAP + 'h)', '', '', '', '', '']);

    for (var ri = 0; ri < dayRows.length; ri++) {
      var dr  = dayRows[ri];
      var jnf = String(dr.job_number || '').trim();
      var jnt = jnf.split(/\s+/)[0];
      var cc  = jobToClient[jnt] || jobToClient[jnf] || '(not in VW)';
      outputRows.push([
        normDbgDate_(dr.work_date),
        '',
        jnf,
        parseFloat(dr.hours) || 0,
        String(dr.event_type || ''),
        cc
      ]);
    }
    outputRows.push(['', '', '', '', '', '']);
  }

  // ── Write to sheet ───────────────────────────────────────────
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(OUT_TAB);
  if (tab) { tab.clearContents(); tab.clearFormats(); }
  else     { tab = ss.insertSheet(OUT_TAB); }

  var banner = ['DBG — JUNE 2026 DAYS OVER ' + CAP + 'h CAP', 'Run: ' + new Date().toISOString(),
                'Days over cap: ' + overCapDates.length, '', '', ''];
  var allRows = [banner, new Array(6).fill(''), COLS].concat(outputRows);

  tab.getRange(1, 1, allRows.length, 6).setValues(allRows);
  tab.getRange(1, 1, 1, 6).setBackground('#fff2cc').setFontWeight('bold');
  tab.getRange(3, 1, 1, 6).setBackground('#cfe2f3').setFontWeight('bold');

  // Highlight day-header rows
  for (var or = 0; or < outputRows.length; or++) {
    if (String(outputRows[or][0]).indexOf('──') === 0) {
      tab.getRange(4 + or, 1, 1, 6).setBackground('#f4cccc').setFontWeight('bold');
    }
  }

  tab.setFrozenRows(3);
  tab.autoResizeColumns(1, 6);

  console.log('[DbgDailyCapAudit] Days over ' + CAP + 'h cap: ' + overCapDates.length);
  for (var x = 0; x < overCapDates.length; x++) {
    var e = dateMap[overCapDates[x]];
    console.log('  ' + overCapDates[x] + ': ' + e.total + 'h (' + e.rows.length + ' rows)');
    for (var y = 0; y < e.rows.length; y++) {
      var rr = e.rows[y];
      var jj = String(rr.job_number || '').trim();
      console.log('    ' + jj + ' | ' + rr.hours + 'h | ' + (jobToClient[jj.split(/\s+/)[0]] || '?'));
    }
  }
}

// ── Private helpers ───────────────────────────────────────────

var DBG_MONTH_MAP_ = {
  jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11
};

function normDbgDate_(raw) {
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
    var mi = DBG_MONTH_MAP_[mg[1].toLowerCase()];
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
