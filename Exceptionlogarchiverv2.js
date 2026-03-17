/**
 * ============================================================================
 * ExceptionLogArchiverV2.gs
 * BLC Job Management System — Exception Log Management
 * 
 * REPLACES: ExceptionLogArchiver.gs (delete the old file after deploying this)
 * 
 * Created: March 14, 2026
 * Author: BLC Development
 * ============================================================================
 * 
 * WHAT THIS FILE DOES:
 * 1. Emergency flush — moves ALL current rows out of EXCEPTIONS_LOG (one-time)
 * 2. Daily archiver — moves rows older than 3 days to monthly archive tabs
 * 3. Auto-creates monthly archive tabs as needed (EXCEPTIONS_ARCHIVE_2026_03, etc.)
 * 4. Auto-deletes archive tabs older than 90 days to keep workbook light
 * 5. Upgrades logException() to support severity levels (ERROR, WARNING, INFO)
 *    - Only ERROR and WARNING are logged. INFO is silently skipped.
 * 
 * FIXES FROM OLD VERSION:
 * - Old archiver used SpreadsheetApp.getUi().alert() inside the function.
 *   This CRASHES when called from a time-based trigger (no UI in headless mode).
 *   That was the root cause of "never ran." V2 uses Logger.log() for trigger
 *   context and only shows UI alerts in menu-invoked functions.
 * - Old 30-day retention meant nothing ever qualified for archival (all rows < 15 days).
 *   V2 uses 3-day retention.
 * - Old single EXCEPTIONS_ARCHIVE tab would eventually become the next 50k problem.
 *   V2 uses monthly tabs with 90-day auto-delete.
 * 
 * EXISTING EXCEPTIONS_ARCHIVE TAB:
 * The old tab (tab #18) may contain data from past manual runs.
 * The emergency flush will NOT touch it. It creates a new BULK tab.
 * After confirming the flush worked, you can manually delete the old tab
 * or leave it — the 90-day cleanup only deletes tabs matching the new naming pattern.
 * 
 * MENU ITEMS TO ADD TO onOpen() in Code.gs:
 *   .addSeparator()
 *   .addItem('Emergency Flush Exception Log', 'emergencyFlushExceptionLog')
 *   .addItem('Archive Old Exceptions (3+ days)', 'archiveExceptionLogV2')
 *   .addItem('Cleanup Old Archive Tabs (90+ days)', 'cleanupOldArchiveTabs')
 *   .addItem('Check Exception Log Health', 'checkExceptionLogHealth')
 * 
 * TRIGGER: Set archiveAndCleanupExceptions() to run DAILY at midnight.
 *          Delete the old weekly archiveExceptionLog trigger first.
 *          This single daily trigger handles both archival AND cleanup.
 * ============================================================================
 */


// ── CONFIGURATION ──────────────────────────────────────────────────────────
// 
// sourceSheet uses CONFIG.sheets.exceptions from Code.gs for single source of truth.
// All .gs files share the same scope in Google Apps Script, so CONFIG is accessible here.
// If CONFIG is somehow not available, the fallback string 'EXCEPTIONS_LOG' is used.

var EXCEPTION_CONFIG = {
  archivePrefix:      'EXCEPTIONS_ARCHIVE_',    // Monthly tabs: EXCEPTIONS_ARCHIVE_2026_03
  retentionDays:      3,                         // Keep 3 days in EXCEPTIONS_LOG
  archiveMaxAgeDays:  90,                        // Delete archive tabs older than 90 days
  maxRowsPerArchiveTab: 50000,                   // Overflow to _B, _C if exceeded
  timestampCol:       1                          // Column A = timestamp (1-indexed)
};

/**
 * Helper: Get the EXCEPTIONS_LOG sheet name safely.
 * Uses CONFIG.sheets.exceptions if available, falls back to hardcoded string.
 */
