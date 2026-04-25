// ============================================================
// IntakeAllocationBridge.gs
// Blue Lotus Consulting Corporation
// Connects the JOB_INTAKE queue (Gmail parser) to the
// Allocation workflow — eliminates manual job number typing.
//
// HOW IT WORKS:
//   1. Gmail parser fills JOB_INTAKE with Pending rows
//   2. Team Lead opens "Allocate from Intake Queue" dialog
//   3. Dialog shows all Pending jobs — one row per product type
//   4. TL selects designer + expected date → clicks Allocate
//   5. System creates MASTER + ACTIVE_JOBS entries automatically
//   6. JOB_INTAKE row is marked "Allocated"
//   7. Allocation notification email is sent
//
// MENU ITEMS (added to onOpen in Code.gs):
//   - Allocate from Intake Queue  → showIntakeQueue()
//   - Sync Intake → Alloc Form    → syncIntakeToAllocationForm()
//   - Refresh Intake Queue View   → refreshIntakeQueueView()
// ============================================================


// ============================================================
// 1. SHOW INTAKE QUEUE DIALOG
//    Opens an HTML dialog listing all Pending intake jobs.
//    Team Lead allocates directly from here — no form typing.
// ============================================================

function showIntakeQueue() {
  var FUNCTION_NAME = "showIntakeQueue";
  try {
    var pendingJobs  = getIntakePendingJobs_();
    var designers    = getActiveDesigners_();
    var tlNames      = getActiveTLNames_();
    var allocatedBy  = tlNames.length > 0 ? tlNames : designers;

    if (pendingJobs.length === 0) {
      SpreadsheetApp.getUi().alert(
        "✅ No Pending Jobs\n\n" +
        "The intake queue is empty.\n" +
        "Run 'Scan Emails Now' to check for new job emails."
      );
      return;
    }

    var html  = buildIntakeQueueHtml_(pendingJobs, designers, allocatedBy);
    var panel = HtmlService
      .createHtmlOutput(html)
      .setTitle("Intake Queue — Pending Jobs")
      .setWidth(900)
      .setHeight(600);

    SpreadsheetApp.getUi().showModalDialog(panel, "Allocate from Intake Queue");

  } catch (err) {
    logException("ERROR", "SYSTEM", FUNCTION_NAME,
      "showIntakeQueue failed: " + err.message);
    SpreadsheetApp.getUi().alert("❌ Error opening queue:\n" + err.message);
  }
}


// ============================================================
// 2. ALLOCATE AN INTAKE JOB
//    Called from the dialog via google.script.run
//    Receives one job payload, creates MASTER + ACTIVE_JOBS,
//    marks intake row Allocated, sends notification.
// ============================================================

