// ============================================================
// ClientReturnSystem.gs
// Blue Lotus Consulting Corporation
// Manages per-client return forms — one form per client.
// Each client sees only their own jobs — full isolation.
// Build date: March 7, 2026
// ============================================================

// Form field indices (0-based, Timestamp is always index 0)
var CLIENT_RETURN_FORM = {
  timestamp:         0,  // Auto — Google Forms always inserts this
  jobNumber:         1,  // Job Number — dropdown (client-specific)
  dateIssueNoticed:  2,  // Date Issue Noticed — date
  issueDescription:  3,  // Describe the Issue — paragraph
  severity:          4,  // Severity — dropdown: Minor / Major
  attachmentLink:    5,  // Attachment / Screenshot Link — short answer
  submittedBy:       6   // Your Name — short answer
};

// CLIENT_RETURN_LOG column indices (1-based for getRange)
// Matches actual tab structure confirmed March 7, 2026:
// Return ID | Date Submitted | Client_Name | Job Number |
// Date Issue Noticed | Describe the Issue | Submitted By |
// Status | Logged | Severity | Attachment_Link | Logged_Timestamp
var CRL = {
  returnId:          1,   // Col A — Return ID
  dateSubmitted:     2,   // Col B — Date Submitted
  clientName:        3,   // Col C — Client_Name
  jobNumber:         4,   // Col D — Job Number
  dateIssueNoticed:  5,   // Col E — Date Issue Noticed
  issueDescription:  6,   // Col F — Describe the Issue
  submittedBy:       7,   // Col G — Submitted By
  status:            8,   // Col H — Status
  logged:            9,   // Col I — Logged
  severity:          10,  // Col J — Severity
  attachmentLink:    11,  // Col K — Attachment_Link
  loggedTimestamp:   12   // Col L — Logged_Timestamp
};


// ─────────────────────────────────────────────────────────────
// MAIN HANDLER
// Called directly by per-form trigger when a client submits
// a return. Trigger is created by createClientReturnTrigger_()
// and fires onClientReturnSubmit() directly — not via router.
// ─────────────────────────────────────────────────────────────

function onClientReturnSubmit(e) {
  var FUNCTION_NAME = "onClientReturnSubmit";
  var jobNumber = "UNKNOWN";

  try {
    var row = e.values; // 0-based array from form submit event

    jobNumber            = String(row[CLIENT_RETURN_FORM.jobNumber]        || "").trim();
    var dateIssueNoticed = row[CLIENT_RETURN_FORM.dateIssueNoticed]            || "";
    var issueDescription = String(row[CLIENT_RETURN_FORM.issueDescription] || "").trim();
    var severity         = String(row[CLIENT_RETURN_FORM.severity]         || "").trim();
    var attachmentLink   = String(row[CLIENT_RETURN_FORM.attachmentLink]   || "").trim();
    var submittedBy      = String(row[CLIENT_RETURN_FORM.submittedBy]      || "").trim();
    var now              = new Date();

    // ── 1. Validate required fields ────────────────────────────
    if (!jobNumber) {
      logException("ERROR", "UNKNOWN", FUNCTION_NAME,
        "Client return submitted with no job number. Aborting.");
      return;
    }
    if (!issueDescription) {
      logException("ERROR", jobNumber, FUNCTION_NAME,
        "Client return submitted with no issue description. Aborting.");
      return;
    }

    // ── 2. Look up job in MASTER to get client info ────────────
    var MJ           = CONFIG.masterCols;
    var masterData   = getSheetData(CONFIG.sheets.masterJobDatabase);
    var clientName   = "";
    var clientCode   = "";
    var designerName = "";

    for (var i = 1; i < masterData.length; i++) {
      var mJob = String(masterData[i][MJ.jobNumber - 1] || "").trim();
      if (mJob === jobNumber) {
        clientCode   = String(masterData[i][MJ.clientCode   - 1] || "").trim();
        clientName   = String(masterData[i][MJ.clientName   - 1] || "").trim();
        designerName = String(masterData[i][MJ.designerName - 1] || "").trim();
        break;
      }
    }

    if (!clientName) {
      logException("WARNING", jobNumber, FUNCTION_NAME,
        "Job not found in MASTER. Logging return with unknown client.");
      clientName = "UNKNOWN";
      clientCode = "UNKNOWN";
    }

    // ── 3. Generate unique Return ID ───────────────────────────
    var returnId = "RET-" +
      Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyyMMdd") +
      "-" + Math.floor(Math.random() * 9000 + 1000);

    // ── 4. Log to CLIENT_RETURN_LOG ────────────────────────────
    var logSheet = getSheet(CONFIG.sheets.clientReturn);
    logSheet.appendRow([
      returnId,          // Col A — Return ID
      now,               // Col B — Date Submitted
      clientName,        // Col C — Client_Name
      jobNumber,         // Col D — Job Number
      dateIssueNoticed,  // Col E — Date Issue Noticed
      issueDescription,  // Col F — Describe the Issue
      submittedBy,       // Col G — Submitted By
      "Open",            // Col H — Status
      now,               // Col I — Logged
      severity,          // Col J — Severity
      attachmentLink,    // Col K — Attachment_Link
      now                // Col L — Logged_Timestamp
    ]);

    // ── 5. Re-open job in MASTER + ACTIVE_JOBS ────────────────
    var reopened = reopenJobFromClientReturn_(jobNumber, severity, returnId);

    // ── 6. Send notification to Sarty + TL + Stacey ───────────
    sendClientReturnNotification(
      returnId, jobNumber, clientCode, clientName,
      designerName, dateIssueNoticed, issueDescription,
      severity, attachmentLink, submittedBy, now, reopened
    );

    logException("INFO", jobNumber, FUNCTION_NAME,
      "Client return logged. Return ID: " + returnId +
      " | Client: " + clientName +
      " | Severity: " + severity +
      " | Re-opened in MASTER: " + (reopened ? "Yes" : "No") +
      " | Submitted By: " + submittedBy);

  } catch (err) {
    logException("ERROR", jobNumber, FUNCTION_NAME,
      "onClientReturnSubmit crashed: " + err.message);
  }
}


