// ============================================================
// BLC JOB MANAGEMENT SYSTEM — FINAL CONSOLIDATED VERSION
// Blue Lotus Consulting Corporation
// Last Updated: March 14, 2026
//
// THIS FILE IS THE SINGLE SOURCE OF TRUTH FOR:
// - CONFIG object, DESIGNER_NAME_MAP, all constants
// - Form submit router + all 3 core form handlers
// - Dashboard refresh + TL_VIEW population
// - Daily digest email system
// - Invoice generation
// - Portal data functions (doGet, designer/TL/client views)
// - Core utility functions
//
// FUNCTIONS THAT LIVE IN OTHER FILES (NOT duplicated here):
// - onboardNewClient()              → OnboardingSystemClient.gs
// - setupAllClientReturnForms()     → ClientReturnSystem.gs
// - onClientReturnSubmit()          → ClientReturnSystem.gs
// - syncClientReturnFormDropdowns() → ClientReturnSystem.gs
// - setupClientReturnTriggersFromOnboarding() → OnboardingSystemClient.gs
// - onAllocationSubmit()            → AllocationSystem.gs
// - syncAllocationFormDropdowns()   → AllocationSystem.gs
// - onboardDesigner()               → OnboardingSystemDesigner.gs
// - standardiseProductTypes()       → ProductTypePatch.gs
// - patchOrphanedActiveJobs()       → OrphanJobPatcher.gs
// - archiveAndCleanupExceptions()   → ExceptionLogArchiverV2.gs
// - findJobRowByKey()               → CompositeKeyFix.gs.gs
// ============================================================

var NOTIFICATION_EMAIL = "blccanada2026@gmail.com";

var CONFIG = {
  sheets: {
    masterJob:         "MASTER_JOB_DATABASE",
    masterJobDatabase: "MASTER_JOB_DATABASE",
    jobStart:          "FORM_Job_Start",
    dailyLog:          "FORM_Daily_Work_Log",
    qcLog:             "FORM_QC_Log",
    clientMaster:      "CLIENT_MASTER",
    designerMaster:    "DESIGNER_MASTER",
    dashboard:         "DASHBOARD_VIEW",
    exceptions:        "EXCEPTIONS_LOG",
    activeJobs:        "ACTIVE_JOBS",
    clientReturn:        "CLIENT_RETURN_LOG",
    formJobAllocation:   "FORM_Job_Allocation",
    jobIntake:           "JOB_INTAKE",
    clientIntakeConfig:  "CLIENT_INTAKE_CONFIG"
  },
  allocationFormId: "1QZUh322IGBJLXSb1B0K-mi90MU_maGpPGnSr8lmZXqY",
  jobStartCols: { timestamp:1, jobNumber:2, clientName:3, designerName:4, expectedCompletion:5, isReallocation:6, sopAcknowledged:7, productType:8 },
  dailyLogCols: { timestamp:1, jobNumber:2, designerName:3, dateWorked:4, productType:5, hoursWorked:6, readyForQC:7, notes:8, sopConfirmation:9 },
  qcLogCols:    { timestamp:1, jobNumber:2, reviewerName:3, dateOfReview:4, hoursSpent:5, productType:6, outcome:7, qcNotes:8, checklistConfirm:9, typeOfReview:10 },
  masterCols: {
    jobNumber:1, clientCode:2, clientName:3, designerName:4, productType:5,
    allocatedDate:6, startDate:7, expectedCompletion:8, actualCompletion:9,
    status:10, designHoursTotal:11, qcHoursTotal:12, totalBillableHours:13,
    reworkHoursMajor:14, reworkHoursMinor:15, qcLead:16, qcStatus:17,
    billingPeriod:18, invoiceMonth:19, sopAcknowledged:20, reallocationFlag:21,
    previousDesigner:22, reworkFlag:23, reworkCount:24, onHoldFlag:25,
    onHoldReason:26, lastUpdated:27, lastUpdatedBy:28, notes:29, rowId:30,
    isTest:31, sqftDesigner:32, sqftVerified:33, boardFootage:34,
    sqftDiscrepancy:35, isImported:36
  },
  productTypes: [
    "Roof Truss", "Floor Truss", "Wall Frame",
    "I-Joist Floor", "Management", "Lumber Estimation"
  ],
  status: {
    allocated:         "Allocated",
    pickedUp:          "Picked Up",
    inDesign:          "In Design",
    submittedForQC:    "Submitted For QC",
    qcInProgress:      "QC In Progress",
    reworkMajor:       "Rework - Major",
    reworkMinor:       "Rework - Minor",
    waitingReQC:       "Waiting Re-QC",
    waitingSpotCheck:  "Waiting Spot Check",
    spotCheckProgress: "Spot Check In Progress",
    onHold:            "On Hold",
    completed:         "Completed - Billable",
    revision:          "Revision"
  }
};

var DESIGNER_NAME_MAP = {
  'Debnath Sen':'Deb Sen', 'DS-Deb Sen':'Deb Sen', 'DS - Deb Sen':'Deb Sen',
  'BC- Bharath Charles':'Bharath Charles', 'BC-Bharath Charles':'Bharath Charles',
  'SG - Sarty Gosh':'Sarty Gosh', 'SG-Sarty Gosh':'Sarty Gosh',
  'DG - Debby Gosh':'Debby Gosh', 'DG-Debby Gosh':'Debby Gosh',
  'RK - Raj Kumar':'Raj Kumar', 'RK-Raj Kumar':'Raj Kumar',
  'Sandy Das':'Samar Kumar Das', 'SKD-Sandy Das':'Samar Kumar Das', 'SKD - Sandy Das':'Samar Kumar Das',
  'SN-Savvy Nath':'Savvy Nath', 'SN - Savvy Nath':'Savvy Nath',
  'SR-Sayan Roy':'Sayan Roy', 'SR - Sayan Roy':'Sayan Roy', 'Sayana Roy':'Sayan Roy',
  'Sagar Banik':'Banik Sagar', 'SB-Sagar Banik':'Banik Sagar', 'SB - Sagar Banik':'Banik Sagar',
  'Pabitra Ghosh':'Pabitra Gosh', 'PG-Pabitra Ghosh':'Pabitra Gosh',
  'PG- Pabitra Ghosh':'Pabitra Gosh', 'PG - Pabitra Ghosh':'Pabitra Gosh',
  'PG-Pabitra Gosh':'Pabitra Gosh', 'PG - Pabitra Gosh':'Pabitra Gosh',
  'Prianka Santra':'Priyanka S', 'PS-Prianka Santra':'Priyanka S', 'PS - Prianka Santra':'Priyanka S',
  'Abby Bera':'Abhijit Bera', 'AB - Abby Bera':'Abhijit Bera', 'AB-Abby Bera':'Abhijit Bera',
  'Ravi Gummadi':'RaviKumar Gummadi', 'RG-Ravi Gummadi':'RaviKumar Gummadi', 'RG - Ravi Gummadi':'RaviKumar Gummadi',
  'VK-Vani':'Vani KV', 'VK - Vani':'Vani KV',
  'Nitish Mishra':'Nitesh Mishra', 'NM-Nitish Mishra':'Nitesh Mishra',
  'AR-Abhisek Rit': 'Abhisek Rit'
};

function normaliseDesignerName(name) {
  var trimmed = String(name).trim();
  return DESIGNER_NAME_MAP[trimmed] || trimmed;
}


// ============================================================
// MENU
// Functions not defined in this file live in their dedicated .gs files.
// Google Apps Script shares all functions across files in the same project.
// ============================================================
/**
 * BLC MENU — ADDITIONS TO onOpen()
 *
 * Your current menu is missing these items. Find the onOpen() function
 * in Code.gs and add the blocks below into the appropriate sections.
 *
 * HOW TO FIND THE RIGHT SPOT:
 * Your onOpen() will have a chain of .addItem() and .addSeparator() calls.
 * Match the section descriptions below to where they logically belong.
 * The full suggested final menu order is shown at the bottom of this file.
 */


// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 1 — Add after "Standardise Product Types" (already in your menu)
// ─────────────────────────────────────────────────────────────────────────────
/*
  .addItem('Sync Form Dropdowns',                   'syncFormDropdowns')
  .addItem('Standardise OWW Product Types',         'standardiseOWWProductTypes')
  .addItem('Patch Management → Job Allocation',     'patchManagementToJobAllocation')
  .addItem('Detect Duplicate Master Rows',          'detectDuplicateMasterRows')
*/


// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 2 — Add a new INVOICING section (does not exist in your menu yet)
// Place this before or after the "Setup All Client Return Forms" separator
// ─────────────────────────────────────────────────────────────────────────────
/*
  .addSeparator()
  .addItem('Generate Invoices',                     'generateInvoices')
  .addItem('Invoice Time Revision (manual fix)',    'invoiceTimeRevision')
*/


// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 3 — Add a new PAYROLL section (does not exist in your menu yet)
// Place this after the invoicing section
// ─────────────────────────────────────────────────────────────────────────────
/*
  .addSeparator()
  .addItem('Run March 2026 Payroll',                'runPayrollMarch2026')
  .addItem('Run Feb 2026 Payroll',                  'runPayrollFeb2026')
  .addItem('Reconcile Payroll vs Invoices',         'reconcilePayrollVsInvoices')
*/


