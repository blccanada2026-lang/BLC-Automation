// ============================================================
// BLC REVISION MANAGER
// File: InvoiceTimeRevisionManager.gs
//
// PURPOSE: Handles job hour revisions on already-billed jobs.
// Updates master data and regenerates the invoice PDF.
//
// TRIGGERS:
// 1. Manual: Raj runs invoiceTimeRevision() from Apps Script menu
// 2. Form: Sarty submits Revision Form -> onInvoiceTimeRevisionSubmit()
//
// USAGE (manual):
// - Open Apps Script editor
// - Select invoiceTimeRevision from dropdown
// - Click Run
// - Enter job number, new hours, reason when prompted
// ============================================================

// ============================================================
// CORE REVISION FUNCTION
// Called by both manual dialog and form trigger
// ============================================================
function invoiceTimeReviseJobHours(jobNumber, newDesignHours, newQCHours, reason) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var masterSheet = ss.getSheetByName(CONFIG.sheets.masterJob);

  if (!masterSheet) {
    logException("REVISION ERROR", jobNumber, "System", "Cannot find MASTER_JOB_DATABASE");
    return { success: false, message: "Cannot find MASTER_JOB_DATABASE" };
  }

  // Find the job row
  var jobRow = findJobRow(jobNumber);
  if (jobRow === -1) {
    logException("REVISION ERROR", jobNumber, "System", "Job not found in master database");
    return { success: false, message: "Job not found: " + jobNumber };
  }

  // Read current values
  var currentDesignHours  = parseFloat(masterSheet.getRange(jobRow, CONFIG.masterCols.designHoursTotal).getValue()) || 0;
  var currentQCHours      = parseFloat(masterSheet.getRange(jobRow, CONFIG.masterCols.qcHoursTotal).getValue()) || 0;
  var currentTotalHours   = parseFloat(masterSheet.getRange(jobRow, CONFIG.masterCols.totalBillableHours).getValue()) || 0;
  var billingPeriod       = String(masterSheet.getRange(jobRow, CONFIG.masterCols.billingPeriod).getValue()).trim();
  var clientCode          = String(masterSheet.getRange(jobRow, CONFIG.masterCols.clientCode).getValue()).trim();
  var clientName          = String(masterSheet.getRange(jobRow, CONFIG.masterCols.clientName).getValue()).trim();
  var designerName        = String(masterSheet.getRange(jobRow, CONFIG.masterCols.designerName).getValue()).trim();
  var currentStatus       = String(masterSheet.getRange(jobRow, CONFIG.masterCols.status).getValue()).trim();

  // Validate inputs
  if (isNaN(newDesignHours) || newDesignHours < 0) {
    return { success: false, message: "Invalid design hours: " + newDesignHours };
  }
  if (isNaN(newQCHours) || newQCHours < 0) {
    return { success: false, message: "Invalid QC hours: " + newQCHours };
  }

  var newTotalHours = newDesignHours + newQCHours;

  // Store original hours for audit trail and invoice note
  var originalDesignHours = currentDesignHours;
  var originalQCHours     = currentQCHours;
  var originalTotalHours  = currentTotalHours;
  var hoursDifference     = newTotalHours - originalTotalHours;

  // Update master with revised hours
  masterSheet.getRange(jobRow, CONFIG.masterCols.designHoursTotal).setValue(newDesignHours);
  masterSheet.getRange(jobRow, CONFIG.masterCols.qcHoursTotal).setValue(newQCHours);
  masterSheet.getRange(jobRow, CONFIG.masterCols.totalBillableHours).setValue(newTotalHours);
  masterSheet.getRange(jobRow, CONFIG.masterCols.lastUpdated).setValue(getTimestamp());
  masterSheet.getRange(jobRow, CONFIG.masterCols.lastUpdatedBy).setValue("Revision Manager");

  // Store revision metadata in Notes column
  var existingNotes = String(masterSheet.getRange(jobRow, CONFIG.masterCols.notes).getValue()).trim();
  var revisionNote  = "REVISED " + getTimestamp() +
    " | Original: " + originalTotalHours + "hrs" +
    " | Revised: " + newTotalHours + "hrs" +
    " | Diff: " + (hoursDifference >= 0 ? "+" : "") + hoursDifference + "hrs" +
    " | Reason: " + reason;
  masterSheet.getRange(jobRow, CONFIG.masterCols.notes).setValue(
    existingNotes ? existingNotes + "\n" + revisionNote : revisionNote
  );

  // Log to exception log
  logException("REVISION APPLIED", jobNumber, designerName,
    "Design: " + originalDesignHours + " -> " + newDesignHours +
    " | QC: " + originalQCHours + " -> " + newQCHours +
    " | Total: " + originalTotalHours + " -> " + newTotalHours +
    " | Reason: " + reason
  );

  // Regenerate invoice for this client + billing period
  var invoiceResult = invoiceTimeRegenerateInvoice(
    clientCode,
    clientName,
    billingPeriod,
    jobNumber,
    originalTotalHours,
    newTotalHours,
    hoursDifference,
    reason
  );

  return {
    success: true,
    jobNumber: jobNumber,
    clientCode: clientCode,
    billingPeriod: billingPeriod,
    originalDesignHours: originalDesignHours,
    originalQCHours: originalQCHours,
    originalTotalHours: originalTotalHours,
    newDesignHours: newDesignHours,
    newQCHours: newQCHours,
    newTotalHours: newTotalHours,
    hoursDifference: hoursDifference,
    invoiceResult: invoiceResult,
    message: "Revision applied successfully. Invoice regenerated."
  };
}

