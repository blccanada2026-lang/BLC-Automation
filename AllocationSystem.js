// ============================================================
// AllocationSystem.gs
// Blue Lotus Consulting Corporation
// Piece 1: Job Allocation Form handler
// Handles submissions from Sarty / Team Leads
// Build date: March 7, 2026
// ============================================================

// Column indices for FORM_Job_Allocation response sheet (0-based)
// Order MUST match the Google Form question order exactly.
// Timestamp is always index 0 — Google Forms inserts it automatically.
var ALLOC_FORM = {
  timestamp:          0,  // Auto — always first in form responses
  jobNumber:          1,  // "Job Number" — text field
  clientCode:         2,  // "Client Code" — dropdown
  designerName:       3,  // "Designer Name" — dropdown
  productType:        4,  // "Product Type" — dropdown
  expectedCompletion: 5,  // "Expected Completion Date" — date field
  notes:              6,  // "Notes / Instructions" — paragraph text
  allocatedBy:        7   // "Allocated By" — dropdown
};


// ─────────────────────────────────────────────────────────────
// MAIN HANDLER
// Called by onFormSubmitRouter() when FORM_Job_Allocation
// receives a new submission.
// ─────────────────────────────────────────────────────────────

function onAllocationSubmit(e) {
  var FUNCTION_NAME = "onAllocationSubmit";
  var jobNumber = "UNKNOWN";

  try {

    // ── 1. Read form response ──────────────────────────────────
    var row = e.values;

    jobNumber            = String(row[ALLOC_FORM.jobNumber]          || "").trim().toUpperCase();
    var clientCode       = String(row[ALLOC_FORM.clientCode]         || "").trim();
    var designerRaw      = String(row[ALLOC_FORM.designerName]       || "").trim();
    var productType      = String(row[ALLOC_FORM.productType]        || "").trim();
    var expectedComp     = row[ALLOC_FORM.expectedCompletion]            || "";
    var notes            = String(row[ALLOC_FORM.notes]              || "").trim();
    var allocatedBy      = String(row[ALLOC_FORM.allocatedBy]        || "").trim();

    // ── 2. Validate required fields ────────────────────────────
    if (!jobNumber) {
      logException("ERROR", "UNKNOWN", FUNCTION_NAME,
        "Allocation submitted with blank Job Number. Aborting.");
      return;
    }
    if (!clientCode) {
      logException("ERROR", jobNumber, FUNCTION_NAME,
        "No Client Code provided. Aborting.");
      return;
    }
    if (!designerRaw) {
      logException("ERROR", jobNumber, FUNCTION_NAME,
        "No Designer Name provided. Aborting.");
      return;
    }
    if (!productType) {
      logException("ERROR", jobNumber, FUNCTION_NAME,
        "No Product Type provided. Aborting.");
      return;
    }

    // ── 3. Normalise designer name ─────────────────────────────
    var designerName = normaliseDesignerName(designerRaw);

    // ── 4. Look up client name from CLIENT_MASTER ──────────────
    var clientName = getClientNameByCode(clientCode);
    if (!clientName) {
      logException("WARNING", jobNumber, FUNCTION_NAME,
        "Client code '" + clientCode + "' not found in CLIENT_MASTER. " +
        "Using code as name.");
      clientName = clientCode;
    }

    // ── 5. Duplicate check — block if job already exists ───────
    var existingRow = findJobRow(jobNumber);
    if (existingRow > 0) {
      logException("WARNING", jobNumber, FUNCTION_NAME,
        "Duplicate allocation blocked. Job " + jobNumber +
        " already exists in MASTER at row " + existingRow + ".");
      sendAllocationBlockedEmail(jobNumber, allocatedBy, clientCode,
        "Job " + jobNumber + " already exists in the system. " +
        "If this is a new revision, use the Job Start form instead.");
      return;
    }

    // ── 6. Build new MASTER row — always 36 cols ───────────────
    var MJ  = CONFIG.masterCols;
    var today = new Date();
    var newRow = new Array(36).fill("");

    newRow[MJ.jobNumber          - 1] = jobNumber;
    newRow[MJ.clientCode         - 1] = clientCode;
    newRow[MJ.clientName         - 1] = clientName;
    newRow[MJ.designerName       - 1] = designerName;
    newRow[MJ.productType        - 1] = productType;
    newRow[MJ.allocatedDate      - 1] = today;
    newRow[MJ.expectedCompletion - 1] = expectedComp;
    newRow[MJ.status             - 1] = CONFIG.status.allocated;
    newRow[MJ.sopAcknowledged    - 1] = "No";
    newRow[MJ.reallocationFlag   - 1] = "No";
    newRow[MJ.reworkFlag         - 1] = "No";
    newRow[MJ.reworkCount        - 1] = 0;
    newRow[MJ.onHoldFlag         - 1] = "No";
    newRow[MJ.lastUpdated        - 1] = today;
    newRow[MJ.lastUpdatedBy      - 1] = "onAllocationSubmit";
    newRow[MJ.notes              - 1] = notes;
    newRow[MJ.rowId              - 1] = Utilities.getUuid();
    newRow[MJ.isTest             - 1] = (jobNumber.indexOf("TEST-") === 0)
                                        ? "Yes" : "No";
    newRow[MJ.isImported         - 1] = "No";

    // ── 7. Append to MASTER_JOB_DATABASE ──────────────────────
    var masterSheet = getSheet(CONFIG.sheets.masterJob);
    masterSheet.appendRow(newRow);

    // ── 8. Add to ACTIVE_JOBS ──────────────────────────────────
    addToActiveJobsOnAllocation(
      jobNumber, clientCode, clientName, designerName,
      productType, today, expectedComp
    );

    // ── 9. Mark matching intake row as Allocated (if came from queue) ──────────
    postAllocationIntakeSync(jobNumber, productType, allocatedBy);

    // ── 10. Send notification ──────────────────────────────────
    sendAllocationNotification(
      jobNumber, clientName, clientCode, designerName,
      productType, expectedComp, allocatedBy, notes
    );

    logException("INFO", jobNumber, FUNCTION_NAME,
      "Allocated successfully. Designer: " + designerName +
      " | Client: " + clientCode +
      " | Product: " + productType +
      " | By: " + allocatedBy);

  } catch (err) {
    logException("ERROR", jobNumber, FUNCTION_NAME,
      "onAllocationSubmit crashed: " + err.message);
  }
}


