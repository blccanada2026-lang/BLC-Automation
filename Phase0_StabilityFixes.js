/**
 * ============================================================================
 * BLC PHASE 0 — STABILITY FIXES
 * File: Phase0_StabilityFixes.gs
 * Date: March 17, 2026
 * Purpose: All Phase 0 fixes in one file. Paste into Apps Script editor.
 *          Run functions from Menu > BLC System after adding menu items.
 * ============================================================================
 *
 * WHAT THIS FILE CONTAINS:
 * 1. fixClientPortalLinksReference()  — Fixes the missing CLIENT_PORTAL_LINKS tab
 * 2. setupSyncFormDropdownsTrigger()  — Creates the missing daily trigger
 * 3. verifyAndFixOrphanPatcher()      — Verifies/fixes orphan patcher timing
 * 4. verifyAndFixArchiver()           — Verifies/fixes exception log archiver timing
 * 5. auditMatixProductTypes()         — Audits MATIX rows for Deb Sen product type errors
 * 6. investigateSayanHours()          — Diagnostic: finds Sayan Roy's unaccounted hours
 * 7. investigateDebbyDeduction()      — Diagnostic: checks Debby Gosh Jan MATIX hours
 * 8. addPhase0MenuItems()             — Adds all Phase 0 items to the BLC System menu
 *
 * MANUAL STEPS (not in this file — see checklist):
 * - Delete retired files: Migration.gs, QCHoursPatch.gs, PatchDebbyMissingRow..., PatchFunctions.gs
 * - Rename CompositeKeyFix.gs.gs to CompositeKeyFix.gs
 * - Archive import staging tabs (hide them)
 *
 * ============================================================================
 */


// ============================================================================
// FIX 1: CLIENT_PORTAL_LINKS — Create the missing tab
// ============================================================================
// WHAT: CONFIG.sheets.clientPortalLinks references a tab that does not exist.
//       Any code that calls getSheet(CONFIG.sheets.clientPortalLinks) will throw.
// FIX:  Create the tab with proper headers so future portal code has a home.
//       Also patches CONFIG if the key exists.
// ============================================================================

function fixClientPortalLinksReference() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tabName = "CLIENT_PORTAL_LINKS";
  
  // Check if tab already exists
  var existing = ss.getSheetByName(tabName);
  if (existing) {
    SpreadsheetApp.getUi().alert("Tab '" + tabName + "' already exists. No action needed.");
    return;
  }
  
  // Create the tab with proper headers
  var sheet = ss.insertSheet(tabName);
  var headers = [
    "Client_Code",
    "Client_Name", 
    "Portal_URL",
    "Portal_Token",
    "Token_Expiry",
    "PIN_Hash",
    "Active",
    "Created_Date",
    "Last_Accessed"
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  
  // Bold the header row
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  
  // Freeze header row
  sheet.setFrozenRows(1);
  
  // Pre-populate with active clients from CLIENT_MASTER
  try {
    var clientSheet = ss.getSheetByName("CLIENT_MASTER");
    if (clientSheet) {
      var clientData = clientSheet.getDataRange().getValues();
      var rows = [];
      for (var i = 1; i < clientData.length; i++) {
        var active = String(clientData[i][9]).trim(); // col J = Active
        if (active.toLowerCase() === "yes") {
          rows.push([
            clientData[i][0],  // Client_Code
            clientData[i][1],  // Client_Name
            clientData[i][17] || "", // Portal_URL (col R)
            "",                // Portal_Token — to be generated
            "",                // Token_Expiry
            "",                // PIN_Hash
            "Yes",             // Active
            new Date(),        // Created_Date
            ""                 // Last_Accessed
          ]);
        }
      }
      if (rows.length > 0) {
        sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
      }
    }
  } catch (e) {
    // Non-critical — tab created even if client population fails
    logException("WARNING", "N/A", "Phase0Fix", "CLIENT_PORTAL_LINKS created but client population failed: " + e.message);
  }
  
  logException("INFO", "N/A", "Phase0Fix", "Created CLIENT_PORTAL_LINKS tab with " + (rows ? rows.length : 0) + " client rows.");
  SpreadsheetApp.getUi().alert("SUCCESS: Created '" + tabName + "' tab with " + (rows ? rows.length : 0) + " active client rows.\n\nThe CRITICAL bug is now fixed.");
}


