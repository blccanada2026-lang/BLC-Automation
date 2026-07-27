// ============================================================
// PartitionHeaderIntegrityCheck.gs — BLC Nexus T12 Migration/Diagnostic
//
// READ-ONLY. Scans every partition tab (any sheet whose name contains
// '|', the TABLE|YYYY-MM convention) in the live spreadsheet and
// compares its row 1 against the canonical header list for that base
// table (SetupScript.gs's SCHEMAS map — a true top-level global, not
// wrapped in an IIFE, so it's directly readable here).
//
// WHY THIS MATTERS (2026-07-27 finding): ensurePartition() (DAL.gs)
// creates a new partition tab and populates its header row as two
// SEPARATE Sheets API calls, not one atomic operation. If execution is
// interrupted between them (a timeout, a quota error, anything), the
// result is a tab that EXISTS but has NO header row -- and
// ensurePartition()'s own "already exists" check only looks at the tab
// NAME, never verifies headers, so it will never self-heal. Every
// subsequent DAL.appendRow() to that partition then calls
// objectToRow_(headers, data), which maps strictly against row 1 --
// with a blank row 1, every field of every row gets silently
// discarded. The write reports success. The data is gone. This is the
// same failure shape independently found in the Jan-May "exists but
// empty" partition confusion.
//
// DELIBERATE EXCEPTION TO RULE A2 (DAL-only sheet access): reading a
// tab's row 1 to verify header STRUCTURE is not a row-data read DAL's
// readAll()/readWhere() API models (there is no public DAL function
// that returns raw headers), and this is exactly the class of
// structural/meta check DAL.listSheets() already exists for. Uses
// SpreadsheetApp directly, for header inspection ONLY, in this one
// diagnostic file -- no row data is ever read or written here.
//
// READ-ONLY BY CONSTRUCTION: DAL.listSheets() plus direct
// SpreadsheetApp header reads (see exception above) only. No
// DAL.appendRow/appendRows/updateWhere/ensurePartition/clearSheet
// anywhere in this file, and no SpreadsheetApp writes at all. Not
// Config.isDev()-gated -- deliberately, since it must run against PROD
// to answer this truthfully.
//
// HOW TO RUN (Apps Script editor, whichever project is active):
//   runPartitionHeaderIntegrityCheck()
// ============================================================

function runPartitionHeaderIntegrityCheck() {
  var actualScriptId = ScriptApp.getScriptId();
  console.log('=== Partition header integrity check (read-only) ===');
  console.log('Script ID: ' + actualScriptId + ' — confirm which project this is ' +
              '(DEV: 1smkj0mmUqcWDDJPq... / PROD: 1HzRiDrQJ6z-BxPzk...) before trusting this output.');

  var actor = RBAC.resolveActor('raj.nair@bluelotuscanada.ca');
  RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_VIEW);

  var allSheetNames = DAL.listSheets();
  var partitionTabs = allSheetNames.filter(function (name) { return name.indexOf('|') !== -1; });
  console.log('Total sheets: ' + allSheetNames.length + ' | partition tabs (contain "|"): ' + partitionTabs.length);

  var ss = SpreadsheetApp.getActiveSpreadsheet(); // exception documented above — header inspection only

  var blankCount    = 0;
  var mismatchCount = 0;
  var unknownCount  = 0;
  var okCount       = 0;

  console.log('');
  console.log('--- Per-partition results ---');
  partitionTabs.forEach(function (tabName) {
    var sep      = tabName.indexOf('|');
    var baseName = tabName.substring(0, sep);
    var canonical = (typeof SCHEMAS !== 'undefined') ? SCHEMAS[baseName] : undefined;

    var sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      console.log('  ' + tabName + ': SHEET NOT FOUND (listed by listSheets() but not resolvable — investigate separately)');
      return;
    }

    var lastCol = sheet.getLastColumn();
    var headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    var nonBlankHeaders = headers.filter(function (h) { return String(h || '').trim() !== ''; });

    if (nonBlankHeaders.length === 0) {
      blankCount++;
      console.log('  ' + tabName + ': *** BLANK ROW 1 — broken partition, silently discarding every write ***');
      return;
    }

    if (!canonical) {
      unknownCount++;
      console.log('  ' + tabName + ': unknown base table "' + baseName + '" — no canonical schema found in SCHEMAS to compare against. Headers present: [' + headers.join(', ') + ']');
      return;
    }

    var headersTrimmed = headers.map(function (h) { return String(h || '').trim(); });
    var matches = headersTrimmed.length === canonical.length &&
                  headersTrimmed.every(function (h, i) { return h === canonical[i]; });

    if (matches) {
      okCount++;
    } else {
      mismatchCount++;
      console.log('  ' + tabName + ': *** HEADER MISMATCH ***');
      console.log('    actual:    [' + headersTrimmed.join(', ') + ']');
      console.log('    canonical: [' + canonical.join(', ') + ']');
    }
  });

  console.log('');
  console.log('=== Summary: ' + okCount + ' OK, ' + mismatchCount + ' mismatched, ' +
              blankCount + ' BLANK (broken), ' + unknownCount + ' unknown-table (uncheckable). ' +
              (blankCount === 0 && mismatchCount === 0 ? 'CLEAN.' : 'ISSUES FOUND — see above.') + ' ===');
}
