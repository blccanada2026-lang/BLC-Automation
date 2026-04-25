// ============================================================
// SHEET STRUCTURE AUDIT
// Reads every tab in the spreadsheet and writes a full report
// to a new SHEET_AUDIT tab: sheet name, row count, and every
// column header with its column letter and index.
// Run once from the BLC menu, then share / export the tab.
// ============================================================

function auditSheetStructure() {
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var sheets  = ss.getSheets();
  var auditName = "SHEET_AUDIT";

  // ── Create / clear the audit tab ─────────────────────────
  var audit = ss.getSheetByName(auditName);
  if (!audit) {
    audit = ss.insertSheet(auditName);
  } else {
    audit.clearContents();
    audit.clearFormats();
  }

  // ── Header row ───────────────────────────────────────────
  var headers = ["Tab Name", "Total Rows", "Total Columns",
                 "Col Index", "Col Letter", "Column Header"];
  audit.appendRow(headers);
  var hRange = audit.getRange(1, 1, 1, headers.length);
  hRange.setBackground("#1a73e8").setFontColor("#fff").setFontWeight("bold");
  audit.setFrozenRows(1);

  var colLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  function colLetter(n) { // 1-based
    var result = "";
    while (n > 0) {
      result = colLetters[(n - 1) % 26] + result;
      n = Math.floor((n - 1) / 26);
    }
    return result;
  }

  var totalRows = 0;

  // ── One block per sheet ──────────────────────────────────
  for (var s = 0; s < sheets.length; s++) {
    var sheet     = sheets[s];
    var sheetName = sheet.getName();

    // Skip the audit tab itself
    if (sheetName === auditName) continue;

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();

    if (lastRow === 0 || lastCol === 0) {
      // Empty sheet — still record it
      audit.appendRow([sheetName, 0, 0, "", "", "(empty sheet)"]);
      totalRows++;
      continue;
    }

    // Read header row (row 1)
    var headerVals = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

    for (var c = 0; c < headerVals.length; c++) {
      var headerText = String(headerVals[c] || "").trim();
      var colIdx     = c + 1;
      audit.appendRow([
        c === 0 ? sheetName      : "",   // Tab Name — only on first col row
        c === 0 ? lastRow - 1    : "",   // Data rows (excl header)
        c === 0 ? lastCol        : "",   // Total columns
        colIdx,                          // Column index (1-based)
        colLetter(colIdx),               // Column letter (A, B, AA…)
        headerText || "(blank header)"   // Header text
      ]);
      totalRows++;
    }

    // Shade alternating sheets for readability
    if (s % 2 === 0) {
      var startRow = totalRows - lastCol + 2; // +2 for header row
      try {
        audit.getRange(startRow, 1, lastCol, headers.length)
             .setBackground("#f8f9fa");
      } catch(e) { /* ignore range errors */ }
    }
  }

  // ── Auto-resize columns ──────────────────────────────────
  for (var col = 1; col <= headers.length; col++) {
    audit.autoResizeColumn(col);
  }

  // ── Move audit tab to far right ──────────────────────────
  ss.setActiveSheet(audit);
  ss.moveActiveSheet(ss.getNumSheets());

  SpreadsheetApp.getUi().alert(
    "✅ Sheet Audit Complete\n\n" +
    "Tab: SHEET_AUDIT\n" +
    "Sheets scanned: " + (sheets.length - 1) + "\n\n" +
    "Review the tab, then share it or export as CSV/PDF.\n" +
    "Use this to identify which columns are active vs can be cleaned up."
  );
}


// ============================================================
// FIX ACTIVE_JOBS HEADERS + MIGRATE EXISTING ROWS
// The sheet headers were out of sync with what the code writes.
// Correct column order (matches addToActiveJobsOnAllocation):
//   A  Job_Number
//   B  Client_Code
//   C  Client_Name
//   D  Designer_Name
//   E  Product_Type
//   F  Status
//   G  Allocated_Date
//   H  Expected_Completion
//   I  Last_Updated
//   J  Last_Updated_By
// Run once from menu — safe to re-run.
// ============================================================