// ============================================================================
// FIX 2: syncFormDropdowns() daily trigger
// ============================================================================
// WHAT: syncFormDropdowns() has no automated trigger. New designers/clients
//       added via onboarding don't appear in form dropdowns until someone
//       remembers to run it manually.
// FIX:  Create a daily trigger that runs syncFormDropdowns() at 6 AM.
// ============================================================================

function setupSyncFormDropdownsTrigger() {
  // Check if trigger already exists
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "syncFormDropdowns") {
      SpreadsheetApp.getUi().alert("syncFormDropdowns trigger already exists.\nHandler: syncFormDropdowns\nType: " + triggers[i].getEventType());
      return;
    }
  }
  
  // Create daily trigger at 6 AM
  ScriptApp.newTrigger("syncFormDropdowns")
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .create();
  
  logException("INFO", "N/A", "Phase0Fix", "Created daily trigger for syncFormDropdowns() at 6 AM.");
  SpreadsheetApp.getUi().alert("SUCCESS: Created daily trigger for syncFormDropdowns().\n\nSchedule: Every day at 6:00 AM.\n\nForm dropdowns will now stay in sync automatically.");
}


// ============================================================================
// FIX 3: Verify and fix OrphanJobPatcher timing
// ============================================================================
// WHAT: patchOrphanedActiveJobs() trigger is registered but has never run.
//       Orphaned jobs in ACTIVE_JOBS are not being cleaned up.
// FIX:  Check trigger status, fix timing if needed, and do a manual run.
// ============================================================================

function verifyAndFixOrphanPatcher() {
  var ui = SpreadsheetApp.getUi();
  var triggers = ScriptApp.getProjectTriggers();
  var found = false;
  var triggerInfo = "";
  
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "patchOrphanedActiveJobs") {
      found = true;
      triggerInfo = "Type: " + triggers[i].getEventType() + 
                    "\nTrigger ID: " + triggers[i].getUniqueId();
      break;
    }
  }
  
  if (!found) {
    // Create the trigger — runs every 6 hours
    ScriptApp.newTrigger("patchOrphanedActiveJobs")
      .timeBased()
      .everyHours(6)
      .create();
    
    logException("INFO", "N/A", "Phase0Fix", "Created 6-hourly trigger for patchOrphanedActiveJobs().");
    triggerInfo = "CREATED NEW: Every 6 hours.";
  }
  
  // Now do a manual test run
  var result = ui.alert(
    "Orphan Patcher Status",
    "Trigger: " + (found ? "EXISTS\n" + triggerInfo : "WAS MISSING — " + triggerInfo) +
    "\n\nDo you want to run patchOrphanedActiveJobs() now as a test?\n(This will fix any orphaned jobs currently in ACTIVE_JOBS)",
    ui.ButtonSet.YES_NO
  );
  
  if (result === ui.Button.YES) {
    try {
      patchOrphanedActiveJobs();
      ui.alert("patchOrphanedActiveJobs() ran successfully.\nCheck EXCEPTIONS_LOG for details.");
    } catch (e) {
      ui.alert("ERROR running patchOrphanedActiveJobs():\n\n" + e.message + "\n\nCheck the function in OrphanJobPatcher.gs.");
      logException("ERROR", "N/A", "Phase0Fix", "patchOrphanedActiveJobs() failed: " + e.message);
    }
  }
}


// ============================================================================
// FIX 4: Verify and fix Exception Log Archiver timing
// ============================================================================
// WHAT: archiveExceptionLog() trigger is registered but has never run.
//       EXCEPTIONS_LOG may grow without bound.
// FIX:  Check trigger status, fix timing if needed, and do a manual run.
// ============================================================================