// ─────────────────────────────────────────────────────────────
// JOB RE-ENTRY
// When a client return is submitted, re-opens the job in MASTER
// and ACTIVE_JOBS so it flows back through the normal workflow.
// Minor severity → Rework - Minor
// Major severity → Rework - Major
// Only re-opens if job is currently in a terminal status
// (Completed - Billable or Billed). Skips gracefully otherwise.
// ─────────────────────────────────────────────────────────────

function reopenJobFromClientReturn_(jobNumber, severity, returnId) {
  var FUNCTION_NAME = "reopenJobFromClientReturn_";
  try {
    var MJ          = CONFIG.masterCols;
    var masterSheet = getSheet(CONFIG.sheets.masterJob);
    var masterData  = masterSheet.getDataRange().getValues();

    var jobRow     = -1;
    var clientCode = "";
    var clientName = "";
    var designerName = "";
    var productType  = "";

    for (var i = 1; i < masterData.length; i++) {
      var rowJob    = String(masterData[i][MJ.jobNumber - 1] || "").trim();
      var rowStatus = String(masterData[i][MJ.status   - 1] || "").trim();
      var isTerminal = (rowStatus === CONFIG.status.completed || rowStatus === "Billed");

      if (rowJob.toUpperCase() === jobNumber.toUpperCase() && isTerminal) {
        jobRow       = i + 1; // 1-based for getRange
        clientCode   = String(masterData[i][MJ.clientCode   - 1] || "").trim();
        clientName   = String(masterData[i][MJ.clientName   - 1] || "").trim();
        designerName = String(masterData[i][MJ.designerName - 1] || "").trim();
        productType  = String(masterData[i][MJ.productType  - 1] || "").trim();
        break;
      }
    }

    if (jobRow === -1) {
      logException("WARNING", jobNumber, FUNCTION_NAME,
        "Job not found in MASTER or not in terminal status — skipping re-open. ReturnId=" + returnId);
      return false;
    }

    var newStatus = (severity === "Major")
      ? CONFIG.status.reworkMajor
      : CONFIG.status.reworkMinor;

    var currentReworkCount = parseInt(
      masterSheet.getRange(jobRow, MJ.reworkCount).getValue()) || 0;

    var existingNotes = String(
      masterSheet.getRange(jobRow, MJ.notes).getValue() || "").trim();
    var returnNote = "Client Return " + returnId + " (" + severity + ") — " +
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
    var updatedNotes = existingNotes
      ? existingNotes + " | " + returnNote
      : returnNote;

    // ── Update MASTER ─────────────────────────────────────────
    masterSheet.getRange(jobRow, MJ.status       ).setValue(newStatus);
    masterSheet.getRange(jobRow, MJ.reworkFlag   ).setValue("Yes");
    masterSheet.getRange(jobRow, MJ.reworkCount  ).setValue(currentReworkCount + 1);
    masterSheet.getRange(jobRow, MJ.notes        ).setValue(updatedNotes);
    masterSheet.getRange(jobRow, MJ.lastUpdated  ).setValue(new Date());
    masterSheet.getRange(jobRow, MJ.lastUpdatedBy).setValue("Client Return — " + returnId);
    SpreadsheetApp.flush();

    // ── Re-add to ACTIVE_JOBS ─────────────────────────────────
    var activeSheet = getSheet(CONFIG.sheets.activeJobs);
    activeSheet.appendRow([
      jobNumber,
      clientCode,
      clientName,
      designerName,
      productType,
      newStatus,
      new Date(),  // re-opened date
      "",          // expected completion — TL to set
      new Date(),
      "Client Return — " + returnId
    ]);

    logException("INFO", jobNumber, FUNCTION_NAME,
      "Job re-opened. Status → " + newStatus +
      " | Rework count: " + (currentReworkCount + 1) +
      " | ReturnId: " + returnId +
      " | Designer: " + designerName);

    return true;

  } catch (err) {
    logException("ERROR", jobNumber, FUNCTION_NAME,
      "reopenJobFromClientReturn_ crashed: " + err.message);
    return false;
  }
}