// ─────────────────────────────────────────────────────────────────────────────
// FULL SUGGESTED onOpen() — copy-paste this entire function into Code.gs
// replacing your existing onOpen() completely.
// ─────────────────────────────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('BLC System')

    // ── DASHBOARDS ────────────────────────────────────────────────────────────
    .addItem('Refresh Dashboard',                     'refreshDashboard')
    .addItem('Refresh TL View',                       'refreshTLView')

    // ── DATA STANDARDISATION ──────────────────────────────────────────────────
    .addSeparator()
    .addItem('Standardise Designer Names',            'standardiseDesignerNames')
    .addItem('Standardise Product Types',             'standardiseProductTypes')
    .addItem('Standardise OWW Product Types',         'standardiseOWWProductTypes')
    .addItem('Sync Form Dropdowns',                   'syncFormDropdowns')

    // ── ONE-TIME PATCHES (run once, leave in menu as a record) ────────────────
    .addSeparator()
    .addItem('Patch Orphaned Jobs',                   'patchOrphanedJobs')
    .addItem('Patch Management → Job Allocation',     'patchManagementToJobAllocation')
    .addItem('Detect Duplicate Master Rows',          'detectDuplicateMasterRows')

    // ── INVOICING ─────────────────────────────────────────────────────────────
    .addSeparator()
    .addItem('Generate Invoices',                     'generateInvoices')
    .addItem('Invoice Time Revision (manual fix)',    'invoiceTimeRevision')

    // ── PAYROLL ───────────────────────────────────────────────────────────────
    .addSeparator()
    .addItem('Run March 2026 Payroll',                'runPayrollMarch2026')
    .addItem('Run Feb 2026 Payroll',                  'runPayrollFeb2026')
    .addItem('Reconcile Payroll vs Invoices',         'reconcilePayrollVsInvoices')

    // ── CLIENT MANAGEMENT ─────────────────────────────────────────────────────
    .addSeparator()
    .addItem('Setup All Client Return Forms',         'setupAllClientReturnForms')
    .addItem('Onboard New Client',                    'onboardNewClient')
    .addItem('Setup Client Return Triggers',          'setupClientReturnTriggers')

    // ── DESIGNER MANAGEMENT ───────────────────────────────────────────────────
    .addSeparator()
    .addItem('Onboard / Reactivate Designer',         'onboardNewDesigner')

    // ── EXCEPTION LOG ─────────────────────────────────────────────────────────
    .addSeparator()
    .addItem('Emergency Flush Exception Log',         'emergencyFlushExceptionLog')
    .addItem('Archive Old Exceptions (3+ days)',      'archiveExceptionLog')
    .addItem('Cleanup Old Archive Tabs (90+ days)',   'cleanupOldArchiveTabs')
    .addItem('Check Exception Log Health',            'checkExceptionLogHealth')

    // ── CLIENT PORTAL ─────────────────────────────────────────────────────────
    .addSeparator()
    .addItem('Generate Client Portal Tokens',         'generateClientPortalTokens')
    .addItem('Rotate Client Portal Token',            'rotateClientPortalToken')
    .addItem('Show Client Portal URLs',               'showClientPortalUrls')

    // ── JOB INTAKE (EMAIL PARSER) ─────────────────────────────────────────────
    .addSeparator()
    .addItem('Create Intake Sheets (run once)',        'createIntakeSheets')
    .addItem('Setup Email Intake Trigger (run once)', 'setupEmailIntakeTrigger')
    .addItem('Scan Emails Now (manual run)',           'scanForNewJobEmails')
    .addItem('Test Email Parser',                     'testEmailParser')

    // ── JOB INTAKE — ALLOCATION QUEUE ─────────────────────────────────────────
    .addSeparator()
    .addItem('📋 Allocate from Intake Queue',          'showIntakeQueue')
    .addItem('Refresh Intake Queue View Sheet',        'refreshIntakeQueueView')
    .addItem('Sync Intake → Allocation Form',          'syncIntakeToAllocationForm')

    // ── DIAGNOSTICS ───────────────────────────────────────────────────────────
    .addSeparator()
    .addItem('Diagnose Sync Issues',                  'diagnoseSyncIssues')
    .addItem('Diagnose Form Items',                   'diagnoseFormItems')

    // ── DANGER ZONE ───────────────────────────────────────────────────────────
    .addSeparator()
    .addItem('Setup Triggers (DANGER — deletes all)', 'setupTriggers')
    .addToUi();
    addPhase0MenuItems();
}
// ============================================================
// CORE UTILITY FUNCTIONS
// ============================================================

function getSheet(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    logException("SHEET NOT FOUND", sheetName, "System", "Sheet does not exist");
    throw new Error("Sheet not found: " + sheetName);
  }
  return sheet;
}

function getSheetData(sheetName) {
  return getSheet(sheetName).getDataRange().getValues();
}

function getClientCode(clientName) {
  var data = getSheetData(CONFIG.sheets.clientMaster);
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() === String(clientName).trim()) return data[i][0];
  }
  return "UNKNOWN";
}

function getBillingPeriod(dateValue) {
  var date = new Date(dateValue);
  var month = date.getMonth() + 1;
  var monthStr = month < 10 ? "0" + month : String(month);
  var period = date.getDate() <= 15 ? "1-15" : "16-End";
  return date.getFullYear() + "-" + monthStr + " | " + period;
}

function getInvoiceMonth(dateValue) {
  var date = new Date(dateValue);
  var months = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];
  return months[date.getMonth()] + " " + date.getFullYear();
}

function generateRowId() {
  return "BLC-" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd-HHmmss");
}

/**
 * logException() — Backward-compatible severity wrapper.
 * Routes through logExceptionV2() in ExceptionLogArchiverV2.gs.
 * INFO/DEBUG types are silently skipped (volume reducer).
 */
function logException(type, jobNumber, actor, message) {
  var severity = 'WARNING';
  if (type) {
    var upper = type.toUpperCase();
    if (upper.indexOf('ERROR') !== -1 || upper.indexOf('CRITICAL') !== -1 || upper.indexOf('FAIL') !== -1) {
      severity = 'ERROR';
    } else if (upper.indexOf('INFO') !== -1 || upper.indexOf('DEBUG') !== -1) {
      severity = 'INFO';
    }
  }
  logExceptionV2(severity, jobNumber, actor, type + ': ' + (message || ''));
}

function isValidHours(value) {
  var num = parseFloat(value);
  return !isNaN(num) && num > 0 && num <= 24;
}

function getTimestamp() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
}

function convertExcelDate(val) {
  if (val instanceof Date) return val;
  var num = parseInt(val);
  if (!isNaN(num) && num > 40000) return new Date((num - 25569) * 86400 * 1000);
  return new Date(val);
}

function getHistoricalBillingPeriod(date) {
  try {
    var d = new Date(date);
    var month = String(d.getMonth() + 1).padStart(2, '0');
    return d.getFullYear() + '-' + month + ' | ' + (d.getDate() <= 15 ? '1-15' : '16-End');
  } catch(e) { return '2026-01 | 1-15'; }
}

function getHistoricalInvoiceMonth(date) {
  try {
    var d = new Date(date);
    var months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
    return months[d.getMonth()] + ' ' + d.getFullYear();
  } catch(e) { return 'January 2026'; }
}

function getOrCreateFolder(parent, folderName) {
  var folders = parent.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return parent.createFolder(folderName);
}

function removeCompletedFromActiveJobs(jobNumber) {
  try {
    var sheet = getSheet(CONFIG.sheets.activeJobs);
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim().toUpperCase() === String(jobNumber).trim().toUpperCase()) {
        sheet.deleteRow(i + 1);
        logException("ACTIVE JOBS UPDATED", jobNumber, "System", "Job removed from active list");
        return;
      }
    }
  } catch(error) {
    logException("SCRIPT ERROR - ACTIVE JOBS", jobNumber, "System", error.message);
  }
}


// ============================================================
// FORM SUBMIT ROUTER
// ============================================================

function onFormSubmitRouter(e) {
  try {
    var sheetName = e.range.getSheet().getName();
    if      (sheetName === CONFIG.sheets.jobStart)          onJobStartSubmit(e);
    else if (sheetName === CONFIG.sheets.dailyLog)          onDailyLogSubmit(e);
    else if (sheetName === CONFIG.sheets.qcLog)             onQCLogSubmit(e);
    else if (sheetName === CONFIG.sheets.formJobAllocation) onAllocationSubmit(e);
    else logException("UNKNOWN FORM", sheetName, "System", "Submission from unknown sheet");
  } catch(error) {
    logException("SCRIPT ERROR - ROUTER", "UNKNOWN", "System", error.message);
  }
}


// ============================================================
// JOB START FORM HANDLER
// ============================================================