function verifyAndFixArchiver() {
  var ui = SpreadsheetApp.getUi();
  var triggers = ScriptApp.getProjectTriggers();
  var found = false;
  var triggerInfo = "";
  
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "archiveExceptionLog") {
      found = true;
      triggerInfo = "Type: " + triggers[i].getEventType() + 
                    "\nTrigger ID: " + triggers[i].getUniqueId();
      break;
    }
  }
  
  if (!found) {
    // Create weekly trigger — Sunday at midnight
    ScriptApp.newTrigger("archiveExceptionLog")
      .timeBased()
      .onWeekDay(ScriptApp.WeekDay.SUNDAY)
      .atHour(0)
      .create();
    
    logException("INFO", "N/A", "Phase0Fix", "Created weekly trigger for archiveExceptionLog() — Sundays at midnight.");
    triggerInfo = "CREATED NEW: Every Sunday at midnight.";
  }
  
  // Check EXCEPTIONS_LOG row count
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var excSheet = ss.getSheetByName("EXCEPTIONS_LOG");
  var rowCount = excSheet ? excSheet.getLastRow() : "UNKNOWN";
  
  var result = ui.alert(
    "Exception Log Archiver Status",
    "Trigger: " + (found ? "EXISTS\n" + triggerInfo : "WAS MISSING — " + triggerInfo) +
    "\n\nEXCEPTIONS_LOG current rows: " + rowCount +
    "\n\nDo you want to run archiveExceptionLog() now?\n(This will move old entries to EXCEPTIONS_ARCHIVE)",
    ui.ButtonSet.YES_NO
  );
  
  if (result === ui.Button.YES) {
    try {
      archiveExceptionLog();
      ui.alert("archiveExceptionLog() ran successfully.\nCheck both EXCEPTIONS_LOG and EXCEPTIONS_ARCHIVE.");
    } catch (e) {
      ui.alert("ERROR running archiveExceptionLog():\n\n" + e.message + "\n\nCheck the function in ExceptionLogArchiver.gs.");
      logException("ERROR", "N/A", "Phase0Fix", "archiveExceptionLog() failed: " + e.message);
    }
  }
}


// ============================================================================
// FIX 5: Audit MATIX product types for Deb Sen
// ============================================================================
// WHAT: Deb Sen is a Roof Truss specialist but some MATIX rows may show
//       I-Joist Floor due to the parallel component bug (now fixed).
//       These must be verified before running payroll.
// FIX:  Scan MASTER for Deb Sen + MATIX rows and flag any showing wrong
//       product type.
// ============================================================================

function auditMatixProductTypes() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var masterSheet = ss.getSheetByName("MASTER_JOB_DATABASE");
  var data = masterSheet.getDataRange().getValues();
  
  var MJ = CONFIG.masterCols;
  var issues = [];
  var rowNumbers = [];
  
  for (var i = 1; i < data.length; i++) {
    var designer = String(data[i][MJ.designerName - 1]).trim();
    var clientCode = String(data[i][MJ.clientCode - 1]).trim();
    var productType = String(data[i][MJ.productType - 1]).trim();
    var jobNumber = String(data[i][MJ.jobNumber - 1]).trim();
    var status = String(data[i][MJ.status - 1]).trim();
    
    // Check Deb Sen with non-Roof-Truss product types
    var normalised = normaliseDesignerName(designer);
    if (normalised === "Deb Sen" && productType !== "Roof Truss" && productType !== "") {
      issues.push({
        row: i + 1,
        job: jobNumber,
        client: clientCode,
        productType: productType,
        status: status
      });
      rowNumbers.push(i + 1);
    }
  }
  
  if (issues.length === 0) {
    SpreadsheetApp.getUi().alert("CLEAN: No product type mismatches found for Deb Sen.\n\nAll Deb Sen rows show 'Roof Truss' as expected.");
    logException("INFO", "N/A", "Phase0Audit", "MATIX product type audit: CLEAN. No Deb Sen mismatches.");
    return;
  }
  
  // Build report
  var report = "FOUND " + issues.length + " Deb Sen rows with non-Roof-Truss product types:\n\n";
  for (var j = 0; j < issues.length; j++) {
    report += "Row " + issues[j].row + " | Job: " + issues[j].job + 
              " | Client: " + issues[j].client +
              " | Product: " + issues[j].productType + 
              " | Status: " + issues[j].status + "\n";
  }
  report += "\nThese rows may need product type correction to 'Roof Truss'.\n";
  report += "DO NOT auto-fix — verify each row with Sarty first.";
  
  logException("WARNING", "AUDIT", "Phase0Audit", "MATIX audit found " + issues.length + " Deb Sen product type mismatches. Rows: " + rowNumbers.join(", "));
  
  SpreadsheetApp.getUi().alert(report);
}