function fixActiveJobsHeaders() {
  var ss          = SpreadsheetApp.getActiveSpreadsheet();
  var activeSheet = ss.getSheetByName(CONFIG.sheets.activeJobs);

  if (!activeSheet) {
    SpreadsheetApp.getUi().alert("❌ ACTIVE_JOBS sheet not found.");
    return;
  }

  var correctHeaders = [
    "Job_Number", "Client_Code", "Client_Name", "Designer_Name",
    "Product_Type", "Status", "Allocated_Date", "Expected_Completion",
    "Last_Updated", "Last_Updated_By"
  ];

  var lastRow = activeSheet.getLastRow();
  var lastCol = activeSheet.getLastColumn();

  // ── Ensure sheet has at least 10 columns ─────────────────
  if (lastCol < 10) {
    activeSheet.getRange(1, lastCol + 1, 1, 10 - lastCol)
               .setValues([new Array(10 - lastCol).fill("")]);
  }

  // ── Read all existing data (including header row) ─────────
  var allData = lastRow > 0
    ? activeSheet.getRange(1, 1, lastRow, Math.max(lastCol, 10)).getValues()
    : [];

  // ── Old header pattern (6 cols): Job_Number | Client_Name |
  //    Designer_Name | Status | Start_Date | Expected_Completion
  // New header pattern (10 cols): as above.
  // Detect which format each data row is in by checking col count.
  // Old rows have blank cols G-J; new rows have data in col B = clientCode.
  // Migration strategy: for old-format rows, shift cols B-F right by 1
  // and insert blank Client_Code at col B.

  var migratedRows = [];
  var migratedCount = 0;

  for (var i = 1; i < allData.length; i++) { // skip row 0 (header)
    var row = allData[i];
    var colB = String(row[1] || "").trim();
    var colF = String(row[5] || "").trim();

    // Detect old-format row: col B contains a name (not a client code),
    // col F is a date or empty, cols G-J are all blank.
    var colsGJBlank = !row[6] && !row[7] && !row[8] && !row[9];
    var colBLooksLikeName = colB.indexOf(" ") !== -1; // names have spaces, codes don't

    if (colsGJBlank && colBLooksLikeName) {
      // Old format: [Job, ClientName, DesignerName, Status, StartDate, ExpCompletion]
      // Migrate to: [Job, "", ClientName, DesignerName, "", Status, StartDate, ExpCompletion, "", "migrated"]
      var migrated = [
        row[0],  // Job_Number
        "",      // Client_Code (unknown for old rows)
        row[1],  // Client_Name
        row[2],  // Designer_Name
        "",      // Product_Type (unknown for old rows)
        row[3],  // Status
        row[4],  // Allocated_Date
        row[5],  // Expected_Completion
        new Date(),
        "migrated from old format"
      ];
      migratedRows.push(migrated);
      migratedCount++;
    } else {
      // Already new format or partial — keep as-is, pad to 10
      var kept = row.slice(0, 10);
      while (kept.length < 10) kept.push("");
      migratedRows.push(kept);
    }
  }

  // ── Rewrite the sheet ─────────────────────────────────────
  activeSheet.clearContents();

  // Header row
  activeSheet.getRange(1, 1, 1, correctHeaders.length)
             .setValues([correctHeaders]);
  activeSheet.getRange(1, 1, 1, correctHeaders.length)
             .setBackground("#1a73e8")
             .setFontColor("#fff")
             .setFontWeight("bold");
  activeSheet.setFrozenRows(1);

  // Data rows
  if (migratedRows.length > 0) {
    activeSheet.getRange(2, 1, migratedRows.length, 10)
               .setValues(migratedRows);
  }

  SpreadsheetApp.flush();

  SpreadsheetApp.getUi().alert(
    "✅ ACTIVE_JOBS headers fixed.\n\n" +
    "Total data rows: " + migratedRows.length + "\n" +
    "Rows migrated from old format: " + migratedCount + "\n\n" +
    "Column order is now:\n" +
    "A: Job_Number\n" +
    "B: Client_Code\n" +
    "C: Client_Name\n" +
    "D: Designer_Name\n" +
    "E: Product_Type\n" +
    "F: Status\n" +
    "G: Allocated_Date\n" +
    "H: Expected_Completion\n" +
    "I: Last_Updated\n" +
    "J: Last_Updated_By"
  );
}


// ============================================================
// EXPORT EXCEPTIONS ARCHIVE TO SEPARATE SHEET
// Copies EXCEPTIONS_ARCHIVE_BULK_2026_03_14 to a new Google
// Spreadsheet, then deletes the heavy tab from this workbook.
// Run once — creates a permanent archive file in your Drive.
// ============================================================

