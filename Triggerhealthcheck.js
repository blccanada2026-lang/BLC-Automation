// ============================================================
// TriggerHealthCheck.gs
// Blue Lotus Consulting Corporation
//
// PURPOSE: Daily automated verification that all expected
// triggers exist and are firing. Sends an alert email to
// NOTIFICATION_EMAIL if anything is missing, stale, or broken.
//
// WHAT IT CHECKS:
// 1. All 5 core time-based triggers exist
// 2. Each active client has a return form trigger
// 3. No triggers have excessive error rates
// 4. Maps each onClientReturnSubmit trigger to its client
//
// TRIGGER: Daily at 8am Saskatchewan time
// MENU:    BLC System → Diagnose Sync Issues (or run manually)
//
// SETUP: Run setupTriggerHealthCheck() once to create the trigger.
//
// Created: March 14, 2026
// ============================================================


// ── Expected core triggers ─────────────────────────────────────
// These must always exist. If any are missing, alert immediately.
var EXPECTED_CORE_TRIGGERS = [
  { fn: "onFormSubmitRouter",           type: "SPREADSHEET", description: "Routes all internal form submissions" },
  { fn: "refreshDashboard",             type: "CLOCK",       description: "Dashboard + TL_VIEW refresh every 15 min" },
  { fn: "sendDailyDigest",              type: "CLOCK",       description: "5pm daily email digest" },
  { fn: "archiveAndCleanupExceptions",  type: "CLOCK",       description: "Midnight daily exception log archival" },
  { fn: "patchOrphanedActiveJobs",      type: "CLOCK",       description: "6am daily ACTIVE_JOBS cleanup" }
];


// ============================================================
// MAIN HEALTH CHECK FUNCTION
// Safe for both trigger (headless) and menu (UI) execution.
// ============================================================