function getExceptionSheetName_() {
  try {
    if (typeof CONFIG !== 'undefined' && CONFIG.sheets && CONFIG.sheets.exceptions) {
      return CONFIG.sheets.exceptions;
    }
  } catch (e) {
    // CONFIG not available — use fallback
  }
  return 'EXCEPTIONS_LOG';
}

/**
 * Helper: Safely get the EXCEPTIONS_LOG sheet.
 * Uses getSheet() from Code.gs if available, falls back to direct lookup.
 */
function getExceptionSheet_(ss) {
  var sheetName = getExceptionSheetName_();
  try {
    // Try using the standard getSheet() helper from Code.gs
    if (typeof getSheet === 'function') {
      return getSheet(sheetName);
    }
  } catch (e) {
    // getSheet() threw — fall back to direct lookup
  }
  return ss.getSheetByName(sheetName);
}

/**
 * Helper: Check if we are running in a UI context (menu click) or headless (trigger).
 * Returns true if UI is available, false if running from a trigger.
 */
function hasUI_() {
  try {
    SpreadsheetApp.getUi();
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Helper: Show message to user (UI alert if available, Logger if not).
 */
function showMessage_(title, message) {
  if (hasUI_()) {
    SpreadsheetApp.getUi().alert(title, message, SpreadsheetApp.getUi().ButtonSet.OK);
  } else {
    Logger.log(title + ': ' + message);
  }
}


// ── 1. EMERGENCY FLUSH (ONE-TIME, MENU ONLY) ──────────────────────────────
/**
 * Moves ALL rows from EXCEPTIONS_LOG to a one-time bulk archive tab.
 * Run this ONCE to get immediate performance relief.
 * After running: EXCEPTIONS_LOG will have only the header row.
 * 
 * Creates tab: EXCEPTIONS_ARCHIVE_BULK_[date]
 * 
 * This function uses UI dialogs and should only be run from the menu.
 */
function emergencyFlushExceptionLog() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var source = getExceptionSheet_(ss);
  
  if (!source) {
    showMessage_('Error', 'EXCEPTIONS_LOG tab not found.');
    return;
  }
  
  var data = source.getDataRange().getValues();
  var totalRows = data.length;
  
  if (totalRows <= 1) {
    showMessage_('Nothing to Flush', 'EXCEPTIONS_LOG is already empty (header only).');
    return;
  }
  
  var dataRows = totalRows - 1;
  
  // Confirm with user (only works from menu — that's fine, this is menu-only)
  if (hasUI_()) {
    var ui = SpreadsheetApp.getUi();
    var confirm = ui.alert(
      'Emergency Flush — Confirm',
      'This will move ' + dataRows + ' rows from EXCEPTIONS_LOG to a bulk archive tab.\n\n' +
      'EXCEPTIONS_LOG will be cleared (header preserved).\n\n' +
      'This cannot be undone. Proceed?',
      ui.ButtonSet.YES_NO
    );
    
    if (confirm !== ui.Button.YES) {
      ui.alert('Cancelled. No changes made.');
      return;
    }
  }
  
  try {
    // Create bulk archive tab with date stamp
    var dateStamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy_MM_dd');
    var archiveName = EXCEPTION_CONFIG.archivePrefix + 'BULK_' + dateStamp;
    
    // Handle running flush twice on the same day
    var archiveSheet = ss.getSheetByName(archiveName);
    if (!archiveSheet) {
      archiveSheet = ss.insertSheet(archiveName);
      // Copy header row from source
      var header = data[0];
      archiveSheet.getRange(1, 1, 1, header.length).setValues([header]);
      archiveSheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
    }
    
    // Find next empty row in archive
    var archiveLastRow = archiveSheet.getLastRow();
    
    // Copy all data rows (skip header)
    var dataOnly = data.slice(1);
    if (dataOnly.length > 0) {
      archiveSheet.getRange(archiveLastRow + 1, 1, dataOnly.length, dataOnly[0].length)
        .setValues(dataOnly);
    }
    
    // Clear EXCEPTIONS_LOG data rows (keep header)
    if (totalRows > 1) {
      source.deleteRows(2, totalRows - 1);
    }
    
    // Shrink the sheet — delete excess empty rows to reclaim space
    var maxRows = source.getMaxRows();
    if (maxRows > 500) {
      try {
        source.deleteRows(3, maxRows - 2); // Keep header + 1 buffer row
      } catch (e) {
        // Safe to ignore — can't delete below minimum
      }
    }
    
    // Move archive tab to the end
    ss.setActiveSheet(archiveSheet);
    ss.moveActiveSheet(ss.getNumSheets());
    
    // Return focus to EXCEPTIONS_LOG
    ss.setActiveSheet(source);
    
    showMessage_(
      'Emergency Flush Complete',
      'Moved ' + dataRows + ' rows to tab: ' + archiveName + '\n\n' +
      'EXCEPTIONS_LOG is now clean (header only).\n\n' +
      'NEXT STEP: Verify the daily trigger is set to run\n' +
      'archiveAndCleanupExceptions() daily at midnight.'
    );
    
    // Log the flush event (using INFO_FORCE so it actually gets written)
    logExceptionV2('INFO_FORCE', '', 'System', 
      'Emergency flush completed. Moved ' + dataRows + ' rows to ' + archiveName);
    
  } catch (err) {
    showMessage_('Error', 'Flush failed: ' + err.message + '\n\nCheck execution log.');
    Logger.log('Emergency flush error: ' + err.toString());
  }
}


// ── 2. DAILY ARCHIVER (SAFE FOR TRIGGER AND MENU) ─────────────────────────
/**
 * Moves rows older than RETENTION_DAYS from EXCEPTIONS_LOG to monthly archive tabs.
 * Creates monthly tabs automatically: EXCEPTIONS_ARCHIVE_2026_03, etc.
 * If a monthly tab exceeds MAX_ROWS, creates overflow: EXCEPTIONS_ARCHIVE_2026_03_B.
 * 
 * CRITICAL: This function NEVER calls getUi() or alert().
 * It is safe to run from a time-based trigger or from the menu.
 */
function archiveExceptionLogV2() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var source = getExceptionSheet_(ss);
  
  if (!source) {
    Logger.log('archiveExceptionLogV2: EXCEPTIONS_LOG tab not found. Skipping.');
    return;
  }
  
  var data = source.getDataRange().getValues();
  if (data.length <= 1) {
    Logger.log('archiveExceptionLogV2: No data rows to process.');
    return;
  }
  
  var header = data[0];
  var cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - EXCEPTION_CONFIG.retentionDays);
  cutoffDate.setHours(0, 0, 0, 0);
  
  var rowsToKeep = [header];
  var rowsToArchive = {};    // Keyed by monthly tab name
  var archivedCount = 0;
  
  for (var i = 1; i < data.length; i++) {
    var timestamp = data[i][EXCEPTION_CONFIG.timestampCol - 1];
    var rowDate;
    
    // Handle various timestamp formats
    if (timestamp instanceof Date) {
      rowDate = timestamp;
    } else if (typeof timestamp === 'string' && timestamp.length > 0) {
      rowDate = new Date(timestamp);
    } else {
      // No valid timestamp — keep the row (don't lose data)
      rowsToKeep.push(data[i]);
      continue;
    }
    
    // Check if date is valid
    if (isNaN(rowDate.getTime())) {
      rowsToKeep.push(data[i]);
      continue;
    }
    
    if (rowDate < cutoffDate) {
      // Determine which monthly tab this row belongs to
      var yearMonth = Utilities.formatDate(rowDate, Session.getScriptTimeZone(), 'yyyy_MM');
      var archiveTabName = EXCEPTION_CONFIG.archivePrefix + yearMonth;
      
      if (!rowsToArchive[archiveTabName]) {
        rowsToArchive[archiveTabName] = [];
      }
      rowsToArchive[archiveTabName].push(data[i]);
      archivedCount++;
    } else {
      rowsToKeep.push(data[i]);
    }
  }
  
  if (archivedCount === 0) {
    Logger.log('archiveExceptionLogV2: No rows older than ' + 
      EXCEPTION_CONFIG.retentionDays + ' days. ' + (data.length - 1) + ' rows retained.');
    return;
  }
  
  // Write archived rows to their monthly tabs
  for (var tabName in rowsToArchive) {
    if (rowsToArchive.hasOwnProperty(tabName)) {
      writeToArchiveTab_(ss, tabName, header, rowsToArchive[tabName]);
    }
  }
  
  // Rewrite EXCEPTIONS_LOG with only retained rows
  source.clearContents();
  if (rowsToKeep.length > 0) {
    source.getRange(1, 1, rowsToKeep.length, rowsToKeep[0].length).setValues(rowsToKeep);
    // Re-bold header
    source.getRange(1, 1, 1, header.length).setFontWeight('bold');
  }
  
  // Shrink the physical sheet size to reclaim space
  var maxRows = source.getMaxRows();
  var dataRows = source.getLastRow();
  if (maxRows > dataRows + 100) {
    try {
      source.deleteRows(dataRows + 101, maxRows - dataRows - 100);
    } catch (e) {
      // Can't delete if too few rows remain — safe to ignore
    }
  }
  
  Logger.log('archiveExceptionLogV2: Archived ' + archivedCount + ' rows across ' + 
    Object.keys(rowsToArchive).length + ' monthly tabs. ' + 
    (rowsToKeep.length - 1) + ' data rows retained in EXCEPTIONS_LOG.');
}