function onJobStartSubmit(e) {
  try {
    var sheet = getSheet(CONFIG.sheets.jobStart);
    var lastRow = sheet.getLastRow();
    var response = sheet.getRange(lastRow, 1, 1, 8).getValues()[0];

    var timestamp          = response[CONFIG.jobStartCols.timestamp - 1];
    var jobNumber          = String(response[CONFIG.jobStartCols.jobNumber - 1]).trim();
    var clientName         = String(response[CONFIG.jobStartCols.clientName - 1]).trim();
    var designerName       = normaliseDesignerName(response[CONFIG.jobStartCols.designerName - 1]);
    var expectedCompletion = response[CONFIG.jobStartCols.expectedCompletion - 1];
    var isReallocation     = String(response[CONFIG.jobStartCols.isReallocation - 1]).trim();
    var sopAcknowledged    = String(response[CONFIG.jobStartCols.sopAcknowledged - 1]).trim();
    var productType        = String(response[CONFIG.jobStartCols.productType - 1]).trim();
    var isTestJob          = jobNumber.toUpperCase().indexOf("TEST-") === 0 ? "Yes" : "No";

    if (!jobNumber || jobNumber === "") {
      logException("MISSING JOB NUMBER", "UNKNOWN", designerName, "Job Start submitted with no job number");
      return;
    }

    var master = getSheet(CONFIG.sheets.masterJob);
    var existingRow = findJobRow(jobNumber);

    var allData     = master.getDataRange().getValues();
    var colJob      = CONFIG.masterCols.jobNumber  - 1;
    var colStatus   = CONFIG.masterCols.status     - 1;
    var colProduct  = CONFIG.masterCols.productType - 1;
    var colDesigner = CONFIG.masterCols.designerName - 1;

    var terminalStatuses = ["Completed - Billable", "Billed"];
    var activeStatuses   = [
      "Picked Up", "In Design", "Submitted For QC", "QC In Progress",
      "Rework - Major", "Rework - Minor", "Waiting Re-QC",
      "Waiting Spot Check", "Spot Check In Progress", "On Hold", "Allocated"
    ];

    var matchingRows = [];
    for (var r = 1; r < allData.length; r++) {
      if (String(allData[r][colJob]).trim().toUpperCase() !== jobNumber.toUpperCase()) continue;
      matchingRows.push({
        sheetRow:     r + 1,
        status:       String(allData[r][colStatus]).trim(),
        productType:  String(allData[r][colProduct]).trim(),
        designerName: String(allData[r][colDesigner]).trim()
      });
    }

    if (matchingRows.length > 0) {

      var sameProductRows = matchingRows.filter(function(row) {
        return row.productType.toUpperCase() === productType.toUpperCase();
      });

      if (sameProductRows.length === 0) {
        logException("PARALLEL COMPONENT", jobNumber, designerName,
          "New parallel component. Product: " + productType +
          ". Existing product(s): " + matchingRows.map(function(r) {
            return r.productType; }).join(", "));
      } else {

        var sameProductRow = sameProductRows[sameProductRows.length - 1];
        existingRow        = sameProductRow.sheetRow;
        var currentStatus  = sameProductRow.status;

        // ── REVISION WORKFLOW ─────────────────────────────────────
        if (terminalStatuses.indexOf(currentStatus) !== -1) {

          var srcClientCode  = String(master.getRange(existingRow, CONFIG.masterCols.clientCode).getValue()).trim();
          var srcClientName  = String(master.getRange(existingRow, CONFIG.masterCols.clientName).getValue()).trim();
          var srcProductType = String(master.getRange(existingRow, CONFIG.masterCols.productType).getValue()).trim();

          if (!srcClientName || srcClientName === "") srcClientName = clientName;
          var clientCode = srcClientCode || getClientCode(srcClientName);

          var revisionRow = new Array(36).fill("");
          revisionRow[CONFIG.masterCols.jobNumber - 1]          = jobNumber;
          revisionRow[CONFIG.masterCols.clientCode - 1]         = clientCode;
          revisionRow[CONFIG.masterCols.clientName - 1]         = srcClientName;
          revisionRow[CONFIG.masterCols.designerName - 1]       = designerName;
          revisionRow[CONFIG.masterCols.productType - 1]        = srcProductType;
          revisionRow[CONFIG.masterCols.allocatedDate - 1]      = timestamp;
          revisionRow[CONFIG.masterCols.startDate - 1]          = timestamp;
          revisionRow[CONFIG.masterCols.expectedCompletion - 1] = expectedCompletion;
          revisionRow[CONFIG.masterCols.status - 1]             = "Picked Up";
          revisionRow[CONFIG.masterCols.designHoursTotal - 1]   = 0;
          revisionRow[CONFIG.masterCols.qcHoursTotal - 1]       = 0;
          revisionRow[CONFIG.masterCols.totalBillableHours - 1] = 0;
          revisionRow[CONFIG.masterCols.reworkHoursMajor - 1]   = 0;
          revisionRow[CONFIG.masterCols.reworkHoursMinor - 1]   = 0;
          revisionRow[CONFIG.masterCols.sopAcknowledged - 1]    = sopAcknowledged;
          revisionRow[CONFIG.masterCols.reallocationFlag - 1]   = "Yes";
          revisionRow[CONFIG.masterCols.previousDesigner - 1]   = sameProductRow.designerName;
          revisionRow[CONFIG.masterCols.reworkFlag - 1]         = "No";
          revisionRow[CONFIG.masterCols.reworkCount - 1]        = 0;
          revisionRow[CONFIG.masterCols.onHoldFlag - 1]         = "No";
          revisionRow[CONFIG.masterCols.billingPeriod - 1]      = getBillingPeriod(timestamp);
          revisionRow[CONFIG.masterCols.invoiceMonth - 1]       = getInvoiceMonth(timestamp);
          revisionRow[CONFIG.masterCols.lastUpdated - 1]        = getTimestamp();
          revisionRow[CONFIG.masterCols.lastUpdatedBy - 1]      = "Job Start Form - Revision";
          revisionRow[CONFIG.masterCols.rowId - 1]              = Utilities.getUuid();
          revisionRow[CONFIG.masterCols.isTest - 1]             = isTestJob;

          master.appendRow(revisionRow);
          SpreadsheetApp.flush();

          var verifyRow = findJobRowByKey(jobNumber, srcProductType, designerName);
          if (verifyRow === -1) {
            Utilities.sleep(1000);
            master.appendRow(revisionRow);
            SpreadsheetApp.flush();
            logException("REVISION ROW RETRY", jobNumber, designerName,
              "First appendRow failed silently. Retried.");
          }

          var activeSheet = getSheet(CONFIG.sheets.activeJobs);
          activeSheet.appendRow([jobNumber, srcClientName, designerName,
            "Revision", timestamp, expectedCompletion]);

          sendRevisionAlert(jobNumber, designerName, sameProductRow.designerName,
            String(master.getRange(existingRow, CONFIG.masterCols.billingPeriod).getValue()).trim(),
            srcClientName);

          logException("REVISION STARTED", jobNumber, designerName,
            "New revision row created. Client: " + srcClientName +
            " Product: " + srcProductType + " Period: " + getBillingPeriod(timestamp));
          return;
        }

        // ── REALLOCATION WORKFLOW ─────────────────────────────────
        if (isReallocation.toLowerCase().indexOf("yes") !== -1) {
          var oldDesigner = master.getRange(existingRow, CONFIG.masterCols.designerName).getValue();
          master.getRange(existingRow, CONFIG.masterCols.designerName).setValue(designerName);
          master.getRange(existingRow, CONFIG.masterCols.previousDesigner).setValue(oldDesigner);
          master.getRange(existingRow, CONFIG.masterCols.reallocationFlag).setValue("Yes");
          master.getRange(existingRow, CONFIG.masterCols.status).setValue(CONFIG.status.pickedUp);
          master.getRange(existingRow, CONFIG.masterCols.lastUpdated).setValue(getTimestamp());
          master.getRange(existingRow, CONFIG.masterCols.lastUpdatedBy).setValue("Job Start Form - Reallocation");
          logException("REALLOCATION", jobNumber, designerName, "Reallocated from: " + oldDesigner);
          return;
        }

        // ── ALLOCATED PICKUP ──────────────────────────────────────
        // Normal case: job was pre-allocated (status = "Allocated") and
        // designer is now picking it up via the Job Start form.
        // Previously this fell through to DUPLICATE JOB START and was rejected.
        if (currentStatus === CONFIG.status.allocated) {
          if (designerName !== sameProductRow.designerName) {
            logException("WARNING", jobNumber, designerName,
              "Designer mismatch on allocated pickup. Allocated to: " +
              sameProductRow.designerName + ", picking up: " + designerName +
              ". Proceeding — use isReallocation=Yes next time to be explicit.");
          }
          master.getRange(existingRow, CONFIG.masterCols.status).setValue(CONFIG.status.pickedUp);
          master.getRange(existingRow, CONFIG.masterCols.startDate).setValue(timestamp);
          master.getRange(existingRow, CONFIG.masterCols.expectedCompletion).setValue(expectedCompletion);
          master.getRange(existingRow, CONFIG.masterCols.sopAcknowledged).setValue(sopAcknowledged);
          master.getRange(existingRow, CONFIG.masterCols.billingPeriod).setValue(getBillingPeriod(timestamp));
          master.getRange(existingRow, CONFIG.masterCols.invoiceMonth).setValue(getInvoiceMonth(timestamp));
          master.getRange(existingRow, CONFIG.masterCols.lastUpdated).setValue(getTimestamp());
          master.getRange(existingRow, CONFIG.masterCols.lastUpdatedBy).setValue("Job Start Form - Allocated Pickup");
          SpreadsheetApp.flush();

          // Update ACTIVE_JOBS: Allocated → Picked Up
          var activeSheet = getSheet(CONFIG.sheets.activeJobs);
          var activeData  = activeSheet.getDataRange().getValues();
          for (var a = 1; a < activeData.length; a++) {
            if (String(activeData[a][0]).trim().toUpperCase() === jobNumber.toUpperCase()) {
              activeSheet.getRange(a + 1, 6).setValue(CONFIG.status.pickedUp);       // col 6 = Status
              activeSheet.getRange(a + 1, 10).setValue("Job Start Form - Allocated Pickup"); // col 10 = Last_Updated_By
              break;
            }
          }

          logException("INFO_FORCE", jobNumber, designerName,
            "Pre-allocated job picked up. Status: Allocated → Picked Up." +
            " Billing period: " + getBillingPeriod(timestamp));
          return;
        }

        // ── TRUE DUPLICATE ────────────────────────────────────────
        logException("DUPLICATE JOB START", jobNumber, designerName,
          "Job already exists with status: " + currentStatus + ". Product: " + productType);
        return;
      }
    }

    // ── NEW JOB (or new parallel component) ───────────────────
    var clientCode = getClientCode(clientName);
    var rowId = generateRowId();
    var newRow = new Array(36).fill("");

    newRow[CONFIG.masterCols.jobNumber - 1]          = jobNumber;
    newRow[CONFIG.masterCols.clientCode - 1]         = clientCode;
    newRow[CONFIG.masterCols.clientName - 1]         = clientName;
    newRow[CONFIG.masterCols.designerName - 1]       = designerName;
    newRow[CONFIG.masterCols.productType - 1]        = productType;
    newRow[CONFIG.masterCols.allocatedDate - 1]      = timestamp;
    newRow[CONFIG.masterCols.startDate - 1]          = timestamp;
    newRow[CONFIG.masterCols.expectedCompletion - 1] = expectedCompletion;
    newRow[CONFIG.masterCols.status - 1]             = CONFIG.status.pickedUp;
    newRow[CONFIG.masterCols.designHoursTotal - 1]   = 0;
    newRow[CONFIG.masterCols.qcHoursTotal - 1]       = 0;
    newRow[CONFIG.masterCols.totalBillableHours - 1] = 0;
    newRow[CONFIG.masterCols.reworkHoursMajor - 1]   = 0;
    newRow[CONFIG.masterCols.reworkHoursMinor - 1]   = 0;
    newRow[CONFIG.masterCols.sopAcknowledged - 1]    = sopAcknowledged;
    newRow[CONFIG.masterCols.reallocationFlag - 1]   = "No";
    newRow[CONFIG.masterCols.reworkFlag - 1]         = "No";
    newRow[CONFIG.masterCols.reworkCount - 1]        = 0;
    newRow[CONFIG.masterCols.onHoldFlag - 1]         = "No";
    newRow[CONFIG.masterCols.lastUpdated - 1]        = getTimestamp();
    newRow[CONFIG.masterCols.lastUpdatedBy - 1]      = "Job Start Form";
    newRow[CONFIG.masterCols.rowId - 1]              = rowId;
    newRow[CONFIG.masterCols.isTest - 1]             = isTestJob;

    master.appendRow(newRow);
    SpreadsheetApp.flush();

    var verifyNewRow = findJobRow(jobNumber);
    if (verifyNewRow === -1) {
      Utilities.sleep(1000);
      master.appendRow(newRow);
      SpreadsheetApp.flush();
      logException("JOB CREATE RETRY", jobNumber, designerName, "appendRow failed silently. Retried.");
    }

    var activeSheet = getSheet(CONFIG.sheets.activeJobs);
    activeSheet.appendRow([jobNumber, clientName, designerName,
      CONFIG.status.pickedUp, timestamp, expectedCompletion]);

    logException("JOB CREATED", jobNumber, designerName, "New job created. Client: " + clientName);

  } catch(error) {
    logException("SCRIPT ERROR - JOB START", "UNKNOWN", "System", error.message);
  }
}


// ============================================================
// REVISION ALERT EMAIL
// Called by onJobStartSubmit() during revision workflow.
// ============================================================

function sendRevisionAlert(jobNumber, newDesigner, previousDesigner, billingPeriod, clientName) {
  try {
    var subject = '🔄 Revision Started — ' + jobNumber + ' — ' + clientName;

    var body =
      '<div style="font-family:Arial,sans-serif;max-width:600px;">' +
      '<div style="background:#5B9EC9;padding:20px;text-align:center;">' +
      '<span style="color:#F2C94C;font-size:22px;font-weight:bold;">REVISION ALERT</span>' +
      '<span style="color:white;font-size:13px;display:block;margin-top:5px;">Blue Lotus Consulting</span>' +
      '</div><div style="padding:20px;">' +
      '<h2 style="color:#5B9EC9;">Job Revision Started</h2>' +
      '<div style="background:#EAF3FB;padding:15px;border-radius:6px;border-left:4px solid #1E4D7B;">' +
      '<p style="margin:5px 0;"><b>Job Number:</b> ' + jobNumber + '</p>' +
      '<p style="margin:5px 0;"><b>Client:</b> ' + clientName + '</p>' +
      '<p style="margin:5px 0;"><b>New Designer:</b> ' + newDesigner + '</p>' +
      '<p style="margin:5px 0;"><b>Previous Designer:</b> ' + previousDesigner + '</p>' +
      '<p style="margin:5px 0;"><b>Original Billing Period:</b> ' + billingPeriod + '</p>' +
      '</div>' +
      '<p style="margin-top:16px;">A new revision row has been created in MASTER_JOB_DATABASE. ' +
      'The original completed row is preserved. The revision row has its own billing period.</p>' +
      '<h3 style="color:#1E4D7B;">Action Required:</h3>' +
      '<ol><li>Verify the revision scope with the client</li>' +
      '<li>Confirm the designer assignment</li>' +
      '<li>Monitor progress in the TL View</li></ol>' +
      '</div><div style="background:#f5f5f5;padding:10px;text-align:center;color:#999;font-size:11px;">' +
      'BLC Job Management System — Auto Notification</div></div>';

    GmailApp.sendEmail(NOTIFICATION_EMAIL, subject, 'Please enable HTML.',
      { htmlBody: body, name: 'BLC Job System' });

    var designerData = getSheetData(CONFIG.sheets.designerMaster);
    for (var i = 1; i < designerData.length; i++) {
      if (String(designerData[i][8] || '').trim() !== 'Yes') continue;
      var role  = String(designerData[i][4] || '').trim();
      var email = String(designerData[i][2] || '').trim();
      if (!email) continue;
      if (role === 'Project Manager' || role === 'Team Leader' || role === 'QC Reviewer') {
        GmailApp.sendEmail(email, subject, 'Please enable HTML.',
          { htmlBody: body, name: 'BLC Job System' });
      }
    }

  } catch (err) {
    logException('ERROR', jobNumber, 'sendRevisionAlert', 'Failed: ' + err.message);
  }
}