function exportAndDeleteExceptionsArchive() {
  var ARCHIVE_TAB = "EXCEPTIONS_ARCHIVE_BULK_2026_03_14";
  var ss          = SpreadsheetApp.getActiveSpreadsheet();
  var archiveSheet = ss.getSheetByName(ARCHIVE_TAB);
  var ui           = SpreadsheetApp.getUi();

  if (!archiveSheet) {
    ui.alert("Tab '" + ARCHIVE_TAB + "' not found — nothing to do.");
    return;
  }

  var rowCount = archiveSheet.getLastRow();
  var colCount = archiveSheet.getLastColumn();

  var confirm = ui.alert(
    "Export & Delete Exceptions Archive",
    "This will:\n" +
    "1. Copy " + rowCount + " rows to a new Google Sheet in your Drive\n" +
    "2. Delete the '" + ARCHIVE_TAB + "' tab from this workbook\n\n" +
    "The archive file will be named:\n" +
    "  BLC Exceptions Archive — 2026-03\n\n" +
    "Proceed?",
    ui.ButtonSet.YES_NO
  );

  if (confirm !== ui.Button.YES) return;

  // ── Copy data to new spreadsheet ──────────────────────────
  var newSS   = SpreadsheetApp.create("BLC Exceptions Archive — 2026-03");
  var newSheet = newSS.getActiveSheet();
  newSheet.setName("EXCEPTIONS_ARCHIVE");

  // Copy in batches of 500 rows (avoids timeout on 67K rows)
  var batchSize = 500;
  for (var startRow = 1; startRow <= rowCount; startRow += batchSize) {
    var numRows = Math.min(batchSize, rowCount - startRow + 1);
    var data    = archiveSheet.getRange(startRow, 1, numRows, colCount).getValues();
    newSheet.getRange(startRow, 1, numRows, colCount).setValues(data);
  }

  SpreadsheetApp.flush();

  var archiveUrl = newSS.getUrl();

  // ── Delete the heavy tab ──────────────────────────────────
  ss.deleteSheet(archiveSheet);

  ui.alert(
    "✅ Archive exported and tab deleted.\n\n" +
    "Archive file URL (save this!):\n" + archiveUrl + "\n\n" +
    "Rows exported: " + rowCount + "\n" +
    "Tab deleted: " + ARCHIVE_TAB
  );

  logException("INFO", "SYSTEM", "exportAndDeleteExceptionsArchive",
    "Archive exported to: " + archiveUrl + " | Rows: " + rowCount);
}


function diagnoseSyncIssue() {
  var cmData     = getSheetData(CONFIG.sheets.clientMaster);
  var masterData = getSheetData(CONFIG.sheets.masterJobDatabase);
  var MJ         = CONFIG.masterCols;
  var output     = [];

  output.push("CLIENT_MASTER rows found: " + (cmData.length - 1));
  output.push("MASTER rows found: " + (masterData.length - 1));
  output.push("---");

  // Check each client
  for (var i = 1; i < cmData.length; i++) {
    var clientCode = String(cmData[i][0]  || "").trim();
    var isActive   = String(cmData[i][9]  || "").trim();
    var formId     = String(cmData[i][15] || "").trim();

    output.push("Client row " + i + ": code='" + clientCode +
      "' active='" + isActive +
      "' formId='" + (formId ? formId.substring(0,10) + "..." : "BLANK") + "'");

    if (!clientCode || isActive !== "Yes" || !formId) {
      output.push("  ⚠️ SKIPPED — check values above");
      continue;
    }

    // Count matching completed jobs
    var matched = 0;
    for (var j = 1; j < masterData.length; j++) {
      var mClient = String(masterData[j][MJ.clientCode - 1] || "").trim();
      var mStatus = String(masterData[j][MJ.status     - 1] || "").trim();
      var mIsTest = String(masterData[j][MJ.isTest     - 1] || "").trim();
      if (mClient === clientCode &&
          mIsTest !== "Yes" &&
          (mStatus === CONFIG.status.completed || mStatus === "Billed")) {
        matched++;
      }
    }
    output.push("  Completed jobs found for " + clientCode + ": " + matched);
  }

  // Show first 3 completed rows from MASTER for spot check
  output.push("---");
  output.push("First 3 Completed rows in MASTER:");
  var count = 0;
  for (var k = 1; k < masterData.length && count < 3; k++) {
    var s = String(masterData[k][MJ.status - 1] || "").trim();
    if (s === CONFIG.status.completed || s === "Billed") {
      output.push("  Job: " + masterData[k][MJ.jobNumber  - 1] +
        " | Client: '"     + masterData[k][MJ.clientCode  - 1] + "'" +
        " | Status: '"     + masterData[k][MJ.status      - 1] + "'");
      count++;
    }
  }

  var result = output.join("\n");
  Logger.log(result);
  SpreadsheetApp.getUi().alert(result);
}