/**
 * Internal helper: Writes rows to a monthly archive tab.
 * Creates the tab if it doesn't exist.
 * If tab exceeds MAX_ROWS, creates overflow tabs with _B, _C suffix.
 */
function writeToArchiveTab_(ss, tabName, header, rows) {
  var targetTab = ss.getSheetByName(tabName);
  
  if (!targetTab) {
    targetTab = ss.insertSheet(tabName);
    targetTab.getRange(1, 1, 1, header.length).setValues([header]);
    targetTab.getRange(1, 1, 1, header.length).setFontWeight('bold');
    // Move to end of workbook
    ss.setActiveSheet(targetTab);
    ss.moveActiveSheet(ss.getNumSheets());
  }
  
  var currentRows = targetTab.getLastRow();
  var availableSpace = EXCEPTION_CONFIG.maxRowsPerArchiveTab - currentRows;
  
  if (rows.length <= availableSpace) {
    targetTab.getRange(currentRows + 1, 1, rows.length, rows[0].length).setValues(rows);
    return;
  }
  
  // Fill current tab first
  if (availableSpace > 0) {
    var firstBatch = rows.slice(0, availableSpace);
    targetTab.getRange(currentRows + 1, 1, firstBatch.length, firstBatch[0].length)
      .setValues(firstBatch);
  }
  
  // Overflow to _B, _C, etc.
  var remaining = rows.slice(Math.max(availableSpace, 0));
  var overflowSuffix = 'B';
  
  while (remaining.length > 0) {
    var overflowName = tabName + '_' + overflowSuffix;
    var overflowTab = ss.getSheetByName(overflowName);
    
    if (!overflowTab) {
      overflowTab = ss.insertSheet(overflowName);
      overflowTab.getRange(1, 1, 1, header.length).setValues([header]);
      overflowTab.getRange(1, 1, 1, header.length).setFontWeight('bold');
      ss.setActiveSheet(overflowTab);
      ss.moveActiveSheet(ss.getNumSheets());
    }
    
    var overflowCurrent = overflowTab.getLastRow();
    var overflowSpace = EXCEPTION_CONFIG.maxRowsPerArchiveTab - overflowCurrent;
    
    if (remaining.length <= overflowSpace) {
      overflowTab.getRange(overflowCurrent + 1, 1, remaining.length, remaining[0].length)
        .setValues(remaining);
      remaining = [];
    } else {
      var batch = remaining.slice(0, overflowSpace);
      overflowTab.getRange(overflowCurrent + 1, 1, batch.length, batch[0].length)
        .setValues(batch);
      remaining = remaining.slice(overflowSpace);
      overflowSuffix = String.fromCharCode(overflowSuffix.charCodeAt(0) + 1);
    }
  }
}