// ============================================================
// DAILY LOG FORM HANDLER
// ============================================================

function onDailyLogSubmit(e) {
  try {
    var sheet = getSheet(CONFIG.sheets.dailyLog);
    var lastRow = sheet.getLastRow();
    var response = sheet.getRange(lastRow, 1, 1, 10).getValues()[0];

    var jobNumber    = String(response[CONFIG.dailyLogCols.jobNumber - 1]).trim();
    var designerName = normaliseDesignerName(response[CONFIG.dailyLogCols.designerName - 1]);
    var dateWorked   = response[CONFIG.dailyLogCols.dateWorked - 1];
    var productType  = String(response[CONFIG.dailyLogCols.productType - 1]).trim();
    var hoursWorked  = response[CONFIG.dailyLogCols.hoursWorked - 1];
    var readyForQC   = String(response[CONFIG.dailyLogCols.readyForQC - 1]).trim();
    var sqftDesigner = String(response[7] || "").trim();

    var hoursNum = parseFloat(hoursWorked) || 0;
    if (hoursNum > 10) {
      var designerSheet = getSheet(CONFIG.sheets.designerMaster);
      var designerData = designerSheet.getDataRange().getValues();
      var pmEmail = '', tlEmail = '';
      for (var di = 1; di < designerData.length; di++) {
        if (String(designerData[di][8] || '').trim() !== 'Yes') continue;
        var dRole = String(designerData[di][4] || '').trim();
        if (dRole === 'Project Manager') pmEmail = String(designerData[di][2] || '').trim();
        if (dRole === 'Team Leader')     tlEmail = String(designerData[di][2] || '').trim();
      }
      var anomalySubject = 'Hours Anomaly - ' + designerName + ' logged ' + hoursNum + ' hrs on ' + jobNumber;
      var anomalyBody = 'HOURS ANOMALY ALERT\n\nDesigner: ' + designerName + '\nJob: ' + jobNumber + '\nHours: ' + hoursNum + '\nDate: ' + dateWorked + '\nProduct: ' + productType + '\n\nExceeds 10hr threshold.\n\nBLC Job Management System';
      GmailApp.sendEmail(NOTIFICATION_EMAIL, anomalySubject, anomalyBody, { name: 'BLC Job System' });
      if (pmEmail) GmailApp.sendEmail(pmEmail, anomalySubject, anomalyBody, { name: 'BLC Job System' });
      if (tlEmail) GmailApp.sendEmail(tlEmail, anomalySubject, anomalyBody, { name: 'BLC Job System' });
      logException('HOURS ANOMALY', jobNumber, designerName, 'Hours: ' + hoursNum + ' exceeds threshold');
    }

    if (!jobNumber || jobNumber === "") {
      logException("MISSING JOB NUMBER", "UNKNOWN", designerName, "Daily log with no job number");
      return;
    }
    if (!isValidHours(hoursWorked)) {
      logException("INVALID HOURS", jobNumber, designerName, "Invalid hours: " + hoursWorked);
      return;
    }

    var jobRow = findJobRowByKey(jobNumber, productType, designerName);
    if (jobRow === -1) {
      logException("JOB NOT FOUND", jobNumber, designerName, "Not found for product: " + productType);
      return;
    }

    var master = getSheet(CONFIG.sheets.masterJob);
    var currentStatus = String(master.getRange(jobRow, CONFIG.masterCols.status).getValue()).trim();
    var VALID_STATUSES_FOR_LOGGING = [
      "Picked Up", "In Design", "Rework - Major", "Rework - Minor",
      "Waiting Re-QC", "Submitted For QC", "Revision"
    ];

    if (VALID_STATUSES_FOR_LOGGING.indexOf(currentStatus) === -1) {
      logException("INVALID STATUS", jobNumber, designerName, "Cannot log hours. Status: " + currentStatus);
      return;
    }

    var newHours = parseFloat(hoursWorked);
    var isRework = (currentStatus === CONFIG.status.reworkMajor || currentStatus === CONFIG.status.reworkMinor);

    if (isRework) {
      if (currentStatus === CONFIG.status.reworkMajor) {
        var curMajor = parseFloat(master.getRange(jobRow, CONFIG.masterCols.reworkHoursMajor).getValue()) || 0;
        master.getRange(jobRow, CONFIG.masterCols.reworkHoursMajor).setValue(curMajor + newHours);
      } else {
        var curMinor = parseFloat(master.getRange(jobRow, CONFIG.masterCols.reworkHoursMinor).getValue()) || 0;
        master.getRange(jobRow, CONFIG.masterCols.reworkHoursMinor).setValue(curMinor + newHours);
      }
    } else {
      var currentDesignHours = parseFloat(master.getRange(jobRow, CONFIG.masterCols.designHoursTotal).getValue()) || 0;
      master.getRange(jobRow, CONFIG.masterCols.designHoursTotal).setValue(currentDesignHours + newHours);
    }

    var curProductType = String(master.getRange(jobRow, CONFIG.masterCols.productType).getValue()).trim();
    if (!curProductType || curProductType === "") {
      master.getRange(jobRow, CONFIG.masterCols.productType).setValue(productType);
    }

    var designHours = parseFloat(master.getRange(jobRow, CONFIG.masterCols.designHoursTotal).getValue()) || 0;
    var qcHours     = parseFloat(master.getRange(jobRow, CONFIG.masterCols.qcHoursTotal).getValue()) || 0;
    master.getRange(jobRow, CONFIG.masterCols.totalBillableHours).setValue(designHours + qcHours);

    var newStatus = CONFIG.status.inDesign;
    if (readyForQC.toLowerCase().indexOf("yes") !== -1) {
      newStatus = CONFIG.status.submittedForQC;
      master.getRange(jobRow, CONFIG.masterCols.actualCompletion).setValue(dateWorked);
      master.getRange(jobRow, CONFIG.masterCols.billingPeriod).setValue(getBillingPeriod(dateWorked));
      master.getRange(jobRow, CONFIG.masterCols.invoiceMonth).setValue(getInvoiceMonth(dateWorked));
      if (sqftDesigner !== "") {
        master.getRange(jobRow, CONFIG.masterCols.sqftDesigner).setValue(sqftDesigner);
      }
    } else if (isRework) {
      newStatus = currentStatus;
    }

    master.getRange(jobRow, CONFIG.masterCols.status).setValue(newStatus);
    master.getRange(jobRow, CONFIG.masterCols.lastUpdated).setValue(getTimestamp());
    master.getRange(jobRow, CONFIG.masterCols.lastUpdatedBy).setValue("Daily Work Log");

    // INFO severity — routine event, skipped by filter
    logException("INFO", jobNumber, designerName, "Hours: " + newHours + " Status: " + newStatus);

  } catch(error) {
    logException("SCRIPT ERROR - DAILY LOG", "UNKNOWN", "System", error.message);
  }
}


// ============================================================
// QC LOG FORM HANDLER
// ============================================================

