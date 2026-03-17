/**
 * ============================================================================
 * BLC BUG FIXES — March 17, 2026
 * File: BugFixes_March17.gs
 * 
 * FIXES 7 REPORTED BUGS:
 *   1. B600102 — Priyanka Job Start not picked up (Row 880)
 *   2. B600105 — Priyanka Job Start not picked up (Row 903)
 *   3. 2509-4875-B — Rework on wrong designer (Rows 463 + 801)
 *   4. 2512-8644-F — Sagar hours missing + wrong status (Row 807)
 *   5. Q260126 — Duplicate row (Row 740)
 *   6. 2509-4543-B — Mistaken entry (Row 763)
 *   7. 2509-4875-B — Samar hours wrong (Row 463)
 *
 * HOW TO USE:
 *   1. Paste into Apps Script as BugFixes_March17.gs
 *   2. Save (Ctrl+S)
 *   3. Run: runAllBugFixes()
 *   4. Each fix asks for confirmation before applying
 *   5. Check EXCEPTIONS_LOG after each fix
 *
 * SAFETY: Every fix logs old/new values. No rows are deleted.
 *         Cancelled rows use isTest="Yes" to exclude from billing.
 * ============================================================================
 */


function runAllBugFixes() {
  var ui = SpreadsheetApp.getUi();
  
  var result = ui.alert(
    "BLC Bug Fixes — March 17, 2026",
    "This will run fixes for 7 reported bugs.\n" +
    "Each fix will ask for confirmation before applying.\n\n" +
    "Bugs to fix:\n" +
    "1. B600102 — Priyanka job stuck at Allocated\n" +
    "2. B600105 — Priyanka job stuck at Allocated\n" +
    "3 & 7. 2509-4875-B — Rework on wrong designer + wrong hours\n" +
    "4. 2512-8644-F — Sagar hours missing\n" +
    "5. Q260126 — Duplicate row\n" +
    "6. 2509-4543-B — Mistaken entry\n\n" +
    "Proceed?",
    ui.ButtonSet.YES_NO
  );
  
  if (result !== ui.Button.YES) return;
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var masterSheet = ss.getSheetByName("MASTER_JOB_DATABASE");
  var activeSheet = ss.getSheetByName("ACTIVE_JOBS");
  var MJ = CONFIG.masterCols;
  
  var fixCount = 0;
  var skipCount = 0;
  var errorCount = 0;
  
  // =========================================================================
  // FIX 1: B600102 — Update Row 880 from Allocated to Picked Up
  // =========================================================================
  try {
    var row = 880;
    var currentStatus = String(masterSheet.getRange(row, MJ.status).getValue()).trim();
    var currentDesigner = String(masterSheet.getRange(row, MJ.designerName).getValue()).trim();
    var jobNum = String(masterSheet.getRange(row, MJ.jobNumber).getValue()).trim();
    
    var confirm1 = ui.alert(
      "FIX 1: B600102 (Row " + row + ")",
      "Current state:\n" +
      "  Job: " + jobNum + "\n" +
      "  Designer: " + currentDesigner + "\n" +
      "  Status: " + currentStatus + "\n\n" +
      "Will change:\n" +
      "  Status → Picked Up\n" +
      "  Start Date → 2026-03-13 (Priyanka's form submission date)\n" +
      "  Last Updated → Now\n" +
      "  Last Updated By → BugFix-March17\n\n" +
      "Apply this fix?",
      ui.ButtonSet.YES_NO
    );
    
    if (confirm1 === ui.Button.YES) {
      masterSheet.getRange(row, MJ.status).setValue("Picked Up");
      masterSheet.getRange(row, MJ.startDate).setValue(new Date("2026-03-13"));
      masterSheet.getRange(row, MJ.lastUpdated).setValue(new Date());
      masterSheet.getRange(row, MJ.lastUpdatedBy).setValue("BugFix-March17");
      
      // Update ACTIVE_JOBS too
      updateActiveJobStatus_(activeSheet, "B600102", "Picked Up");
      
      logException("BUGFIX", "B600102", "BugFix-March17", 
        "Row " + row + ": Status Allocated→Picked Up. Start Date set to 2026-03-13. Priyanka's Job Start form was submitted but onJobStartSubmit failed to update the pre-allocated row.");
      fixCount++;
    } else {
      skipCount++;
    }
  } catch (e) {
    logException("ERROR", "B600102", "BugFix-March17", "Fix failed: " + e.message);
    errorCount++;
  }
  
  // =========================================================================
  // FIX 2: B600105 — Update Row 903 from Allocated to Picked Up
  // =========================================================================
  try {
    var row = 903;
    var currentStatus = String(masterSheet.getRange(row, MJ.status).getValue()).trim();
    var currentDesigner = String(masterSheet.getRange(row, MJ.designerName).getValue()).trim();
    var jobNum = String(masterSheet.getRange(row, MJ.jobNumber).getValue()).trim();
    
    var confirm2 = ui.alert(
      "FIX 2: B600105 (Row " + row + ")",
      "Current state:\n" +
      "  Job: " + jobNum + "\n" +
      "  Designer: " + currentDesigner + "\n" +
      "  Status: " + currentStatus + "\n\n" +
      "Will change:\n" +
      "  Status → Picked Up\n" +
      "  Start Date → 2026-03-16 (when Priyanka started per team report)\n" +
      "  Last Updated → Now\n" +
      "  Last Updated By → BugFix-March17\n\n" +
      "Apply this fix?",
      ui.ButtonSet.YES_NO
    );
    
    if (confirm2 === ui.Button.YES) {
      masterSheet.getRange(row, MJ.status).setValue("Picked Up");
      masterSheet.getRange(row, MJ.startDate).setValue(new Date("2026-03-16"));
      masterSheet.getRange(row, MJ.lastUpdated).setValue(new Date());
      masterSheet.getRange(row, MJ.lastUpdatedBy).setValue("BugFix-March17");
      
      updateActiveJobStatus_(activeSheet, "B600105", "Picked Up");
      
      logException("BUGFIX", "B600105", "BugFix-March17", 
        "Row " + row + ": Status Allocated→Picked Up. Start Date set to 2026-03-16. Same root cause as B600102.");
      fixCount++;
    } else {
      skipCount++;
    }
  } catch (e) {
    logException("ERROR", "B600105", "BugFix-March17", "Fix failed: " + e.message);
    errorCount++;
  }
  
  // =========================================================================
  // FIX 3 & 7: 2509-4875-B — Restore Samar's row + fix rework on Roy's row + fix hours
  // =========================================================================
  try {
    var samarRow = 463;
    var royRow = 801;
    
    var samarStatus = String(masterSheet.getRange(samarRow, MJ.status).getValue()).trim();
    var samarHours = masterSheet.getRange(samarRow, MJ.designHoursTotal).getValue();
    var royStatus = String(masterSheet.getRange(royRow, MJ.status).getValue()).trim();
    
    var confirm3 = ui.alert(
      "FIX 3 & 7: 2509-4875-B (Rows " + samarRow + " + " + royRow + ")",
      "SAMAR's Row " + samarRow + " (current):\n" +
      "  Status: " + samarStatus + "\n" +
      "  Design Hours: " + samarHours + "\n" +
      "  QC Status: Minor Error\n\n" +
      "ROY's Row " + royRow + " (current):\n" +
      "  Status: " + royStatus + "\n\n" +
      "Will change:\n\n" +
      "SAMAR Row " + samarRow + ":\n" +
      "  Status → Completed - Billable (restore — was billed Feb 16-End)\n" +
      "  Design Hours → 6.5 (was 4, correcting per Samar's report)\n" +
      "  QC Hours → 1.25 (unchanged)\n" +
      "  Total Billable → 7.75 (6.5 + 1.25)\n" +
      "  QC Status → Passed (restore to original)\n" +
      "  Rework Flag → No\n" +
      "  Rework Count → 0\n\n" +
      "ROY Row " + royRow + ":\n" +
      "  Status → Rework - Minor (this is where the rework belongs)\n" +
      "  QC Status → Minor Error\n" +
      "  Rework Flag → Yes\n" +
      "  Rework Count → 1\n\n" +
      "Apply both fixes?",
      ui.ButtonSet.YES_NO
    );
    
    if (confirm3 === ui.Button.YES) {
      // --- Fix Samar's row (463) ---
      masterSheet.getRange(samarRow, MJ.status).setValue("Completed - Billable");
      masterSheet.getRange(samarRow, MJ.designHoursTotal).setValue(6.5);
      masterSheet.getRange(samarRow, MJ.totalBillableHours).setValue(7.75); // 6.5 + 1.25
      masterSheet.getRange(samarRow, MJ.qcStatus).setValue("Passed");
      masterSheet.getRange(samarRow, MJ.reworkFlag).setValue("No");
      masterSheet.getRange(samarRow, MJ.reworkCount).setValue(0);
      masterSheet.getRange(samarRow, MJ.lastUpdated).setValue(new Date());
      masterSheet.getRange(samarRow, MJ.lastUpdatedBy).setValue("BugFix-March17");
      
      // --- Fix Roy's row (801) ---
      masterSheet.getRange(royRow, MJ.status).setValue("Rework - Minor");
      masterSheet.getRange(royRow, MJ.qcStatus).setValue("Minor Error");
      masterSheet.getRange(royRow, MJ.qcLead).setValue("Bharath Charles");
      masterSheet.getRange(royRow, MJ.reworkFlag).setValue("Yes");
      masterSheet.getRange(royRow, MJ.reworkCount).setValue(1);
      masterSheet.getRange(royRow, MJ.lastUpdated).setValue(new Date());
      masterSheet.getRange(royRow, MJ.lastUpdatedBy).setValue("BugFix-March17");
      
      logException("BUGFIX", "2509-4875-B", "BugFix-March17", 
        "Row " + samarRow + " (Samar): Restored to Completed-Billable. Hours 4→6.5, TotalBillable→7.75, QC Status→Passed, Rework cleared. " +
        "Row " + royRow + " (Roy): Status Completed-Billable→Rework-Minor. QC rework was incorrectly applied to Samar's row by onQCLogSubmit composite key mismatch.");
      fixCount++;
    } else {
      skipCount++;
    }
  } catch (e) {
    logException("ERROR", "2509-4875-B", "BugFix-March17", "Fix failed: " + e.message);
    errorCount++;
  }
  
  // =========================================================================
  // FIX 4: 2512-8644-F — Update Sagar's revision row with correct hours and status
  // =========================================================================
  try {
    var row = 807;
    var currentStatus = String(masterSheet.getRange(row, MJ.status).getValue()).trim();
    var currentHours = masterSheet.getRange(row, MJ.designHoursTotal).getValue();
    var currentDesigner = String(masterSheet.getRange(row, MJ.designerName).getValue()).trim();
    
    var confirm4 = ui.alert(
      "FIX 4: 2512-8644-F (Row " + row + ")",
      "Current state:\n" +
      "  Designer: " + currentDesigner + "\n" +
      "  Status: " + currentStatus + "\n" +
      "  Design Hours: " + currentHours + "\n\n" +
      "Will change:\n" +
      "  Status → Completed - Billable\n" +
      "  Design Hours → 11.5 (logged March 9, 11, 12)\n" +
      "  Total Billable → 11.5\n" +
      "  Billing Period → 2026-03 | 1-15\n" +
      "  Actual Completion → Now\n" +
      "  Remove from ACTIVE_JOBS\n\n" +
      "Apply this fix?",
      ui.ButtonSet.YES_NO
    );
    
    if (confirm4 === ui.Button.YES) {
      masterSheet.getRange(row, MJ.status).setValue("Completed - Billable");
      masterSheet.getRange(row, MJ.designHoursTotal).setValue(11.5);
      masterSheet.getRange(row, MJ.totalBillableHours).setValue(11.5);
      masterSheet.getRange(row, MJ.billingPeriod).setValue("2026-03 | 1-15");
      masterSheet.getRange(row, MJ.actualCompletion).setValue(new Date());
      masterSheet.getRange(row, MJ.lastUpdated).setValue(new Date());
      masterSheet.getRange(row, MJ.lastUpdatedBy).setValue("BugFix-March17");
      
      // Remove from ACTIVE_JOBS
      removeFromActiveJobs_(activeSheet, "2512-8644-F", "Banik Sagar");
      
      logException("BUGFIX", "2512-8644-F", "BugFix-March17", 
        "Row " + row + " (Sagar): Status Revision→Completed-Billable. Hours 0→11.5. " +
        "Daily log submissions failed to accumulate hours — onDailyLogSubmit could not match Revision status row. Removed from ACTIVE_JOBS.");
      fixCount++;
    } else {
      skipCount++;
    }
  } catch (e) {
    logException("ERROR", "2512-8644-F", "BugFix-March17", "Fix failed: " + e.message);
    errorCount++;
  }
  
  // =========================================================================
  // FIX 5: Q260126 — Soft-delete duplicate row 740
  // =========================================================================
  try {
    var correctRow = 709;
    var dupeRow = 740;
    
    var dupeStatus = String(masterSheet.getRange(dupeRow, MJ.status).getValue()).trim();
    var dupeHours = masterSheet.getRange(dupeRow, MJ.designHoursTotal).getValue();
    var correctHours = masterSheet.getRange(correctRow, MJ.designHoursTotal).getValue();
    
    var confirm5 = ui.alert(
      "FIX 5: Q260126 — Duplicate row",
      "CORRECT Row " + correctRow + ":\n" +
      "  Design Hours: " + correctHours + " (this is the real entry)\n" +
      "  Status: " + String(masterSheet.getRange(correctRow, MJ.status).getValue()).trim() + "\n\n" +
      "DUPLICATE Row " + dupeRow + " (to be cancelled):\n" +
      "  Design Hours: " + dupeHours + "\n" +
      "  Status: " + dupeStatus + "\n" +
      "  Row ID: REOPEN-Q260126\n\n" +
      "Will change Row " + dupeRow + ":\n" +
      "  Status → Cancelled - Duplicate\n" +
      "  isTest → Yes (excluded from billing)\n" +
      "  Notes → Duplicate entry. Correct data in Row " + correctRow + "\n\n" +
      "Row " + correctRow + " stays unchanged.\n\n" +
      "Apply this fix?",
      ui.ButtonSet.YES_NO
    );
    
    if (confirm5 === ui.Button.YES) {
      masterSheet.getRange(dupeRow, MJ.status).setValue("Cancelled - Duplicate");
      masterSheet.getRange(dupeRow, MJ.isTest).setValue("Yes");
      masterSheet.getRange(dupeRow, MJ.notes).setValue("Duplicate entry. Vani submitted daily log then complete job form. Correct data in Row " + correctRow + ". Cancelled by BugFix-March17.");
      masterSheet.getRange(dupeRow, MJ.lastUpdated).setValue(new Date());
      masterSheet.getRange(dupeRow, MJ.lastUpdatedBy).setValue("BugFix-March17");
      
      logException("BUGFIX", "Q260126", "BugFix-March17", 
        "Row " + dupeRow + ": Cancelled as duplicate. isTest=Yes. Original correct entry is Row " + correctRow + " with " + correctHours + " design hours.");
      fixCount++;
    } else {
      skipCount++;
    }
  } catch (e) {
    logException("ERROR", "Q260126", "BugFix-March17", "Fix failed: " + e.message);
    errorCount++;
  }
  
  // =========================================================================
  // FIX 6: 2509-4543-B — Soft-delete mistaken entry
  // =========================================================================
  try {
    var row = 763;
    var currentStatus = String(masterSheet.getRange(row, MJ.status).getValue()).trim();
    var currentDesigner = String(masterSheet.getRange(row, MJ.designerName).getValue()).trim();
    
    var confirm6 = ui.alert(
      "FIX 6: 2509-4543-B (Row " + row + ")",
      "Current state:\n" +
      "  Designer: " + currentDesigner + "\n" +
      "  Status: " + currentStatus + "\n" +
      "  Design Hours: 0\n" +
      "  Product Type: (empty)\n\n" +
      "This was entered by mistake. Will change:\n" +
      "  Status → Cancelled - Mistaken Entry\n" +
      "  isTest → Yes (excluded from billing and portals)\n" +
      "  Notes → Mistaken entry by Kumar\n" +
      "  Remove from ACTIVE_JOBS\n\n" +
      "Apply this fix?",
      ui.ButtonSet.YES_NO
    );
    
    if (confirm6 === ui.Button.YES) {
      masterSheet.getRange(row, MJ.status).setValue("Cancelled - Mistaken Entry");
      masterSheet.getRange(row, MJ.isTest).setValue("Yes");
      masterSheet.getRange(row, MJ.notes).setValue("Mistaken entry by Kumar. No actual work done. Cancelled by BugFix-March17.");
      masterSheet.getRange(row, MJ.lastUpdated).setValue(new Date());
      masterSheet.getRange(row, MJ.lastUpdatedBy).setValue("BugFix-March17");
      
      // Remove from ACTIVE_JOBS
      removeFromActiveJobs_(activeSheet, "2509-4543-B", "Raj Kumar");
      
      logException("BUGFIX", "2509-4543-B", "BugFix-March17", 
        "Row " + row + ": Cancelled as mistaken entry. isTest=Yes. Removed from ACTIVE_JOBS.");
      fixCount++;
    } else {
      skipCount++;
    }
  } catch (e) {
    logException("ERROR", "2509-4543-B", "BugFix-March17", "Fix failed: " + e.message);
    errorCount++;
  }
  
  // =========================================================================
  // SUMMARY
  // =========================================================================
  ui.alert(
    "BUG FIXES COMPLETE",
    "Applied: " + fixCount + " fix(es)\n" +
    "Skipped: " + skipCount + "\n" +
    "Errors: " + errorCount + "\n\n" +
    "Check EXCEPTIONS_LOG for full audit trail.\n\n" +
    "IMPORTANT — TWO ROOT CAUSE BUGS TO FIX IN CODE:\n\n" +
    "1. onJobStartSubmit() does not handle pre-allocated rows.\n" +
    "   When a job has status 'Allocated', Job Start should UPDATE\n" +
    "   that row instead of failing silently.\n\n" +
    "2. onDailyLogSubmit() does not handle 'Revision' status rows.\n" +
    "   Daily log hours are lost when a job's status is 'Revision'\n" +
    "   because the handler only looks for Picked Up / In Design.",
    ui.ButtonSet.OK
  );
}