// ============================================================
// REGENERATE INVOICE FOR A BILLING PERIOD
// Reads all jobs for client + period from master,
// rebuilds the PDF with revision note, overwrites original
// ============================================================
function invoiceTimeRegenerateInvoice(clientCode, clientName, billingPeriod, revisedJobNumber, originalHours, newHours, hoursDiff, reason) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var masterSheet = ss.getSheetByName(CONFIG.sheets.masterJob);
    var configSheet = ss.getSheetByName("CONFIG");
    var clientSheet = ss.getSheetByName(CONFIG.sheets.clientMaster);

    if (!masterSheet) {
      return { success: false, message: "Cannot find master sheet" };
    }

    // Get billing rate for this client
    var billingRate = 85; // fallback
    var currency = "CAD";
    if (clientSheet) {
      var clientData = clientSheet.getDataRange().getValues();
      for (var ci = 1; ci < clientData.length; ci++) {
        var code = String(clientData[ci][0]).trim();
        if (code === clientCode) {
          var rate = parseFloat(clientData[ci][5]) || 85;
          var curr = String(clientData[ci][11]).trim().toUpperCase();
          billingRate = rate;
          currency = curr;
          break;
        }
      }
    }

    // Convert USD to CAD if needed
    var USD_TO_CAD = 1.42;
    var displayRate = (currency === "USD") ? Math.round(rate * USD_TO_CAD * 100) / 100 : billingRate;
    var rateLabel = (currency === "USD") ? "USD " + billingRate + " (CAD " + displayRate + ")" : "CAD " + billingRate;

    // Read all jobs for this client + billing period
    var lastRow = masterSheet.getLastRow();
    var allData = masterSheet.getRange(2, 1, lastRow - 1, 42).getValues();

    var jobLines = [];
    var totalHours = 0;

    allData.forEach(function(row) {
      var rowClient  = String(row[CONFIG.masterCols.clientCode - 1]).trim();
      var rowPeriod  = String(row[CONFIG.masterCols.billingPeriod - 1]).trim();
      var rowIsTest  = String(row[CONFIG.masterCols.isTest - 1]).trim().toLowerCase();
      var rowJobNum  = String(row[CONFIG.masterCols.jobNumber - 1]).trim();
      var rowHours   = parseFloat(row[CONFIG.masterCols.totalBillableHours - 1]) || 0;
      var rowDesigner = String(row[CONFIG.masterCols.designerName - 1]).trim();
      var rowProduct  = String(row[CONFIG.masterCols.productType - 1]).trim();
      var rowStatus   = String(row[CONFIG.masterCols.status - 1]).trim();

      if (rowClient !== clientCode) return;
      if (rowPeriod !== billingPeriod) return;
      if (rowIsTest === "yes") return;
      if (rowHours <= 0) return;

      jobLines.push({
        jobNumber:   rowJobNum,
        designer:    rowDesigner,
        productType: rowProduct,
        hours:       rowHours,
        amount:      rowHours * displayRate,
        isRevised:   (rowJobNum === revisedJobNumber)
      });
      totalHours += rowHours;
    });

    if (jobLines.length === 0) {
      return { success: false, message: "No jobs found for " + clientCode + " in period " + billingPeriod };
    }

    var totalAmount = totalHours * displayRate;

    // Get BLC details from CONFIG sheet
    var blcAddress  = "Blue Lotus Consulting Corporation";
    var blcGST      = "";
    var blcEmail    = "blccanada2026@gmail.com";
    if (configSheet) {
      var configData = configSheet.getDataRange().getValues();
      configData.forEach(function(row) {
        if (String(row[0]).trim() === "BLC_ADDRESS")  blcAddress = String(row[1]).trim();
        if (String(row[0]).trim() === "GST_NUMBER")   blcGST     = String(row[1]).trim();
        if (String(row[0]).trim() === "CONTACT_EMAIL") blcEmail  = String(row[1]).trim();
      });
    }

    // Build invoice date
    var invoiceDate = Utilities.formatDate(new Date(), "America/Regina", "MMMM d, yyyy");
    var invoiceNumber = "BLC-" + clientCode + "-" + billingPeriod.replace(/[^a-zA-Z0-9]/g, "") + "-R";

    // Build revision summary line
    var revisionSummary =
      "REVISION NOTE: Job " + revisedJobNumber +
      " revised from " + originalHours + " hrs to " + newHours + " hrs" +
      " (Difference: " + (hoursDiff >= 0 ? "+" : "") + hoursDiff + " hrs)" +
      " | Reason: " + reason;

    // Build HTML invoice
    var html = invoiceTimeBuildHTML(
      invoiceNumber,
      invoiceDate,
      clientName,
      clientCode,
      billingPeriod,
      jobLines,
      totalHours,
      totalAmount,
      displayRate,
      rateLabel,
      blcAddress,
      blcGST,
      blcEmail,
      revisionSummary
    );

    // Convert to PDF and save to Drive
    var blob = Utilities.newBlob(html, "text/html", invoiceNumber + ".html");
    var pdfBlob = blob.getAs("application/pdf");
    pdfBlob.setName("BLC_Invoice_" + clientCode + "_" + billingPeriod.replace(/[^a-zA-Z0-9]/g, "_") + ".pdf");

    // Find and overwrite existing file in Drive, or create new one
    var fileName = "BLC_Invoice_" + clientCode + "_" + billingPeriod.replace(/[^a-zA-Z0-9]/g, "_") + ".pdf";
    var existingFiles = DriveApp.getFilesByName(fileName);
    if (existingFiles.hasNext()) {
      var existingFile = existingFiles.next();
      existingFile.setContent(pdfBlob.getBytes());
      logException("INVOICE REGENERATED", revisedJobNumber, "System",
        "Invoice overwritten: " + fileName + " | Period: " + billingPeriod + " | Total hrs: " + totalHours);
      return { success: true, fileName: fileName, message: "Invoice regenerated and overwritten in Drive" };
    } else {
      var folder = DriveApp.getRootFolder();
      folder.createFile(pdfBlob);
      logException("INVOICE CREATED", revisedJobNumber, "System",
        "New invoice created: " + fileName + " | Period: " + billingPeriod + " | Total hrs: " + totalHours);
      return { success: true, fileName: fileName, message: "New invoice created in Drive" };
    }

  } catch(err) {
    logException("INVOICE REGEN ERROR", revisedJobNumber, "System", err.message);
    return { success: false, message: err.message };
  }
}