function allocateIntakeJob(payload) {
  var FUNCTION_NAME = "allocateIntakeJob";
  var jobNumber = "UNKNOWN";

  try {
    // ── Unpack payload from dialog ─────────────────────────
    jobNumber       = String(payload.jobNumber     || "").trim().toUpperCase();
    var intakeId    = String(payload.intakeId      || "").trim();
    var clientCode  = String(payload.clientCode    || "").trim();
    var productType = String(payload.productType   || "").trim();
    var designerRaw = String(payload.designerName  || "").trim();
    var expCompStr  = String(payload.expectedCompletion || "").trim();
    var allocatedBy = String(payload.allocatedBy   || "").trim();
    var notes       = String(payload.notes         || "").trim();

    // ── Validate ───────────────────────────────────────────
    if (!jobNumber || !clientCode || !designerRaw || !productType) {
      return { ok: false, msg: "Missing required field (job, client, designer, product)." };
    }
    if (!designerRaw) {
      return { ok: false, msg: "Please select a designer." };
    }

    // ── Normalise designer name ────────────────────────────
    var designerName = normaliseDesignerName(designerRaw);

    // ── Look up client name ────────────────────────────────
    var clientName = getClientNameByCode(clientCode);
    if (!clientName) clientName = clientCode;

    // ── Duplicate check ────────────────────────────────────
    var existingRow = findJobRow(jobNumber);
    if (existingRow > 0) {
      return {
        ok: false,
        msg: "Job " + jobNumber + " already exists in MASTER (row " + existingRow + ")." +
             " If this is a revision, use the Job Start form instead."
      };
    }

    // ── Parse expected completion date ─────────────────────
    var expectedComp = "";
    if (expCompStr) {
      var d = new Date(expCompStr);
      expectedComp = isNaN(d.getTime()) ? "" : d;
    }

    // ── Build MASTER row ───────────────────────────────────
    var MJ     = CONFIG.masterCols;
    var today  = new Date();
    var newRow = new Array(39).fill("");

    newRow[MJ.jobNumber              - 1] = jobNumber;
    newRow[MJ.clientCode             - 1] = clientCode;
    newRow[MJ.clientName             - 1] = clientName;
    newRow[MJ.designerName           - 1] = designerName;
    newRow[MJ.productType            - 1] = productType;
    newRow[MJ.allocatedDate          - 1] = today;
    newRow[MJ.expectedCompletion     - 1] = expectedComp;
    newRow[MJ.status                 - 1] = CONFIG.status.allocated;
    newRow[MJ.sopAcknowledged        - 1] = "No";
    newRow[MJ.reallocationFlag       - 1] = "No";
    newRow[MJ.reworkFlag             - 1] = "No";
    newRow[MJ.reworkCount            - 1] = 0;
    newRow[MJ.onHoldFlag             - 1] = "No";
    newRow[MJ.lastUpdated            - 1] = today;
    newRow[MJ.lastUpdatedBy          - 1] = "allocateIntakeJob";
    newRow[MJ.notes                  - 1] = notes;
    newRow[MJ.rowId                  - 1] = Utilities.getUuid();
    newRow[MJ.isTest                 - 1] = "No";
    newRow[MJ.isImported             - 1] = "No";
    newRow[MJ.qcExempt               - 1] = "No";
    newRow[MJ.sopChecklistSubmitted  - 1] = "No";
    newRow[MJ.qcChecklistSubmitted   - 1] = "No";

    // ── Append to MASTER_JOB_DATABASE ─────────────────────
    var masterSheet = getSheet(CONFIG.sheets.masterJob);
    masterSheet.appendRow(newRow);

    // ── Add to ACTIVE_JOBS ─────────────────────────────────
    addToActiveJobsOnAllocation(
      jobNumber, clientCode, clientName, designerName,
      productType, today, expectedComp
    );

    // ── Mark intake row as Allocated ───────────────────────
    markIntakeAllocated(jobNumber, productType, allocatedBy);

    // ── Send notification ──────────────────────────────────
    sendAllocationNotification(
      jobNumber, clientName, clientCode, designerName,
      productType, expectedComp, allocatedBy, notes
    );

    // ── Send SOP checklist email to designer ───────────────
    sendSopChecklistEmail_(jobNumber, designerName, clientCode);

    logException("INFO", jobNumber, FUNCTION_NAME,
      "Allocated from intake queue. IntakeId=" + intakeId +
      " | Designer=" + designerName +
      " | Product=" + productType +
      " | By=" + allocatedBy);

    return { ok: true, msg: "✅ " + jobNumber + " (" + productType + ") allocated to " + designerName };

  } catch (err) {
    logException("ERROR", jobNumber, FUNCTION_NAME,
      "allocateIntakeJob crashed: " + err.message);
    return { ok: false, msg: "System error: " + err.message };
  }
}


// ============================================================
// 3. SYNC INTAKE JOBS → ALLOCATION FORM DROPDOWN
//    Updates the "Job Number" question on the Allocation Form
//    with all Pending intake jobs in "JOBNUM | CLIENT | PRODUCT"
//    format, so nothing needs to be typed.
//    Also runs the standard dropdown sync for designers etc.
// ============================================================

function syncIntakeToAllocationForm() {
  var FUNCTION_NAME = "syncIntakeToAllocationForm";
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

    // ── Build pending job choices ──────────────────────────
    var pendingJobs = getIntakePendingJobs_();
    var jobChoices  = [];

    for (var i = 0; i < pendingJobs.length; i++) {
      var j = pendingJobs[i];
      // Format: "B600105 | TITAN | Roof Truss"
      jobChoices.push(j.jobNumber + " | " + j.clientCode + " | " + j.productType);
    }

    if (jobChoices.length === 0) {
      jobChoices = ["(No pending jobs — scan emails first)"];
    }

    // ── Update "Job Number" list item ──────────────────────
    for (var k = 0; k < items.length; k++) {
      var item  = items[k];
      var title = item.getTitle();
      var type  = item.getType();

      if (title === "Job Number" &&
          type  === FormApp.ItemType.LIST) {
        item.asListItem().setChoiceValues(jobChoices);
        break;
      }
    }

    // ── Also sync standard dropdowns (designers, clients) ──
    syncAllocationFormDropdowns();

    var msg = "✅ Intake sync complete.\n\n" +
      "Pending jobs added to form: " + pendingJobs.length;

    logException("INFO", "SYSTEM", FUNCTION_NAME, msg);
    SpreadsheetApp.getUi().alert(msg);

  } catch (err) {
    logException("ERROR", "SYSTEM", FUNCTION_NAME,
      "syncIntakeToAllocationForm failed: " + err.message);
    SpreadsheetApp.getUi().alert("❌ Sync failed:\n" + err.message);
  }
}


