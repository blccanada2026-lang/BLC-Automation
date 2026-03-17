// ============================================================
// OrphanJobPatcher.gs — V2
// Blue Lotus Consulting Corporation
// 
// PURPOSE: Two-way cleanup of ACTIVE_JOBS vs MASTER_JOB_DATABASE
//
// DIRECTION 1 — ORPHAN RECOVERY:
//   Finds jobs in ACTIVE_JOBS that are missing from MASTER
//   and creates the missing MASTER rows. This fixes silent
//   appendRow() failures during onJobStartSubmit().
//
// DIRECTION 2 — STALE REMOVAL:
//   Finds jobs in ACTIVE_JOBS that are already Completed/Billed
//   in MASTER and removes them from ACTIVE_JOBS. This fixes
//   cases where removeCompletedFromActiveJobs() failed or was
//   skipped during QC completion.
//
// TRIGGER: Daily at 6am Saskatchewan time
// MENU:    BLC System → Patch Orphaned Jobs
//
// REPLACES: Previous OrphanJobPatcher.gs (single-direction only)
//
// CHANGES FROM V1:
// 1. Added Direction 2 (stale removal) — was completely missing
// 2. Reads productType from ACTIVE_JOBS when available
// 3. Handles variable ACTIVE_JOBS column widths (6-col and 10-col rows)
// 4. Normalises designer names on patched rows
// 5. Safe for both trigger (headless) and menu (UI) execution
//
// Created: March 14, 2026
// ============================================================

