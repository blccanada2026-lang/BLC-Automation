// ============================================================
// BlankProductAudit.gs — BLC Nexus Data Integrity Audit
// src/12-migration/BlankProductAudit.gs
//
// HOW TO RUN (Apps Script editor):
//   runBlankProductAudit()           — current period
//   runBlankProductAudit('2026-06B') — specific period
//
// Finds SBS + NORSPAN jobs that appear in the given period's
// timesheet (have FACT_WORK_LOGS entries in that period) but
// have an empty or null product_code in VW_JOB_CURRENT_STATE.
//
// Results written to _TEMP_AUDIT_BLANK_PRODUCT (created if
// absent, cleared if present). Read-only — no FACT or VW writes.
// ============================================================

var AUDIT_TAB_BLANK_PRODUCT = '_TEMP_AUDIT_BLANK_PRODUCT';

/**
 * Audits SBS + NORSPAN jobs in the current (or specified) period
 * for blank product_code in VW_JOB_CURRENT_STATE.
 * @param {string} [periodId]  e.g. '2026-06B'. Defaults to current period.
 */
function runBlankProductAudit(periodId) {
  var MODULE = 'BlankProductAudit';

  // ── Resolve period ───────────────────────────────────────────
  if (!periodId) {
    var _n = new Date();
    var _m = (_n.getMonth() + 1 < 10 ? '0' : '') + (_n.getMonth() + 1);
    periodId = _n.getFullYear() + '-' + _m + (_n.getDate() <= 15 ? 'A' : 'B');
  }
  var pm = periodId.match(/^(\d{4})-(\d{2})([AB])$/);
  if (!pm) throw new Error('BlankProductAudit: invalid periodId "' + periodId + '"');

  var year           = parseInt(pm[1], 10);
  var monthIdx       = parseInt(pm[2], 10) - 1;
  var half           = pm[3];
  var fromDate       = half === 'A' ? new Date(year, monthIdx, 1)  : new Date(year, monthIdx, 16);
  var toDate         = half === 'A' ? new Date(year, monthIdx, 15) : new Date(year, monthIdx + 1, 0);
  var monthPartition = pm[1] + '-' + pm[2];

  function ymd_(d) { return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
  var fromYMD = ymd_(fromDate), toYMD = ymd_(toDate);

  Logger.info('BLANK_PRODUCT_AUDIT_START', { module: MODULE, period_id: periodId });

  // ── Step 1: Build set of job_numbers with hours in this period ──
  // Mirrors the exclusion rules in ClientTimesheetEngine.buildWorkLogEntries_
  var wlRows = [];
  try {
    wlRows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
      callerModule: MODULE,
      periodId:     monthPartition
    });
  } catch (e) {
    Logger.warn('BLANK_PRODUCT_AUDIT_WL_FAIL', { module: MODULE, error: e.message });
  }

  var activeJobs = {};
  for (var i = 0; i < wlRows.length; i++) {
    var row = wlRows[i];
    if (row.migration_batch) continue;
    var rawDate = row.work_date;
    var d;
    if (rawDate instanceof Date) {
      d = isNaN(rawDate.getTime()) ? null : rawDate;
    } else {
      var s   = String(rawDate || '').trim();
      var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      d = iso ? new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3])) : null;
    }
    if (!d) continue;
    var wd  = ymd_(d);
    if (wd < fromYMD || wd > toYMD) continue;
    var jn  = String(row.job_number || '').trim().split(/\s+/)[0];
    var hrs = parseFloat(row.hours);
    if (!jn || isNaN(hrs) || hrs === 0) continue;
    activeJobs[jn] = true;
  }

  // ── Step 2: Find SBS + NORSPAN VW rows in activeJobs with blank product_code ──
  var TARGET = { 'SBS': true, 'NORSPAN': true, 'NORSPAN-MB': true };
  var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });

  var hits = [];
  for (var j = 0; j < vwRows.length; j++) {
    var r  = vwRows[j];
    var cc = String(r.client_code || '').toUpperCase().trim();
    if (!TARGET[cc]) continue;
    var jn2 = String(r.job_number || '').trim();
    if (!activeJobs[jn2]) continue;
    var pc  = String(r.product_code || '').trim();
    if (pc) continue; // product_code present — not a problem
    hits.push(r);
  }

  // Sort: client_code ASC, job_number ASC
  hits.sort(function(a, b) {
    var c1 = String(a.client_code || ''), c2 = String(b.client_code || '');
    if (c1 !== c2) return c1 < c2 ? -1 : 1;
    return String(a.job_number || '') < String(b.job_number || '') ? -1 : 1;
  });

  Logger.info('BLANK_PRODUCT_AUDIT_DONE', {
    module:     MODULE,
    period_id:  periodId,
    blankCount: hits.length
  });

  // ── Step 3: Write to _TEMP_AUDIT_BLANK_PRODUCT ───────────────
  // Direct SpreadsheetApp: _TEMP_AUDIT tabs are one-time diagnostic
  // output, not FACT tables. DAL does not support tab creation or
  // arbitrary-layout writes.
  var cols = ['job_number', 'client_code', 'client_job_ref', 'job_type', 'product_code', 'current_state'];

  var sheetData = [];
  sheetData.push([
    'AUDIT: Blank product_code — SBS + NORSPAN — period ' + periodId,
    'Run: ' + new Date().toISOString(),
    'Jobs in period with blank product_code: ' + hits.length,
    '', '', ''
  ]);
  sheetData.push(['', '', '', '', '', '']);
  sheetData.push(cols);

  if (hits.length === 0) {
    sheetData.push(['✅ No blank product_codes found for SBS/NORSPAN in ' + periodId, '', '', '', '', '']);
  } else {
    for (var k = 0; k < hits.length; k++) {
      var h = hits[k];
      sheetData.push([
        String(h.job_number     || ''),
        String(h.client_code    || ''),
        String(h.client_job_ref || ''),
        String(h.job_type       || ''),
        String(h.product_code   || ''),
        String(h.current_state  || '')
      ]);
    }
  }

  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(AUDIT_TAB_BLANK_PRODUCT);
  if (tab) {
    tab.clearContents();
  } else {
    tab = ss.insertSheet(AUDIT_TAB_BLANK_PRODUCT);
  }
  tab.getRange(1, 1, sheetData.length, cols.length).setValues(sheetData);
  tab.getRange(1, 1, 1, cols.length).setFontWeight('bold').setBackground('#fff2cc');
  tab.getRange(3, 1, 1, cols.length).setFontWeight('bold').setBackground('#cfe2f3');
  tab.setFrozenRows(3);
  tab.autoResizeColumns(1, cols.length);

  // ── Console summary ──────────────────────────────────────────
  console.log('[BlankProductAudit] Period: ' + periodId + ' | Blank product_code count: ' + hits.length);
  for (var p = 0; p < hits.length; p++) {
    console.log('  ' + hits[p].client_code + ' | ' + hits[p].job_number +
                ' | ref=' + (hits[p].client_job_ref || '(blank)') +
                ' | type=' + (hits[p].job_type || '(blank)') +
                ' | state=' + hits[p].current_state);
  }

  return { period_id: periodId, blankCount: hits.length };
}