// ─────────────────────────────────────────────────────────────
// NOTIFICATION EMAIL
// Recipients: Sarty Gosh (PM) + TL assigned to client + Stacey
// Sarty and TL emails looked up dynamically from DESIGNER_MASTER
// Stacey = NOTIFICATION_EMAIL constant
// ─────────────────────────────────────────────────────────────

function sendClientReturnNotification(returnId, jobNumber, clientCode,
    clientName, designerName, dateIssueNoticed, issueDescription,
    severity, attachmentLink, submittedBy, submittedAt, reopened) {

  var FUNCTION_NAME = "sendClientReturnNotification";
  try {
    // ── Build recipient list ───────────────────────────────────
    var recipients = [NOTIFICATION_EMAIL]; // Stacey always first
    var sartyFound = false;

    var designerData = getSheetData(CONFIG.sheets.designerMaster);
    // DESIGNER_MASTER 0-based indices from getValues():
    // name=1, email=2, role=4, active=8, assignedClients=10
    for (var i = 1; i < designerData.length; i++) {
      var dName    = String(designerData[i][1]  || "").trim();
      var dEmail   = String(designerData[i][2]  || "").trim();
      var dRole    = String(designerData[i][4]  || "").trim();
      var dActive  = String(designerData[i][8]  || "").trim();
      var dClients = String(designerData[i][10] || "").trim();

      if (dActive !== "Yes" || !dEmail) continue;

      // Sarty Gosh — PM always notified
      if (dName === "Sarty Gosh") {
        sartyFound = true;
        if (recipients.indexOf(dEmail) === -1) {
          recipients.push(dEmail);
        }
        continue;
      }

      // Team Leader assigned to this client
      if (dRole === "Team Leader") {
        var assignedList = dClients.split(",").map(function(c) {
          return c.trim().toUpperCase();
        });
        if (clientCode &&
            assignedList.indexOf(clientCode.toUpperCase()) !== -1) {
          if (recipients.indexOf(dEmail) === -1) {
            recipients.push(dEmail);
          }
        }
      }
    }

    if (!sartyFound) {
      logException("WARNING", jobNumber, FUNCTION_NAME,
        "Sarty Gosh not found in DESIGNER_MASTER or email blank. " +
        "Check Active=Yes and email is populated in col C.");
    }

    // ── Format dates ───────────────────────────────────────────
    var issueDateStr = dateIssueNoticed
      ? Utilities.formatDate(new Date(dateIssueNoticed),
          Session.getScriptTimeZone(), "MMM dd, yyyy")
      : "Not provided";

    var submittedAtStr = Utilities.formatDate(
      submittedAt, Session.getScriptTimeZone(), "MMM dd, yyyy h:mm a");

    // ── Severity colour badge ──────────────────────────────────
    var severityColor  = severity === "Major" ? "#d93025" : "#f9a825";
    var severityBadge  =
      "<span style='background:" + severityColor + ";color:#fff;" +
      "padding:3px 10px;border-radius:3px;font-weight:bold;'>" +
      (severity || "Not specified") + "</span>";

    // ── Build email body ───────────────────────────────────────
    var subject = "⚠️ BLC | Client Return: " + jobNumber +
      " [" + (severity || "Unknown") + "] — " + clientName;

    var body =
      "<div style='font-family:Arial,sans-serif;font-size:14px;color:#333;'>" +
      "<h2 style='color:#d93025;margin-bottom:4px;'>⚠️ Client Return Submitted</h2>" +
      "<p style='color:#888;margin-top:0;font-size:12px;'>" +
        "BLC Job Management System — " + submittedAtStr + "</p>" +
      "<table style='border-collapse:collapse;width:100%;max-width:580px;" +
        "border:1px solid #e0e0e0;border-radius:4px;'>" +
      _retRow("Return ID",          returnId,                          false) +
      _retRow("Job Number",         jobNumber,                         true)  +
      _retRow("Client",             clientName,                        false) +
      _retRow("Designer",           designerName || "Unknown",         true)  +
      _retRow("Severity",           severityBadge,                     false) +
      _retRow("Job Re-Opened",      reopened
        ? "✅ Yes — status set to Rework " + (severity === "Major" ? "(Major)" : "(Minor)")
        : "⚠️ No — job not found in terminal status or already active",    true)  +
      _retRow("Date Issue Noticed", issueDateStr,                      false) +
      _retRow("Submitted By",       submittedBy,                       true)  +
      _retRow("Issue Description",  issueDescription,                  false) +
      (attachmentLink
        ? _retRow("Attachment",
            "<a href='" + attachmentLink + "'>View Attachment</a>", false)
        : "") +
      "</table>" +
      "<p style='margin-top:16px;font-size:13px;color:#555;'>" +
        "Please review this return and update the CLIENT_RETURN_LOG " +
        "status once actioned.</p>" +
      "<p style='font-size:11px;color:#aaa;margin-top:8px;'>" +
        "This is an automated notification. Do not reply to this email.</p>" +
      "</div>";

    MailApp.sendEmail({
      to:       recipients.join(","),
      subject:  subject,
      htmlBody: body
    });

    logException("INFO", jobNumber, FUNCTION_NAME,
      "Notification sent to: " + recipients.join(", "));

  } catch (err) {
    logException("WARNING", jobNumber, FUNCTION_NAME,
      "sendClientReturnNotification failed: " + err.message);
  }
}