function patchOrphanedActiveJobs() {
  var FUNCTION_NAME = "patchOrphanedActiveJobs";

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var activeSheet = ss.getSheetByName(CONFIG.sheets.activeJobs);
    var masterSheet = ss.getSheetByName(CONFIG.sheets.masterJob);

    if (!activeSheet || !masterSheet) {
      Logger.log("ERROR: Cannot find ACTIVE_JOBS or MASTER_JOB_DATABASE");
      logException("ERROR", "SYSTEM", FUNCTION_NAME, "Required sheets not found. Aborting.");
      return;
    }

    var activeData = activeSheet.getDataRange().getValues();
    var masterData = masterSheet.getDataRange().getValues();

    if (activeData.length <= 1) {
      Logger.log("ACTIVE_JOBS is empty (header only). Nothing to patch.");
      return;
    }

    // ── Build a lookup of all MASTER job numbers + statuses ────
    // This avoids calling findJobRow() per row (which reads MASTER each time)
    var masterLookup = {}; // { "JOBNUMBER": { row: sheetRow, status: "...", productType: "..." } }
    var MJ = CONFIG.masterCols;

    for (var m = 1; m < masterData.length; m++) {
      var mJob = String(masterData[m][MJ.jobNumber - 1] || "").trim().toUpperCase();
      if (!mJob) continue;
      var mStatus = String(masterData[m][MJ.status - 1] || "").trim();
      var mProduct = String(masterData[m][MJ.productType - 1] || "").trim();

      // Keep the LAST (most recent) row for each job number
      // This matches findJobRow() behavior which returns the latest live row
      masterLookup[mJob] = {
        row: m + 1,
        status: mStatus,
        productType: mProduct
      };
    }

    // ── DIRECTION 1: Find orphans (in ACTIVE but missing from MASTER) ──
    // ── DIRECTION 2: Find stale (in ACTIVE but Completed/Billed in MASTER) ──

    var terminalStatuses = ["Completed - Billable", "Billed"];
    var orphansFixed = 0;
    var staleRemoved = 0;
    var alreadyOk = 0;
    var rowsToDelete = []; // Collect row indices to delete (Direction 2)

    for (var i = activeData.length - 1; i >= 1; i--) {
      // ACTIVE_JOBS has variable column widths:
      // Code.gs writes 6 cols: [jobNumber, clientName, designer, status, date, expected]
      // AllocationSystem.gs writes 10 cols: [jobNumber, clientCode, clientName, designer, productType, status, allocDate, expected, timestamp, source]
      //
      // Job number is ALWAYS col A (index 0) regardless of format.
      // We read other fields defensively based on column count.

      var rowCols = activeData[i].length;
      var jobNumber = String(activeData[i][0] || "").trim();

      if (!jobNumber) continue;

      var jobKey = jobNumber.toUpperCase();
      var masterEntry = masterLookup[jobKey];

      if (!masterEntry) {
        // ── DIRECTION 1: Job is in ACTIVE but missing from MASTER ──
        // Create the missing MASTER row.

        // Read fields from ACTIVE_JOBS defensively
        var clientName, designer, status, timestamp, expected, productType;

        if (rowCols >= 10) {
          // 10-col format (AllocationSystem)
          clientName  = String(activeData[i][2] || "").trim();
          designer    = String(activeData[i][3] || "").trim();
          productType = String(activeData[i][4] || "").trim();
          status      = String(activeData[i][5] || "").trim();
          timestamp   = activeData[i][6] || new Date();
          expected    = activeData[i][7] || "";
        } else {
          // 6-col format (Code.gs)
          clientName  = String(activeData[i][1] || "").trim();
          designer    = String(activeData[i][2] || "").trim();
          status      = String(activeData[i][3] || "").trim();
          timestamp   = activeData[i][4] || new Date();
          expected    = activeData[i][5] || "";
          productType = ""; // Not available in 6-col format
        }

        // Normalise designer name
        designer = normaliseDesignerName(designer);

        // Look up client code
        var clientCode = getClientCode(clientName);

        // Guard: If client name resolved to UNKNOWN, log and skip
        // (known bug — UNKNOWN client causes silent failures downstream)
        if (clientCode === "UNKNOWN" && clientName !== "UNKNOWN") {
          logException("WARNING", jobNumber, FUNCTION_NAME,
            "Client name '" + clientName + "' resolved to UNKNOWN. " +
            "Cannot create MASTER row without valid client code. " +
            "Fix CLIENT_MASTER and re-run.");
          continue;
        }

        var newRow = new Array(36).fill("");
        newRow[MJ.jobNumber - 1]          = jobNumber;
        newRow[MJ.clientCode - 1]         = clientCode;
        newRow[MJ.clientName - 1]         = clientName;
        newRow[MJ.designerName - 1]       = designer;
        newRow[MJ.productType - 1]        = productType;
        newRow[MJ.allocatedDate - 1]      = timestamp;
        newRow[MJ.startDate - 1]          = timestamp;
        newRow[MJ.expectedCompletion - 1] = expected;
        newRow[MJ.status - 1]             = status || CONFIG.status.pickedUp;
        newRow[MJ.designHoursTotal - 1]   = 0;
        newRow[MJ.qcHoursTotal - 1]       = 0;
        newRow[MJ.totalBillableHours - 1] = 0;
        newRow[MJ.reworkHoursMajor - 1]   = 0;
        newRow[MJ.reworkHoursMinor - 1]   = 0;
        newRow[MJ.reallocationFlag - 1]   = "No";
        newRow[MJ.reworkFlag - 1]         = "No";
        newRow[MJ.reworkCount - 1]        = 0;
        newRow[MJ.onHoldFlag - 1]         = "No";
        newRow[MJ.lastUpdated - 1]        = getTimestamp();
        newRow[MJ.lastUpdatedBy - 1]      = FUNCTION_NAME;
        newRow[MJ.rowId - 1]              = Utilities.getUuid();
        newRow[MJ.isTest - 1]             = (jobNumber.indexOf("TEST-") === 0) ? "Yes" : "No";
        newRow[MJ.isImported - 1]         = "No";

        masterSheet.appendRow(newRow);
        orphansFixed++;

        logException("WARNING", jobNumber, FUNCTION_NAME,
          "ORPHAN FIXED: Job was in ACTIVE_JOBS but missing from MASTER. " +
          "Row created. Designer: " + designer + " | Client: " + clientName +
          " | Product: " + (productType || "(unknown)"));

      } else if (terminalStatuses.indexOf(masterEntry.status) !== -1) {
        // ── DIRECTION 2: Job exists in MASTER and is Completed/Billed ──
        // It should not be in ACTIVE_JOBS. Mark for deletion.
        rowsToDelete.push(i + 1); // 1-indexed sheet row
        staleRemoved++;

        logException("WARNING", jobNumber, FUNCTION_NAME,
          "STALE REMOVED: Job was in ACTIVE_JOBS but already '" +
          masterEntry.status + "' in MASTER. Removed from ACTIVE_JOBS.");

      } else {
        alreadyOk++;
      }
    }

    // ── Delete stale rows from ACTIVE_JOBS ──────────────────────
    // Delete from bottom to top so row indices don't shift
    if (rowsToDelete.length > 0) {
      // rowsToDelete is already in reverse order because we iterated backwards
      // But sort descending to be safe
      rowsToDelete.sort(function(a, b) { return b - a; });

      for (var d = 0; d < rowsToDelete.length; d++) {
        activeSheet.deleteRow(rowsToDelete[d]);
      }
      SpreadsheetApp.flush();
    }

    // ── Summary ─────────────────────────────────────────────────
    var summary = "Orphan Patcher complete. " +
      "Orphans fixed: " + orphansFixed +
      " | Stale removed: " + staleRemoved +
      " | Already OK: " + alreadyOk;

    Logger.log(summary);

    if (orphansFixed > 0 || staleRemoved > 0) {
      logException("WARNING", "SYSTEM", FUNCTION_NAME, summary);

      // Send alert email when patches are applied
      try {
        GmailApp.sendEmail(NOTIFICATION_EMAIL,
          "BLC | Orphan Patcher: " + orphansFixed + " fixed, " + staleRemoved + " stale removed",
          summary + "\n\nCheck EXCEPTIONS_LOG for details.\n\nBLC Job Management System",
          { name: "BLC Job System" });
      } catch (emailErr) {
        // Non-critical — log and continue
        Logger.log("Orphan patcher email failed: " + emailErr.message);
      }
    }

  } catch (err) {
    logException("ERROR", "SYSTEM", FUNCTION_NAME,
      "patchOrphanedActiveJobs crashed: " + err.message);
    Logger.log("ORPHAN PATCHER ERROR: " + err.message);
  }
}


// ============================================================
// SETUP TRIGGER — Run once to create the daily trigger
// Only needed if the trigger doesn't already exist.
// Check the Triggers page before running.
// ============================================================

function setupOrphanPatcherTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'patchOrphanedActiveJobs') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('patchOrphanedActiveJobs')
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .inTimezone('America/Regina')
    .create();

  Logger.log("Daily trigger set for patchOrphanedActiveJobs at 6am SK time");

  try {
    SpreadsheetApp.getUi().alert("✅ Daily trigger created.\nOrphan patcher runs every day at 6am SK time.");
  } catch (e) {
    // Running from trigger — no UI available
  }
}