// ── 3. CLEANUP OLD ARCHIVE TABS (90+ DAYS) ─────────────────────────────────
/**
 * Deletes monthly archive tabs older than ARCHIVE_MAX_AGE_DAYS.
 * Also deletes bulk archive tabs older than 90 days.
 * Does NOT touch the old "EXCEPTIONS_ARCHIVE" tab (different naming pattern).
 * 
 * Safe to run from trigger or menu.
 */
function cleanupOldArchiveTabs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - EXCEPTION_CONFIG.archiveMaxAgeDays);
  
  var deletedTabs = [];
  var prefix = EXCEPTION_CONFIG.archivePrefix;
  
  for (var i = sheets.length - 1; i >= 0; i--) {
    var name = sheets[i].getName();
    
    // Only process tabs matching our naming pattern: EXCEPTIONS_ARCHIVE_*
    // This will NOT match the old "EXCEPTIONS_ARCHIVE" tab (no trailing underscore)
    if (name.indexOf(prefix) !== 0) continue;
    
    var suffix = name.substring(prefix.length);
    var tabDate = null;
    
    if (suffix.indexOf('BULK_') === 0) {
      // Bulk tab: EXCEPTIONS_ARCHIVE_BULK_2026_03_14
      var bulkDateStr = suffix.substring(5);
      var bulkParts = bulkDateStr.split('_');
      if (bulkParts.length >= 3) {
        tabDate = new Date(
          parseInt(bulkParts[0]),
          parseInt(bulkParts[1]) - 1,
          parseInt(bulkParts[2])
        );
      }
    } else {
      // Monthly tab: EXCEPTIONS_ARCHIVE_2026_03 or EXCEPTIONS_ARCHIVE_2026_03_B
      var monthParts = suffix.split('_');
      if (monthParts.length >= 2) {
        var year = parseInt(monthParts[0]);
        var month = parseInt(monthParts[1]);
        if (!isNaN(year) && !isNaN(month) && month >= 1 && month <= 12) {
          // Use last day of that month as the age reference
          tabDate = new Date(year, month, 0);
        }
      }
    }
    
    if (tabDate && !isNaN(tabDate.getTime()) && tabDate < cutoffDate) {
      var rowCount = sheets[i].getLastRow();
      deletedTabs.push(name + ' (' + rowCount + ' rows)');
      ss.deleteSheet(sheets[i]);
    }
  }
  
  if (deletedTabs.length > 0) {
    Logger.log('cleanupOldArchiveTabs: Deleted ' + deletedTabs.length + ' tabs: ' + deletedTabs.join(', '));
    logExceptionV2('INFO_FORCE', '', 'System', 
      'Archive cleanup: deleted ' + deletedTabs.length + ' tabs older than ' + 
      EXCEPTION_CONFIG.archiveMaxAgeDays + ' days: ' + deletedTabs.join(', '));
  } else {
    Logger.log('cleanupOldArchiveTabs: No archive tabs older than ' + 
      EXCEPTION_CONFIG.archiveMaxAgeDays + ' days found.');
  }
}