// ─────────────────────────────────────────────────────────────
// SETUP — Creates one return form per active client
// Saves form ID + URL back to CLIENT_MASTER cols P and Q
// Sends Stacey all new links for review before client delivery
// Safe to re-run — skips clients that already have a form ID
// ─────────────────────────────────────────────────────────────

function setupAllClientReturnForms() {
  var FUNCTION_NAME = "setupAllClientReturnForms";
  try {
    var ss      = SpreadsheetApp.getActiveSpreadsheet();
    var cmSheet = getSheet(CONFIG.sheets.clientMaster);
    var cmData  = cmSheet.getDataRange().getValues();

    // CLIENT_MASTER 0-based indices:
    // clientCode=0, clientName=1, active=9,
    // returnFormId=15, returnFormUrl=16, formCreatedDate=18
    var created = [];
    var skipped = [];

    for (var i = 1; i < cmData.length; i++) {
      var row        = cmData[i];
      var clientCode = String(row[0]  || "").trim();
      var clientName = String(row[1]  || "").trim();
      var isActive   = String(row[9]  || "").trim();
      var existingId = String(row[15] || "").trim();

      if (!clientCode || isActive !== "Yes") continue;

      // Skip if form already exists
      if (existingId && existingId !== "") {
        skipped.push(clientCode);
        continue;
      }

      // Create new form for this client
      var result = createClientReturnForm_(clientCode, clientName, ss);

      // Save form ID, URL, created date back to CLIENT_MASTER
      // Cols P=16, Q=17, S=19 (1-based) → sheet row i+1
      cmSheet.getRange(i + 1, 16).setValue(result.formId);
      cmSheet.getRange(i + 1, 17).setValue(result.formUrl);
      cmSheet.getRange(i + 1, 19).setValue(new Date());

      // Create per-form trigger
      createClientReturnTrigger_(result.formId);

      created.push({
        code: clientCode,
        name: clientName,
        url:  result.formUrl
      });

      logException("INFO", "SYSTEM", FUNCTION_NAME,
        "Return form created for " + clientCode +
        " | Form ID: " + result.formId);
    }

    // Notify Stacey with all new links for review
    if (created.length > 0) {
      sendNewFormLinksToStacey_(created, "setupAllClientReturnForms");
    }

    SpreadsheetApp.getUi().alert(
      "✅ Client Return Forms Setup Complete.\n\n" +
      "Forms created: " + created.length + "\n" +
      "Skipped (already exist): " + skipped.length + "\n\n" +
      (created.length > 0
        ? "Stacey has been notified at " + NOTIFICATION_EMAIL + "\n" +
          "with all new form links.\n\n" +
          "⚠️ Review each link before sending to clients."
        : "No new forms were needed.")
    );

  } catch (err) {
    logException("ERROR", "SYSTEM", FUNCTION_NAME,
      "setupAllClientReturnForms crashed: " + err.message);
    SpreadsheetApp.getUi().alert(
      "❌ Error setting up client return forms:\n" + err.message +
      "\n\nCheck EXCEPTIONS_LOG for details."
    );
  }
}


