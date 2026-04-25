/**
 * BLC JOB MANAGEMENT SYSTEM
 * Invoice Fix — March 2026
 * 
 * FILE CONTENTS:
 *   1. generateInvoices()          — REPLACE existing function in Code.gs
 *   2. generateStatementPDF()      — REPLACE existing function in Code.gs
 *   3. standardiseOWWProductTypes() — NEW — run once as one-time patch
 *   4. detectDuplicateMasterRows()  — NEW — diagnostic tool, run before invoicing
 *
 * ROOT CAUSES FIXED:
 *   BUG 1: generateInvoices() was reading only col K (Design_Hours_Total).
 *          Col L (QC_Hours_Total) was never read. QC hours from Sarty, Savvy,
 *          Bharath, Samar, Raj Kumar, Pabitra were all billed as zero.
 *          Fix: QC hours now attributed to QC_Lead (col P) as a separate
 *          line section on each invoice.
 *
 *   BUG 2: "OWW Floor 1/2/3" and "I-Joist Floor 1/2/3" are not canonical
 *          product types. standardiseOWWProductTypes() maps all variants
 *          to "Floor Truss" in MASTER. Run once before re-running invoices.
 *
 *   BUG 3: Duplicate MASTER rows for the same job/designer/product type
 *          cause jobs to be billed twice. detectDuplicateMasterRows()
 *          finds them so you can manually review before invoicing.
 *
 * HOW TO DEPLOY:
 *   Step 1 — Run standardiseOWWProductTypes() from the BLC System menu
 *            (adds menu item — see onOpen() additions at bottom of file)
 *   Step 2 — Run detectDuplicateMasterRows() and review the output
 *   Step 3 — Replace generateInvoices() and generateStatementPDF() in Code.gs
 *   Step 4 — Re-run invoices for 2026-03 | 1-15
 *
 * COLUMN REFERENCE (confirmed 36-col schema, 0-based array indices):
 *   [0]  Job_Number          [9]  Status
 *   [1]  Client_Code         [10] Design_Hours_Total    ← col K
 *   [2]  Client_Name         [11] QC_Hours_Total        ← col L  (was missing)
 *   [3]  Designer_Name       [12] Total_Billable_Hours  ← col M
 *   [4]  Product_Type        [15] QC_Lead               ← col P
 *   [5]  Allocated_Date      [17] Billing_Period        ← col R  (filter key)
 *   [30] Is_Test                                        ← col AE (exclude)
 */

// ─────────────────────────────────────────────────────────────────────────────
// PART 1 — generateInvoices()
// Replace the existing generateInvoices() in Code.gs with this entire function.
// ─────────────────────────────────────────────────────────────────────────────