function onQCLogSubmit(e) {
  try {
    var sheet    = getSheet(CONFIG.sheets.qcLog);
    var lastRow  = sheet.getLastRow();
    var response = sheet.getRange(lastRow, 1, 1, 12).getValues()[0];

    var jobNumber    = String(response[CONFIG.qcLogCols.jobNumber    - 1]).trim();
    var reviewerName = normaliseDesignerName(response[CONFIG.qcLogCols.reviewerName - 1]);
    var dateOfReview = response[CONFIG.qcLogCols.dateOfReview - 1];
    var hoursSpent   = response[CONFIG.qcLogCols.hoursSpent   - 1];
    var productType  = String(response[CONFIG.qcLogCols.productType  - 1]).trim();
    var outcome      = String(response[CONFIG.qcLogCols.outcome      - 1]).trim();
    var sqftVerified = String(response[9]  || "").trim();
    var boardFootage = String(response[10] || "").trim();

    if (!jobNumber || jobNumber === "") {
      logException("MISSING JOB NUMBER", "UNKNOWN", reviewerName, "QC log with no job number");
      return;
    }

    var parsedHours = parseFloat(hoursSpent);
    if (isNaN(parsedHours) || parsedHours <= 0 || parsedHours > 24) {
      logException("INVALID HOURS", jobNumber, reviewerName, "Invalid QC hours: " + hoursSpent);
      return;
    }

    var master  = getSheet(CONFIG.sheets.masterJobDatabase);
    var allData = master.getDataRange().getValues();
    var colJob     = CONFIG.masterCols.jobNumber  - 1;
    var colStatus  = CONFIG.masterCols.status     - 1;
    var colProduct = CONFIG.masterCols.productType - 1;

    var terminalStatuses = ["Completed - Billable", "Billed"];
    var activeStatuses   = [
      "Picked Up", "In Design", "Submitted For QC", "QC In Progress",
      "Rework - Major", "Rework - Minor", "Waiting Re-QC",
      "Waiting Spot Check", "Spot Check In Progress", "On Hold",
      "Allocated", "Rework - In Progress"
    ];

    var exactMatch = -1, activeAny = -1, terminalExact = -1, terminalAny = -1;

    for (var r = 1; r < allData.length; r++) {
      var rJob     = allData[r][colJob]     ? String(allData[r][colJob]).trim()     : "";
      var rStatus  = allData[r][colStatus]  ? String(allData[r][colStatus]).trim()  : "";
      var rProduct = allData[r][colProduct] ? String(allData[r][colProduct]).trim() : "";

      if (rJob !== jobNumber) continue;
      var isActive   = activeStatuses.indexOf(rStatus)   !== -1;
      var isTerminal = terminalStatuses.indexOf(rStatus) !== -1;
      var productMatch = (rProduct === productType) || (rProduct === "" && productType !== "");

      if (isActive) {
        if (productMatch && rProduct === productType) { exactMatch = r + 1; }
        else { activeAny = r + 1; }
      } else if (isTerminal) {
        if (productMatch && rProduct === productType) { terminalExact = r + 1; }
        else { terminalAny = r + 1; }
      }
    }

    var jobRow = -1, matchType = "";
    if (exactMatch !== -1) {
      jobRow = exactMatch; matchType = "active + exact product";
    } else if (activeAny !== -1) {
      jobRow = activeAny; matchType = "active + no product match — fallback";
      logException("QC PRODUCT MISMATCH", jobNumber, reviewerName,
        "QC product '" + productType + "' did not match. Using fallback.");
    } else if (terminalExact !== -1) {
      logException("QC MATCH FAILED", jobNumber, reviewerName, "Only completed row found. Aborted.");
      return;
    } else if (terminalAny !== -1) {
      logException("QC MATCH FAILED", jobNumber, reviewerName, "Only terminal rows. Aborted.");
      return;
    } else {
      logException("JOB NOT FOUND", jobNumber, reviewerName, "Not in master. Aborted.");
      return;
    }

    var matchedStatus = String(allData[jobRow - 1][colStatus]).trim();
    var qcReadyStatuses = ["Submitted For QC", "QC In Progress", "Waiting Re-QC",
      "Waiting Spot Check", "Spot Check In Progress"];
    if (qcReadyStatuses.indexOf(matchedStatus) === -1) {
      logException("UNEXPECTED QC STATUS", jobNumber, reviewerName,
        "Row status '" + matchedStatus + "'. Proceeding but flagging.");
    }

    var rowData      = allData[jobRow - 1];
    var curQCHours   = parseFloat(rowData[CONFIG.masterCols.qcHoursTotal    - 1]) || 0;
    var designHours  = parseFloat(rowData[CONFIG.masterCols.designHoursTotal - 1]) || 0;
    var curSqftDes   = parseFloat(rowData[CONFIG.masterCols.sqftDesigner    - 1]) || 0;
    var curReworkCnt = parseFloat(rowData[CONFIG.masterCols.reworkCount     - 1]) || 0;
    var newQCTotal   = curQCHours + parsedHours;

    var newStatus = "", newQCStatus = "", outcomeLower = outcome.toLowerCase();
    var isCompletion = false, isRework = false, newReworkCnt = curReworkCnt;

    if      (outcomeLower.indexOf("re-qc pass") !== -1)          { newStatus = CONFIG.status.completed;   newQCStatus = "Re-QC Passed";         isCompletion = true; }
    else if (outcomeLower.indexOf("re-qc failed") !== -1)        { newStatus = CONFIG.status.reworkMajor; newQCStatus = "Re-QC Failed";          isRework = true; newReworkCnt++; }
    else if (outcomeLower.indexOf("spot check approved") !== -1) { newStatus = CONFIG.status.completed;   newQCStatus = "Spot Check Approved";  isCompletion = true; }
    else if (outcomeLower.indexOf("spot check escalated") !== -1){ newStatus = CONFIG.status.reworkMajor; newQCStatus = "Spot Check Escalated"; isRework = true; newReworkCnt++; }
    else if (outcomeLower.indexOf("major error") !== -1)         { newStatus = CONFIG.status.reworkMajor; newQCStatus = "Major Error";           isRework = true; newReworkCnt++; }
    else if (outcomeLower.indexOf("minor error") !== -1)         { newStatus = CONFIG.status.reworkMinor; newQCStatus = "Minor Error";           isRework = true; newReworkCnt++; }
    else if (outcomeLower.indexOf("pass") !== -1)                { newStatus = CONFIG.status.completed;   newQCStatus = "Passed";               isCompletion = true; }
    else                                                         { newStatus = CONFIG.status.qcInProgress; newQCStatus = "In Progress"; }

    master.getRange(jobRow, CONFIG.masterCols.qcHoursTotal).setValue(newQCTotal);
    master.getRange(jobRow, CONFIG.masterCols.totalBillableHours).setValue(designHours + newQCTotal);
    master.getRange(jobRow, CONFIG.masterCols.qcLead).setValue(reviewerName);
    master.getRange(jobRow, CONFIG.masterCols.qcStatus).setValue(newQCStatus);
    master.getRange(jobRow, CONFIG.masterCols.status).setValue(newStatus);
    master.getRange(jobRow, CONFIG.masterCols.lastUpdated).setValue(new Date());
    master.getRange(jobRow, CONFIG.masterCols.lastUpdatedBy).setValue("QC Log");

    if (isRework) {
      master.getRange(jobRow, CONFIG.masterCols.reworkFlag).setValue("Yes");
      master.getRange(jobRow, CONFIG.masterCols.reworkCount).setValue(newReworkCnt);
    }
    if (isCompletion) {
      master.getRange(jobRow, CONFIG.masterCols.billingPeriod).setValue(getBillingPeriod(dateOfReview));
      master.getRange(jobRow, CONFIG.masterCols.invoiceMonth).setValue(getInvoiceMonth(dateOfReview));
    }
    if (sqftVerified !== "") {
      master.getRange(jobRow, CONFIG.masterCols.sqftVerified).setValue(sqftVerified);
      var sqftVer = parseFloat(sqftVerified) || 0;
      if (curSqftDes > 0 && sqftVer > 0) {
        var discrepancy = Math.abs(curSqftDes - sqftVer) / curSqftDes * 100;
        master.getRange(jobRow, CONFIG.masterCols.sqftDiscrepancy)
          .setValue(discrepancy > 5 ? "YES - " + discrepancy.toFixed(1) + "%" : "No");
      }
    }
    if (boardFootage !== "") {
      master.getRange(jobRow, CONFIG.masterCols.boardFootage).setValue(boardFootage);
    }

    SpreadsheetApp.flush();
    if (isCompletion) { removeCompletedFromActiveJobs(jobNumber); }

    logException("QC LOGGED", jobNumber, reviewerName,
      "Outcome: " + outcome + " — Product: " + productType + " — Match: " + matchType + " — Status: " + newStatus);

  } catch (error) {
    logException("SCRIPT ERROR - QC LOG", "UNKNOWN", "System",
      error.message + (error.stack ? " | " + error.stack : ""));
  }
}


// ============================================================
// DASHBOARD REFRESH
// CRITICAL FIX: populateTLView() moved OUTSIDE the loop.
// Was called ~800x per refresh — root cause of 50k exception rows.
// ============================================================

function refreshDashboard() {
  try {
    var master = getSheet(CONFIG.sheets.masterJob);
    var data = master.getDataRange().getValues();
    var dash = getSheet(CONFIG.sheets.dashboard);

    var total = 0, allocated = 0, pickedUp = 0, inDesign = 0;
    var submittedForQC = 0, qcInProgress = 0, reworkMajor = 0, reworkMinor = 0;
    var waitingReQC = 0, waitingSpotCheck = 0, onHold = 0, completed = 0;
    var totalDesignHours = 0, totalQCHours = 0, totalBillableHours = 0;
    var totalReworkMajor = 0, totalReworkMinor = 0;

    for (var i = 1; i < data.length; i++) {
      if (!data[i][0] || data[i][0] === "") continue;
      if (String(data[i][CONFIG.masterCols.isTest - 1]).trim() === "Yes") continue;
      total++;
      var status = String(data[i][CONFIG.masterCols.status - 1]).trim();

      if      (status === CONFIG.status.allocated)          allocated++;
      else if (status === CONFIG.status.pickedUp)           pickedUp++;
      else if (status === CONFIG.status.inDesign)           inDesign++;
      else if (status === CONFIG.status.submittedForQC)     submittedForQC++;
      else if (status === CONFIG.status.qcInProgress)       qcInProgress++;
      else if (status === CONFIG.status.reworkMajor)        reworkMajor++;
      else if (status === CONFIG.status.reworkMinor)        reworkMinor++;
      else if (status === CONFIG.status.waitingReQC)        waitingReQC++;
      else if (status === CONFIG.status.waitingSpotCheck)   waitingSpotCheck++;
      else if (status === CONFIG.status.onHold)             onHold++;
      else if (status === CONFIG.status.completed)          completed++;

      totalDesignHours   += parseFloat(data[i][CONFIG.masterCols.designHoursTotal - 1]) || 0;
      totalQCHours       += parseFloat(data[i][CONFIG.masterCols.qcHoursTotal - 1]) || 0;
      totalBillableHours += parseFloat(data[i][CONFIG.masterCols.totalBillableHours - 1]) || 0;
      totalReworkMajor   += parseFloat(data[i][CONFIG.masterCols.reworkHoursMajor - 1]) || 0;
      totalReworkMinor   += parseFloat(data[i][CONFIG.masterCols.reworkHoursMinor - 1]) || 0;
    }

    // populateTLView() — called ONCE after the loop, not inside it
    populateTLView();

    dash.getRange("A1").setValue("BLC DASHBOARD");
    dash.getRange("A2").setValue("Last Updated:");
    dash.getRange("B2").setValue(new Date());
    dash.getRange("A4").setValue("JOB STATUS SUMMARY");
    dash.getRange("A5").setValue("Total Jobs");           dash.getRange("B5").setValue(total);
    dash.getRange("A6").setValue("Allocated");            dash.getRange("B6").setValue(allocated);
    dash.getRange("A7").setValue("Picked Up");            dash.getRange("B7").setValue(pickedUp);
    dash.getRange("A8").setValue("In Design");            dash.getRange("B8").setValue(inDesign);
    dash.getRange("A9").setValue("Submitted For QC");     dash.getRange("B9").setValue(submittedForQC);
    dash.getRange("A10").setValue("QC In Progress");      dash.getRange("B10").setValue(qcInProgress);
    dash.getRange("A11").setValue("Rework - Major");      dash.getRange("B11").setValue(reworkMajor);
    dash.getRange("A12").setValue("Rework - Minor");      dash.getRange("B12").setValue(reworkMinor);
    dash.getRange("A13").setValue("Waiting Re-QC");       dash.getRange("B13").setValue(waitingReQC);
    dash.getRange("A14").setValue("Waiting Spot Check");  dash.getRange("B14").setValue(waitingSpotCheck);
    dash.getRange("A15").setValue("On Hold");             dash.getRange("B15").setValue(onHold);
    dash.getRange("A16").setValue("Completed - Billable");dash.getRange("B16").setValue(completed);
    dash.getRange("A18").setValue("HOURS SUMMARY");
    dash.getRange("A19").setValue("Total Design Hours");  dash.getRange("B19").setValue(totalDesignHours);
    dash.getRange("A20").setValue("Total QC Hours");      dash.getRange("B20").setValue(totalQCHours);
    dash.getRange("A21").setValue("Total Billable Hours");dash.getRange("B21").setValue(totalBillableHours);
    dash.getRange("A22").setValue("Rework Hours - Major");dash.getRange("B22").setValue(totalReworkMajor);
    dash.getRange("A23").setValue("Rework Hours - Minor");dash.getRange("B23").setValue(totalReworkMinor);

    // INFO — routine, skipped by severity filter
    logException("INFO", "SYSTEM", "Auto", "Dashboard updated successfully");

  } catch(error) {
    logException("SCRIPT ERROR - DASHBOARD", "UNKNOWN", "System", error.message);
  }
}


// ============================================================
// SETUP TRIGGERS — CONFIRMATION GUARD
// ============================================================

function setupTriggers() {
  try {
    var ui = SpreadsheetApp.getUi();
    var confirm = ui.alert(
      '⚠️ DANGER — Delete All Triggers?',
      'This DELETES all triggers and recreates only 3 core triggers.\n\n' +
      'You will need to MANUALLY recreate:\n' +
      '• archiveAndCleanupExceptions (daily midnight)\n' +
      '• patchOrphanedActiveJobs (daily 6am)\n' +
      '• All onClientReturnSubmit form triggers\n\n' +
      'Are you SURE?',
      ui.ButtonSet.YES_NO
    );
    if (confirm !== ui.Button.YES) {
      ui.alert('Cancelled. No triggers changed.');
      return;
    }

    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) { ScriptApp.deleteTrigger(triggers[i]); }
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    ScriptApp.newTrigger("onFormSubmitRouter").forSpreadsheet(ss).onFormSubmit().create();
    ScriptApp.newTrigger("refreshDashboard").timeBased().everyMinutes(15).create();
    ScriptApp.newTrigger("sendDailyDigest").timeBased().atHour(17).everyDays(1).create();

    logException("TRIGGERS SETUP", "SYSTEM", "Admin", "3 core triggers created");
    ui.alert("✅ 3 core triggers created.\n\n⚠️ MANUALLY add:\n• archiveAndCleanupExceptions\n• patchOrphanedActiveJobs\n• Client return form triggers");

  } catch(error) {
    logException("SCRIPT ERROR - SETUP TRIGGERS", "UNKNOWN", "System", error.message);
    SpreadsheetApp.getUi().alert("Error: " + error.message);
  }
}