// ── 4. COMBINED DAILY TRIGGER FUNCTION ─────────────────────────────────────
/**
 * Single function for the daily trigger.
 * Runs archival first, then cleanup. One trigger, two jobs.
 * 
 * SET THIS AS YOUR DAILY TRIGGER (replace old weekly archiveExceptionLog trigger).
 * 
 * CRITICAL: This function NEVER calls getUi() or alert().
 * The old archiver crashed on triggers because it used getUi().alert() — 
 * that was the root cause of "never ran." This function is 100% headless-safe.
 */
function archiveAndCleanupExceptions() {
  try {
    Logger.log('archiveAndCleanupExceptions: Starting daily run...');
    
    // Step 1: Archive old rows from EXCEPTIONS_LOG (older than 3 days)
    archiveExceptionLogV2();
    
    // Step 2: Delete archive tabs older than 90 days
    cleanupOldArchiveTabs();
    
    Logger.log('archiveAndCleanupExceptions: Daily run complete.');
    
  } catch (err) {
    Logger.log('archiveAndCleanupExceptions ERROR: ' + err.toString());
    // Try to log the error — if EXCEPTIONS_LOG itself is the problem, this may fail
    try {
      logExceptionV2('ERROR', '', 'System', 'archiveAndCleanupExceptions failed: ' + err.message);
    } catch (e) {
      // Can't log — just let it go. The Logger.log above is our safety net.
    }
  }
}