// ─────────────────────────────────────────────────────────────
// ACTIVE JOBS HELPER
// ─────────────────────────────────────────────────────────────

function addToActiveJobsOnAllocation(jobNumber, clientCode, clientName,
                                      designerName, productType,
                                      allocatedDate, expectedCompletion) {
  var FUNCTION_NAME = "addToActiveJobsOnAllocation";
  try {
    var activeSheet = getSheet(CONFIG.sheets.activeJobs);
    activeSheet.appendRow([
      jobNumber,
      clientCode,
      clientName,
      designerName,
      productType,
      CONFIG.status.allocated,
      allocatedDate,
      expectedCompletion || "",
      new Date(),
      "onAllocationSubmit"
    ]);
  } catch (err) {
    logException("ERROR", jobNumber, FUNCTION_NAME,
      "Failed to add to ACTIVE_JOBS: " + err.message);
  }
}


// ─────────────────────────────────────────────────────────────
// CLIENT LOOKUP HELPER
// ─────────────────────────────────────────────────────────────

function getClientNameByCode(clientCode) {
  var FUNCTION_NAME = "getClientNameByCode";
  try {
    var data = getSheetData(CONFIG.sheets.clientMaster);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim().toUpperCase() ===
          String(clientCode).trim().toUpperCase()) {
        return String(data[i][1]).trim();
      }
    }
    return "";
  } catch (err) {
    logException("ERROR", "SYSTEM", FUNCTION_NAME,
      "getClientNameByCode error: " + err.message);
    return "";
  }
}


// ─────────────────────────────────────────────────────────────
// NOTIFICATION EMAILS
// ─────────────────────────────────────────────────────────────

function sendAllocationNotification(jobNumber, clientName, clientCode,
                                     designerName, productType,
                                     expectedCompletion, allocatedBy, notes) {
  var FUNCTION_NAME = "sendAllocationNotification";
  try {
    var expDate = expectedCompletion
      ? Utilities.formatDate(new Date(expectedCompletion),
          Session.getScriptTimeZone(), "MMM dd, yyyy")
      : "Not set";

    var subject = "BLC | Job Allocated: " + jobNumber + " → " + designerName;

    var body =
      "<div style='font-family:Arial,sans-serif;font-size:14px;color:#333;'>" +
      "<h2 style='color:#1a73e8;margin-bottom:4px;'>✅ Job Allocated</h2>" +
      "<p style='color:#888;margin-top:0;font-size:12px;'>BLC Job Management System</p>" +
      "<table style='border-collapse:collapse;width:100%;max-width:520px;" +
        "border:1px solid #e0e0e0;border-radius:4px;'>" +
      _allocRow("Job Number",          jobNumber,                           false) +
      _allocRow("Client",              clientName + " (" + clientCode + ")", true) +
      _allocRow("Designer",            designerName,                        false) +
      _allocRow("Product Type",        productType,                         true)  +
      _allocRow("Expected Completion", expDate,                             false) +
      _allocRow("Allocated By",        allocatedBy,                         true)  +
      (notes ? _allocRow("Notes",      notes,                               false) : "") +
      "</table>" +
      "<p style='font-size:12px;color:#aaa;margin-top:16px;'>" +
        "This is an automated notification. Do not reply.</p>" +
      "</div>";

    MailApp.sendEmail({
      to:       NOTIFICATION_EMAIL,
      subject:  subject,
      htmlBody: body
    });

  } catch (err) {
    logException("WARNING", jobNumber, FUNCTION_NAME,
      "Allocation notification email failed: " + err.message);
  }
}