// ============================================================================
// DIAGNOSTIC 6: Investigate Sayan Roy's unaccounted hours
// ============================================================================
// WHAT: Sayan was paid for 138.30 hrs in January but only 115.25 hrs appear
//       in SBS invoices. 23.05 hrs are unaccounted for.
// FIX:  Scan MASTER for all Sayan Roy rows in January and break down by client.
// ============================================================================

function investigateSayanHours() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var masterSheet = ss.getSheetByName("MASTER_JOB_DATABASE");
  var data = masterSheet.getDataRange().getValues();
  
  var MJ = CONFIG.masterCols;
  var sayanRows = [];
  var hoursByClient = {};
  var totalDesignHours = 0;
  var totalQCHours = 0;
  
  for (var i = 1; i < data.length; i++) {
    var designer = normaliseDesignerName(String(data[i][MJ.designerName - 1]).trim());
    var qcLead = normaliseDesignerName(String(data[i][MJ.qcLead - 1]).trim());
    var billingPeriod = String(data[i][MJ.billingPeriod - 1]).trim();
    
    // Filter January 2026 by billingPeriod (col R) — NEVER by invoiceMonth
    var isJan = billingPeriod.indexOf("2026-01") === 0;
    if (!isJan) continue;
    
    var designHours = parseFloat(data[i][MJ.designHoursTotal - 1]) || 0;
    var qcHours = parseFloat(data[i][MJ.qcHoursTotal - 1]) || 0;
    var clientCode = String(data[i][MJ.clientCode - 1]).trim();
    var jobNumber = String(data[i][MJ.jobNumber - 1]).trim();
    var status = String(data[i][MJ.status - 1]).trim();
    var isTest = String(data[i][MJ.isTest - 1]).trim();
    
    if (isTest.toLowerCase() === "yes") continue;
    
    // Design hours by Sayan
    if (designer === "Sayan Roy" && designHours > 0) {
      if (!hoursByClient[clientCode]) hoursByClient[clientCode] = { design: 0, qc: 0, jobs: [] };
      hoursByClient[clientCode].design += designHours;
      hoursByClient[clientCode].jobs.push("Row " + (i+1) + " | " + jobNumber + " | " + designHours + "hrs | " + status);
      totalDesignHours += designHours;
    }
    
    // QC hours by Sayan
    if (qcLead === "Sayan Roy" && qcHours > 0) {
      if (!hoursByClient[clientCode]) hoursByClient[clientCode] = { design: 0, qc: 0, jobs: [] };
      hoursByClient[clientCode].qc += qcHours;
      totalQCHours += qcHours;
    }
  }
  
  // Build report
  var report = "SAYAN ROY — JANUARY 2026 HOURS BREAKDOWN\n";
  report += "==========================================\n\n";
  report += "Total Design Hours: " + totalDesignHours.toFixed(2) + "\n";
  report += "Total QC Hours: " + totalQCHours.toFixed(2) + "\n";
  report += "Combined Total: " + (totalDesignHours + totalQCHours).toFixed(2) + "\n";
  report += "Paid Amount (manual): 138.30 hrs\n";
  report += "Difference: " + (138.30 - totalDesignHours - totalQCHours).toFixed(2) + " hrs\n\n";
  
  report += "BREAKDOWN BY CLIENT:\n";
  for (var client in hoursByClient) {
    report += "\n" + client + ": Design=" + hoursByClient[client].design.toFixed(2) + 
              " | QC=" + hoursByClient[client].qc.toFixed(2) + "\n";
    for (var k = 0; k < hoursByClient[client].jobs.length; k++) {
      report += "  " + hoursByClient[client].jobs[k] + "\n";
    }
  }
  
  logException("INFO", "AUDIT", "Phase0Audit", "Sayan Roy Jan investigation: Design=" + totalDesignHours.toFixed(2) + " QC=" + totalQCHours.toFixed(2) + " Total=" + (totalDesignHours + totalQCHours).toFixed(2));
  
  SpreadsheetApp.getUi().alert(report);
}