function generateInvoices() {
  var ui = SpreadsheetApp.getUi();
  
  // Prompt for billing period
  var periodResp = ui.prompt(
    'Generate Invoices',
    'Enter billing period prefix (e.g. 2026-03):',
    ui.ButtonSet.OK_CANCEL
  );
  if (periodResp.getSelectedButton() !== ui.Button.OK) return;
  var periodPrefix = periodResp.getResponseText().trim();
  if (!periodPrefix) {
    ui.alert('Billing period is required.');
    return;
  }
  
  // Prompt for invoice month label
  var monthResp = ui.prompt(
    'Generate Invoices',
    'Enter invoice month label (e.g. March 2026):',
    ui.ButtonSet.OK_CANCEL
  );
  if (monthResp.getSelectedButton() !== ui.Button.OK) return;
  var invoiceMonthLabel = monthResp.getResponseText().trim();
  if (!invoiceMonthLabel) {
    ui.alert('Invoice month is required.');
    return;
  }

  try {
    var masterData  = getSheetData(CONFIG.sheets.masterJob);
    var clientData  = getSheetData(CONFIG.sheets.clientMaster);

    // ── Build client lookup map ──────────────────────────────────────────────
    // CLIENT_MASTER: clientCode=index 0, clientName=1, email=3, 
    //                billingRate=5, qcRate=6, gstApplicable=12, address=13,
    //                paymentTerms=14, active=9
    var clientMap = {};
    for (var ci = 1; ci < clientData.length; ci++) {
      var crow = clientData[ci];
      var code = String(crow[0] || '').trim().toUpperCase();
      if (!code) continue;
      clientMap[code] = {
        name:         String(crow[1]  || '').trim(),
        email:        String(crow[3]  || '').trim(),
        billingRate:  parseFloat(crow[5])  || 0,
        qcRate:       parseFloat(crow[6])  || 0,
        gstApplicable:String(crow[12] || '').trim().toLowerCase() === 'yes',
        address:      String(crow[13] || '').trim(),
        paymentTerms: String(crow[14] || '').trim() || 'Net 15',
        active:       String(crow[9]  || '').trim().toLowerCase() === 'yes',
      };
    }

    // ── Collect billable rows from MASTER ────────────────────────────────────
    // Filter: status = "Completed - Billable"
    //         billingPeriod starts with periodPrefix   (col R, index 17)
    //         isTest != "Yes"                          (col AE, index 30)
    //
    // Per row we collect:
    //   Design hours  → attributed to Designer_Name (col D, index 3)
    //   QC hours      → attributed to QC_Lead       (col P, index 15)
    //
    // Structure: invoiceData[clientCode][designerName] = [{job, type, hrs, notes}]
    //            qcData[clientCode][qcLeadName]        = [{job, type, hrs}]

    var invoiceData = {}; // design hours by client → designer
    var qcData      = {}; // QC hours by client → QC lead

    for (var r = 1; r < masterData.length; r++) {
      var row    = masterData[r];
      var status = String(row[9]  || '').trim();
      var period = String(row[17] || '').trim();
      var isTest = String(row[30] || '').trim().toLowerCase();

      // Status gate
      if (status !== 'Completed - Billable') continue;
      // Billing period gate — use indexOf not equality (handles 1-15 and 16-End)
      if (period.indexOf(periodPrefix) !== 0) continue;
      // Exclude test jobs
      if (isTest === 'yes') continue;

      var jobNum      = String(row[0]  || '').trim();
      var clientCode  = String(row[1]  || '').trim().toUpperCase();
      var designer    = normaliseDesignerName(String(row[3]  || '').trim());
      var productType = String(row[4]  || '').trim();
      var designHrs   = parseFloat(row[10]) || 0;
      var qcHrs       = parseFloat(row[11]) || 0;
      var qcLead      = normaliseDesignerName(String(row[15] || '').trim());
      var rowNotes    = String(row[28] || '').trim();

      if (!clientCode || !jobNum) continue;

      // ── Design hours ────────────────────────────────────────────────────────
      if (designHrs > 0 && designer) {
        if (!invoiceData[clientCode]) invoiceData[clientCode] = {};
        if (!invoiceData[clientCode][designer]) invoiceData[clientCode][designer] = [];
        invoiceData[clientCode][designer].push({
          job:   jobNum,
          type:  productType,
          hours: designHrs,
          notes: rowNotes,
          desc:  'Design-Quote'
        });
      }

      // ── QC hours ─────────────────────────────────────────────────────────────
      // FIX: This block was entirely absent in the old generateInvoices().
      // QC hours are attributed to QC_Lead (col P), not the designer.
      if (qcHrs > 0 && qcLead) {
        if (!qcData[clientCode]) qcData[clientCode] = {};
        if (!qcData[clientCode][qcLead]) qcData[clientCode][qcLead] = [];
        qcData[clientCode][qcLead].push({
          job:   jobNum,
          type:  productType,
          hours: qcHrs,
          notes: rowNotes,
          desc:  'Quality Check'
        });
      }
    }

    // ── Get all clients that have billable data ───────────────────────────────
    var allClients = Object.keys(Object.assign({}, invoiceData, qcData));
    if (allClients.length === 0) {
      ui.alert('No Completed-Billable jobs found for period: ' + periodPrefix + 
               '\n\nCheck:\n1. Status = "Completed - Billable" in col J\n' +
               '2. Billing period in col R starts with "' + periodPrefix + '"');
      return;
    }

    // ── Get or create invoice folder in Drive ─────────────────────────────────
    var folderName   = CONFIG.invoiceFolderName || 'BLC Invoices';
    var driveFiles   = DriveApp.getFoldersByName(folderName);
    var invoiceFolder= driveFiles.hasNext() ? driveFiles.next() : DriveApp.createFolder(folderName);

    var generated = [];
    var errors    = [];

    // ── Generate one PDF per client ───────────────────────────────────────────
    for (var ci2 = 0; ci2 < allClients.length; ci2++) {
      var clientCode2  = allClients[ci2];
      var client       = clientMap[clientCode2];

      if (!client) {
        errors.push(clientCode2 + ': not found in CLIENT_MASTER');
        continue;
      }

      var designRows = invoiceData[clientCode2] || {};
      var qcRows     = qcData[clientCode2]      || {};

      try {
        var pdfFile = generateStatementPDF(
          clientCode2, client, designRows, qcRows,
          periodPrefix, invoiceMonthLabel, invoiceFolder
        );
        generated.push(clientCode2 + ' → ' + pdfFile.getName());
        logException('INFO', 'INVOICE', 'generateInvoices',
                     'Invoice generated for ' + clientCode2 + ' period ' + periodPrefix);
      } catch (pdfErr) {
        errors.push(clientCode2 + ': ' + pdfErr.message);
        logException('ERROR', 'INVOICE', 'generateInvoices',
                     'Failed for ' + clientCode2 + ': ' + pdfErr.message);
      }
    }

    // ── Summary alert ─────────────────────────────────────────────────────────
    var msg = 'Invoice generation complete.\n\n';
    if (generated.length) msg += 'Generated (' + generated.length + '):\n' + generated.join('\n') + '\n\n';
    if (errors.length)    msg += 'ERRORS (' + errors.length + '):\n' + errors.join('\n');
    ui.alert(msg);

  } catch (err) {
    logException('ERROR', 'INVOICE', 'generateInvoices', err.message);
    ui.alert('Invoice generation failed: ' + err.message);
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// PART 2 — generateStatementPDF()
// Replace the existing generateStatementPDF() in Code.gs with this function.
// ─────────────────────────────────────────────────────────────────────────────

function generateStatementPDF(clientCode, client, designRows, qcRows,
                               periodPrefix, invoiceMonthLabel, folder) {

  var ss        = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = 'STMT_' + clientCode + '_' + periodPrefix.replace(/[^0-9a-z]/gi, '');
  
  // Remove any leftover staging sheet from a prior failed run
  var existing = ss.getSheetByName(sheetName);
  if (existing) ss.deleteSheet(existing);

  var sheet = ss.insertSheet(sheetName);

  try {
    // ── Company header ────────────────────────────────────────────────────────
    var companyName    = CONFIG.company.name    || 'Blue Lotus Consulting Corporation';
    var companyAddress = CONFIG.company.address || '541 Avenue I north | Saskatoon, SK S7L2G9';
    var companyEmail   = CONFIG.company.email   || 'contact@bluelotuscanada.ca';
    var gstNumber      = CONFIG.company.gstNumber || '827089830RT0001';
    var gstRate        = CONFIG.company.gstRate   || 0.05;

    var today          = Utilities.formatDate(new Date(), 'America/Regina', 'MMMM dd, yyyy');
    var billingRate    = client.billingRate || 25;
    var qcBillingRate  = client.qcRate     || client.billingRate || 25;
    var currency       = (clientCode === 'SBS') ? 'USD' : 'CAD';
    var applyGST       = client.gstApplicable && (clientCode !== 'SBS');

    // ── Aggregate hours ───────────────────────────────────────────────────────
    // Sort designers alphabetically for consistent output
    var designerNames = Object.keys(designRows).sort();
    var qcLeadNames   = Object.keys(qcRows).sort();

    var allDesignRows = []; // flat list for all rows: {sno, job, type, desc, hours, designer, notes}
    var designSummary = {}; // designer → total hours
    var qcSummary     = {}; // qclead  → total hours
    var sno = 1;

    // Design rows
    for (var di = 0; di < designerNames.length; di++) {
      var dname  = designerNames[di];
      var djobs  = designRows[dname];
      // Sort jobs by job number for consistency
      djobs.sort(function(a, b) { return a.job.localeCompare(b.job); });
      var dtotal = 0;
      for (var dj = 0; dj < djobs.length; dj++) {
        allDesignRows.push({
          sno:      sno++,
          job:      djobs[dj].job,
          type:     djobs[dj].type,
          desc:     djobs[dj].desc,
          hours:    djobs[dj].hours,
          designer: dname,
          notes:    djobs[dj].notes
        });
        dtotal += djobs[dj].hours;
      }
      // Designer subtotal row
      allDesignRows.push({ subtotal: true, designer: dname, hours: dtotal });
      designSummary[dname] = dtotal;
    }

    // QC rows
    var allQcRows = [];
    for (var qi = 0; qi < qcLeadNames.length; qi++) {
      var qname  = qcLeadNames[qi];
      var qjobs  = qcRows[qname];
      qjobs.sort(function(a, b) { return a.job.localeCompare(b.job); });
      var qtotal = 0;
      for (var qj = 0; qj < qjobs.length; qj++) {
        allQcRows.push({
          sno:      sno++,
          job:      qjobs[qj].job,
          type:     qjobs[qj].type,
          desc:     qjobs[qj].desc,
          hours:    qjobs[qj].hours,
          designer: qname,
          notes:    qjobs[qj].notes
        });
        qtotal += qjobs[qj].hours;
      }
      allQcRows.push({ subtotal: true, designer: qname, hours: qtotal });
      qcSummary[qname] = qtotal;
    }

    // ── Financials ────────────────────────────────────────────────────────────
    var totalDesignHrs = Object.values(designSummary).reduce(function(s, h) { return s + h; }, 0);
    var totalQCHrs     = Object.values(qcSummary).reduce(function(s, h) { return s + h; }, 0);
    var totalHrs       = totalDesignHrs + totalQCHrs;

    var subtotalDesign = totalDesignHrs * billingRate;
    var subtotalQC     = totalQCHrs     * qcBillingRate;
    var subtotal       = subtotalDesign + subtotalQC;
    var gstAmount      = applyGST ? subtotal * gstRate : 0;
    var totalDue       = subtotal + gstAmount;

    // ── Write to staging sheet ────────────────────────────────────────────────
    var rowNum = 1;
    var data   = [];

    // Row 1: Company name (large header)
    data.push([companyName, '', '', '', '', '', '']);
    // Row 2: Address / contact / GST
    data.push([companyAddress + ' | ' + companyEmail + ' | GST: ' + gstNumber, '', '', '', '', '', '']);
    data.push(['', '', '', '', '', '', '']);

    // Row 4-5: Bill To + Statement Details side by side
    data.push(['BILL TO', '', '', 'STATEMENT DETAILS', '', '', '']);
    data.push([client.name, '', '', 'Billing Period: ' + periodPrefix, '', '', '']);
    data.push([client.address, '', '', 'Date: ' + today, '', '', '']);
    data.push(['', '', '', 'Invoice Month: ' + invoiceMonthLabel, '', '', '']);
    data.push(['', '', '', 'Currency: ' + currency, '', '', '']);
    data.push(['', '', '', 'Payment Terms: ' + client.paymentTerms, '', '', '']);
    data.push(['', '', '', '', '', '', '']);

    // Column headers
    data.push(['Sno', 'Job #', 'Job Type', 'Description', 'Hours', 'Designer', 'Notes']);

    // ── Design section ────────────────────────────────────────────────────────
    if (allDesignRows.length > 0) {
      data.push(['--- DESIGN HOURS ---', '', '', '', '', '', '']);
      for (var i = 0; i < allDesignRows.length; i++) {
        var r = allDesignRows[i];
        if (r.subtotal) {
          data.push(['', '', '', 'Total — ' + r.designer, r.hours, '', '']);
        } else {
          data.push([r.sno, r.job, r.type, r.desc, r.hours, r.designer, r.notes]);
        }
      }
      data.push(['', '', '', 'TOTAL DESIGN HOURS', totalDesignHrs + ' hrs', '', '']);
      data.push(['', '', '', '', '', '', '']);
    }

    // ── QC section ────────────────────────────────────────────────────────────
    // This entire section is NEW — was never generated before.
    if (allQcRows.length > 0) {
      data.push(['--- QUALITY CHECK HOURS ---', '', '', '', '', '', '']);
      for (var j = 0; j < allQcRows.length; j++) {
        var qr = allQcRows[j];
        if (qr.subtotal) {
          data.push(['', '', '', 'Total — ' + qr.designer, qr.hours, '', '']);
        } else {
          data.push([qr.sno, qr.job, qr.type, qr.desc, qr.hours, qr.designer, qr.notes]);
        }
      }
      data.push(['', '', '', 'TOTAL QC HOURS', totalQCHrs + ' hrs', '', '']);
      data.push(['', '', '', '', '', '', '']);
    }

    // ── Totals ────────────────────────────────────────────────────────────────
    data.push(['', '', '', 'TOTAL BILLABLE HOURS', totalHrs + ' hrs', '', '']);
    data.push(['', '', '', '', '', '', '']);
    data.push(['', '', '', 'Design Subtotal:', currency + ' $' + subtotalDesign.toFixed(2), '', '']);
    if (totalQCHrs > 0) {
      data.push(['', '', '', 'QC Subtotal:', currency + ' $' + subtotalQC.toFixed(2), '', '']);
    }
    data.push(['', '', '', 'Subtotal:', currency + ' $' + subtotal.toFixed(2), '', '']);
    if (applyGST) {
      data.push(['', '', '', 'GST (' + (gstRate * 100).toFixed(0) + '%):', currency + ' $' + gstAmount.toFixed(2), '', '']);
    }
    data.push(['', '', '', 'TOTAL AMOUNT DUE:', currency + ' $' + totalDue.toFixed(2), '', '']);
    data.push(['', '', '', '', '', '', '']);

    // ── Designer summary ──────────────────────────────────────────────────────
    data.push(['DESIGNER SUMMARY', '', '', '', '', '', '']);
    data.push(['Designer', 'Design Hrs', 'QC Hrs', 'Total Hrs', '', '', '']);
    var allNames = Array.from(new Set(Object.keys(designSummary).concat(Object.keys(qcSummary)))).sort();
    for (var k = 0; k < allNames.length; k++) {
      var n   = allNames[k];
      var dh  = designSummary[n] || 0;
      var qh  = qcSummary[n]    || 0;
      data.push([n, dh, qh, dh + qh, '', '', '']);
    }
    data.push(['TOTAL', totalDesignHrs, totalQCHrs, totalHrs, '', '', '']);
    data.push(['', '', '', '', '', '', '']);
    data.push(['Thank you for your business. Payment due within ' + client.paymentTerms +
               ' of statement date. ' + companyEmail, '', '', '', '', '', '']);

    // Write all rows at once (single setValues call)
    sheet.getRange(1, 1, data.length, 7).setValues(data);

    // ── Export to PDF ─────────────────────────────────────────────────────────
    SpreadsheetApp.flush();
    var fileName = clientCode + '_Statement_' + periodPrefix.replace(' | ', '_') + '.pdf';
    
    // Remove existing file with same name if present
    var existingFiles = folder.getFilesByName(fileName);
    while (existingFiles.hasNext()) { existingFiles.next().setTrashed(true); }

    var exportUrl = 'https://docs.google.com/spreadsheets/d/' + ss.getId() +
      '/export?format=pdf' +
      '&size=A4&portrait=true&fitw=true' +
      '&sheetnames=false&printtitle=false' +
      '&pagenumbers=false&gridlines=false' +
      '&gid=' + sheet.getSheetId();

    var token    = ScriptApp.getOAuthToken();
    var response = UrlFetchApp.fetch(exportUrl, {
      headers: { 'Authorization': 'Bearer ' + token }
    });

    var pdfFile  = folder.createFile(response.getBlob().setName(fileName));
    return pdfFile;

  } finally {
    // Always delete the staging sheet — even if export threw
    var cleanup = ss.getSheetByName(sheetName);
    if (cleanup) ss.deleteSheet(cleanup);
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// PART 3 — standardiseOWWProductTypes()
// NEW function. Run once from the menu before re-generating invoices.
// Maps all OWW Floor 1/2/3 and I-Joist Floor 1/2/3 variants → "Floor Truss"
// in MASTER_JOB_DATABASE col E (Product_Type, array index 4).
// Safe to re-run — only changes non-canonical values, never overwrites
// values already in the canonical whitelist.
// ─────────────────────────────────────────────────────────────────────────────

function standardiseOWWProductTypes() {
  var ui = SpreadsheetApp.getUi();
  
  // Canonical whitelist — these values are NEVER touched
  var CANONICAL = ['Roof Truss', 'Floor Truss', 'Wall Frame', 'I-Joist Floor'];

  // Everything that maps to "Floor Truss"
  var FLOOR_TRUSS_VARIANTS = [
    'OWW Floor 1', 'OWW Floor 2', 'OWW Floor 3',
    'OWW FLoor 1', 'OWW FLoor 2', 'OWW FLoor 3',
    'OWW floor 1', 'OWW floor 2', 'OWW floor 3',
    'I JOIST Floor 1', 'I JOIST Floor 2', 'I JOIST Floor 3',
    'I-Joist Floor 1', 'I-Joist Floor 2', 'I-Joist Floor 3',
    'I Joist Floor 1', 'I Joist Floor 2', 'I Joist Floor 3',
    'Floor Truss 1',   'Floor Truss 2',   'Floor Truss 3',
    'OWW',             'I-Joist',         'I JOIST',
  ];

  try {
    var masterSheet = getSheet(CONFIG.sheets.masterJob);
    var data = masterSheet.getDataRange().getValues();
    var changes = [];
    var skipped = [];

    for (var r = 1; r < data.length; r++) {
      var current = String(data[r][4] || '').trim(); // col E = index 4

      // Already canonical — never touch
      if (CANONICAL.indexOf(current) !== -1) continue;
      // Blank — leave it
      if (!current) continue;

      var target = null;
      var upperCurrent = current.toUpperCase();

      // Check Floor Truss variants (case-insensitive)
      for (var v = 0; v < FLOOR_TRUSS_VARIANTS.length; v++) {
        if (upperCurrent === FLOOR_TRUSS_VARIANTS[v].toUpperCase()) {
          target = 'Floor Truss';
          break;
        }
      }

      if (target) {
        // +2 because data is 0-indexed, sheet rows are 1-indexed, plus header row
        var sheetRow = r + 1;
        masterSheet.getRange(sheetRow, 5).setValue(target); // col E = column 5
        changes.push('Row ' + sheetRow + ': "' + current + '" → "' + target + '"' +
                     ' (Job: ' + data[r][0] + ', Designer: ' + data[r][3] + ')');
        logException('INFO', String(data[r][0]), 'standardiseOWWProductTypes',
                     'Product type updated: "' + current + '" → "' + target + '"');
      } else {
        // Unknown value — log it but don't change
        skipped.push('Row ' + (r+1) + ': Unknown type "' + current + '" — not changed');
      }
    }

    // Report
    var msg = 'standardiseOWWProductTypes complete.\n\n';
    msg += 'Changed: ' + changes.length + ' rows\n';
    if (skipped.length) {
      msg += 'Unknown types (not changed): ' + skipped.length + '\n\n';
      msg += 'Unknown values found:\n' + skipped.slice(0, 20).join('\n');
      if (skipped.length > 20) msg += '\n... (' + (skipped.length - 20) + ' more)';
    }
    if (changes.length) {
      msg += '\n\nChanges made (first 30):\n' + changes.slice(0, 30).join('\n');
      if (changes.length > 30) msg += '\n... (' + (changes.length - 30) + ' more)';
    }
    ui.alert(msg);
    Logger.log(msg);

  } catch (err) {
    logException('ERROR', 'BATCH', 'standardiseOWWProductTypes', err.message);
    ui.alert('Error: ' + err.message);
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// PART 4 — detectDuplicateMasterRows()
// NEW diagnostic tool. Run before invoicing to find rows where the same
// Job_Number + Designer_Name + Product_Type appears more than once.
// These are the rows that cause double-billing (e.g. Q260126/Q260127M NORSPAN).
// Writes results to EXCEPTIONS_LOG. Shows a summary alert.
// DOES NOT delete anything — review output, then manually merge or delete.
// ─────────────────────────────────────────────────────────────────────────────

function detectDuplicateMasterRows() {
  var ui = SpreadsheetApp.getUi();

  // Optional: filter to a specific billing period
  var periodResp = ui.prompt(
    'Detect Duplicate Master Rows',
    'Enter billing period prefix to check (e.g. 2026-03)\nor leave blank to check ALL rows:',
    ui.ButtonSet.OK_CANCEL
  );
  if (periodResp.getSelectedButton() !== ui.Button.OK) return;
  var filterPeriod = periodResp.getResponseText().trim();

  try {
    var masterSheet = getSheet(CONFIG.sheets.masterJob);
    var data = masterSheet.getDataRange().getValues();

    // Key: jobNumber + '|' + designerName + '|' + productType
    var seen      = {};  // key → first row number
    var dupeRows  = [];  // [{key, rows: [r1, r2, ...], details}]
    var dupeKeys  = {};  // key → array of row numbers

    for (var r = 1; r < data.length; r++) {
      var row     = data[r];
      var jobNum  = String(row[0]  || '').trim();
      var designer= String(row[3]  || '').trim();
      var prodType= String(row[4]  || '').trim();
      var period  = String(row[17] || '').trim();
      var isTest  = String(row[30] || '').trim().toLowerCase();

      if (!jobNum || !designer) continue;
      if (isTest === 'yes') continue;
      if (filterPeriod && period.indexOf(filterPeriod) !== 0) continue;

      var key = jobNum + '|' + designer + '|' + prodType;
      var sheetRow = r + 1;

      if (!dupeKeys[key]) {
        dupeKeys[key] = [];
      }
      dupeKeys[key].push({
        sheetRow: sheetRow,
        designHrs: parseFloat(row[10]) || 0,
        qcHrs:     parseFloat(row[11]) || 0,
        status:    String(row[9]  || '').trim(),
        period:    period,
        client:    String(row[1]  || '').trim(),
      });
    }

    // Find keys with more than one row
    var dupeReport = [];
    for (var key in dupeKeys) {
      if (dupeKeys[key].length > 1) {
        dupeReport.push({ key: key, rows: dupeKeys[key] });
      }
    }

    if (dupeReport.length === 0) {
      ui.alert('No duplicate rows found' + (filterPeriod ? ' for ' + filterPeriod : '') + '.\nSafe to proceed with invoicing.');
      return;
    }

    // Log to EXCEPTIONS_LOG
    var logLines = [];
    for (var d = 0; d < dupeReport.length; d++) {
      var dupe    = dupeReport[d];
      var parts   = dupe.key.split('|');
      var rowNums = dupe.rows.map(function(x) { return 'Row ' + x.sheetRow +
                   ' (' + x.status + ', Design:' + x.designHrs + 'h, QC:' + x.qcHrs + 'h)'; });
      var summary = 'DUPLICATE: Job=' + parts[0] + ' Designer=' + parts[1] +
                    ' Type=' + parts[2] + ' | Rows: ' + rowNums.join(' / ');
      logException('WARNING', parts[0], 'detectDuplicateMasterRows', summary);
      logLines.push(summary);
    }

    // Alert summary
    var msg = '⚠ DUPLICATE ROWS FOUND: ' + dupeReport.length + ' cases\n\n';
    msg += 'These jobs will be DOUBLE-BILLED if you run invoices now.\n';
    msg += 'Check EXCEPTIONS_LOG for full details.\n\n';
    msg += 'First 10 duplicates:\n';
    msg += logLines.slice(0, 10).join('\n');
    if (dupeReport.length > 10) msg += '\n... (' + (dupeReport.length - 10) + ' more in EXCEPTIONS_LOG)';
    msg += '\n\nDO NOT delete rows without confirming with Raj first.';
    msg += '\nFor each duplicate: keep the row with the higher hours total, zero out the other.';
    ui.alert(msg);

  } catch (err) {
    logException('ERROR', 'BATCH', 'detectDuplicateMasterRows', err.message);
    ui.alert('Error: ' + err.message);
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// PART 5 — onOpen() menu additions
// ADD these lines to the existing onOpen() function in Code.gs.
// Find the existing .addItem lines and add these alongside them.
// ─────────────────────────────────────────────────────────────────────────────

/*
  ADD THESE 4 LINES to the BLC System menu in onOpen():

  .addSeparator()
  .addItem('Standardise OWW Product Types (run once)', 'standardiseOWWProductTypes')
  .addItem('Detect Duplicate Master Rows', 'detectDuplicateMasterRows')
  .addSeparator()

  These go near the existing 'Generate Invoices' and 'Sync Form Dropdowns' items.
*/


// ─────────────────────────────────────────────────────────────────────────────
// DEPLOYMENT CHECKLIST
// Print this out and check each step before re-running invoices.
// ─────────────────────────────────────────────────────────────────────────────

/*
  PRE-INVOICE CHECKLIST — 2026-03 | 1-15
  
  □ 1. Clear all filters on MASTER_JOB_DATABASE tab
  
  □ 2. Run: BLC System → Standardise OWW Product Types (run once)
         Expected: "OWW Floor 1/2/3" and "I-Joist Floor 1/2/3" rows updated to "Floor Truss"
         Verify: check a few MATIX and SBS rows with OWW in the Notes column
  
  □ 3. Run: BLC System → Detect Duplicate Master Rows → enter "2026-03"
         Expected: alert shows any duplicate job+designer+type combinations
         Action: for each duplicate, check with Sarty, keep correct row, zero hours on duplicate
  
  □ 4. Status sweep — manually fix jobs stuck before Completed-Billable:
         Filter MASTER col J (Status) for period "2026-03" (col R)
         Where Status = "Submitted For QC" or "QC In Progress" and work is confirmed done:
           - Confirm with Sarty that job passed QC
           - Change Status → "Completed - Billable"
           - Ensure col L (QC_Hours_Total) is filled in
           - Ensure col P (QC_Lead) is filled in
         Known jobs to check:
           MATIX:   160623 (Debby, 3 hrs)
           TITAN:   B600102 (Priyanka, 3 hrs)
           SBS:     2602-2129 / 2603-2685-C / 2603-2823-B (Pabitra, 66 hrs total)
           SBS:     2509-4564-F / 2512-8644-F / 2602-1681-A / 2603-2788-A (Banik, 24+ hrs)
           SBS:     2601-0892-A / 2502-2648-B / M00167-B / 2503-3620-B (Sayan, 24 hrs)
           SBS:     2603-2923 series / 2603-2927 series (Raj Kumar, 11 hrs)
           SBS:     2601-0616-A (Savvy, 2 hrs)
           NORSPAN: Q260134 (Ravi, 7 hrs)
  
  □ 5. Verify QC_Lead (col P) is populated for all Completed-Billable jobs in 2026-03
         Filter: Status = "Completed - Billable" AND col P is blank
         Action: fill in QC_Lead before running invoices or QC hours will be lost
  
  □ 6. Verify QC_Hours_Total (col L) > 0 for all jobs where QC was done
         Jobs with a QC Lead but 0 in col L means QC hours were never logged
         Action: ask Sarty/QC reviewer to submit QC log form for those jobs
  
  □ 7. Investigate specific anomalies (confirm with Sarty before changing):
         MATIX:   Job 160706 — 9.25 hrs under Deb Sen in invoice, 0 in Sarty's timesheet
         NORSPAN: Q260113 — 4.5 hrs under Vani in invoice, 0 in timesheet
         NORSPAN: Q260099 — 4.5 hrs under Ravi in invoice, 0 in current timesheet
         NORSPAN: Q260126 — 7.0 hrs in invoice (2 rows), 2.0 hrs in timesheet
  
  □ 8. Run: BLC System → Generate Invoices → enter "2026-03"
  
  □ 9. Review generated PDFs in Drive folder before sending to clients
  
  □ 10. After invoices confirmed correct → run payroll
*/