function sendAllocationBlockedEmail(jobNumber, allocatedBy,
                                     clientCode, reason) {
  var FUNCTION_NAME = "sendAllocationBlockedEmail";
  try {
    MailApp.sendEmail({
      to:      NOTIFICATION_EMAIL,
      subject: "⚠️ BLC | Allocation Blocked: " + jobNumber,
      htmlBody:
        "<div style='font-family:Arial,sans-serif;font-size:14px;color:#333;'>" +
        "<h2 style='color:#d93025;'>⚠️ Allocation Blocked</h2>" +
        "<table style='border-collapse:collapse;width:100%;max-width:520px;" +
          "border:1px solid #e0e0e0;'>" +
        _allocRow("Job Number",   jobNumber,   false) +
        _allocRow("Client Code",  clientCode,  true)  +
        _allocRow("Submitted By", allocatedBy, false) +
        _allocRow("Reason",       reason,      true)  +
        "</table>" +
        "<p style='font-size:12px;color:#aaa;margin-top:16px;'>" +
          "BLC Job Management System — Auto-notification</p>" +
        "</div>"
    });
  } catch (err) {
    logException("WARNING", jobNumber, FUNCTION_NAME,
      "Allocation blocked email failed: " + err.message);
  }
}


function _allocRow(label, value, shaded) {
  var bg = shaded ? "background:#f8f9fa;" : "";
  return "<tr style='" + bg + "'>" +
    "<td style='padding:8px 12px;font-weight:bold;color:#555;" +
      "width:40%;border-bottom:1px solid #e0e0e0;'>" + label + "</td>" +
    "<td style='padding:8px 12px;border-bottom:1px solid #e0e0e0;'>" +
      (value || "—") + "</td>" +
    "</tr>";
}


// ─────────────────────────────────────────────────────────────
// DROPDOWN SYNC
// Updates Client Code, Designer Name, Product Type and
// Allocated By dropdowns on the Allocation Google Form.
// ─────────────────────────────────────────────────────────────

function syncAllocationFormDropdowns() {
  var FUNCTION_NAME = "syncAllocationFormDropdowns";
  try {
    var formId = CONFIG.allocationFormId;

    if (!formId || formId === "PASTE_FORM_ID_HERE") {
      SpreadsheetApp.getUi().alert(
        "⚠️ Allocation Form ID not set in CONFIG.allocationFormId."
      );
      return;
    }

    var form  = FormApp.openById(formId);
    var items = form.getItems();

    // ── Client code list (active only) ────────────────────────
    var clientData  = getSheetData(CONFIG.sheets.clientMaster);
    var clientCodes = [];
    for (var i = 1; i < clientData.length; i++) {
      var isActive = String(clientData[i][9]).trim();
      var code     = String(clientData[i][0]).trim();
      if (code && isActive === "Yes") clientCodes.push(code);
    }

    // ── Designer list and TL/PM list (active only) ─────────────
    var designerData  = getSheetData(CONFIG.sheets.designerMaster);
    var designerNames = [];
    var tlNames       = [];
    for (var j = 1; j < designerData.length; j++) {
      var dActive = String(designerData[j][8]).trim();
      var dName   = String(designerData[j][1]).trim();
      var dRole   = String(designerData[j][4]).trim();
      if (dName && dActive === "Yes") {
        designerNames.push(dName);
        if (dRole === "Team Leader" || dRole === "Project Manager") {
          tlNames.push(dName);
        }
      }
    }

    // Allocated By = TL + PM only
    var allocatedByList = tlNames.length > 0 ? tlNames : designerNames;

    // ── Update form items by title ─────────────────────────────
    for (var k = 0; k < items.length; k++) {
      var item  = items[k];
      var title = item.getTitle();
      var type  = item.getType();

      if (title === "Client Code" &&
          type  === FormApp.ItemType.LIST) {
        item.asListItem().setChoiceValues(clientCodes);
      }
      if (title === "Designer Name" &&
          type  === FormApp.ItemType.LIST) {
        item.asListItem().setChoiceValues(designerNames);
      }
      if (title === "Allocated By" &&
          type  === FormApp.ItemType.LIST) {
        item.asListItem().setChoiceValues(allocatedByList);
      }
      if (title === "Product Type" &&
          type  === FormApp.ItemType.LIST) {
        item.asListItem().setChoiceValues(CONFIG.productTypes);
      }
    }

    logException("INFO", "SYSTEM", FUNCTION_NAME,
      "Allocation form dropdowns synced. " +
      "Clients: "    + clientCodes.length +
      " | Designers: " + designerNames.length +
      " | AllocatedBy: " + allocatedByList.length);

    SpreadsheetApp.getUi().alert(
      "✅ Allocation Form dropdowns synced.\n\n" +
      "Clients: "       + clientCodes.length    + "\n" +
      "Designers: "     + designerNames.length  + "\n" +
      "Allocated By: "  + allocatedByList.length
    );

  } catch (err) {
    logException("ERROR", "SYSTEM", FUNCTION_NAME,
      "syncAllocationFormDropdowns failed: " + err.message);
    SpreadsheetApp.getUi().alert(
      "❌ Error syncing allocation form dropdowns:\n" + err.message
    );
  }
}