// ── 5. UPGRADED logException WITH SEVERITY FILTERING ───────────────────────
/**
 * New logging function with severity-based filtering.
 * 
 * Severity levels:
 *   'ERROR'      — Always logged. System errors, data integrity issues, function failures.
 *   'WARNING'    — Always logged. Anomalies, unexpected data, things needing attention.
 *   'INFO'       — SKIPPED (not written to sheet). Routine events.
 *   'INFO_FORCE' — Always logged. Critical system events that are informational but
 *                  must be recorded (flush operations, deployments, config changes).
 * 
 * Column structure matches existing EXCEPTIONS_LOG exactly:
 *   Col A: Timestamp    (Date object)
 *   Col B: Type         (string — severity level)
 *   Col C: Job_Number   (string)
 *   Col D: Person       (string — actor/function name)
 *   Col E: Message      (string — details)
 * 
 * If severity is not provided, defaults to 'WARNING' for safety
 * (ensures the message gets logged rather than silently dropped).
 */
function logExceptionV2(severity, jobNumber, actor, message) {
  // Default to WARNING so unknown severities are logged (safe default)
  if (!severity || severity === '') severity = 'WARNING';
  
  severity = severity.toString().toUpperCase().trim();
  
  // SKIP INFO-level entries — this is the volume reducer
  if (severity === 'INFO') {
    return;
  }
  
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = getExceptionSheet_(ss);
    
    if (!sheet) {
      Logger.log('logExceptionV2: EXCEPTIONS_LOG not found. Message was: ' + message);
      return;
    }
    
    // Append row matching existing column structure:
    // [Timestamp, Type, Job_Number, Person, Message]
    sheet.appendRow([
      new Date(),
      severity,
      jobNumber || '',
      actor || '',
      message || ''
    ]);
    
  } catch (err) {
    // Last resort — log to console so it's at least visible in execution log
    Logger.log('logExceptionV2 FAILED: ' + err.message + ' | Original: ' + message);
  }
}


// ── 6. BACKWARD COMPATIBILITY — PASTE INTO Code.gs ─────────────────────────
/**
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  PASTE THIS INTO Code.gs — REPLACING THE EXISTING logException()   │
 * │                                                                     │
 * │  This maps the old 'type' parameter to severity levels.            │
 * │  All existing calls to logException() throughout Code.gs,          │
 * │  CEODashboard.gs, OrphanJobPatcher.gs, etc. will automatically     │
 * │  route through the severity filter. No changes to those files.     │
 * │                                                                     │
 * │  Mapping logic:                                                    │
 * │  - type contains "ERROR"/"CRITICAL"/"FAIL" → severity ERROR       │
 * │  - type contains "INFO"/"DEBUG"            → severity INFO (SKIP)  │
 * │  - everything else (DUPLICATE, STATUS_CHANGE, REALLOCATION,        │
 * │    QC_SUBMIT, HOURS_ANOMALY, etc.)         → severity WARNING      │
 * │    (all still logged — nothing operational gets suppressed)         │
 * └─────────────────────────────────────────────────────────────────────┘
 * 
 * function logException(type, jobNumber, actor, details) {
 *   var severity = 'WARNING';
 *   if (type) {
 *     var upper = type.toUpperCase();
 *     if (upper.indexOf('ERROR') !== -1 || 
 *         upper.indexOf('CRITICAL') !== -1 || 
 *         upper.indexOf('FAIL') !== -1) {
 *       severity = 'ERROR';
 *     } else if (upper.indexOf('INFO') !== -1 || 
 *                upper.indexOf('DEBUG') !== -1) {
 *       severity = 'INFO';
 *     }
 *   }
 *   logExceptionV2(severity, jobNumber, actor, type + ': ' + (details || ''));
 * }
 */