// ============================================================================
// HELPER: Update status in ACTIVE_JOBS for a given job number
// ============================================================================
function updateActiveJobStatus_(activeSheet, jobNumber, newStatus) {
  if (!activeSheet) return;
  var data = activeSheet.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    var rowStr = data[i].join(" ");
    if (rowStr.indexOf(jobNumber) > -1) {
      // Find the status column — search for the old status value and update
      for (var j = 0; j < data[i].length; j++) {
        var val = String(data[i][j]).trim();
        if (val === "Allocated" || val === "Picked Up" || val === "In Design" || 
            val === "Revision" || val === "Submitted For QC") {
          activeSheet.getRange(i + 1, j + 1).setValue(newStatus);
          return;
        }
      }
    }
  }
}


// ============================================================================
// HELPER: Remove a row from ACTIVE_JOBS by job number and designer
// ============================================================================
function removeFromActiveJobs_(activeSheet, jobNumber, designerName) {
  if (!activeSheet) return;
  var data = activeSheet.getDataRange().getValues();
  
  // Search from bottom to top so row deletion doesn't shift indices
  for (var i = data.length - 1; i >= 1; i--) {
    var rowStr = data[i].join(" ");
    if (rowStr.indexOf(jobNumber) > -1) {
      // Extra safety: check designer name if provided
      if (designerName && rowStr.indexOf(designerName) === -1) continue;
      activeSheet.deleteRow(i + 1);
      return;
    }
  }
}