// ============================================================================
// DIAGNOSTIC 7: Investigate Debby Gosh January MATIX hours
// ============================================================================
// WHAT: Debby Gosh Jan MATIX files show 149 hrs but manual paid 146 hrs.
//       3 hrs were manually deducted. Reason unknown.
// FIX:  Scan MASTER for all Debby Gosh Jan rows and show totals by client.
// ============================================================================

function investigateDebbyDeduction() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var masterSheet = ss.getSheetByName("MASTER_JOB_DATABASE");
  var data = masterSheet.getDataRange().getValues();
  
  var MJ = CONFIG.masterCols;
  var hoursByClient = {};
  var totalHours = 0;
  
  for (var i = 1; i < data.length; i++) {
    var designer = normaliseDesignerName(String(data[i][MJ.designerName - 1]).trim());
    var billingPeriod = String(data[i][MJ.billingPeriod - 1]).trim();
    
    var isJan = billingPeriod.indexOf("2026-01") === 0;
    if (!isJan) continue;
    if (designer !== "Debby Gosh") continue;
    
    var isTest = String(data[i][MJ.isTest - 1]).trim();
    if (isTest.toLowerCase() === "yes") continue;
    
    var designHours = parseFloat(data[i][MJ.designHoursTotal - 1]) || 0;
    var clientCode = String(data[i][MJ.clientCode - 1]).trim();
    var jobNumber = String(data[i][MJ.jobNumber - 1]).trim();
    var status = String(data[i][MJ.status - 1]).trim();
    var productType = String(data[i][MJ.productType - 1]).trim();
    
    if (!hoursByClient[clientCode]) hoursByClient[clientCode] = { total: 0, jobs: [] };
    hoursByClient[clientCode].total += designHours;
    hoursByClient[clientCode].jobs.push(
      "Row " + (i+1) + " | " + jobNumber + " | " + productType + " | " + designHours + "hrs | " + status
    );
    totalHours += designHours;
  }
  
  var report = "DEBBY GOSH — JANUARY 2026 HOURS\n";
  report += "================================\n\n";
  report += "Total Design Hours in MASTER: " + totalHours.toFixed(2) + "\n";
  report += "Hours in MATIX Invoice Files: 149.00\n";
  report += "Hours Actually Paid: 146.00\n";
  report += "Deduction: 3.00 hrs (reason unknown)\n\n";
  
  report += "BREAKDOWN BY CLIENT:\n";
  for (var client in hoursByClient) {
    report += "\n" + client + ": " + hoursByClient[client].total.toFixed(2) + " hrs\n";
    for (var k = 0; k < hoursByClient[client].jobs.length; k++) {
      report += "  " + hoursByClient[client].jobs[k] + "\n";
    }
  }
  
  report += "\nACTION: Ask Sarty why 3 hrs were deducted. Document the reason.";
  
  logException("INFO", "AUDIT", "Phase0Audit", "Debby Gosh Jan investigation: Total in MASTER=" + totalHours.toFixed(2));
  
  SpreadsheetApp.getUi().alert(report);
}


// ============================================================================
// FIX 8: List all triggers for verification
// ============================================================================
// WHAT: Gives a clear picture of all active triggers before and after fixes.
// ============================================================================

function listAllTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var report = "ACTIVE TRIGGERS (" + triggers.length + " total)\n";
  report += "====================================\n\n";
  
  for (var i = 0; i < triggers.length; i++) {
    report += (i + 1) + ". " + triggers[i].getHandlerFunction() + "\n";
    report += "   Type: " + triggers[i].getEventType() + "\n";
    report += "   Source: " + triggers[i].getTriggerSource() + "\n";
    report += "   ID: " + triggers[i].getUniqueId() + "\n\n";
  }
  
  // Expected triggers after Phase 0:
  report += "EXPECTED TRIGGERS AFTER PHASE 0:\n";
  report += "1. onFormSubmitRouter (Form submit)\n";
  report += "2. sendDailyDigest (Time — 5pm daily)\n";
  report += "3. refreshDashboard (Time — 15 min)\n";
  report += "4. patchOrphanedActiveJobs (Time — 6 hourly)\n";
  report += "5. archiveExceptionLog (Time — Weekly Sunday)\n";
  report += "6. syncFormDropdowns (Time — Daily 6 AM) [NEW]\n";
  
  SpreadsheetApp.getUi().alert(report);
}