// ============================================================
// FORM DROPDOWN SYNC (internal forms only)
// Client return form sync lives in ClientReturnSystem.gs
// ============================================================

function syncFormDropdowns() {
  var ss          = SpreadsheetApp.getActiveSpreadsheet();
  var syncResults = [];
  var hasErrors   = false;

  // ── 1. Client names (from CLIENT_MASTER, active only) ─────────────────────
  var clientNames = [];
  try {
    var clientData = getSheetData(CONFIG.sheets.clientMaster);
    for (var i = 1; i < clientData.length; i++) {
      var cName   = String(clientData[i][1]  || '').trim();
      var cActive = String(clientData[i][9]  || '').trim();
      if (cName && cActive === 'Yes') clientNames.push(cName);
    }
    if (clientNames.length === 0) {
      syncResults.push('⚠ No active clients found in CLIENT_MASTER');
      hasErrors = true;
    }
  } catch (err) {
    syncResults.push('CLIENT_MASTER read error: ' + err.message);
    hasErrors = true;
  }

  // ── 2. Designer names + QC reviewer names (from DESIGNER_MASTER) ──────────
  var designerNames    = [];
  var qcReviewerNames  = [];
  try {
    var designerData = getSheetData(CONFIG.sheets.designerMaster);
    for (var j = 1; j < designerData.length; j++) {
      var dName   = String(designerData[j][1] || '').trim(); // col B index 1
      var dActive = String(designerData[j][8] || '').trim(); // col I index 8
      var dRole   = String(designerData[j][4] || '').trim(); // col E index 4
      if (!dName || dActive !== 'Yes') continue;
      designerNames.push(dName);
      if (dRole === 'Team Leader'     ||
          dRole === 'Project Manager' ||
          dRole === 'QC Reviewer'     ||
          dRole === 'Senior Designer') {
        qcReviewerNames.push(dName);
      }
    }
    if (designerNames.length === 0) {
      syncResults.push('⚠ No active designers found in DESIGNER_MASTER');
      hasErrors = true;
    }
  } catch (err) {
    syncResults.push('DESIGNER_MASTER read error: ' + err.message);
    hasErrors = true;
  }

  // ── 3. Product types — canonical list including Job Allocation ─────────────
  // This list is the single source of truth for all form dropdowns.
  // To add a new product type: add it here, then run this function.
  var productTypes = [
    'Roof Truss',
    'Floor Truss',
    'Wall Frame',
    'I-Joist Floor',
    'Job Allocation'
  ];

  // ── 4. Job Start Form ──────────────────────────────────────────────────────
  // Syncs: Client Name, Designer Name, Product Type
  try {
    var jobStartSheet = ss.getSheetByName(CONFIG.sheets.jobStart);
    if (jobStartSheet) {
      var jsUrl = jobStartSheet.getFormUrl();
      if (jsUrl) {
        var jsForm  = FormApp.openByUrl(jsUrl);
        var jsItems = jsForm.getItems();
        var jsFound = { client: false, designer: false, product: false };

        for (var a = 0; a < jsItems.length; a++) {
          var jsTitle = jsItems[a].getTitle().trim();
          var jsType  = jsItems[a].getType();

          if (jsTitle === 'Client Name' &&
              jsType  === FormApp.ItemType.LIST &&
              clientNames.length > 0) {
            jsItems[a].asListItem().setChoiceValues(clientNames);
            jsFound.client = true;
          }

          if (jsTitle === 'Designer Name' &&
              jsType  === FormApp.ItemType.LIST &&
              designerNames.length > 0) {
            jsItems[a].asListItem().setChoiceValues(designerNames);
            jsFound.designer = true;
          }

          if (jsTitle === 'Product Type' &&
              jsType  === FormApp.ItemType.LIST) {
            jsItems[a].asListItem().setChoiceValues(productTypes);
            jsFound.product = true;
          }
        }

        syncResults.push(
          'Job Start Form:  ' +
          'Client '   + (jsFound.client   ? '✓' : '✗ MISS') + '  |  ' +
          'Designer ' + (jsFound.designer ? '✓' : '✗ MISS') + '  |  ' +
          'Product '  + (jsFound.product  ? '✓' : '✗ MISS (question title must be "Product Type")')
        );
        if (!jsFound.product) hasErrors = true;
      } else {
        syncResults.push('Job Start Form: ✗ No form URL found on sheet');
        hasErrors = true;
      }
    } else {
      syncResults.push('Job Start Form: ✗ Sheet not found: ' + CONFIG.sheets.jobStart);
      hasErrors = true;
    }
  } catch (err) {
    syncResults.push('Job Start Form: ERROR — ' + err.message);
    hasErrors = true;
  }

  // ── 5. Daily Work Log Form ─────────────────────────────────────────────────
  // Syncs: Your Name (designer), Product Type
  try {
    var dailyLogSheet = ss.getSheetByName(CONFIG.sheets.dailyLog);
    if (dailyLogSheet) {
      var dlUrl = dailyLogSheet.getFormUrl();
      if (dlUrl) {
        var dlForm  = FormApp.openByUrl(dlUrl);
        var dlItems = dlForm.getItems();
        var dlFound = { designer: false, product: false };

        for (var b = 0; b < dlItems.length; b++) {
          var dlTitle = dlItems[b].getTitle().trim();
          var dlType  = dlItems[b].getType();

          if (dlTitle === 'Your Name' &&
              dlType  === FormApp.ItemType.LIST &&
              designerNames.length > 0) {
            dlItems[b].asListItem().setChoiceValues(designerNames);
            dlFound.designer = true;
          }

          if (dlTitle === 'Product Type' &&
              dlType  === FormApp.ItemType.LIST) {
            dlItems[b].asListItem().setChoiceValues(productTypes);
            dlFound.product = true;
          }
        }

        syncResults.push(
          'Daily Work Log: ' +
          'Designer ' + (dlFound.designer ? '✓' : '✗ MISS') + '  |  ' +
          'Product '  + (dlFound.product  ? '✓' : '✗ MISS (question title must be "Product Type")')
        );
        if (!dlFound.product) hasErrors = true;
      } else {
        syncResults.push('Daily Work Log: ✗ No form URL found on sheet');
        hasErrors = true;
      }
    } else {
      syncResults.push('Daily Work Log: ✗ Sheet not found: ' + CONFIG.sheets.dailyLog);
      hasErrors = true;
    }
  } catch (err) {
    syncResults.push('Daily Work Log: ERROR — ' + err.message);
    hasErrors = true;
  }

  // ── 6. QC Log Form ─────────────────────────────────────────────────────────
  // Syncs: QC Reviewer Name, Product Type
  try {
    var qcLogSheet = ss.getSheetByName(CONFIG.sheets.qcLog);
    if (qcLogSheet) {
      var qcUrl = qcLogSheet.getFormUrl();
      if (qcUrl) {
        var qcForm  = FormApp.openByUrl(qcUrl);
        var qcItems = qcForm.getItems();
        var qcFound = { reviewer: false, product: false };

        for (var c = 0; c < qcItems.length; c++) {
          var qcTitle = qcItems[c].getTitle().trim();
          var qcType  = qcItems[c].getType();

          if (qcTitle === 'QC Reviewer Name' &&
              qcType  === FormApp.ItemType.LIST &&
              qcReviewerNames.length > 0) {
            qcItems[c].asListItem().setChoiceValues(qcReviewerNames);
            qcFound.reviewer = true;
          }

          if (qcTitle === 'Product Type' &&
              qcType  === FormApp.ItemType.LIST) {
            qcItems[c].asListItem().setChoiceValues(productTypes);
            qcFound.product = true;
          }
        }

        syncResults.push(
          'QC Log Form:     ' +
          'Reviewers ' + (qcFound.reviewer ? '✓' : '✗ MISS') + '  |  ' +
          'Product '   + (qcFound.product  ? '✓' : '✗ MISS (question title must be "Product Type")')
        );
        if (!qcFound.product) hasErrors = true;
      } else {
        syncResults.push('QC Log Form: ✗ No form URL found on sheet');
        hasErrors = true;
      }
    } else {
      syncResults.push('QC Log Form: ✗ Sheet not found: ' + CONFIG.sheets.qcLog);
      hasErrors = true;
    }
  } catch (err) {
    syncResults.push('QC Log Form: ERROR — ' + err.message);
    hasErrors = true;
  }

  // ── 7. Log and alert ────────────────────────────────────────────────────────
  logException(
    'INFO', 'SYSTEM', 'syncFormDropdowns',
    'Sync complete — Clients: ' + clientNames.length +
    ' Designers: ' + designerNames.length +
    ' QC Reviewers: ' + qcReviewerNames.length +
    ' Product Types: ' + productTypes.length
  );

  SpreadsheetApp.getUi().alert(
    'Form Dropdowns Sync\n\n' +
    syncResults.join('\n') +
    '\n\n' +
    'Clients: '       + clientNames.length    + '  |  ' +
    'Designers: '     + designerNames.length  + '  |  ' +
    'QC Reviewers: '  + qcReviewerNames.length + '  |  ' +
    'Product Types: ' + productTypes.length   +
    (hasErrors
      ? '\n\n⚠ Some issues found — check items marked ✗ above.\n' +
        'If Product Type shows MISS, check the exact question title\n' +
        'in your Google Form matches "Product Type" (case sensitive).'
      : '\n\n✅ All dropdowns synced successfully.')
  );
}

// ============================================================
// DAILY DIGEST — EMAIL SYSTEM
// ============================================================

function sendDailyDigest() {
  try {
    var masterData = getSheetData(CONFIG.sheets.masterJob);
    var designerData = getSheetData(CONFIG.sheets.designerMaster);
    var dateLabel = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMMM dd, yyyy");

    var managers = [], teamLeads = [], designers = [];
    for (var i = 1; i < designerData.length; i++) {
      if (!designerData[i][1] || String(designerData[i][8]).trim() !== "Yes") continue;
      var person = {
        name: String(designerData[i][1]).trim(),
        email: String(designerData[i][2]).trim(),
        role: String(designerData[i][4]).trim(),
        assignedClients: String(designerData[i][10] || "").trim()
      };
      if (person.role === "Project Manager") managers.push(person);
      else if (person.role === "QC Lead" || person.role === "Team Leader") teamLeads.push(person);
      else designers.push(person);
    }

    var allJobs = [];
    for (var j = 1; j < masterData.length; j++) {
      if (!masterData[j][0] || masterData[j][0] === "") continue;
      if (String(masterData[j][CONFIG.masterCols.isTest - 1]).trim() === "Yes") continue;
      allJobs.push({
        jobNumber: String(masterData[j][CONFIG.masterCols.jobNumber - 1]).trim(),
        clientCode: String(masterData[j][CONFIG.masterCols.clientCode - 1]).trim(),
        clientName: String(masterData[j][CONFIG.masterCols.clientName - 1]).trim(),
        designerName: String(masterData[j][CONFIG.masterCols.designerName - 1]).trim(),
        status: String(masterData[j][CONFIG.masterCols.status - 1]).trim(),
        designHours: parseFloat(masterData[j][CONFIG.masterCols.designHoursTotal - 1]) || 0,
        totalBillable: parseFloat(masterData[j][CONFIG.masterCols.totalBillableHours - 1]) || 0,
        reworkMajor: parseFloat(masterData[j][CONFIG.masterCols.reworkHoursMajor - 1]) || 0,
        reworkMinor: parseFloat(masterData[j][CONFIG.masterCols.reworkHoursMinor - 1]) || 0
      });
    }

    sendManagerDigest(managers, allJobs, dateLabel);
    sendTeamLeadDigest(teamLeads, allJobs, dateLabel);
    sendDesignerDigest(designers, allJobs, dateLabel);

    logException("INFO", "SYSTEM", "Auto", "Daily digest sent for: " + dateLabel);
  } catch(error) {
    logException("SCRIPT ERROR - DIGEST", "UNKNOWN", "System", error.message);
  }
}

