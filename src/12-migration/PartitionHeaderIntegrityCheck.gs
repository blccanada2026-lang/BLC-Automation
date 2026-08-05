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

/**
 * @returns {{ ok: boolean, okCount: number, blankCount: number,
 *   mismatchCount: number, unknownCount: number, blankTabs: string[],
 *   mismatchTabs: string[] }} ok is true only when blankCount === 0 —
 *   the actively dangerous case (see file header). Mismatches/unknowns
 *   don't affect ok; they're reported but confirmed latent/harmless as
 *   of the 2026-07-27 full PROD scan (PROJECT_MEMORY.md §3.5's
 *   surrounding history).
 */
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
  var blankTabs     = [];
  var mismatchTabs  = [];

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
      blankTabs.push(tabName);
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
      mismatchTabs.push(tabName);
      console.log('  ' + tabName + ': *** HEADER MISMATCH ***');
      console.log('    actual:    [' + headersTrimmed.join(', ') + ']');
      console.log('    canonical: [' + canonical.join(', ') + ']');
    }
  });

  console.log('');
  console.log('=== Summary: ' + okCount + ' OK, ' + mismatchCount + ' mismatched, ' +
              blankCount + ' BLANK (broken), ' + unknownCount + ' unknown-table (uncheckable). ' +
              (blankCount === 0 && mismatchCount === 0 ? 'CLEAN.' : 'ISSUES FOUND — see above.') + ' ===');

  return {
    ok: blankCount === 0,
    okCount: okCount, blankCount: blankCount, mismatchCount: mismatchCount, unknownCount: unknownCount,
    blankTabs: blankTabs, mismatchTabs: mismatchTabs
  };
}

// ============================================================
// DAILY MONITOR — alerts (email) when a BLANK header is found.
//
// Deliberately alerts ONLY on blankCount > 0, not on mismatches/
// unknowns — a blank header is the actively dangerous case (every
// write against it is silently discarded, exactly the Aug 2026
// incident). Mismatches were separately confirmed latent/harmless as
// of the 2026-07-27 full PROD scan; alerting on them would be noise
// without being actionable. Since PR #9 (DAL.gs self-healing fix),
// this should almost never fire in practice — it exists as an early-
// warning safety net, not the primary defense.
//
// Reuses the alerting pattern already established in
// ExecutionHealthMonitor.gs (same script-properties cooldown approach,
// same MailApp HTML style, same CEO_BRIEFING_RECIPIENT property) rather
// than inventing a new one.
//
// INSTALL:  runInstallPartitionHeaderMonitorTrigger()
// REMOVE:   runRemovePartitionHeaderMonitorTrigger()
// MANUAL:   runPartitionHeaderMonitorJob(true)  — forces send even in cooldown
// ============================================================

var PHM_ALERT_RECIPIENT_PROP_ = 'CEO_BRIEFING_RECIPIENT';
var PHM_LAST_ALERT_PROP_      = 'PHM_LAST_ALERT_MS';
var PHM_ALERT_COOLDOWN_MS_    = 20 * 60 * 60 * 1000; // 20 hours — just under the daily cadence, so a manual run doesn't double-send same-day

/**
 * Clock trigger entry point — runs daily.
 * @param {boolean=} forceSend  Bypass the cooldown (manual runs only).
 */
function runPartitionHeaderMonitorJob(forceSend) {
  var result = runPartitionHeaderIntegrityCheck();
  if (result.blankCount === 0) return;

  var props     = PropertiesService.getScriptProperties();
  var lastAlert = parseInt(props.getProperty(PHM_LAST_ALERT_PROP_) || '0', 10);
  if (!forceSend && Date.now() - lastAlert < PHM_ALERT_COOLDOWN_MS_) {
    console.log('[PartitionHeaderMonitor] Blank header(s) found but within cooldown window. Suppressing alert.');
    return;
  }

  var recipient = props.getProperty(PHM_ALERT_RECIPIENT_PROP_) || 'raj.nair@bluelotuscanada.ca';
  sendPartitionHeaderAlert_(recipient, result);
  props.setProperty(PHM_LAST_ALERT_PROP_, String(Date.now()));
}

function sendPartitionHeaderAlert_(recipient, result) {
  var subject = '🔴 [BLC Nexus] Broken partition header(s) detected — ' +
                Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');

  var rows = result.blankTabs.map(function (tabName) {
    return '<tr style="background:#fdf0ef;border-bottom:1px solid #eee;">' +
           '<td style="padding:10px 14px;font-size:13px;color:#333;">' + tabName + '</td></tr>';
  }).join('');

  var html =
    '<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#222;">' +
    '<div style="background:#1a3c6e;padding:20px 28px;border-radius:6px 6px 0 0;">' +
    '  <h2 style="margin:0;color:#fff;font-size:18px;">BLC Nexus — Broken Partition Header Alert</h2>' +
    '</div>' +
    '<div style="border:1px solid #ddd;border-top:none;padding:24px 28px;border-bottom:none;">' +
    '  <p style="font-size:14px;margin:0 0 16px;">' +
         '<strong>' + result.blankTabs.length + ' partition tab(s)</strong> have a blank header row — ' +
         'every field of every write against them is being silently discarded right now. ' +
         'This is the exact failure that caused the Aug 2026 incident (missing designer hours).' +
    '  </p>' +
    '  <table style="width:100%;border-collapse:collapse;">' + rows + '</table>' +
    '  <p style="font-size:13px;color:#666;margin:20px 0 0;">' +
         'Run <strong>runAug2026PartitionRecoveryHeaderRepairOnly()</strong>-style repair, or repair the ' +
         'header manually, then re-run <strong>runPartitionHeaderIntegrityCheck()</strong> to confirm.' +
    '  </p>' +
    '  <p style="font-size:12px;color:#aaa;margin:8px 0 0;">Next alert suppressed for 20 hours.</p>' +
    '</div>' +
    '<div style="border:1px solid #ddd;border-top:none;padding:12px 28px;border-radius:0 0 6px 6px;background:#f8f9fc;">' +
    '  <p style="font-size:12px;color:#888;margin:0;">— BLC Nexus PartitionHeaderIntegrityCheck</p>' +
    '</div>' +
    '</div>';

  MailApp.sendEmail({ to: recipient, subject: subject, htmlBody: html });
}

/**
 * Installs a daily partition-header monitor trigger. Idempotent.
 */
function runInstallPartitionHeaderMonitorTrigger() {
  var FN = 'runPartitionHeaderMonitorJob';
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === FN) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger(FN).timeBased().everyDays(1).atHour(4).create();
  console.log('✅ Partition header monitor installed: ' + FN + ' daily around 04:00.');
}

/**
 * Removes the partition-header monitor trigger.
 */
function runRemovePartitionHeaderMonitorTrigger() {
  var FN      = 'runPartitionHeaderMonitorJob';
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === FN) { ScriptApp.deleteTrigger(t); removed++; }
  });
  console.log(removed > 0 ? ('✅ Removed ' + removed + ' trigger(s).') : 'No matching trigger found.');
}