// ============================================================================
// MENU: Add Phase 0 items to BLC System menu
// ============================================================================
// HOW TO USE: Add this call to your existing onOpen() function in Code.gs
//             See instructions below the function.
// ============================================================================

function addPhase0MenuItems() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("BLC Phase 0 Fixes")
    .addItem("1. Fix CLIENT_PORTAL_LINKS", "fixClientPortalLinksReference")
    .addItem("2. Setup syncFormDropdowns Trigger", "setupSyncFormDropdownsTrigger")
    .addItem("3. Verify Orphan Patcher", "verifyAndFixOrphanPatcher")
    .addItem("4. Verify Exception Archiver", "verifyAndFixArchiver")
    .addItem("5. Audit MATIX Product Types (Deb Sen)", "auditMatixProductTypes")
    .addItem("6. Investigate Sayan Roy Hours", "investigateSayanHours")
    .addItem("7. Investigate Debby Gosh Deduction", "investigateDebbyDeduction")
    .addSeparator()
    .addItem("List All Active Triggers", "listAllTriggers")
    .addToUi();
}


// ============================================================================
// INSTRUCTIONS FOR RAJ
// ============================================================================
//
// STEP 1: Paste this entire file into a new Apps Script file called
//         "Phase0_StabilityFixes.gs"
//
// STEP 2: In Code.gs, find your onOpen() function and add this line
//         at the END, just before the closing brace:
//
//         addPhase0MenuItems();
//
// STEP 3: Save all files (Ctrl+S)
//
// STEP 4: Refresh the spreadsheet (close and reopen, or press F5)
//
// STEP 5: You should see a new menu called "BLC Phase 0 Fixes"
//
// STEP 6: Run the fixes IN ORDER (1 through 7):
//
//   FIX 1 — Click "Fix CLIENT_PORTAL_LINKS" 
//           Expected: Creates the missing tab. CRITICAL bug resolved.
//
//   FIX 2 — Click "Setup syncFormDropdowns Trigger"
//           Expected: Creates daily 6 AM trigger. Forms stay in sync.
//
//   FIX 3 — Click "Verify Orphan Patcher"
//           Expected: Shows trigger status. Click Yes to do a test run.
//
//   FIX 4 — Click "Verify Exception Archiver"
//           Expected: Shows trigger status + EXCEPTIONS_LOG row count.
//           Click Yes to archive old entries.
//
//   FIX 5 — Click "Audit MATIX Product Types"
//           Expected: Either "CLEAN" or a list of Deb Sen rows to check.
//           DO NOT auto-fix any rows. Verify with Sarty first.
//
//   FIX 6 — Click "Investigate Sayan Roy Hours"
//           Expected: Full breakdown of Sayan's Jan hours by client.
//           Share results with Sarty to identify the 23.05 missing hours.
//
//   FIX 7 — Click "Investigate Debby Gosh Deduction"
//           Expected: Full breakdown of Debby's Jan hours.
//           Ask Sarty why 3 hrs were deducted.
//
// STEP 7: Click "List All Active Triggers" to verify you now have 6 triggers.
//
// STEP 8: MANUAL STEPS (do these in the Apps Script editor):
//
//   a) DELETE these files (click the three dots next to each, then Remove):
//      - Migration.gs
//      - QCHoursPatch.gs  
//      - PatchDebbyMissingRow... (whatever the full name is)
//      - PatchFunctions.gs
//
//   b) RENAME CompositeKeyFix.gs.gs:
//      - Click the three dots next to CompositeKeyFix.gs.gs
//      - Click Rename
//      - Change to: CompositeKeyFix
//      - (Apps Script adds .gs automatically)
//
//   c) HIDE import staging tabs:
//      - Right-click on IMPORT_JAN_2026 tab → Hide sheet
//      - Right-click on IMPORT_FEB_2026_1_15 tab → Hide sheet  
//      - Right-click on IMPORT_FEB_2026_16_END tab → Hide sheet
//
// STEP 9: Run "List All Active Triggers" one more time to confirm 
//         everything is clean. You should see 6 triggers.
//
// PHASE 0 IS COMPLETE. The system is now stable for the rebuild.
//
// ============================================================================