function sendManagerDigest(managers, allJobs, dateLabel) {
  try {
    var needsAttention = allJobs.filter(function(j) {
      return j.status === CONFIG.status.submittedForQC || j.status === CONFIG.status.reworkMajor ||
             j.status === CONFIG.status.reworkMinor || j.status === CONFIG.status.waitingReQC ||
             j.status === CONFIG.status.waitingSpotCheck || j.status === CONFIG.status.onHold;
    });
    var completed = allJobs.filter(function(j) { return j.status === CONFIG.status.completed; });
    var inProgress = allJobs.filter(function(j) { return j.status === CONFIG.status.inDesign || j.status === CONFIG.status.pickedUp; });
    var totalBillable = 0, totalRework = 0;
    allJobs.forEach(function(j) { totalBillable += j.totalBillable; totalRework += j.reworkMajor + j.reworkMinor; });

    var body = buildEmailHeader("Manager Daily Digest", dateLabel);
    body += buildSection("JOBS REQUIRING ATTENTION", needsAttention, "attention");
    body += buildSection("COMPLETED JOBS", completed, "completed");
    body += buildSection("JOBS IN PROGRESS", inProgress, "progress");
    body += buildSummaryBlock(allJobs.length, needsAttention.length, completed.length, totalBillable, totalRework);
    body += buildEmailFooter();

    for (var i = 0; i < managers.length; i++) {
      if (managers[i].email) {
        GmailApp.sendEmail(managers[i].email, "BLC Daily Job Digest - " + dateLabel,
          "Please enable HTML.", { htmlBody: body, name: "BLC Job System" });
      }
    }
  } catch(error) { logException("SCRIPT ERROR - MANAGER DIGEST", "UNKNOWN", "System", error.message); }
}

function sendTeamLeadDigest(teamLeads, allJobs, dateLabel) {
  try {
    for (var i = 0; i < teamLeads.length; i++) {
      var tl = teamLeads[i];
      if (!tl.email) continue;
      var assignedClients = tl.assignedClients.split(",").map(function(c) { return c.trim().toUpperCase(); });
      var myJobs = allJobs.filter(function(j) { return assignedClients.indexOf(j.clientCode.toUpperCase()) !== -1; });
      var needsAttention = myJobs.filter(function(j) { return j.status === CONFIG.status.submittedForQC || j.status === CONFIG.status.waitingSpotCheck || j.status === CONFIG.status.waitingReQC; });
      var inRework = myJobs.filter(function(j) { return j.status === CONFIG.status.reworkMajor || j.status === CONFIG.status.reworkMinor; });
      var completed = myJobs.filter(function(j) { return j.status === CONFIG.status.completed; });

      var body = buildEmailHeader("Team Lead Daily Digest", dateLabel);
      body += "<p style='color:#5B9EC9;font-size:14px;padding:0 20px;'>Hello " + tl.name + "!</p>";
      body += buildSection("PENDING YOUR REVIEW", needsAttention, "attention");
      body += buildSection("JOBS IN REWORK", inRework, "rework");
      body += buildSection("COMPLETED TODAY", completed, "completed");
      body += buildSummaryBlock(myJobs.length, needsAttention.length, completed.length, 0, 0);
      body += buildEmailFooter();

      GmailApp.sendEmail(tl.email, "BLC Daily Digest - " + dateLabel, "Please enable HTML.", { htmlBody: body, name: "BLC Job System" });
    }
  } catch(error) { logException("SCRIPT ERROR - TL DIGEST", "UNKNOWN", "System", error.message); }
}

function sendDesignerDigest(designers, allJobs, dateLabel) {
  try {
    for (var i = 0; i < designers.length; i++) {
      var designer = designers[i];
      if (!designer.email) continue;
      var myJobs = allJobs.filter(function(j) { return j.designerName.toLowerCase() === designer.name.toLowerCase(); });
      if (myJobs.length === 0) continue;

      var needsAction = myJobs.filter(function(j) { return j.status === CONFIG.status.reworkMajor || j.status === CONFIG.status.reworkMinor; });
      var inProgress = myJobs.filter(function(j) { return j.status === CONFIG.status.inDesign || j.status === CONFIG.status.pickedUp; });
      var completed = myJobs.filter(function(j) { return j.status === CONFIG.status.completed; });
      var myHours = 0;
      myJobs.forEach(function(j) { myHours += j.designHours; });

      var body = buildEmailHeader("Designer Daily Digest", dateLabel);
      body += "<p style='color:#5B9EC9;font-size:14px;padding:0 20px;'>Hello " + designer.name + "!</p>";
      body += buildSection("ACTION REQUIRED", needsAction, "attention");
      body += buildSection("YOUR ACTIVE JOBS", inProgress, "progress");
      body += buildSection("COMPLETED JOBS", completed, "completed");
      body += "<div style='background:#f9f9f9;padding:15px;border-radius:8px;margin:15px;'>" +
              "<p style='margin:5px 0;'><b>Your Total Design Hours:</b> " + myHours.toFixed(2) + "</p></div>";
      body += buildEmailFooter();

      GmailApp.sendEmail(designer.email, "BLC Daily Digest - " + dateLabel, "Please enable HTML.", { htmlBody: body, name: "BLC Job System" });
    }
  } catch(error) { logException("SCRIPT ERROR - DESIGNER DIGEST", "UNKNOWN", "System", error.message); }
}

function buildEmailHeader(title, dateLabel) {
  return "<div style='font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;'>" +
    "<div style='background:#5B9EC9;padding:25px 20px;text-align:center;'>" +
    "<span style='color:#F2C94C;font-size:28px;font-weight:bold;letter-spacing:2px;'>BLC</span>" +
    "<span style='color:white;font-size:14px;display:block;letter-spacing:3px;margin-top:2px;'>BLUE LOTUS CONSULTING</span>" +
    "<span style='color:rgba(255,255,255,0.7);font-size:11px;display:block;letter-spacing:2px;'>CORPORATION</span>" +
    "<div style='border-top:1px solid rgba(255,255,255,0.3);margin-top:15px;padding-top:15px;'>" +
    "<p style='color:white;margin:0;font-size:13px;'>" + title + "</p>" +
    "<p style='color:rgba(255,255,255,0.8);margin:5px 0 0 0;font-size:12px;'>" + dateLabel + "</p>" +
    "</div></div>";
}

function buildSection(title, jobs, type) {
  if (jobs.length === 0) return "";
  var colors = { attention:"#E07B7B", completed:"#8DC63F", progress:"#5B9EC9", rework:"#F2C94C" };
  var color = colors[type] || "#5B9EC9";
  var html = "<div style='margin:15px;'><h3 style='color:" + color + ";border-bottom:2px solid " + color + ";padding-bottom:5px;'>" +
    title + " (" + jobs.length + ")</h3>";
  for (var i = 0; i < jobs.length; i++) {
    var j = jobs[i];
    html += "<div style='background:#f9f9f9;padding:10px;border-radius:6px;margin:8px 0;border-left:4px solid " + color + ";'>" +
      "<p style='margin:3px 0;'><b>" + j.jobNumber + "</b> — " + j.clientName + "</p>" +
      "<p style='margin:3px 0;font-size:13px;color:#666;'>Designer: " + j.designerName + " | Status: " + j.status + "</p>" +
      "<p style='margin:3px 0;font-size:13px;color:#666;'>Billable: " + j.totalBillable.toFixed(2) + " hrs</p></div>";
  }
  return html + "</div>";
}

function buildSummaryBlock(total, attention, completed, billable, rework) {
  return "<div style='background:#5B9EC9;color:white;padding:15px;border-radius:8px;margin:15px;'>" +
    "<h3 style='margin:0 0 10px 0;color:white;'>SUMMARY</h3>" +
    "<p style='margin:5px 0;'>Total Jobs: <b>" + total + "</b></p>" +
    "<p style='margin:5px 0;'>Needs Attention: <b>" + attention + "</b></p>" +
    "<p style='margin:5px 0;'>Completed: <b>" + completed + "</b></p>" +
    (billable > 0 ? "<p style='margin:5px 0;'>Total Billable: <b>" + billable.toFixed(2) + " hrs</b></p>" : "") +
    (rework > 0 ? "<p style='margin:5px 0;'>Total Rework: <b>" + rework.toFixed(2) + " hrs</b></p>" : "") +
    "</div>";
}

function buildEmailFooter() {
  return "<div style='background:#f5f5f5;padding:15px;text-align:center;border-top:1px solid #e0e0e0;'>" +
    "<p style='margin:5px 0;color:#5B9EC9;font-weight:bold;font-size:13px;'>Blue Lotus Consulting Corporation</p>" +
    "<p style='margin:5px 0;color:#999;font-size:11px;'>contact@bluelotuscanada.ca | bluelotuscanada.ca</p>" +
    "<p style='margin:5px 0;color:#999;font-size:11px;'>Automated message from BLC Job Management System</p>" +
    "</div></div>";
}


// ============================================================
// INVOICE GENERATION
// ============================================================


// ============================================================
// DATA MAINTENANCE
// ============================================================

function standardiseDesignerNames() {
  try {
    var master = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    var data = master.getDataRange().getValues();
    var fixed = 0;
    var designerCol = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][0] || data[i][0] === '') { designerCol.push([data[i][3]]); continue; }
      var current = String(data[i][3]).trim();
      var normalised = normaliseDesignerName(current);
      designerCol.push([normalised]);
      if (normalised !== current) fixed++;
    }
    master.getRange(2, 4, designerCol.length, 1).setValues(designerCol);
    SpreadsheetApp.flush();
    SpreadsheetApp.getUi().alert('✅ Designer names standardised!\nRows fixed: ' + fixed);
  } catch(error) {
    SpreadsheetApp.getUi().alert('Error: ' + error.message);
  }
}


// ============================================================
// WEB APP — PORTAL ROUTING
// ============================================================

function doGet(e) {
  return doGetSecure(e);
}
// ============================================================
// PORTAL DATA FUNCTIONS
// ============================================================

