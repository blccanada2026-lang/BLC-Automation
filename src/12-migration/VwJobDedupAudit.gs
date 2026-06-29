// ============================================================
// VwJobDedupAudit.gs — BLC Nexus Data Integrity Audit
// src/12-migration/VwJobDedupAudit.gs
//
// HOW TO RUN (Apps Script editor):
//   runVwJobDedupAudit()
//
// Reads all rows from VW_JOB_CURRENT_STATE and identifies any
// job_number that appears in more than one row. Results written
// to _TEMP_AUDIT_BILLING_DEDUP tab (created if absent, cleared
// if present). No writes to any FACT or VW table.
// ============================================================

var AUDIT_TAB_DEDUP = '_TEMP_AUDIT_BILLING_DEDUP';

/**
 * Audits VW_JOB_CURRENT_STATE for duplicate job_numbers.
 * Writes a summary + per-row detail to _TEMP_AUDIT_BILLING_DEDUP.
 * Read-only — no FACT or VW writes.
 */
function runVwJobDedupAudit() {
  var MODULE = 'VwJobDedupAudit';

  // ── Read all VW rows via DAL ─────────────────────────────────
  var allRows = DAL.readAll(
    Config.TABLES.VW_JOB_CURRENT_STATE,
    { callerModule: MODULE }
  );

  Logger.info('VW_DEDUP_AUDIT_START', {
    module:    MODULE,
    totalRows: allRows.length
  });

  // ── Group by job_number ──────────────────────────────────────
  var groups = {};
  for (var i = 0; i < allRows.length; i++) {
    var r  = allRows[i];
    var jn = String(r.job_number || '(blank)');
    if (!groups[jn]) groups[jn] = [];
    groups[jn].push(r);
  }

  // ── Collect duplicates ───────────────────────────────────────
  var duplicates = [];
  var keys       = Object.keys(groups);
  for (var j = 0; j < keys.length; j++) {
    if (groups[keys[j]].length > 1) {
      duplicates.push({ job_number: keys[j], rows: groups[keys[j]] });
    }
  }

  // Sort duplicates by job_number for readability
  duplicates.sort(function(a, b) {
    return a.job_number < b.job_number ? -1 : 1;
  });

  // ── Build sheet data ─────────────────────────────────────────
  var cols = [
    'job_number', 'row_within_dup', 'total_dups',
    'current_state', 'created_at', 'updated_at',
    'client_code', 'period_id', 'allocated_to',
    'job_type', 'product_code', 'client_job_ref'
  ];

  var sheetData = [];

  // Summary banner
  var auditTimestamp = new Date().toISOString();
  sheetData.push([
    'AUDIT: VW_JOB_CURRENT_STATE duplicate job_number scan',
    'Run: ' + auditTimestamp,
    'Total VW rows: ' + allRows.length,
    'Duplicated job_numbers: ' + duplicates.length,
    '', '', '', '', '', '', '', ''
  ]);
  sheetData.push(['', '', '', '', '', '', '', '', '', '', '', '']);

  // Column headers
  sheetData.push(cols);

  if (duplicates.length === 0) {
    sheetData.push(['✅ No duplicates found', '', '', '', '', '', '', '', '', '', '', '']);
  } else {
    for (var k = 0; k < duplicates.length; k++) {
      var dup = duplicates[k];
      // Sort rows within each group: oldest created_at first
      dup.rows.sort(function(a, b) {
        var da = new Date(a.created_at), db = new Date(b.created_at);
        if (!isNaN(da) && !isNaN(db)) return da - db;
        return String(a.created_at) < String(b.created_at) ? -1 : 1;
      });

      for (var m = 0; m < dup.rows.length; m++) {
        var r = dup.rows[m];
        sheetData.push([
          dup.job_number,
          m + 1,
          dup.rows.length,
          String(r.current_state    || ''),
          String(r.created_at       || ''),
          String(r.updated_at       || ''),
          String(r.client_code      || ''),
          String(r.period_id        || ''),
          String(r.allocated_to     || ''),
          String(r.job_type         || ''),
          String(r.product_code     || ''),
          String(r.client_job_ref   || '')
        ]);
      }
      // Blank separator between duplicate groups
      sheetData.push(['', '', '', '', '', '', '', '', '', '', '', '']);
    }
  }

  // ── Write to _TEMP_AUDIT_BILLING_DEDUP ───────────────────────
  // Direct SpreadsheetApp: _TEMP_AUDIT_BILLING_DEDUP is a one-time diagnostic
  // output tab, not a FACT table. DAL does not support tab creation or
  // arbitrary-layout writes.
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(AUDIT_TAB_DEDUP);
  if (tab) {
    tab.clearContents();
  } else {
    tab = ss.insertSheet(AUDIT_TAB_DEDUP);
  }

  tab.getRange(1, 1, sheetData.length, cols.length).setValues(sheetData);

  // Formatting
  tab.getRange(1, 1, 1, cols.length).setFontWeight('bold').setBackground('#fff2cc'); // summary = yellow
  tab.getRange(3, 1, 1, cols.length).setFontWeight('bold').setBackground('#cfe2f3'); // headers = blue
  tab.setFrozenRows(3);
  tab.autoResizeColumns(1, cols.length);

  // ── Console summary ──────────────────────────────────────────
  console.log('[VwJobDedupAudit] Total VW rows scanned: ' + allRows.length);
  console.log('[VwJobDedupAudit] Duplicated job_numbers found: ' + duplicates.length);

  if (duplicates.length === 0) {
    console.log('[VwJobDedupAudit] ✅ VW_JOB_CURRENT_STATE is clean — no duplicate job_numbers.');
  } else {
    for (var d = 0; d < duplicates.length; d++) {
      var states = duplicates[d].rows.map(function(r) { return r.current_state; }).join(', ');
      console.log('[VwJobDedupAudit] DUPLICATE: ' + duplicates[d].job_number +
                  ' — ' + duplicates[d].rows.length + ' rows — states: [' + states + ']');
    }
    console.log('[VwJobDedupAudit] ⚠️  Open ' + AUDIT_TAB_DEDUP + ' tab for full detail.');
  }

  Logger.info('VW_DEDUP_AUDIT_COMPLETE', {
    module:         MODULE,
    totalRows:      allRows.length,
    duplicateCount: duplicates.length
  });

  return {
    totalRows:      allRows.length,
    duplicateCount: duplicates.length
  };
}