// ─────────────────────────────────────────────────────────────
// NEW CLIENT ONBOARDING HOOK
// Call this from onboardNewClient() after adding client to
// CLIENT_MASTER. Creates form automatically and notifies Stacey.
// ─────────────────────────────────────────────────────────────

function setupNewClientReturnForm(clientCode, clientName) {
  var FUNCTION_NAME = "setupNewClientReturnForm";
  try {
    var ss      = SpreadsheetApp.getActiveSpreadsheet();
    var cmSheet = getSheet(CONFIG.sheets.clientMaster);
    var cmData  = cmSheet.getDataRange().getValues();

    var result = createClientReturnForm_(clientCode, clientName, ss);

    // Find client row in CLIENT_MASTER and save form details
    for (var i = 1; i < cmData.length; i++) {
      var code = String(cmData[i][0] || "").trim();
      if (code === clientCode) {
        cmSheet.getRange(i + 1, 16).setValue(result.formId);
        cmSheet.getRange(i + 1, 17).setValue(result.formUrl);
        cmSheet.getRange(i + 1, 19).setValue(new Date());
        break;
      }
    }

    // Create trigger for this form
    createClientReturnTrigger_(result.formId);

    // Notify Stacey — she reviews and forwards from official email
    sendNewFormLinksToStacey_([{
      code: clientCode,
      name: clientName,
      url:  result.formUrl
    }], "New Client Onboarding — " + clientCode);

    logException("INFO", "SYSTEM", FUNCTION_NAME,
      "Return form created for new client " + clientCode +
      ". Stacey notified for review before sending to client.");

    return result;

  } catch (err) {
    logException("ERROR", "SYSTEM", FUNCTION_NAME,
      "setupNewClientReturnForm failed for " + clientCode +
      ": " + err.message);
    return null;
  }
}


// ─────────────────────────────────────────────────────────────
// SYNC DROPDOWNS
// Updates Job Number dropdown on each client's form with
// only that client's Completed - Billable jobs.
// Run daily via trigger or manually from menu.
// ─────────────────────────────────────────────────────────────