// ============================================================
// BUILD INVOICE HTML
// ============================================================
function invoiceTimeBuildHTML(invoiceNumber, invoiceDate, clientName, clientCode, billingPeriod, jobLines, totalHours, totalAmount, rate, rateLabel, blcAddress, blcGST, blcEmail, revisionSummary) {
  var rows = jobLines.map(function(j) {
    var revisedTag = j.isRevised ? " <span style='color:#c0392b;font-weight:bold;'>[REVISED]</span>" : "";
    return "<tr style='border-bottom:1px solid #eee;'>" +
      "<td style='padding:8px 12px;'>" + j.jobNumber + revisedTag + "</td>" +
      "<td style='padding:8px 12px;'>" + j.designer + "</td>" +
      "<td style='padding:8px 12px;'>" + j.productType + "</td>" +
      "<td style='padding:8px 12px;text-align:right;'>" + j.hours.toFixed(2) + "</td>" +
      "<td style='padding:8px 12px;text-align:right;'>$" + j.amount.toFixed(2) + "</td>" +
      "</tr>";
  }).join("");

  var revisionBlock = revisionSummary ?
    "<div style='background:#fff8e1;border-left:4px solid #f39c12;padding:12px 16px;margin:20px 0;font-size:12px;color:#7d6608;'>" +
    "<b>REVISION NOTICE</b><br>" + revisionSummary + "</div>" : "";

  var gstLine = blcGST ? "<p style='margin:2px 0;font-size:12px;color:#666;'>GST: " + blcGST + "</p>" : "";

  return "<!DOCTYPE html><html><head><meta charset='UTF-8'>" +
    "<style>body{font-family:Arial,sans-serif;color:#222;margin:0;padding:0;}" +
    "table{width:100%;border-collapse:collapse;}" +
    "th{background:#1a1a2e;color:#fff;padding:10px 12px;text-align:left;font-size:13px;}" +
    "tr:nth-child(even){background:#f9f9f9;}" +
    "</style></head><body>" +
    "<div style='max-width:800px;margin:0 auto;padding:40px 20px;'>" +

    "<div style='display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:30px;'>" +
    "<div>" +
    "<h1 style='color:#1a1a2e;font-size:26px;margin:0;'>INVOICE</h1>" +
    "<p style='color:#c9a84c;font-size:13px;margin:4px 0;'>REVISED VERSION</p>" +
    "</div>" +
    "<div style='text-align:right;'>" +
    "<p style='margin:2px 0;font-weight:bold;font-size:14px;'>Blue Lotus Consulting Corporation</p>" +
    "<p style='margin:2px 0;font-size:12px;color:#666;'>" + blcAddress + "</p>" +
    gstLine +
    "<p style='margin:2px 0;font-size:12px;color:#666;'>" + blcEmail + "</p>" +
    "</div></div>" +

    "<div style='background:#f5f3ee;padding:16px;border-radius:6px;margin-bottom:20px;display:flex;justify-content:space-between;'>" +
    "<div><p style='margin:2px 0;font-size:12px;color:#888;'>INVOICE NUMBER</p><p style='margin:0;font-weight:bold;'>" + invoiceNumber + "</p></div>" +
    "<div><p style='margin:2px 0;font-size:12px;color:#888;'>DATE</p><p style='margin:0;font-weight:bold;'>" + invoiceDate + "</p></div>" +
    "<div><p style='margin:2px 0;font-size:12px;color:#888;'>BILLING PERIOD</p><p style='margin:0;font-weight:bold;'>" + billingPeriod + "</p></div>" +
    "<div><p style='margin:2px 0;font-size:12px;color:#888;'>BILL TO</p><p style='margin:0;font-weight:bold;'>" + clientName + "</p></div>" +
    "</div>" +

    revisionBlock +

    "<table>" +
    "<thead><tr><th>Job Number</th><th>Designer</th><th>Product Type</th><th style='text-align:right;'>Hours</th><th style='text-align:right;'>Amount (CAD)</th></tr></thead>" +
    "<tbody>" + rows + "</tbody>" +
    "</table>" +

    "<div style='margin-top:20px;text-align:right;'>" +
    "<table style='width:300px;margin-left:auto;'>" +
    "<tr><td style='padding:6px 12px;'>Total Hours:</td><td style='padding:6px 12px;text-align:right;font-weight:bold;'>" + totalHours.toFixed(2) + "</td></tr>" +
    "<tr><td style='padding:6px 12px;'>Rate:</td><td style='padding:6px 12px;text-align:right;'>" + rateLabel + "/hr</td></tr>" +
    "<tr style='background:#1a1a2e;color:#fff;'><td style='padding:10px 12px;font-weight:bold;'>TOTAL DUE (CAD):</td><td style='padding:10px 12px;text-align:right;font-weight:bold;font-size:16px;'>$" + totalAmount.toFixed(2) + "</td></tr>" +
    "</table></div>" +

    "<p style='margin-top:40px;font-size:11px;color:#aaa;text-align:center;'>This is a revised invoice superseding the previous version. Generated by BLC Job Management System.</p>" +
    "</div></body></html>";
}