// ── 7. HEALTH CHECK (MENU ONLY) ───────────────────────────────────────────
/**
 * Diagnostic tool — shows current state of EXCEPTIONS_LOG and all archive tabs.
 * Run from menu: BLC System → Check Exception Log Health
 * 
 * Add to onOpen() menu:
 *   .addItem('Check Exception Log Health', 'checkExceptionLogHealth')
 */
function checkExceptionLogHealth() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var prefix = EXCEPTION_CONFIG.archivePrefix;
  var report = [];
  
  // Check EXCEPTIONS_LOG
  var source = getExceptionSheet_(ss);
  if (source) {
    var rowCount = source.getLastRow();
    var colCount = source.getLastColumn();
    var cellCount = rowCount * colCount;
    report.push('EXCEPTIONS_LOG:');
    report.push('  Data rows: ' + (rowCount > 0 ? rowCount - 1 : 0));
    report.push('  Cells: ' + cellCount);
    report.push('  Physical rows (incl empty): ' + source.getMaxRows());
    
    if (rowCount > 1) {
      var firstDate = source.getRange(2, EXCEPTION_CONFIG.timestampCol).getValue();
      var lastDate = source.getRange(rowCount, EXCEPTION_CONFIG.timestampCol).getValue();
      report.push('  Oldest: ' + firstDate);
      report.push('  Newest: ' + lastDate);
    }
    
    if (rowCount > 10000) {
      report.push('  ⚠ CRITICAL: Over 10,000 rows — run Emergency Flush NOW');
    } else if (rowCount > 5000) {
      report.push('  ⚠ WARNING: Over 5,000 rows — check daily archiver');
    } else {
      report.push('  ✓ Healthy');
    }
  } else {
    report.push('EXCEPTIONS_LOG: NOT FOUND');
  }
  
  // Check old EXCEPTIONS_ARCHIVE tab
  var oldArchive = ss.getSheetByName('EXCEPTIONS_ARCHIVE');
  if (oldArchive) {
    report.push('');
    report.push('OLD EXCEPTIONS_ARCHIVE tab (from V1):');
    report.push('  Rows: ' + oldArchive.getLastRow());
    report.push('  (Safe to delete after confirming data is not needed.)');
  }
  
  report.push('');
  report.push('V2 Archive Tabs:');
  
  var totalArchiveRows = 0;
  var archiveTabs = [];
  
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    if (name.indexOf(prefix) === 0) {
      var rows = sheets[i].getLastRow();
      totalArchiveRows += rows;
      archiveTabs.push('  ' + name + ': ' + rows + ' rows');
    }
  }
  
  if (archiveTabs.length === 0) {
    report.push('  (none yet)');
  } else {
    report = report.concat(archiveTabs);
    report.push('  Total archive rows: ' + totalArchiveRows);
  }
  
  report.push('');
  report.push('Settings:');
  report.push('  Retention: ' + EXCEPTION_CONFIG.retentionDays + ' days');
  report.push('  Auto-delete archives after: ' + EXCEPTION_CONFIG.archiveMaxAgeDays + ' days');
  report.push('  Max rows per archive tab: ' + EXCEPTION_CONFIG.maxRowsPerArchiveTab);
  report.push('  Source sheet: ' + getExceptionSheetName_());
  
  showMessage_('Exception Log Health Check', report.join('\n'));
}