// ============================================================
// DELETE HISTORICAL / EMPTY TABS
// Removes tabs that are safe to delete:
//   - IMPORT_JAN_2026, IMPORT_FEB_2026_1_15, IMPORT_FEB_2026_16_END
//     (historical Mitek imports — data already in MASTER)
//   - PAYROLL_JANUARY_2026, PAYROLL_AUDIT_JANUARY_2026
//     (January payroll history)
//   - Form Responses 5/6/7/8 (empty auto-created client return tabs)
//   - MANAGEMENT_LOG (empty — raw data in MANAGEMENT_FORM_RAW)
//   - DESIGNER_VIEW (replaced by web app portal)
//   - INVOICE_1_15, INVOICE_16_END (empty)
// Run once from BLC menu — prompts for confirmation first.
// ============================================================

function deleteHistoricalTabs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  var TABS_TO_DELETE = [
    "IMPORT_JAN_2026",
    "IMPORT_FEB_2026_1_15",
    "IMPORT_FEB_2026_16_END",
    "PAYROLL_JANUARY_2026",
    "PAYROLL_AUDIT_JANUARY_2026",
    "Form Responses 5",
    "Form Responses 6",
    "Form Responses 7",
    "Form Responses 8",
    "MANAGEMENT_LOG",
    "DESIGNER_VIEW",
    "INVOICE_1_15",
    "INVOICE_16_END"
  ];

  // Find which tabs actually exist
  var found = [];
  var missing = [];
  for (var i = 0; i < TABS_TO_DELETE.length; i++) {
    var sheet = ss.getSheetByName(TABS_TO_DELETE[i]);
    if (sheet) {
      found.push(TABS_TO_DELETE[i]);
    } else {
      missing.push(TABS_TO_DELETE[i]);
    }
  }

  if (found.length === 0) {
    ui.alert("Nothing to delete — all target tabs are already gone.");
    return;
  }

  var confirm = ui.alert(
    "Delete Historical Tabs",
    "This will permanently delete " + found.length + " tab(s):\n\n" +
    found.join("\n") +
    (missing.length > 0 ? "\n\n(Already gone: " + missing.join(", ") + ")" : "") +
    "\n\nThis cannot be undone. Proceed?",
    ui.ButtonSet.YES_NO
  );

  if (confirm !== ui.Button.YES) return;

  var deleted = [];
  var errors  = [];

  for (var j = 0; j < found.length; j++) {
    try {
      var s = ss.getSheetByName(found[j]);
      if (s) {
        ss.deleteSheet(s);
        deleted.push(found[j]);
      }
    } catch (e) {
      errors.push(found[j] + ": " + e.message);
    }
  }

  SpreadsheetApp.flush();

  var msg = "✅ Deleted " + deleted.length + " tab(s):\n" + deleted.join("\n");
  if (errors.length > 0) {
    msg += "\n\n⚠️ Errors:\n" + errors.join("\n");
  }
  ui.alert(msg);
  logException("INFO", "SYSTEM", "deleteHistoricalTabs",
    "Deleted tabs: " + deleted.join(", "));
}


function diagnoseFormItems() {
  var cmData  = getSheetData(CONFIG.sheets.clientMaster);
  var output  = [];

  // Just check first client form
  var clientCode = String(cmData[1][0]  || "").trim();
  var formId     = String(cmData[1][15] || "").trim();

  output.push("Checking form for: " + clientCode);
  output.push("Form ID: " + formId);
  output.push("---");

  try {
    var form  = FormApp.openById(formId);
    var items = form.getItems();
    output.push("Items found in form: " + items.length);
    output.push("---");
    for (var i = 0; i < items.length; i++) {
      output.push("Item " + i + ": title='" + items[i].getTitle() +
        "' type='" + items[i].getType() + "'" +
        " LIST type value=" + FormApp.ItemType.LIST);
    }
  } catch (err) {
    output.push("❌ Could not open form: " + err.message);
  }

  var result = output.join("\n");
  Logger.log(result);
  SpreadsheetApp.getUi().alert(result);
}