function syncClientReturnFormDropdowns() {
  var FUNCTION_NAME = "syncClientReturnFormDropdowns";
  try {
    var cmData      = getSheetData(CONFIG.sheets.clientMaster);
    var masterData  = getSheetData(CONFIG.sheets.masterJobDatabase);
    var MJ          = CONFIG.masterCols;
    var updateCount = 0;
    var skipCount   = 0;

    // Only include jobs completed in the last 12 months
    var cutoffDate  = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);

    for (var i = 1; i < cmData.length; i++) {
      var clientCode = String(cmData[i][0]  || "").trim();
      var isActive   = String(cmData[i][9]  || "").trim();
      var formId     = String(cmData[i][15] || "").trim();

      if (!clientCode || isActive !== "Yes" || !formId) {
        skipCount++;
        continue;
      }

      // Get completed jobs for this client only — last 12 months
      var jobNumbers = [];
      for (var j = 1; j < masterData.length; j++) {
        var mClient = String(masterData[j][MJ.clientCode        - 1] || "").trim();
        var mJob    = String(masterData[j][MJ.jobNumber         - 1] || "").trim();
        var mStatus = String(masterData[j][MJ.status            - 1] || "").trim();
        var mIsTest = String(masterData[j][MJ.isTest            - 1] || "").trim();
        var mDate   = masterData[j][MJ.actualCompletion         - 1];

        if (mClient !== clientCode)                                      continue;
        if (!mJob)                                                       continue;
        if (mIsTest === "Yes")                                           continue;
        if (mStatus !== CONFIG.status.completed && mStatus !== "Billed") continue;

        // Date filter — skip if older than 12 months
        if (mDate) {
          var completedDate = new Date(mDate);
          if (!isNaN(completedDate) && completedDate < cutoffDate)       continue;
        }

        jobNumbers.push(mJob);
      }

      // Remove duplicates — MASTER may have multiple rows per job (revisions)
      var seen = {};
      jobNumbers = jobNumbers.filter(function(job) {
        if (seen[job]) return false;
        seen[job] = true;
        return true;
      });

      // Sort descending — most recent job numbers first
      jobNumbers.sort(function(a, b) {
        return b > a ? 1 : -1;
      });

      // Hard cap at 200 — Google Forms dropdown limit
      if (jobNumbers.length > 200) {
        jobNumbers = jobNumbers.slice(0, 200);
        logException("INFO", "SYSTEM", FUNCTION_NAME,
          clientCode + " capped at 200 job numbers for form dropdown.");
      }

      if (jobNumbers.length === 0) {
        logException("INFO", "SYSTEM", FUNCTION_NAME,
          "No recent completed jobs for " + clientCode +
          " in last 12 months — skipping.");
        skipCount++;
        continue;
      }

      // Update the form dropdown
      try {
        var form  = FormApp.openById(formId);
        var items = form.getItems();
        var found = false;
        for (var k = 0; k < items.length; k++) {
          if (items[k].getTitle() === "Job Number" &&
              items[k].getType() === FormApp.ItemType.LIST) {
            items[k].asListItem().setChoiceValues(jobNumbers);
            updateCount++;
            found = true;
            logException("INFO", "SYSTEM", FUNCTION_NAME,
              clientCode + " dropdown updated. Jobs: " + jobNumbers.length);
            break;
          }
        }
        if (!found) {
          logException("WARNING", "SYSTEM", FUNCTION_NAME,
            "Job Number item not found on form for " + clientCode);
        }
      } catch (formErr) {
        logException("WARNING", "SYSTEM", FUNCTION_NAME,
          "Could not update form for " + clientCode +
          " (ID: " + formId + "): " + formErr.message);
      }
    }

    logException("INFO", "SYSTEM", FUNCTION_NAME,
      "syncClientReturnFormDropdowns complete. " +
      "Updated: " + updateCount + " | Skipped: " + skipCount);

    SpreadsheetApp.getUi().alert(
      "✅ Client return form dropdowns synced.\n\n" +
      "Forms updated: " + updateCount + "\n" +
      "Skipped: "       + skipCount
    );

  } catch (err) {
    logException("ERROR", "SYSTEM", FUNCTION_NAME,
      "syncClientReturnFormDropdowns crashed: " + err.message);
    SpreadsheetApp.getUi().alert(
      "❌ Error syncing client return dropdowns:\n" + err.message
    );
  }
}

// ─────────────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Creates a new per-client return form with all required fields.
 * Links response sheet to the BLC workbook.
 * Returns { formId, formUrl }.
 */