// ============================================================
// 4. POST-ALLOCATION INTAKE SYNC
//    Call this from onAllocationSubmit() after a successful
//    allocation via the old Google Form (typed job number).
//    Finds the matching Pending intake row and marks it Allocated
//    so the queue stays clean even when using the form.
// ============================================================

function postAllocationIntakeSync(jobNumber, productType, allocatedBy) {
  var FUNCTION_NAME = "postAllocationIntakeSync";
  try {
    if (!jobNumber) return;

    var intakeSheet = getSheet(CONFIG.sheets.jobIntake);
    if (!intakeSheet) return;

    var data = intakeSheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      var rowJobNum  = String(data[i][JI.jobNumber  - 1]).trim().toUpperCase();
      var rowProduct = String(data[i][JI.productType - 1]).trim();
      var rowStatus  = String(data[i][JI.status     - 1]).trim();

      var jobMatch     = rowJobNum === jobNumber.toUpperCase();
      var productMatch = !productType ||
                         rowProduct.toLowerCase() === productType.toLowerCase();
      var isPending    = rowStatus === INTAKE_STATUS_PENDING;

      if (jobMatch && productMatch && isPending) {
        markIntakeAllocated(jobNumber, productType, allocatedBy || "Allocation Form");
        logException("INFO", jobNumber, FUNCTION_NAME,
          "Marked intake row Allocated via form path. IntakeId=" + intakeId);
        break;
      }
    }
  } catch (err) {
    // Non-critical — log but don't break allocation
    logException("WARNING", jobNumber, FUNCTION_NAME,
      "postAllocationIntakeSync failed (non-critical): " + err.message);
  }
}


// ============================================================
// 5. REFRESH INTAKE QUEUE VIEW SHEET
//    Creates/refreshes an "INTAKE_QUEUE_VIEW" sheet that shows
//    all Pending jobs in a clean, read-only dashboard format.
//    Team can glance at this without opening the dialog.
// ============================================================

function refreshIntakeQueueView() {
  var FUNCTION_NAME = "refreshIntakeQueueView";
  try {
    var ss        = SpreadsheetApp.getActiveSpreadsheet();
    var viewName  = "INTAKE_QUEUE_VIEW";
    var viewSheet = ss.getSheetByName(viewName);

    if (!viewSheet) {
      viewSheet = ss.insertSheet(viewName);
    }
    viewSheet.clearContents();
    viewSheet.clearFormats();

    // ── Header row ─────────────────────────────────────────
    var headers = [
      "Intake ID", "Client", "Job Number", "Job Name",
      "Product Type", "Due Date", "Urgent", "Notes",
      "Email From", "Email Date", "Parsed Date", "Status"
    ];
    viewSheet.appendRow(headers);

    var headerRange = viewSheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground("#1a73e8")
               .setFontColor("#ffffff")
               .setFontWeight("bold");
    viewSheet.setFrozenRows(1);

    // ── Pending data rows ──────────────────────────────────
    var pendingJobs = getIntakePendingJobs_();

    if (pendingJobs.length === 0) {
      viewSheet.appendRow(["No pending jobs. Run 'Scan Emails Now' to check for new emails."]);
      viewSheet.getRange(2, 1, 1, headers.length)
               .setFontColor("#888888")
               .setFontWeight("normal");
    } else {
      for (var i = 0; i < pendingJobs.length; i++) {
        var j = pendingJobs[i];
        var row = [
          j.intakeId, j.clientCode, j.jobNumber, j.jobName,
          j.productType, j.dueDate, j.urgent, j.notes,
          j.sourceFrom, j.sourceEmailDate, j.parsedDate, j.status
        ];
        viewSheet.appendRow(row);

        // Highlight urgent rows in light red
        if (j.urgent === "Yes") {
          viewSheet.getRange(i + 2, 1, 1, headers.length)
                   .setBackground("#fce8e6");
        }
      }
    }

    // ── Auto-resize columns ────────────────────────────────
    for (var c = 1; c <= headers.length; c++) {
      viewSheet.autoResizeColumn(c);
    }

    SpreadsheetApp.getUi().alert(
      "✅ Intake Queue View refreshed.\n\nPending jobs: " + pendingJobs.length
    );

  } catch (err) {
    logException("ERROR", "SYSTEM", FUNCTION_NAME,
      "refreshIntakeQueueView failed: " + err.message);
    SpreadsheetApp.getUi().alert("❌ Error refreshing view:\n" + err.message);
  }
}


