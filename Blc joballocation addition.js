/**
 * BLC JOB MANAGEMENT SYSTEM
 * Job Allocation Product Type — Addition
 * 
 * WHAT THIS FILE DOES:
 *   Adds "Job Allocation" as a first-class product type across the system:
 *   1. patchManagementToJobAllocation() — one-time patch: renames "Management"
 *      rows in MASTER to "Job Allocation"
 *   2. Updated generateInvoices() section — handles Job Allocation as a 
 *      third billing section on invoices (separate from Design and QC)
 *   3. syncFormDropdowns() addition — adds "Job Allocation" to all form 
 *      product type dropdowns
 *   4. Canonical whitelist update for standardiseOWWProductTypes()
 *
 * DEPLOYMENT ORDER:
 *   Step 1 — Paste this file into Apps Script as BLC_JobAllocation_Addition.gs
 *   Step 2 — Run patchManagementToJobAllocation() once from the menu
 *   Step 3 — Run syncFormDropdowns() to push "Job Allocation" to all forms
 *   Step 4 — The updated generateInvoices() in BLC_InvoiceFix_March2026.gs
 *             already handles this — no further change needed there
 *             (it reads product type and routes Job Allocation to its own section)
 *
 * ADD TO onOpen() MENU:
 *   .addItem('Patch Management → Job Allocation (run once)', 'patchManagementToJobAllocation')
 */


// ─────────────────────────────────────────────────────────────────────────────
// PART 1 — One-time patch: rename "Management" → "Job Allocation" in MASTER
// ─────────────────────────────────────────────────────────────────────────────