function createClientReturnForm_(clientCode, clientName, ss) {
  var form = FormApp.create("BLC Client Return — " + clientCode);

  form.setDescription(
    "Use this form to report any issues with completed design jobs. " +
    "All fields marked * are required."
  );
  form.setConfirmationMessage(
    "Thank you. Your return has been submitted to the BLC team. " +
    "We will review it and be in touch shortly."
  );
  form.setCollectEmail(false); // No Google login required from client

  // Q1 — Job Number (populated by syncClientReturnFormDropdowns)
  form.addListItem()
    .setTitle("Job Number")
    .setRequired(true)
    .setChoiceValues(["Loading — please check back shortly"]);

  // Q2 — Date Issue Noticed
  form.addDateItem()
    .setTitle("Date Issue Noticed")
    .setRequired(true);

  // Q3 — Describe the Issue
  form.addParagraphTextItem()
    .setTitle("Describe the Issue")
    .setRequired(true);

  // Q4 — Severity
  form.addListItem()
    .setTitle("Severity")
    .setRequired(true)
    .setChoiceValues(["Minor", "Major"]);

  // Q5 — Attachment / Screenshot Link (optional)
  form.addTextItem()
    .setTitle("Attachment / Screenshot Link")
    .setRequired(false);

  // Q6 — Your Name
  form.addTextItem()
    .setTitle("Your Name")
    .setRequired(true);

  // Link responses to BLC workbook
  form.setDestination(
    FormApp.DestinationType.SPREADSHEET,
    ss.getId()
  );

  // Rename the auto-created response tab to something identifiable
  SpreadsheetApp.flush();
  Utilities.sleep(2000); // Give Sheets time to create the tab
  var sheets = ss.getSheets();
  for (var s = sheets.length - 1; s >= 0; s--) {
    var sName = sheets[s].getName();
    // Find the newly created responses tab — it will contain the form name
    if (sName.indexOf("BLC Client Return") !== -1 &&
        sName.indexOf("RESPONSES") === -1) {
      try {
        sheets[s].setName("CLIENT_RETURN_RESPONSES_" + clientCode);
      } catch(renameErr) {
        // Tab rename failed — not critical, log and continue
        logException("WARNING", "SYSTEM", "createClientReturnForm_",
          "Could not rename response tab for " + clientCode +
          ": " + renameErr.message);
      }
      break;
    }
  }

  return {
    formId:  form.getId(),
    formUrl: form.getPublishedUrl()
  };
}


/**
 * DEPRECATED — no longer creates per-form triggers.
 *
 * Client return forms are now handled by the shared onFormSubmitRouter()
 * via the spreadsheet-level onFormSubmit trigger. All response sheets
 * named CLIENT_RETURN_RESPONSES_* are automatically routed to
 * onClientReturnSubmit(). This saves one trigger per client and keeps
 * us well below Google's 20-trigger project limit.
 *
 * To consolidate existing per-form triggers, run setupClientReturnTriggers()
 * from the BLC Menu → Setup Client Return Triggers.
 */
function createClientReturnTrigger_(formId) {
  logException("INFO", "SYSTEM", "createClientReturnTrigger_",
    "Skipped — client return forms now handled by onFormSubmitRouter. " +
    "No per-form trigger needed for form " + formId);
}


/**
 * Consolidates client return triggers.
 * Deletes all per-form onClientReturnSubmit triggers (old approach).
 * Confirms the shared spreadsheet onFormSubmit trigger is in place.
 * Run once from BLC Menu → Setup Client Return Triggers.
 */
function setupClientReturnTriggers() {
  var FUNCTION_NAME = "setupClientReturnTriggers";
  try {
    var ss       = SpreadsheetApp.getActiveSpreadsheet();
    var triggers = ScriptApp.getUserTriggers(ss);

    var deleted  = 0;
    var routerOk = false;

    for (var t = 0; t < triggers.length; t++) {
      var fn  = triggers[t].getHandlerFunction();
      var src = triggers[t].getTriggerSource();

      // Delete old per-form client return triggers
      if (fn === "onClientReturnSubmit") {
        ScriptApp.deleteTrigger(triggers[t]);
        deleted++;
        continue;
      }

      // Confirm shared router trigger exists
      if (fn === "onFormSubmitRouter" && src === ScriptApp.TriggerSource.SPREADSHEETS) {
        routerOk = true;
      }
    }

    // Create the router trigger if it is missing
    if (!routerOk) {
      ScriptApp.newTrigger("onFormSubmitRouter")
        .forSpreadsheet(ss)
        .onFormSubmit()
        .create();
      logException("INFO", "SYSTEM", FUNCTION_NAME,
        "onFormSubmitRouter trigger was missing — created.");
    }

    logException("INFO", "SYSTEM", FUNCTION_NAME,
      "Trigger consolidation complete. " +
      "Per-form triggers deleted: " + deleted +
      " | Router trigger present: " + (routerOk ? "Yes" : "Created now"));

    SpreadsheetApp.getUi().alert(
      "✅ Client Return Triggers Consolidated\n\n" +
      "Per-form triggers deleted : " + deleted + "\n" +
      "Shared router trigger     : " + (routerOk ? "Already present" : "Created now") + "\n\n" +
      "All client return form submissions (sheets named\n" +
      "CLIENT_RETURN_RESPONSES_*) are now handled by the\n" +
      "shared onFormSubmitRouter — no per-form triggers needed.\n\n" +
      "You are safe to add new clients without hitting\n" +
      "Google's 20-trigger limit."
    );

  } catch (err) {
    logException("ERROR", "SYSTEM", FUNCTION_NAME,
      "setupClientReturnTriggers failed: " + err.message);
    SpreadsheetApp.getUi().alert(
      "❌ Error: " + err.message + "\nCheck EXCEPTIONS_LOG for details."
    );
  }
}