// ============================================================
// 6. WEB APP DATA FUNCTION
//    Called by IntakeQueue.html via google.script.run
//    Returns pending jobs + dropdown lists for the web app.
//    Checks that the caller is a TL, PM, or CEO — not a designer.
// ============================================================

function getIntakeQueueData() {
  try {
    var auth = authenticateInternalUser();

    if (!auth.authenticated) {
      return { ok: false, error: auth.error };
    }

    var allowedRoles = ["Team Leader", "Project Manager", "CEO"];
    if (allowedRoles.indexOf(auth.role) === -1) {
      return {
        ok: false,
        error: "Access denied. The Intake Queue is for Team Leads and Project Managers only."
      };
    }

    var tlNames    = getActiveTLNames_();
    var allocByList = tlNames.length > 0 ? tlNames : getActiveDesigners_();

    return {
      ok:          true,
      userName:    auth.name,
      role:        auth.role,
      pendingJobs: getIntakePendingJobs_(),
      designers:   getActiveDesigners_(),
      allocatedBy: allocByList
    };

  } catch (err) {
    return { ok: false, error: "Server error: " + err.message };
  }
}


// ============================================================
// PRIVATE HELPERS
// ============================================================

/**
 * Returns an array of all Pending rows from JOB_INTAKE,
 * sorted by urgency (Urgent first) then by email date.
 */
function getIntakePendingJobs_() {
  var intakeSheet = getSheet(CONFIG.sheets.jobIntake);
  if (!intakeSheet) return [];

  var data = intakeSheet.getDataRange().getValues();
  var jobs = [];

  for (var i = 1; i < data.length; i++) {
    var status = String(data[i][JI.status - 1]).trim();
    if (status !== INTAKE_STATUS_PENDING) continue;

    jobs.push({
      rowIndex:       i + 1,  // 1-based for getRange
      intakeId:       String(data[i][JI.intakeId        - 1]).trim(),
      clientCode:     String(data[i][JI.clientCode      - 1]).trim(),
      jobNumber:      String(data[i][JI.jobNumber       - 1]).trim(),
      jobName:        String(data[i][JI.jobName         - 1]).trim(),
      productType:    String(data[i][JI.productType     - 1]).trim(),
      dueDate:        data[i][JI.dueDate        - 1] || "",
      notes:          String(data[i][JI.notes          - 1]).trim(),
      urgent:         String(data[i][JI.urgent         - 1]).trim(),
      sourceFrom:     String(data[i][JI.sourceFrom     - 1]).trim(),
      sourceSubject:  String(data[i][JI.sourceSubject  - 1]).trim(),
      sourceEmailDate:data[i][JI.sourceEmailDate - 1] || "",
      parsedDate:     data[i][JI.parsedDate     - 1] || "",
      status:         status
    });
  }

  // Sort: Urgent=Yes first, then by email date (oldest first)
  jobs.sort(function(a, b) {
    if (a.urgent === "Yes" && b.urgent !== "Yes") return -1;
    if (b.urgent === "Yes" && a.urgent !== "Yes") return 1;
    var da = a.sourceEmailDate ? new Date(a.sourceEmailDate) : new Date(0);
    var db = b.sourceEmailDate ? new Date(b.sourceEmailDate) : new Date(0);
    return da - db;
  });

  return jobs;
}


/**
 * Returns array of active designer names (for dialog dropdowns).
 */