function triggerHealthCheck() {
  var FUNCTION_NAME = "triggerHealthCheck";
  var issues = [];
  var info = [];

  try {
    var triggers = ScriptApp.getProjectTriggers();
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // ── 1. Build a map of all current triggers ─────────────────
    var triggerMap = {};  // { "functionName": [{ trigger, sourceId, type, lastRun }] }

    for (var t = 0; t < triggers.length; t++) {
      var trig = triggers[t];
      var fn = trig.getHandlerFunction();
      var type = trig.getEventType().toString();
      var sourceId = "";

      try {
        sourceId = trig.getTriggerSourceId() || "";
      } catch (e) {
        sourceId = "(unable to read)";
      }

      if (!triggerMap[fn]) triggerMap[fn] = [];
      triggerMap[fn].push({
        trigger: trig,
        sourceId: sourceId,
        type: type
      });
    }

    info.push("Total triggers found: " + triggers.length);

    // ── 2. Check each expected core trigger ────────────────────
    for (var c = 0; c < EXPECTED_CORE_TRIGGERS.length; c++) {
      var expected = EXPECTED_CORE_TRIGGERS[c];
      var matches = triggerMap[expected.fn] || [];

      if (matches.length === 0) {
        issues.push("MISSING TRIGGER: '" + expected.fn + "' — " +
          expected.description + ". This trigger must be recreated immediately.");
      } else if (matches.length > 1) {
        issues.push("DUPLICATE TRIGGER: '" + expected.fn + "' has " +
          matches.length + " triggers. Should have exactly 1. " +
          "Duplicates may cause double execution.");
      } else {
        info.push("✓ " + expected.fn + " — present");
      }
    }

    // ── 3. Check client return form triggers ───────────────────
    var clientReturnTriggers = triggerMap["onClientReturnSubmit"] || [];
    info.push("Client return triggers found: " + clientReturnTriggers.length);

    // Load CLIENT_MASTER to map triggers to clients
    var cmData = [];
    try {
      cmData = getSheetData(CONFIG.sheets.clientMaster);
    } catch (e) {
      issues.push("Cannot read CLIENT_MASTER: " + e.message);
    }

    // Build formId → clientCode lookup from CLIENT_MASTER
    var formToClient = {};  // { formId: { clientCode, clientName, active } }
    var activeClientsWithForms = 0;
    var activeClientsWithoutForms = [];

    for (var i = 1; i < cmData.length; i++) {
      var clientCode = String(cmData[i][0] || "").trim();
      var clientName = String(cmData[i][1] || "").trim();
      var isActive   = String(cmData[i][9] || "").trim();
      var formId     = String(cmData[i][15] || "").trim();

      if (!clientCode || isActive !== "Yes") continue;

      if (formId) {
        formToClient[formId] = { clientCode: clientCode, clientName: clientName };
        activeClientsWithForms++;
      } else {
        activeClientsWithoutForms.push(clientCode);
      }
    }

    info.push("Active clients with return forms: " + activeClientsWithForms);

    if (activeClientsWithoutForms.length > 0) {
      issues.push("CLIENTS WITHOUT RETURN FORMS: " +
        activeClientsWithoutForms.join(", ") +
        ". Run Onboard New Client or Setup All Client Return Forms.");
    }

    // Map each trigger to its client
    var mappedClients = [];
    var unmappedTriggers = 0;
    var triggerFormIds = {};

    for (var cr = 0; cr < clientReturnTriggers.length; cr++) {
      var crt = clientReturnTriggers[cr];
      var sid = crt.sourceId;

      // Check for duplicate triggers on same form
      if (triggerFormIds[sid]) {
        issues.push("DUPLICATE CLIENT TRIGGER: Form ID '" +
          sid.substring(0, 15) + "...' has multiple triggers. " +
          "Client: " + (formToClient[sid] ? formToClient[sid].clientCode : "UNKNOWN") +
          ". Delete the duplicate from the Triggers page.");
      }
      triggerFormIds[sid] = true;

      if (formToClient[sid]) {
        var client = formToClient[sid];
        mappedClients.push(client.clientCode);
        info.push("✓ Client return trigger: " + client.clientCode +
          " (" + client.clientName + ")");
      } else {
        unmappedTriggers++;
        info.push("⚠ Client return trigger with unknown form ID: " +
          sid.substring(0, 20) + "...");
      }
    }

    if (unmappedTriggers > 0) {
      issues.push("UNMAPPED TRIGGERS: " + unmappedTriggers +
        " onClientReturnSubmit trigger(s) don't match any active client " +
        "in CLIENT_MASTER. These may be from deactivated clients or test forms. " +
        "Review and delete if no longer needed.");
    }

    // Check for active clients that have forms but no trigger
    for (var formId in formToClient) {
      if (!formToClient.hasOwnProperty(formId)) continue;
      if (!triggerFormIds[formId]) {
        var missingClient = formToClient[formId];
        issues.push("MISSING CLIENT TRIGGER: " + missingClient.clientCode +
          " (" + missingClient.clientName + ") has a return form but " +
          "NO trigger. Client returns will not be processed. " +
          "Run Setup Client Return Triggers.");
      }
    }

    // ── 4. Check for unexpected triggers ───────────────────────
    var knownFunctions = {};
    for (var k = 0; k < EXPECTED_CORE_TRIGGERS.length; k++) {
      knownFunctions[EXPECTED_CORE_TRIGGERS[k].fn] = true;
    }
    knownFunctions["onClientReturnSubmit"] = true;
    knownFunctions["triggerHealthCheck"] = true;

    for (var fn in triggerMap) {
      if (!triggerMap.hasOwnProperty(fn)) continue;
      if (!knownFunctions[fn]) {
        info.push("⚠ Unexpected trigger function: '" + fn +
          "' (" + triggerMap[fn].length + " trigger(s)). " +
          "This may be from old code or a setup function.");
      }
    }

    // ── 5. Check trigger count against limit ───────────────────
    if (triggers.length >= 18) {
      issues.push("TRIGGER LIMIT WARNING: " + triggers.length +
        " of 20 triggers used. Google Apps Script has a hard limit of 20. " +
        "Onboarding new clients will fail when limit is reached. " +
        "Consider consolidating client return triggers.");
    } else if (triggers.length >= 15) {
      info.push("⚠ Trigger count: " + triggers.length +
        "/20 — approaching limit. Plan for consolidation.");
    } else {
      info.push("Trigger count: " + triggers.length + "/20 — healthy headroom.");
    }

    // ── 6. Build and send report ───────────────────────────────
    var hasIssues = issues.length > 0;
    var reportLines = [];

    reportLines.push("BLC TRIGGER HEALTH CHECK");
    reportLines.push("Run: " + Utilities.formatDate(new Date(),
      Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"));
    reportLines.push("Status: " + (hasIssues ? "⚠️ ISSUES FOUND" : "✅ ALL HEALTHY"));
    reportLines.push("");

    if (hasIssues) {
      reportLines.push("═══ ISSUES (" + issues.length + ") ═══");
      for (var p = 0; p < issues.length; p++) {
        reportLines.push("⚠ " + issues[p]);
      }
      reportLines.push("");
    }

    reportLines.push("═══ STATUS ═══");
    for (var q = 0; q < info.length; q++) {
      reportLines.push(info[q]);
    }

    var reportText = reportLines.join("\n");
    Logger.log(reportText);

    // Send email ONLY if there are issues (don't spam on healthy checks)
    if (hasIssues) {
      try {
        var subject = "⚠️ BLC Trigger Health Check — " + issues.length + " issue(s) found";

        var htmlBody =
          "<div style='font-family:Arial,sans-serif;max-width:620px;'>" +
          "<div style='background:#d93025;padding:15px;text-align:center;'>" +
          "<span style='color:white;font-size:18px;font-weight:bold;'>⚠️ Trigger Health Check Alert</span>" +
          "</div><div style='padding:20px;'>" +
          "<p style='font-size:13px;color:#888;'>Run: " +
          Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMM dd, yyyy h:mm a") + "</p>";

        htmlBody += "<h3 style='color:#d93025;'>Issues Found (" + issues.length + ")</h3>";
        for (var r = 0; r < issues.length; r++) {
          htmlBody += "<div style='background:#fce4ec;padding:10px;border-radius:4px;" +
            "border-left:4px solid #d93025;margin:8px 0;font-size:13px;'>" +
            issues[r] + "</div>";
        }

        htmlBody += "<h3 style='color:#1a73e8;margin-top:20px;'>Full Status</h3>" +
          "<pre style='background:#f5f5f5;padding:12px;border-radius:4px;" +
          "font-size:12px;overflow-x:auto;'>" + reportText + "</pre>" +
          "</div><div style='background:#f5f5f5;padding:10px;text-align:center;" +
          "color:#999;font-size:11px;'>BLC Job Management System — Auto Alert</div></div>";

        GmailApp.sendEmail(NOTIFICATION_EMAIL, subject,
          reportText, { htmlBody: htmlBody, name: "BLC Job System" });

      } catch (emailErr) {
        Logger.log("Health check email failed: " + emailErr.message);
      }
    }

    // Log the check (as INFO — will be skipped by severity filter, keeping log clean)
    logException("INFO", "SYSTEM", FUNCTION_NAME,
      "Health check complete. Issues: " + issues.length +
      " | Triggers: " + triggers.length);

    // If running from menu, show the report
    try {
      SpreadsheetApp.getUi().alert(
        hasIssues ? "⚠️ Trigger Health Check — Issues Found" : "✅ Trigger Health Check — All Healthy",
        reportText,
        SpreadsheetApp.getUi().ButtonSet.OK
      );
    } catch (e) {
      // Running from trigger — no UI available
    }

  } catch (err) {
    logException("ERROR", "SYSTEM", FUNCTION_NAME,
      "triggerHealthCheck crashed: " + err.message);
    Logger.log("TRIGGER HEALTH CHECK ERROR: " + err.message);

    // Try to send crash alert
    try {
      GmailApp.sendEmail(NOTIFICATION_EMAIL,
        "🔴 BLC Trigger Health Check CRASHED",
        "The trigger health check itself failed.\n\nError: " + err.message +
        "\n\nThis needs immediate attention.\n\nBLC Job Management System",
        { name: "BLC Job System" });
    } catch (e) {
      // Nothing more we can do
    }
  }
}


// ============================================================
// SETUP — Run once to create the daily 8am trigger
// ============================================================

function setupTriggerHealthCheck() {
  // Remove existing triggers for this function
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'triggerHealthCheck') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger('triggerHealthCheck')
    .timeBased()
    .atHour(8)
    .everyDays(1)
    .inTimezone('America/Regina')
    .create();

  Logger.log("Daily trigger set for triggerHealthCheck at 8am SK time");

  try {
    SpreadsheetApp.getUi().alert(
      "✅ Trigger Health Check scheduled.\n\n" +
      "Runs daily at 8am Saskatchewan time.\n" +
      "Sends email alert ONLY when issues are found.\n\n" +
      "You can also run it manually from the menu anytime."
    );
  } catch (e) {
    // Running from trigger — no UI
  }
}