/**
 * Emails Stacey (NOTIFICATION_EMAIL) with all newly created
 * form links. She reviews and forwards from official BLC email.
 * createdForms = [{ code, name, url }]
 */
function sendNewFormLinksToStacey_(createdForms, source) {
  var FUNCTION_NAME = "sendNewFormLinksToStacey_";
  try {
    var rows = "";
    for (var i = 0; i < createdForms.length; i++) {
      var f  = createdForms[i];
      var bg = (i % 2 === 0) ? "" : "background:#f8f9fa;";
      rows +=
        "<tr style='" + bg + "'>" +
        "<td style='padding:8px 12px;font-weight:bold;" +
          "border-bottom:1px solid #e0e0e0;'>" + f.code + "</td>" +
        "<td style='padding:8px 12px;" +
          "border-bottom:1px solid #e0e0e0;'>" + f.name + "</td>" +
        "<td style='padding:8px 12px;" +
          "border-bottom:1px solid #e0e0e0;'>" +
          "<a href='" + f.url + "'>Open Form →</a></td>" +
        "</tr>";
    }

    var body =
      "<div style='font-family:Arial,sans-serif;font-size:14px;color:#333;'>" +
      "<h2 style='color:#1a73e8;'>📋 New Client Return Form(s) Ready</h2>" +
      "<p>The following client return forms have been created and are " +
        "ready for your review.</p>" +
      "<p><strong style='color:#d93025;'>⚠️ Please test each form link " +
        "before forwarding to the client.<br>Send from the official BLC " +
        "email address — not from this Gmail account.</strong></p>" +
      "<p style='color:#888;font-size:12px;'>Source: " + source + "</p>" +
      "<table style='border-collapse:collapse;width:100%;max-width:620px;" +
        "border:1px solid #e0e0e0;'>" +
      "<tr style='background:#1a73e8;color:#fff;'>" +
      "<th style='padding:8px 12px;text-align:left;'>Client Code</th>" +
      "<th style='padding:8px 12px;text-align:left;'>Client Name</th>" +
      "<th style='padding:8px 12px;text-align:left;'>Form Link</th>" +
      "</tr>" +
      rows +
      "</table>" +
      "<p style='margin-top:16px;font-size:12px;color:#aaa;'>" +
        "BLC Job Management System — Automated notification.</p>" +
      "</div>";

    MailApp.sendEmail({
      to:       NOTIFICATION_EMAIL,
      subject:  "📋 BLC | New Client Return Form(s) Ready for Review",
      htmlBody: body
    });

    logException("INFO", "SYSTEM", FUNCTION_NAME,
      "New form links sent to Stacey. Forms: " + createdForms.length);

  } catch (err) {
    logException("WARNING", "SYSTEM", FUNCTION_NAME,
      "sendNewFormLinksToStacey_ failed: " + err.message);
  }
}


// Private helper — builds a styled table row for notification emails
function _retRow(label, value, shaded) {
  var bg = shaded ? "background:#f8f9fa;" : "";
  return "<tr style='" + bg + "'>" +
    "<td style='padding:8px 12px;font-weight:bold;color:#555;" +
      "width:35%;border-bottom:1px solid #e0e0e0;'>" + label + "</td>" +
    "<td style='padding:8px 12px;border-bottom:1px solid #e0e0e0;'>" +
      (value || "—") + "</td>" +
    "</tr>";
}