function patchManagementToJobAllocation() {
  var ui = SpreadsheetApp.getUi();
  try {
    var masterSheet = getSheet(CONFIG.sheets.masterJob);
    var data        = masterSheet.getDataRange().getValues();
    var changed     = [];

    for (var r = 1; r < data.length; r++) {
      var productType = String(data[r][4] || '').trim(); // col E, index 4
      if (productType === 'Management') {
        masterSheet.getRange(r + 1, 5).setValue('Job Allocation');
        changed.push('Row ' + (r + 1) + ' — Job: ' + data[r][0] + 
                     ', Designer: ' + data[r][3]);
        logException('INFO', String(data[r][0]), 'patchManagementToJobAllocation',
                     'Product type updated: Management → Job Allocation');
      }
    }

    var msg = 'patchManagementToJobAllocation complete.\n\n';
    msg += changed.length > 0
      ? 'Updated ' + changed.length + ' row(s):\n' + changed.join('\n')
      : 'No "Management" rows found — already clean.';
    ui.alert(msg);

  } catch (err) {
    logException('ERROR', 'BATCH', 'patchManagementToJobAllocation', err.message);
    ui.alert('Error: ' + err.message);
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// PART 2 — Updated generateInvoices() with Job Allocation section
// This REPLACES generateInvoices() in BLC_InvoiceFix_March2026.gs entirely.
// The only change from the previous version is the Job Allocation bucket.
// ─────────────────────────────────────────────────────────────────────────────

function generateInvoices() {
  var ui = SpreadsheetApp.getUi();

  var periodResp = ui.prompt(
    'Generate Invoices',
    'Enter billing period prefix (e.g. 2026-03):',
    ui.ButtonSet.OK_CANCEL
  );
  if (periodResp.getSelectedButton() !== ui.Button.OK) return;
  var periodPrefix = periodResp.getResponseText().trim();
  if (!periodPrefix) { ui.alert('Billing period is required.'); return; }

  var monthResp = ui.prompt(
    'Generate Invoices',
    'Enter invoice month label (e.g. March 2026):',
    ui.ButtonSet.OK_CANCEL
  );
  if (monthResp.getSelectedButton() !== ui.Button.OK) return;
  var invoiceMonthLabel = monthResp.getResponseText().trim();
  if (!invoiceMonthLabel) { ui.alert('Invoice month is required.'); return; }

  try {
    var masterData = getSheetData(CONFIG.sheets.masterJob);
    var clientData = getSheetData(CONFIG.sheets.clientMaster);

    // Build client lookup
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

    // Three buckets per client:
    //   designRows[client][designer]   = [{job, type, hours, desc, notes}]
    //   qcRows[client][qcLead]         = [{job, type, hours, desc, notes}]
    //   allocRows[client][designer]    = [{job, type, hours, desc, notes}]
    var designRows = {};
    var qcRows     = {};
    var allocRows  = {};

    for (var r = 1; r < masterData.length; r++) {
      var row         = masterData[r];
      var status      = String(row[9]  || '').trim();
      var period      = String(row[17] || '').trim();
      var isTest      = String(row[30] || '').trim().toLowerCase();
      var productType = String(row[4]  || '').trim();

      if (status !== 'Completed - Billable')           continue;
      if (period.indexOf(periodPrefix) !== 0)          continue;
      if (isTest === 'yes')                            continue;

      var jobNum   = String(row[0]  || '').trim();
      var client   = String(row[1]  || '').trim().toUpperCase();
      var designer = normaliseDesignerName(String(row[3] || '').trim());
      var designH  = parseFloat(row[10]) || 0;
      var qcH      = parseFloat(row[11]) || 0;
      var qcLead   = normaliseDesignerName(String(row[15] || '').trim());
      var notes    = String(row[28] || '').trim();

      if (!client || !jobNum) continue;

      var isJobAlloc = (productType === 'Job Allocation');

      // ── Design hours (non-Job-Allocation) ──────────────────────────────────
      if (designH > 0 && designer && !isJobAlloc) {
        if (!designRows[client]) designRows[client] = {};
        if (!designRows[client][designer]) designRows[client][designer] = [];
        designRows[client][designer].push({
          job: jobNum, type: productType, hours: designH,
          desc: 'Design-Quote', notes: notes
        });
      }

      // ── QC hours ───────────────────────────────────────────────────────────
      if (qcH > 0 && qcLead && !isJobAlloc) {
        if (!qcRows[client]) qcRows[client] = {};
        if (!qcRows[client][qcLead]) qcRows[client][qcLead] = [];
        qcRows[client][qcLead].push({
          job: jobNum, type: productType, hours: qcH,
          desc: 'Quality Check', notes: notes
        });
      }

      // ── Job Allocation hours ───────────────────────────────────────────────
      // Both design and QC hours on a Job Allocation row go here,
      // attributed to the designer (who logged the allocation time).
      if (isJobAlloc && (designH + qcH) > 0 && designer) {
        if (!allocRows[client]) allocRows[client] = {};
        if (!allocRows[client][designer]) allocRows[client][designer] = [];
        allocRows[client][designer].push({
          job: jobNum || 'JOB-ALLOC', type: 'Job Allocation',
          hours: designH + qcH,
          desc: 'Job Allocation', notes: notes || 'Job assignment and support'
        });
      }
    }

    var allClients = Object.keys(
      Object.assign({}, designRows, qcRows, allocRows)
    );
    if (allClients.length === 0) {
      ui.alert('No Completed-Billable jobs found for period: ' + periodPrefix);
      return;
    }

    var folderName    = CONFIG.invoiceFolderName || 'BLC Invoices';
    var driveFiles    = DriveApp.getFoldersByName(folderName);
    var invoiceFolder = driveFiles.hasNext()
      ? driveFiles.next()
      : DriveApp.createFolder(folderName);

    var generated = [], errors = [];

    for (var ci2 = 0; ci2 < allClients.length; ci2++) {
      var clientCode2 = allClients[ci2];
      var client2     = clientMap[clientCode2];
      if (!client2) {
        errors.push(clientCode2 + ': not found in CLIENT_MASTER');
        continue;
      }
      try {
        var pdfFile = generateStatementPDF(
          clientCode2, client2,
          designRows[clientCode2] || {},
          qcRows[clientCode2]     || {},
          allocRows[clientCode2]  || {},
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
// PART 3 — Updated generateStatementPDF() with Job Allocation section
// This REPLACES generateStatementPDF() in BLC_InvoiceFix_March2026.gs.
// New parameter: allocRows — the Job Allocation bucket.
// ─────────────────────────────────────────────────────────────────────────────

function generateStatementPDF(clientCode, client, designRows, qcRows, allocRows,
                               periodPrefix, invoiceMonthLabel, folder) {
  var ss        = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = 'STMT_' + clientCode + '_' +
                  periodPrefix.replace(/[^0-9a-z]/gi, '');

  var existing = ss.getSheetByName(sheetName);
  if (existing) ss.deleteSheet(existing);
  var sheet = ss.insertSheet(sheetName);

  try {
    var companyName    = 'Blue Lotus Consulting Corporation';
var companyAddress = '541 Avenue I north | Saskatoon, SK S7L2G9';
var companyEmail   = 'contact@bluelotuscanada.ca';
var gstNumber      = '827089830RT0001';
var gstRate        = 0.05;
    // ── Flatten and sort each bucket ──────────────────────────────────────────
    function flattenBucket(bucket, descLabel) {
      var allRows = []; var summary = {};
      var names = Object.keys(bucket).sort();
      var sno = 1;
      for (var i = 0; i < names.length; i++) {
        var name  = names[i];
        var jobs  = bucket[name].sort(function(a,b){return a.job.localeCompare(b.job);});
        var total = 0;
        for (var j = 0; j < jobs.length; j++) {
          allRows.push({ sno: sno++, job: jobs[j].job, type: jobs[j].type,
                         desc: jobs[j].desc || descLabel,
                         hours: jobs[j].hours, designer: name, notes: jobs[j].notes });
          total += jobs[j].hours;
        }
        allRows.push({ subtotal: true, designer: name, hours: total });
        summary[name] = total;
      }
      return { rows: allRows, summary: summary,
               total: Object.values(summary).reduce(function(s,h){return s+h;},0) };
    }

    var d = flattenBucket(designRows, 'Design-Quote');
    var q = flattenBucket(qcRows,     'Quality Check');
    var a = flattenBucket(allocRows,  'Job Allocation');

    var subtotalDesign = d.total * billingRate;
    var subtotalQC     = q.total * qcBillingRate;
    var subtotalAlloc  = a.total * allocRate;
    var subtotal       = subtotalDesign + subtotalQC + subtotalAlloc;
    var gstAmount      = applyGST ? subtotal * gstRate : 0;
    var totalDue       = subtotal + gstAmount;
    var totalHrs       = d.total + q.total + a.total;

    // ── Build sheet data ──────────────────────────────────────────────────────
    var data = [];

    // Header
    data.push([companyName, '', '', '', '', '', '']);
    data.push([companyAddress + ' | ' + companyEmail + ' | GST: ' + gstNumber,
               '', '', '', '', '', '']);
    data.push(['', '', '', '', '', '', '']);
    data.push(['BILL TO', '', '', 'STATEMENT DETAILS', '', '', '']);
    data.push([client.name,    '', '', 'Billing Period: ' + periodPrefix, '', '', '']);
    data.push([client.address, '', '', 'Date: ' + today, '', '', '']);
    data.push(['', '', '', 'Invoice Month: ' + invoiceMonthLabel, '', '', '']);
    data.push(['', '', '', 'Currency: ' + currency, '', '', '']);
    data.push(['', '', '', 'Payment Terms: ' + client.paymentTerms, '', '', '']);
    data.push(['', '', '', '', '', '', '']);
    data.push(['Sno', 'Job #', 'Job Type', 'Description', 'Hours', 'Designer', 'Notes']);

    function writeSection(label, rows, sectionTotal) {
      if (rows.length === 0) return;
      data.push(['--- ' + label + ' ---', '', '', '', '', '', '']);
      for (var i = 0; i < rows.length; i++) {
        var rx = rows[i];
        if (rx.subtotal) {
          data.push(['', '', '', 'Total — ' + rx.designer, rx.hours, '', '']);
        } else {
          data.push([rx.sno, rx.job, rx.type, rx.desc, rx.hours, rx.designer, rx.notes]);
        }
      }
      data.push(['', '', '', 'TOTAL ' + label.toUpperCase(), sectionTotal + ' hrs', '', '']);
      data.push(['', '', '', '', '', '', '']);
    }

    writeSection('DESIGN HOURS',          d.rows, d.total);
    writeSection('QUALITY CHECK HOURS',   q.rows, q.total);
    writeSection('JOB ALLOCATION HOURS',  a.rows, a.total);  // ← new section

    // Totals
    data.push(['', '', '', 'TOTAL BILLABLE HOURS', totalHrs + ' hrs', '', '']);
    data.push(['', '', '', '', '', '', '']);
    if (d.total  > 0) data.push(['', '', '', 'Design Subtotal:',
      currency + ' $' + subtotalDesign.toFixed(2), '', '']);
    if (q.total  > 0) data.push(['', '', '', 'QC Subtotal:',
      currency + ' $' + subtotalQC.toFixed(2), '', '']);
    if (a.total  > 0) data.push(['', '', '', 'Job Allocation Subtotal:',  // ← new line
      currency + ' $' + subtotalAlloc.toFixed(2), '', '']);
    data.push(['', '', '', 'Subtotal:', currency + ' $' + subtotal.toFixed(2), '', '']);
    if (applyGST) data.push(['', '', '', 'GST (' + (gstRate*100).toFixed(0) + '%):',
      currency + ' $' + gstAmount.toFixed(2), '', '']);
    data.push(['', '', '', 'TOTAL AMOUNT DUE:', currency + ' $' + totalDue.toFixed(2), '', '']);
    data.push(['', '', '', '', '', '', '']);

    // Designer summary — 4 columns now: Design, QC, Alloc, Total
    data.push(['DESIGNER SUMMARY', '', '', '', '', '', '']);
    data.push(['Designer', 'Design Hrs', 'QC Hrs', 'Job Alloc Hrs', 'Total Hrs', '', '']);
    var allNames = Array.from(new Set(
      Object.keys(d.summary).concat(Object.keys(q.summary)).concat(Object.keys(a.summary))
    )).sort();
    for (var k = 0; k < allNames.length; k++) {
      var n  = allNames[k];
      var dh = d.summary[n] || 0;
      var qh = q.summary[n] || 0;
      var ah = a.summary[n] || 0;
      data.push([n, dh, qh, ah, dh + qh + ah, '', '']);
    }
    data.push(['TOTAL', d.total, q.total, a.total, totalHrs, '', '']);
    data.push(['', '', '', '', '', '', '']);
    data.push(['Thank you for your business. Payment due within ' +
               client.paymentTerms + ' of statement date. ' + companyEmail,
               '', '', '', '', '', '']);

    // Write to sheet
    sheet.getRange(1, 1, data.length, 7).setValues(data);
    SpreadsheetApp.flush();

    // Export PDF
    var fileName = clientCode + '_Statement_' +
                   periodPrefix.replace(' | ', '_') + '.pdf';
    var existingFiles = folder.getFilesByName(fileName);
    while (existingFiles.hasNext()) { existingFiles.next().setTrashed(true); }

    var exportUrl = 'https://docs.google.com/spreadsheets/d/' + ss.getId() +
      '/export?format=pdf&size=A4&portrait=true&fitw=true' +
      '&sheetnames=false&printtitle=false&pagenumbers=false&gridlines=false' +
      '&gid=' + sheet.getSheetId();

    var token    = ScriptApp.getOAuthToken();
    var response = UrlFetchApp.fetch(exportUrl, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    return folder.createFile(response.getBlob().setName(fileName));

  } finally {
    var cleanup = ss.getSheetByName(sheetName);
    if (cleanup) ss.deleteSheet(cleanup);
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// PART 4 — syncFormDropdowns() addition
//
// In Code.gs, find your existing syncFormDropdowns() function.
// Locate where the product type choices array is defined — it will look
// something like:
//   var productTypes = ['Roof Truss', 'Floor Truss', 'Wall Frame', 'I-Joist Floor'];
//
// ADD 'Job Allocation' to that array:
//   var productTypes = ['Roof Truss', 'Floor Truss', 'Wall Frame', 'I-Joist Floor',
//                       'Job Allocation'];
//
// This ensures "Job Allocation" appears as a selectable option in:
//   - Job Start Form (product type question)
//   - Daily Work Log Form (product type question)
//   - QC Log Form (product type question — so QC hours on allocation work are logged)
//
// If your syncFormDropdowns() builds the list dynamically from MASTER
// rather than a hardcoded array, add a row to MASTER with product type
// = 'Job Allocation' and the function will pick it up automatically.
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// PART 5 — Updated canonical whitelist for standardiseOWWProductTypes()
//
// In BLC_InvoiceFix_March2026.gs, find standardiseOWWProductTypes() and
// update the CANONICAL array from:
//   var CANONICAL = ['Roof Truss', 'Floor Truss', 'Wall Frame', 'I-Joist Floor'];
// To:
//   var CANONICAL = ['Roof Truss', 'Floor Truss', 'Wall Frame', 'I-Joist Floor',
//                    'Job Allocation'];
//
// This stops "Job Allocation" from ever showing as an unknown type.
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// PART 6 — onOpen() additions
// ADD to the BLC System menu in Code.gs onOpen():
//
//   .addItem('Patch Management → Job Allocation (run once)',
//            'patchManagementToJobAllocation')
//
// Place it near the other one-time patch items.
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// HOW JOB ALLOCATION FLOWS END-TO-END (for reference)
// ─────────────────────────────────────────────────────────────────────────────
//
// 1. Sarty opens Daily Work Log form
// 2. Selects Product Type = "Job Allocation"  ← now available in dropdown
// 3. Enters job# (can use a placeholder like "JOB-MGMT-2026-03" for
//    non-specific allocation work), hours, description
// 4. onDailyLogSubmit() creates/updates a MASTER row with:
//      Product_Type = "Job Allocation"
//      Designer_Name = "Sarty Gosh"
//      Design_Hours_Total = hours logged
// 5. When status = Completed-Billable, generateInvoices() picks it up
//    and puts it in the JOB ALLOCATION HOURS section
// 6. Invoice shows three sections:
//      DESIGN HOURS        — billed at billingRate
//      QUALITY CHECK HOURS — billed at qcRate
//      JOB ALLOCATION HOURS— billed at billingRate (same as design)
//
// NOTE: For non-job allocation (like "job assign & help" which has no
// specific job number), you may want to create a standing MASTER row
// per billing period with a fixed job ID like "MGT-2026-03-SBS" and
// have Sarty log hours against it each day. This avoids the system
// trying to look up a real job number that doesn't exist in MiTek.