function getDesignerViewData() {
  try {
    var designerData = getSheetData(CONFIG.sheets.designerMaster);
    var masterData = getSheetData(CONFIG.sheets.masterJob);
    var designers = [];
    for (var i = 1; i < designerData.length; i++) {
      if (designerData[i][1] && String(designerData[i][8]).trim() === "Yes") designers.push(String(designerData[i][1]).trim());
    }
    var jobs = [];
    for (var j = 1; j < masterData.length; j++) {
      if (!masterData[j][0] || masterData[j][0] === "") continue;
      if (String(masterData[j][CONFIG.masterCols.isTest - 1]).trim() === "Yes") continue;
      var expectedDate = masterData[j][CONFIG.masterCols.expectedCompletion - 1];
      var expectedStr = "";
      if (expectedDate) { try { expectedStr = Utilities.formatDate(new Date(expectedDate), Session.getScriptTimeZone(), "MMM dd yyyy"); } catch(err) { expectedStr = String(expectedDate); } }
      jobs.push({
        jobNumber: String(masterData[j][CONFIG.masterCols.jobNumber - 1]).trim(),
        clientName: String(masterData[j][CONFIG.masterCols.clientName - 1]).trim(),
        designerName: String(masterData[j][CONFIG.masterCols.designerName - 1]).trim(),
        productType: String(masterData[j][CONFIG.masterCols.productType - 1]).trim(),
        status: String(masterData[j][CONFIG.masterCols.status - 1]).trim(),
        designHours: parseFloat(masterData[j][CONFIG.masterCols.designHoursTotal - 1]) || 0,
        expectedCompletion: expectedStr
      });
    }
    return { designers: designers, jobs: jobs };
  } catch(error) {
    logException("SCRIPT ERROR - DESIGNER VIEW", "UNKNOWN", "System", error.message);
    return { designers: [], jobs: [] };
  }
}

function getTeamLeadViewData() {
  var FUNCTION_NAME = "getTeamLeadViewData";
  try {
    var designerData = getSheetData(CONFIG.sheets.designerMaster);
    var masterData = getSheetData(CONFIG.sheets.masterJob);
    var MJ = CONFIG.masterCols;
    var today = new Date(); today.setHours(0, 0, 0, 0);

    var activeStatuses = {"Allocated":true,"Picked Up":true,"In Design":true,"Submitted For QC":true,"QC In Progress":true,
      "Rework - Major":true,"Rework - Minor":true,"Waiting Re-QC":true,"On Hold":true,"Waiting Spot Check":true,"Spot Check In Progress":true};

    var teamLeads = [];
    for (var i = 1; i < designerData.length; i++) {
      var dName = String(designerData[i][1]||"").trim();
      var dRole = String(designerData[i][4]||"").trim();
      var dActive = String(designerData[i][8]||"").trim();
      if (!dName || dActive !== "Yes") continue;
      if (dRole === "Team Leader" || dRole === "Project Manager" || dRole === "QC Reviewer") {
        teamLeads.push({ name: dName, clients: String(designerData[i][10]||"").trim() });
      }
    }

    var jobs = [];
    for (var j = 1; j < masterData.length; j++) {
      var row = masterData[j];
      var status = String(row[MJ.status-1]||"").trim();
      var isTest = String(row[MJ.isTest-1]||"").trim();
      var jobNumber = String(row[MJ.jobNumber-1]||"").trim();
      if (!jobNumber || isTest === "Yes" || !activeStatuses[status]) continue;

      var expDateRaw = row[MJ.expectedCompletion-1];
      var isOverdue = false, expDateStr = "";
      if (expDateRaw) { var expDate = new Date(expDateRaw); expDate.setHours(0,0,0,0); isOverdue = expDate < today; expDateStr = Utilities.formatDate(expDate, Session.getScriptTimeZone(), "MMM dd, yyyy"); }

      jobs.push({
        jobNumber: jobNumber, clientCode: String(row[MJ.clientCode-1]||"").trim(),
        clientName: String(row[MJ.clientName-1]||"").trim(), designerName: String(row[MJ.designerName-1]||"").trim(),
        productType: String(row[MJ.productType-1]||"").trim(), status: status,
        designHours: parseFloat(row[MJ.designHoursTotal-1])||0, qcHours: parseFloat(row[MJ.qcHoursTotal-1])||0,
        totalBillable: parseFloat(row[MJ.totalBillableHours-1])||0, qcLead: String(row[MJ.qcLead-1]||"").trim(),
        billingPeriod: String(row[MJ.billingPeriod-1]||"").trim(), invoiceMonth: String(row[MJ.invoiceMonth-1]||"").trim(),
        expectedCompletion: expDateStr, isOverdue: isOverdue, isRework: (status==="Rework - Major"||status==="Rework - Minor")
      });
    }

    logException("INFO", "SYSTEM", FUNCTION_NAME, "Jobs: " + jobs.length + " | TLs: " + teamLeads.length);
    return { teamLeads: teamLeads, jobs: jobs };
  } catch (err) {
    logException("ERROR", "SYSTEM", FUNCTION_NAME, "Crashed: " + err.message);
    return { teamLeads: [], jobs: [] };
  }
}

function populateTLView() {
  var FUNCTION_NAME = "populateTLView";
  try {
    var masterData = getSheetData(CONFIG.sheets.masterJob);
    var MJ = CONFIG.masterCols;
    var tlSheet = getSheet("TL_VIEW");
    var today = new Date(); today.setHours(0, 0, 0, 0);

    var activeStatuses = {"Allocated":true,"Picked Up":true,"In Design":true,"Submitted For QC":true,"QC In Progress":true,
      "Rework - Major":true,"Rework - Minor":true,"Waiting Re-QC":true,"On Hold":true,"Waiting Spot Check":true,"Spot Check In Progress":true};

    var headers = ["Job_Number","Client_Code","Client_Name","Designer_Name","Product_Type","Status",
      "Expected_Completion","Overdue","Design_Hours_Total","QC_Hours_Total","Total_Billable_Hours",
      "QC_Lead","Billing_Period","Invoice_Month"];

    var rows = [];
    for (var i = 1; i < masterData.length; i++) {
      var row = masterData[i];
      var status = String(row[MJ.status-1]||"").trim();
      var isTest = String(row[MJ.isTest-1]||"").trim();
      var jobNumber = String(row[MJ.jobNumber-1]||"").trim();
      if (!jobNumber || isTest === "Yes" || !activeStatuses[status]) continue;

      var expDateRaw = row[MJ.expectedCompletion-1];
      var isOverdue = "";
      if (expDateRaw) { var expDate = new Date(expDateRaw); expDate.setHours(0,0,0,0); isOverdue = expDate < today ? "YES" : ""; }

      rows.push([jobNumber, String(row[MJ.clientCode-1]||"").trim(), String(row[MJ.clientName-1]||"").trim(),
        String(row[MJ.designerName-1]||"").trim(), String(row[MJ.productType-1]||"").trim(), status,
        expDateRaw||"", isOverdue, parseFloat(row[MJ.designHoursTotal-1])||0, parseFloat(row[MJ.qcHoursTotal-1])||0,
        parseFloat(row[MJ.totalBillableHours-1])||0, String(row[MJ.qcLead-1]||"").trim(),
        String(row[MJ.billingPeriod-1]||"").trim(), String(row[MJ.invoiceMonth-1]||"").trim()]);
    }

    tlSheet.clearContents(); tlSheet.clearFormats();
    var headerRange = tlSheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]); headerRange.setFontWeight("bold"); headerRange.setBackground("#5B9EC9"); headerRange.setFontColor("#ffffff");
    tlSheet.setFrozenRows(1);

    if (rows.length === 0) { logException("INFO", "SYSTEM", FUNCTION_NAME, "TL_VIEW: No active jobs."); return; }

    tlSheet.getRange(2, 1, rows.length, headers.length).setValues(rows);

    for (var r = 0; r < rows.length; r++) {
      var sheetRow = r + 2;
      var rowStatus = rows[r][5], rowOverdue = rows[r][7];
      var rowRange = tlSheet.getRange(sheetRow, 1, 1, headers.length);
      if (rowOverdue === "YES") { rowRange.setBackground("#fce4ec"); continue; }
      if (rowStatus === "Rework - Major" || rowStatus === "Rework - Minor") { rowRange.setBackground("#fff3e0"); continue; }
      if (rowStatus === "In Design" || rowStatus === "Picked Up") { rowRange.setBackground("#e3f2fd"); }
      else if (rowStatus.indexOf("QC") !== -1) { rowRange.setBackground("#fff8e1"); }
      else if (rowStatus === "On Hold") { rowRange.setBackground("#f3e5f5"); }
      else if (rowStatus === "Allocated") { rowRange.setBackground("#e8f5e9"); }
      else if (rowStatus.indexOf("Waiting") !== -1 || rowStatus.indexOf("Submitted") !== -1) { rowRange.setBackground("#e0f7fa"); }
    }

    for (var c = 1; c <= headers.length; c++) { tlSheet.autoResizeColumn(c); }
    logException("INFO", "SYSTEM", FUNCTION_NAME, "TL_VIEW populated. Rows: " + rows.length);
  } catch (err) {
    logException("ERROR", "SYSTEM", FUNCTION_NAME, "populateTLView crashed: " + err.message);
  }
}

function getClientViewData(clientCode) {
  try {
    if (!clientCode || clientCode === "") return { error: true };
    var masterData = getSheetData(CONFIG.sheets.masterJob);
    var clientData = getSheetData(CONFIG.sheets.clientMaster);
    var clientName = "";
    for (var i = 1; i < clientData.length; i++) {
      if (String(clientData[i][0]).trim().toUpperCase() === String(clientCode).trim().toUpperCase()) { clientName = String(clientData[i][1]).trim(); break; }
    }
    if (clientName === "") return { error: true };

    var jobs = [];
    for (var j = 1; j < masterData.length; j++) {
      if (!masterData[j][0] || masterData[j][0] === "") continue;
      if (String(masterData[j][CONFIG.masterCols.isTest - 1]).trim() === "Yes") continue;
      if (String(masterData[j][CONFIG.masterCols.clientCode - 1]).trim().toUpperCase() !== String(clientCode).trim().toUpperCase()) continue;
      var expectedDate = masterData[j][CONFIG.masterCols.expectedCompletion - 1];
      var expectedStr = "";
      if (expectedDate) { try { expectedStr = Utilities.formatDate(new Date(expectedDate), Session.getScriptTimeZone(), "MMM dd yyyy"); } catch(err) { expectedStr = String(expectedDate); } }
      jobs.push({
        jobNumber: String(masterData[j][CONFIG.masterCols.jobNumber - 1]).trim(),
        productType: String(masterData[j][CONFIG.masterCols.productType - 1]).trim(),
        designerName: String(masterData[j][CONFIG.masterCols.designerName - 1]).trim(),
        status: String(masterData[j][CONFIG.masterCols.status - 1]).trim(),
        qcStatus: String(masterData[j][CONFIG.masterCols.qcStatus - 1]).trim(),
        expectedCompletion: expectedStr
      });
    }
    return { error: false, clientName: clientName, jobs: jobs,
      lastUpdated: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMM dd yyyy HH:mm") };
  } catch(error) {
    logException("SCRIPT ERROR - CLIENT VIEW", "UNKNOWN", "System", error.message);
    return { error: true };
  }
}


// ============================================================
// JOB ROW LOOKUP — PRIMARY HELPER
// Note: findJobRowByKey() lives in CompositeKeyFix.gs.gs
// ============================================================

function findJobRow(jobNumber) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.sheets.masterJob);
  var data = sheet.getDataRange().getValues();
  var firstMatch = -1, liveMatch = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toUpperCase() !== String(jobNumber).trim().toUpperCase()) continue;
    if (firstMatch === -1) firstMatch = i + 1;
    if (String(data[i][CONFIG.masterCols.isImported - 1]).trim() !== 'Yes' && liveMatch === -1) { liveMatch = i + 1; }
  }
  return liveMatch !== -1 ? liveMatch : firstMatch;
}