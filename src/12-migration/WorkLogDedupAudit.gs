// ============================================================
// WorkLogDedupAudit.gs — BLC Nexus Data Integrity Audit
// src/12-migration/WorkLogDedupAudit.gs
//
// HOW TO RUN (Apps Script editor):
//   runWorkLogDedupAudit_2026_06()   — June 2026 partition
//   runWorkLogDedupAudit('2026-06')  — any month partition
//
// Finds FACT_WORK_LOGS rows where the same composite key
// (actor_code + job_number + work_date) appears more than once
// in the given month partition.
//
// Output → _TEMP_AUDIT_WORKLOG_DUPES (created/cleared on each run).
// Read-only — no FACT or VW writes.
// ============================================================

var AUDIT_TAB_WORKLOG_DUPES = '_TEMP_AUDIT_WORKLOG_DUPES';

/**
 * Scans FACT_WORK_LOGS for duplicate (actor_code, job_number, work_date)
 * keys in the given month partition. All matching rows are written to
 * _TEMP_AUDIT_WORKLOG_DUPES grouped and colour-coded by duplicate set.
 *
 * @param {string} [monthPartition]  e.g. '2026-06'. Defaults to current month.
 */
function runWorkLogDedupAudit(monthPartition) {
  var MODULE = 'WorkLogDedupAudit';

  // ── Resolve partition ────────────────────────────────────────
  if (!monthPartition) {
    var _n = new Date();
    var _m = (_n.getMonth() + 1 < 10 ? '0' : '') + (_n.getMonth() + 1);
    monthPartition = _n.getFullYear() + '-' + _m;
  }
  if (!monthPartition.match(/^\d{4}-\d{2}$/)) {
    throw new Error('WorkLogDedupAudit: invalid monthPartition "' + monthPartition + '"');
  }
  var year = parseInt(monthPartition.split('-')[0], 10);

  Logger.info('WORKLOG_DEDUP_AUDIT_START', { module: MODULE, partition: monthPartition });

  // ── Load designer names ──────────────────────────────────────
  var staffMap = {};
  try {
    var staffRows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: MODULE });
    for (var s = 0; s < staffRows.length; s++) {
      var sr   = staffRows[s];
      var code = String(sr.person_code || '').trim().toUpperCase();
      if (code) staffMap[code] = String(sr.display_name || sr.name || code);
    }
  } catch (e) {
    Logger.warn('WORKLOG_DEDUP_STAFF_FAIL', { module: MODULE, error: e.message });
  }

  // ── Read FACT_WORK_LOGS ──────────────────────────────────────
  var wlRows = [];
  try {
    wlRows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
      callerModule: MODULE,
      periodId:     monthPartition
    });
  } catch (e) {
    Logger.warn('WORKLOG_DEDUP_WL_FAIL', { module: MODULE, error: e.message });
  }

  // ── Group by (actor_code, job_number, work_date) ─────────────
  var groups = {};  // composite key → [row, ...]
  for (var i = 0; i < wlRows.length; i++) {
    var row = wlRows[i];
    var ac  = String(row.actor_code || '').trim().toUpperCase();
    var jn  = String(row.job_number || '').trim().split(/\s+/)[0];
    var wd  = normWd_(row.work_date, year);
    if (!ac || !jn || !wd) continue;
    var key = ac + '\x00' + jn + '\x00' + wd;
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  }

  // ── Collect duplicate groups (count > 1) ────────────────────
  var dupeGroups = [];
  var allKeys    = Object.keys(groups);
  for (var k = 0; k < allKeys.length; k++) {
    if (groups[allKeys[k]].length > 1) {
      dupeGroups.push({ key: allKeys[k], rows: groups[allKeys[k]] });
    }
  }

  // Sort groups: actor_code ASC, job_number ASC, work_date ASC
  dupeGroups.sort(function(a, b) {
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  // Within each group sort: event_type ASC (MIGRATED before AMENDED before SUBMITTED)
  for (var g = 0; g < dupeGroups.length; g++) {
    dupeGroups[g].rows.sort(function(a, b) {
      var ea = String(a.event_type || ''), eb = String(b.event_type || '');
      return ea < eb ? -1 : ea > eb ? 1 : 0;
    });
  }

  var totalGroups = dupeGroups.length;
  var totalExtras = 0;
  for (var dg = 0; dg < dupeGroups.length; dg++) {
    totalExtras += dupeGroups[dg].rows.length - 1;
  }

  Logger.info('WORKLOG_DEDUP_AUDIT_DONE', {
    module:       MODULE,
    partition:    monthPartition,
    dupe_groups:  totalGroups,
    extra_rows:   totalExtras
  });

  // ── Build sheet data ─────────────────────────────────────────
  var COLS     = ['actor_code', 'designer_name', 'job_number', 'work_date',
                  'hours', 'event_type', 'dupe_count'];
  var numCols  = COLS.length;

  // sheetRows: each entry is { values: [...], bg: '#xxx', bold: bool }
  var sheetRows = [];

  sheetRows.push({
    values: [
      'AUDIT: FACT_WORK_LOGS duplicate keys — partition ' + monthPartition,
      'Run: ' + new Date().toISOString(),
      'Duplicate groups: ' + totalGroups,
      'Extra rows (beyond first per key): ' + totalExtras,
      '', '', ''
    ],
    bg: '#fff2cc', bold: true
  });

  sheetRows.push({ values: ['', '', '', '', '', '', ''], bg: '#ffffff', bold: false });

  sheetRows.push({ values: COLS, bg: '#cfe2f3', bold: true });

  if (totalGroups === 0) {
    sheetRows.push({
      values: ['✅ No duplicate keys found in partition ' + monthPartition,
               '', '', '', '', '', ''],
      bg: '#d9ead3', bold: false
    });
  } else {
    var GROUP_COLORS = ['#fce5cd', '#fce8e6'];  // alternating orange / rose tints
    for (var g2 = 0; g2 < dupeGroups.length; g2++) {
      var bg    = GROUP_COLORS[g2 % 2];
      var group = dupeGroups[g2];
      var count = group.rows.length;

      for (var rr = 0; rr < count; rr++) {
        var r   = group.rows[rr];
        var ac2 = String(r.actor_code || '').trim().toUpperCase();
        sheetRows.push({
          values: [
            ac2,
            staffMap[ac2] || ac2,
            String(r.job_number || '').trim(),
            normWd_(r.work_date, year),
            isNaN(parseFloat(r.hours)) ? '' : parseFloat(r.hours),
            String(r.event_type || ''),
            count
          ],
          bg:   bg,
          bold: rr === 0   // bold first row of each group to mark boundary
        });
      }

      // blank spacer between groups
      sheetRows.push({ values: ['', '', '', '', '', '', ''], bg: '#ffffff', bold: false });
    }
  }

  // ── Write to sheet ───────────────────────────────────────────
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(AUDIT_TAB_WORKLOG_DUPES);
  if (tab) { tab.clearContents(); tab.clearFormats(); }
  else     { tab = ss.insertSheet(AUDIT_TAB_WORKLOG_DUPES); }

  // Bulk-write values in one call
  var allValues = [];
  for (var v = 0; v < sheetRows.length; v++) { allValues.push(sheetRows[v].values); }
  tab.getRange(1, 1, allValues.length, numCols).setValues(allValues);

  // Apply formatting row by row (diagnostic tab — row count is small)
  for (var f = 0; f < sheetRows.length; f++) {
    var rng = tab.getRange(f + 1, 1, 1, numCols);
    rng.setBackground(sheetRows[f].bg);
    if (sheetRows[f].bold) rng.setFontWeight('bold');
  }

  tab.setFrozenRows(3);
  tab.autoResizeColumns(1, numCols);

  console.log('[WorkLogDedupAudit] Partition: ' + monthPartition +
              ' | Duplicate groups: ' + totalGroups +
              ' | Extra rows: ' + totalExtras);

  return { partition: monthPartition, dupe_groups: totalGroups, extra_rows: totalExtras };
}

// ── Private helpers ───────────────────────────────────────────

/**
 * Normalises a work_date value to 'YYYY-MM-DD' for consistent grouping.
 * Handles Date objects, ISO strings, and GAS Date-toString() strings.
 */
function normWd_(raw, year) {
  if (!raw) return '';
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return '';
    var y = raw.getFullYear(), mo = raw.getMonth() + 1, d = raw.getDate();
    return y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (d < 10 ? '0' : '') + d;
  }
  var s   = String(raw).trim();
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
  var parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    var py = parsed.getFullYear(), pm2 = parsed.getMonth() + 1, pd = parsed.getDate();
    return py + '-' + (pm2 < 10 ? '0' : '') + pm2 + '-' + (pd < 10 ? '0' : '') + pd;
  }
  return s;
}

/** Runner — select this function in the Apps Script editor and click Run. */
function runWorkLogDedupAudit_2026_06() {
  runWorkLogDedupAudit('2026-06');
}