function getActiveDesigners_() {
  try {
    var data  = getSheetData(CONFIG.sheets.designerMaster);
    var names = [];
    for (var i = 1; i < data.length; i++) {
      var active = String(data[i][8]).trim();
      var name   = String(data[i][1]).trim();
      if (name && active === "Yes") names.push(name);
    }
    return names.sort();
  } catch (e) {
    return [];
  }
}


/**
 * Returns array of TL/PM names for "Allocated By" dropdown.
 */
function getActiveTLNames_() {
  try {
    var data  = getSheetData(CONFIG.sheets.designerMaster);
    var names = [];
    for (var i = 1; i < data.length; i++) {
      var active = String(data[i][8]).trim();
      var name   = String(data[i][1]).trim();
      var role   = String(data[i][4]).trim();
      if (name && active === "Yes" &&
          (role === "Team Leader" || role === "Project Manager")) {
        names.push(name);
      }
    }
    return names.sort();
  } catch (e) {
    return [];
  }
}


// ============================================================
// HTML DIALOG BUILDER
// Builds the full HTML for the intake queue modal dialog.
// ============================================================

function buildIntakeQueueHtml_(pendingJobs, designers, allocatedByList) {

  var designerOptions = designers.map(function(d) {
    return '<option value="' + escHtml_(d) + '">' + escHtml_(d) + '</option>';
  }).join("");

  var allocByOptions = allocatedByList.map(function(d) {
    return '<option value="' + escHtml_(d) + '">' + escHtml_(d) + '</option>';
  }).join("");

  // Today + 14 days as default expected completion
  var defaultDate = new Date();
  defaultDate.setDate(defaultDate.getDate() + 14);
  var defaultDateStr = defaultDate.toISOString().split("T")[0];

  var jobRows = pendingJobs.map(function(j, idx) {
    var urgentBadge = j.urgent === "Yes"
      ? '<span style="background:#d93025;color:#fff;padding:2px 6px;border-radius:3px;font-size:11px;font-weight:bold;">URGENT</span> '
      : '';

    var dueDateStr = "";
    if (j.dueDate) {
      try {
        dueDateStr = new Date(j.dueDate).toLocaleDateString("en-CA");
      } catch(e) { dueDateStr = String(j.dueDate); }
    }

    var notesDisplay = j.notes ? ('<span title="' + escHtml_(j.notes) + '">📋 ' + escHtml_(j.notes.substring(0,40)) + (j.notes.length > 40 ? "…" : "") + '</span>') : "—";

    return '<tr id="row-' + idx + '" style="border-bottom:1px solid #e0e0e0;">' +
      '<td style="padding:8px;font-size:12px;color:#888;">' + escHtml_(j.intakeId) + '</td>' +
      '<td style="padding:8px;font-weight:bold;">' + escHtml_(j.clientCode) + '</td>' +
      '<td style="padding:8px;">' + urgentBadge + '<strong>' + escHtml_(j.jobNumber) + '</strong>' +
        (j.jobName ? '<br><span style="font-size:11px;color:#555;">' + escHtml_(j.jobName) + '</span>' : '') +
      '</td>' +
      '<td style="padding:8px;">' + escHtml_(j.productType) + '</td>' +
      '<td style="padding:8px;color:' + (j.urgent === "Yes" ? "#d93025" : "#333") + ';">' + (dueDateStr || "—") + '</td>' +
      '<td style="padding:8px;font-size:11px;">' + notesDisplay + '</td>' +

      // Designer dropdown
      '<td style="padding:8px;">' +
        '<select id="designer-' + idx + '" style="width:140px;padding:4px;">' +
          '<option value="">— Select —</option>' + designerOptions +
        '</select>' +
      '</td>' +

      // Expected completion date
      '<td style="padding:8px;">' +
        '<input type="date" id="expdate-' + idx + '" value="' + (dueDateStr || defaultDateStr) + '" ' +
          'style="width:130px;padding:4px;">' +
      '</td>' +

      // Allocated by
      '<td style="padding:8px;">' +
        '<select id="allocby-' + idx + '" style="width:120px;padding:4px;">' +
          '<option value="">— Select —</option>' + allocByOptions +
        '</select>' +
      '</td>' +

      // Allocate button
      '<td style="padding:8px;">' +
        '<button onclick="doAllocate(' + idx + ',' +
          JSON.stringify(j.intakeId) + ',' +
          JSON.stringify(j.jobNumber) + ',' +
          JSON.stringify(j.clientCode) + ',' +
          JSON.stringify(j.productType) + ',' +
          JSON.stringify(j.notes) +
        ')" id="btn-' + idx + '" ' +
          'style="background:#1a73e8;color:#fff;border:none;padding:6px 14px;' +
                 'border-radius:4px;cursor:pointer;font-size:13px;">' +
          'Allocate' +
        '</button>' +
        '<span id="status-' + idx + '" style="font-size:11px;display:block;margin-top:4px;"></span>' +
      '</td>' +
    '</tr>';
  }).join("");

  return '<!DOCTYPE html><html><head>' +
    '<meta charset="UTF-8">' +
    '<style>' +
      'body{font-family:Arial,sans-serif;font-size:13px;margin:0;padding:12px;}' +
      'h2{color:#1a73e8;margin:0 0 4px;}' +
      'p.sub{color:#888;font-size:12px;margin:0 0 12px;}' +
      'table{border-collapse:collapse;width:100%;}' +
      'th{background:#f1f3f4;padding:8px;text-align:left;font-size:12px;color:#555;border-bottom:2px solid #e0e0e0;}' +
      'tr:hover{background:#f8f9fa;}' +
      '.success{color:#0f9d58;font-weight:bold;}' +
      '.error{color:#d93025;font-weight:bold;}' +
    '</style>' +
    '</head><body>' +
    '<h2>📋 Intake Queue — Pending Jobs</h2>' +
    '<p class="sub">Select a designer and click Allocate for each job. ' +
      'Jobs are sorted: Urgent first, then oldest first.</p>' +
    '<table>' +
      '<thead><tr>' +
        '<th>Intake ID</th><th>Client</th><th>Job / Name</th>' +
        '<th>Product</th><th>Due Date</th><th>Notes</th>' +
        '<th>Designer</th><th>Expected Comp.</th><th>Allocated By</th><th>Action</th>' +
      '</tr></thead>' +
      '<tbody>' + jobRows + '</tbody>' +
    '</table>' +
    '<script>' +
    'function doAllocate(idx, intakeId, jobNumber, clientCode, productType, notes) {' +
      'var designer   = document.getElementById("designer-"  + idx).value;' +
      'var expDate    = document.getElementById("expdate-"   + idx).value;' +
      'var allocBy    = document.getElementById("allocby-"   + idx).value;' +
      'var btn        = document.getElementById("btn-"       + idx);' +
      'var statusEl   = document.getElementById("status-"    + idx);' +

      'if (!designer) { statusEl.textContent = "⚠️ Pick a designer"; statusEl.style.color="#d93025"; return; }' +
      'if (!allocBy)  { statusEl.textContent = "⚠️ Pick Allocated By"; statusEl.style.color="#d93025"; return; }' +

      'btn.disabled = true;' +
      'btn.textContent = "Working…";' +
      'statusEl.textContent = "";' +

      'var payload = {' +
        'intakeId: intakeId,' +
        'jobNumber: jobNumber,' +
        'clientCode: clientCode,' +
        'productType: productType,' +
        'designerName: designer,' +
        'expectedCompletion: expDate,' +
        'allocatedBy: allocBy,' +
        'notes: notes' +
      '};' +

      'google.script.run' +
        '.withSuccessHandler(function(result) {' +
          'if (result.ok) {' +
            'statusEl.textContent = result.msg;' +
            'statusEl.style.color = "#0f9d58";' +
            'btn.style.background = "#888";' +
            'btn.textContent = "Done";' +
            'document.getElementById("row-" + idx).style.opacity = "0.4";' +
          '} else {' +
            'statusEl.textContent = "❌ " + result.msg;' +
            'statusEl.style.color = "#d93025";' +
            'btn.disabled = false;' +
            'btn.textContent = "Allocate";' +
          '}' +
        '})' +
        '.withFailureHandler(function(err) {' +
          'statusEl.textContent = "❌ " + err.message;' +
          'statusEl.style.color = "#d93025";' +
          'btn.disabled = false;' +
          'btn.textContent = "Allocate";' +
        '})' +
        '.allocateIntakeJob(payload);' +
    '}' +
    '</script>' +
    '</body></html>';
}


/**
 * Escapes HTML special characters for safe rendering in the dialog.
 */
function escHtml_(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