// ============================================================
// MANUAL TRIGGER: Raj runs this from Apps Script menu
// ============================================================
function invoiceTimeRevision() {
  var ui = SpreadsheetApp.getUi();

  var jobResponse = ui.prompt(
    "BLC Revision Manager",
    "Enter the Job Number to revise:",
    ui.ButtonSet.OK_CANCEL
  );
  if (jobResponse.getSelectedButton() !== ui.Button.OK) return;
  var jobNumber = jobResponse.getResponseText().trim();
  if (!jobNumber) { ui.alert("No job number entered."); return; }

  var designHoursResponse = ui.prompt(
    "BLC Revision Manager",
    "Enter the NEW Design Hours for job " + jobNumber + ":",
    ui.ButtonSet.OK_CANCEL
  );
  if (designHoursResponse.getSelectedButton() !== ui.Button.OK) return;
  var newDesignHours = parseFloat(designHoursResponse.getResponseText().trim());
  if (isNaN(newDesignHours)) { ui.alert("Invalid design hours entered."); return; }

  var qcHoursResponse = ui.prompt(
    "BLC Revision Manager",
    "Enter the NEW QC Hours for job " + jobNumber + " (enter 0 if none):",
    ui.ButtonSet.OK_CANCEL
  );
  if (qcHoursResponse.getSelectedButton() !== ui.Button.OK) return;
  var newQCHours = parseFloat(qcHoursResponse.getResponseText().trim()) || 0;

  var reasonResponse = ui.prompt(
    "BLC Revision Manager",
    "Enter the reason for this revision:",
    ui.ButtonSet.OK_CANCEL
  );
  if (reasonResponse.getSelectedButton() !== ui.Button.OK) return;
  var reason = reasonResponse.getResponseText().trim() || "Manual revision by admin";

  // Confirm before applying
  var confirm = ui.alert(
    "Confirm Revision",
    "Job: " + jobNumber + "\n" +
    "New Design Hours: " + newDesignHours + "\n" +
    "New QC Hours: " + newQCHours + "\n" +
    "New Total: " + (newDesignHours + newQCHours) + "\n" +
    "Reason: " + reason + "\n\n" +
    "This will update the master database and regenerate the invoice. Continue?",
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  var result = invoiceTimeReviseJobHours(jobNumber, newDesignHours, newQCHours, reason);

  if (result.success) {
    ui.alert(
      "Revision Complete",
      "Job " + result.jobNumber + " revised successfully.\n\n" +
      "Original hours: " + result.originalTotalHours + " hrs\n" +
      "New hours: " + result.newTotalHours + " hrs\n" +
      "Difference: " + (result.hoursDifference >= 0 ? "+" : "") + result.hoursDifference + " hrs\n\n" +
      "Invoice regenerated for " + result.clientCode + " | " + result.billingPeriod + "\n" +
      result.invoiceResult.message,
      ui.ButtonSet.OK
    );
  } else {
    ui.alert("Revision Failed", result.message, ui.ButtonSet.OK);
  }
}

// ============================================================
// FORM TRIGGER: Sarty submits Revision Form
// Add this as a form submit trigger on FORM_Revision sheet
//
// Revision Form fields needed (in this order):
// 1. Timestamp (auto)
// 2. Job Number
// 3. New Design Hours
// 4. New QC Hours
// 5. Reason for Revision
// ============================================================
function onInvoiceTimeRevisionSubmit(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("FORM_Revision");
    if (!sheet) {
      logException("REVISION ERROR", "UNKNOWN", "System", "FORM_Revision sheet not found");
      return;
    }
    var lastRow = sheet.getLastRow();
    var response = sheet.getRange(lastRow, 1, 1, 5).getValues()[0];

    var jobNumber      = String(response[1]).trim();
    var newDesignHours = parseFloat(response[2]) || 0;
    var newQCHours     = parseFloat(response[3]) || 0;
    var reason         = String(response[4]).trim() || "Revision via form";

    if (!jobNumber) {
      logException("REVISION ERROR", "UNKNOWN", "System", "Revision form submitted with no job number");
      return;
    }

    var result = invoiceTimeReviseJobHours(jobNumber, newDesignHours, newQCHours, reason);

    logException(
      result.success ? "REVISION COMPLETE" : "REVISION FAILED",
      jobNumber,
      "Revision Form",
      result.message
    );

  } catch(err) {
    logException("SCRIPT ERROR - REVISION", "UNKNOWN", "System", err.message);
  }
}

// ============================================================
// ADD TO SPREADSHEET MENU
// Add this call inside your existing onOpen() function:
//
//   .addItem("Revise Job Hours", "invoiceTimeRevision")
//
// ============================================================