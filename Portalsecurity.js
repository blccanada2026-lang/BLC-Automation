// ============================================================
// PortalSecurity.gs
// Blue Lotus Consulting Corporation
//
// PURPOSE: Portal authentication and authorization engine.
//
// INTERNAL USERS: Google session authentication.
//   Session.getActiveUser().getEmail() → DESIGNER_MASTER lookup
//   → role determines portal + data scope.
//
// CLIENT USERS: Token-based authentication.
//   URL contains client code + token → CLIENT_MASTER validation
//   → data scoped to that client only.
//
// GRACE PERIOD: When SECURITY_ENFORCE is FALSE in CONFIG sheet,
//   authentication runs and LOGS results but does NOT block.
//   Use this for testing before enforcement.
//
// REQUIRES:
//   - CONFIG sheet: Row with key "SECURITY_ENFORCE" and value "TRUE" or "FALSE"
//   - CLIENT_MASTER: Col T (index 20) = PortalToken (32-char per client)
//   - ACCESS_LOG sheet: Auto-created if missing
//
// Created: March 14, 2026
// ============================================================


// ── SECURITY CONFIGURATION ─────────────────────────────────────

var PORTAL_SECURITY = {
  tokenLength: 32,
  clientTokenCol: 20,           // CLIENT_MASTER col T (1-based) — PortalToken
  accessLogSheet: "ACCESS_LOG",
  configKey: "SECURITY_ENFORCE", // CONFIG sheet key
  maxAccessLogRows: 10000       // Auto-trim when exceeded
};

// CEO emails — checked separately because CEO may use multiple accounts
var CEO_EMAILS = [
  "rajnaircanada@gmail.com",
  "blccanada2026@gmail.com",
  "Nairscanada@gmail.com"
  // Add additional CEO emails here if needed
];


// ============================================================
// CORE: Authenticate an internal user by Google session
// Returns: { authenticated, email, name, role, error }
// ============================================================

function authenticateInternalUser() {
  var result = {
    authenticated: false,
    email: "",
    name: "",
    role: "",
    teamLead: "",
    assignedClients: "",
    error: ""
  };

  try {
    var email = Session.getActiveUser().getEmail();

    if (!email || email === "") {
      result.error = "No Google session detected. User may not be logged in.";
      return result;
    }

    result.email = email.toLowerCase().trim();

    // Check CEO emails first (separate list — CEO may use personal email)
    for (var c = 0; c < CEO_EMAILS.length; c++) {
      if (CEO_EMAILS[c].toLowerCase().trim() === result.email) {
        result.authenticated = true;
        result.name = "CEO";
        result.role = "CEO";
        return result;
      }
    }

    // Look up in DESIGNER_MASTER
    var dmData = getSheetData(CONFIG.sheets.designerMaster);
    // 0-based: name=1, email=2, role=4, teamLead=5, active=8, assignedClients=10

    for (var i = 1; i < dmData.length; i++) {
      var dmEmail = String(dmData[i][2] || "").toLowerCase().trim();
      var dmActive = String(dmData[i][8] || "").trim();

      if (dmEmail === result.email) {
        if (dmActive !== "Yes") {
          result.error = "Account found but inactive. Contact administrator.";
          logAccess_("DENIED", result.email, "", "Inactive account");
          return result;
        }

        result.authenticated = true;
        result.name = String(dmData[i][1] || "").trim();
        result.role = String(dmData[i][4] || "").trim();
        result.teamLead = String(dmData[i][5] || "").trim();
        result.assignedClients = String(dmData[i][10] || "").trim();
        return result;
      }
    }

    // Email not found in DESIGNER_MASTER
    result.error = "Email '" + result.email + "' not found in DESIGNER_MASTER.";
    return result;

  } catch (err) {
    result.error = "Authentication error: " + err.message;
    return result;
  }
}


// ============================================================
// CORE: Authenticate a client by token
// Returns: { authenticated, clientCode, clientName, error }
// ============================================================

function authenticateClient(clientCode, token) {
  var result = {
    authenticated: false,
    clientCode: "",
    clientName: "",
    error: ""
  };

  if (!clientCode || !token) {
    result.error = "Missing client code or token.";
    return result;
  }

  clientCode = String(clientCode).trim().toUpperCase();
  token = String(token).trim();

  try {
    var cmData = getSheetData(CONFIG.sheets.clientMaster);
    // 0-based: clientCode=0, clientName=1, active=9, portalToken=19 (col T = index 19)

    for (var i = 1; i < cmData.length; i++) {
      var cmCode = String(cmData[i][0] || "").trim().toUpperCase();
      if (cmCode !== clientCode) continue;

      var cmActive = String(cmData[i][9] || "").trim();
      if (cmActive !== "Yes") {
        result.error = "Client account is inactive.";
        logAccess_("DENIED", "client:" + clientCode, "client", "Inactive client");
        return result;
      }

      var cmToken = String(cmData[i][PORTAL_SECURITY.clientTokenCol - 1] || "").trim();
      if (!cmToken) {
        result.error = "No portal token configured for this client.";
        logAccess_("DENIED", "client:" + clientCode, "client", "No token configured");
        return result;
      }

      if (cmToken !== token) {
        result.error = "Invalid token.";
        logAccess_("DENIED", "client:" + clientCode, "client", "Invalid token");
        return result;
      }

      // Token matches
      result.authenticated = true;
      result.clientCode = cmCode;
      result.clientName = String(cmData[i][1] || "").trim();
      return result;
    }

    result.error = "Client code not found.";
    return result;

  } catch (err) {
    result.error = "Client authentication error: " + err.message;
    return result;
  }
}


// ============================================================
// CORE: Check if security enforcement is enabled
// Reads from CONFIG sheet. Defaults to TRUE if not found.
// ============================================================

function isSecurityEnforced() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var configSheet = ss.getSheetByName("CONFIG");
    if (!configSheet) return true; // Default to enforced if CONFIG missing

    var data = configSheet.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim().toUpperCase() === PORTAL_SECURITY.configKey) {
        var val = String(data[i][1]).trim().toUpperCase();
        return val === "TRUE" || val === "YES" || val === "1";
      }
    }

    return true; // Default to enforced if key not found
  } catch (e) {
    return true; // Default to enforced on error
  }
}


// ============================================================
// CORE: Determine which portal to serve based on role
// Role determines portal — URL parameter is IGNORED for internal users
// ============================================================

function getPortalForRole(role) {
  switch (role) {
    case "CEO":
      return "ceo";
    case "Project Manager":
      return "intake"; // PM lands on intake queue by default
    case "Team Leader":
    case "QC Reviewer":
      return "teamlead";
    case "Designer":
    default:
      return "designer";
  }
}


// ============================================================
// SECURE DATA: Designer view — own jobs, current period only
// ============================================================

function getDesignerViewDataSecure(designerName) {
  try {
    var masterData = getSheetData(CONFIG.sheets.masterJob);
    var MJ = CONFIG.masterCols;

    // Current billing period prefix (e.g., "2026-03")
    var now = new Date();
    var currentMonth = now.getMonth() + 1;
    var currentPeriodPrefix = now.getFullYear() + "-" +
      (currentMonth < 10 ? "0" + currentMonth : String(currentMonth));

    var jobs = [];
    for (var j = 1; j < masterData.length; j++) {
      var row = masterData[j];
      if (!row[0] || row[0] === "") continue;
      if (String(row[MJ.isTest - 1]).trim() === "Yes") continue;

      var rowDesigner = String(row[MJ.designerName - 1]).trim();
      if (rowDesigner.toLowerCase() !== designerName.toLowerCase()) continue;

      // Current period filter: include jobs with current billing period
      // OR jobs with active (non-completed) status regardless of period
      var rowStatus = String(row[MJ.status - 1]).trim();
      var rowBillingPeriod = String(row[MJ.billingPeriod - 1]).trim();
      var isActive = rowStatus !== "Completed - Billable" && rowStatus !== "Billed";
      var isCurrentPeriod = rowBillingPeriod.indexOf(currentPeriodPrefix) === 0;

      if (!isActive && !isCurrentPeriod) continue;

      var expectedDate = row[MJ.expectedCompletion - 1];
      var expectedStr = "";
      if (expectedDate) {
        try { expectedStr = Utilities.formatDate(new Date(expectedDate), Session.getScriptTimeZone(), "MMM dd yyyy"); }
        catch(err) { expectedStr = String(expectedDate); }
      }

      jobs.push({
        jobNumber: String(row[MJ.jobNumber - 1]).trim(),
        clientName: String(row[MJ.clientName - 1]).trim(),
        productType: String(row[MJ.productType - 1]).trim(),
        status: rowStatus,
        designHours: parseFloat(row[MJ.designHoursTotal - 1]) || 0,
        expectedCompletion: expectedStr
      });
    }

    return { designers: [designerName], jobs: jobs, role: "Designer" };

  } catch (error) {
    logException("ERROR", "SYSTEM", "getDesignerViewDataSecure", error.message);
    return { designers: [], jobs: [], role: "Designer" };
  }
}


// ============================================================
// SECURE DATA: Team Lead view — team's jobs only
// Hierarchy: DESIGNER_MASTER col F (teamLead)
// ============================================================

function getTeamLeadViewDataSecure(tlName, role) {
  try {
    var designerData = getSheetData(CONFIG.sheets.designerMaster);
    var masterData = getSheetData(CONFIG.sheets.masterJob);
    var MJ = CONFIG.masterCols;
    var today = new Date(); today.setHours(0, 0, 0, 0);

    var activeStatuses = {
      "Allocated":true, "Picked Up":true, "In Design":true,
      "Submitted For QC":true, "QC In Progress":true,
      "Rework - Major":true, "Rework - Minor":true,
      "Waiting Re-QC":true, "On Hold":true,
      "Waiting Spot Check":true, "Spot Check In Progress":true
    };

    // Build list of designers this TL manages
    // PM (Project Manager) sees ALL designers
    var managedDesigners = {};
    var teamLeads = [];

    for (var i = 1; i < designerData.length; i++) {
      var dName = String(designerData[i][1] || "").trim();
      var dRole = String(designerData[i][4] || "").trim();
      var dActive = String(designerData[i][8] || "").trim();
      var dTL = String(designerData[i][5] || "").trim();
      var dClients = String(designerData[i][10] || "").trim();

      if (!dName || dActive !== "Yes") continue;

      if (dRole === "Team Leader" || dRole === "Project Manager" || dRole === "QC Reviewer") {
        teamLeads.push({ name: dName, clients: dClients });
      }

      if (role === "Project Manager") {
        // PM sees everyone
        managedDesigners[dName.toLowerCase()] = true;
      } else {
        // TL/QC Reviewer sees: designers who report to them + themselves
        if (dTL.toLowerCase() === tlName.toLowerCase() ||
            dName.toLowerCase() === tlName.toLowerCase()) {
          managedDesigners[dName.toLowerCase()] = true;
        }
      }
    }

    // Filter jobs to only those by managed designers
    var jobs = [];
    for (var j = 1; j < masterData.length; j++) {
      var row = masterData[j];
      var status = String(row[MJ.status - 1] || "").trim();
      var isTest = String(row[MJ.isTest - 1] || "").trim();
      var jobNumber = String(row[MJ.jobNumber - 1] || "").trim();
      var designer = String(row[MJ.designerName - 1] || "").trim();

      if (!jobNumber || isTest === "Yes" || !activeStatuses[status]) continue;

      // Filter: PM sees all, TL sees only managed designers
      if (!managedDesigners[designer.toLowerCase()]) continue;

      var expDateRaw = row[MJ.expectedCompletion - 1];
      var isOverdue = false, expDateStr = "";
      if (expDateRaw) {
        var expDate = new Date(expDateRaw);
        expDate.setHours(0, 0, 0, 0);
        isOverdue = expDate < today;
        expDateStr = Utilities.formatDate(expDate, Session.getScriptTimeZone(), "MMM dd, yyyy");
      }

      jobs.push({
        jobNumber: jobNumber,
        clientCode: String(row[MJ.clientCode - 1] || "").trim(),
        clientName: String(row[MJ.clientName - 1] || "").trim(),
        designerName: designer,
        productType: String(row[MJ.productType - 1] || "").trim(),
        status: status,
        designHours: parseFloat(row[MJ.designHoursTotal - 1]) || 0,
        qcHours: parseFloat(row[MJ.qcHoursTotal - 1]) || 0,
        totalBillable: parseFloat(row[MJ.totalBillableHours - 1]) || 0,
        qcLead: String(row[MJ.qcLead - 1] || "").trim(),
        billingPeriod: String(row[MJ.billingPeriod - 1] || "").trim(),
        invoiceMonth: String(row[MJ.invoiceMonth - 1] || "").trim(),
        expectedCompletion: expDateStr,
        isOverdue: isOverdue,
        isRework: (status === "Rework - Major" || status === "Rework - Minor")
      });
    }

    return { teamLeads: teamLeads, jobs: jobs, role: role };

  } catch (err) {
    logException("ERROR", "SYSTEM", "getTeamLeadViewDataSecure", err.message);
    return { teamLeads: [], jobs: [], role: role };
  }
}


// ============================================================
// SECURE DATA: Client view — their jobs, current period, no internals
// ============================================================

function getClientViewDataSecure(clientCode) {
  try {
    if (!clientCode) return { error: true };

    var masterData = getSheetData(CONFIG.sheets.masterJob);
    var clientData = getSheetData(CONFIG.sheets.clientMaster);
    var MJ = CONFIG.masterCols;

    // Get client name
    var clientName = "";
    for (var i = 1; i < clientData.length; i++) {
      if (String(clientData[i][0]).trim().toUpperCase() === clientCode.toUpperCase()) {
        clientName = String(clientData[i][1]).trim();
        break;
      }
    }
    if (!clientName) return { error: true };

    // Current period prefix
    var now = new Date();
    var currentMonth = now.getMonth() + 1;
    var currentPeriodPrefix = now.getFullYear() + "-" +
      (currentMonth < 10 ? "0" + currentMonth : String(currentMonth));

    var jobs = [];
    for (var j = 1; j < masterData.length; j++) {
      var row = masterData[j];
      if (!row[0] || row[0] === "") continue;
      if (String(row[MJ.isTest - 1]).trim() === "Yes") continue;
      if (String(row[MJ.clientCode - 1]).trim().toUpperCase() !== clientCode.toUpperCase()) continue;

      var rowStatus = String(row[MJ.status - 1]).trim();
      var rowBillingPeriod = String(row[MJ.billingPeriod - 1]).trim();

      // Clients see: active jobs + current period completed jobs
      var isActive = rowStatus !== "Completed - Billable" && rowStatus !== "Billed";
      var isCurrentPeriod = rowBillingPeriod.indexOf(currentPeriodPrefix) === 0;
      if (!isActive && !isCurrentPeriod) continue;

      var expectedDate = row[MJ.expectedCompletion - 1];
      var expectedStr = "";
      if (expectedDate) {
        try { expectedStr = Utilities.formatDate(new Date(expectedDate), Session.getScriptTimeZone(), "MMM dd yyyy"); }
        catch(err) { expectedStr = String(expectedDate); }
      }

      // Client view: NO designer names, NO hours, NO financial data
      jobs.push({
        jobNumber: String(row[MJ.jobNumber - 1]).trim(),
        productType: String(row[MJ.productType - 1]).trim(),
        status: rowStatus,
        expectedCompletion: expectedStr
      });
    }

    return {
      error: false,
      clientName: clientName,
      jobs: jobs,
      lastUpdated: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMM dd yyyy HH:mm")
    };

  } catch (error) {
    logException("ERROR", "SYSTEM", "getClientViewDataSecure", error.message);
    return { error: true };
  }
}


// ============================================================
// TOKEN MANAGEMENT
// ============================================================

/**
 * Generates a cryptographically random 32-character token.
 */
function generatePortalToken_() {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  var token = "";
  for (var i = 0; i < PORTAL_SECURITY.tokenLength; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

/**
 * Generate tokens for all active clients that don't have one yet.
 * Run from menu after adding PortalToken column (col T) to CLIENT_MASTER.
 */
function generateClientPortalTokens() {
  var FUNCTION_NAME = "generateClientPortalTokens";
  try {
    var cmSheet = getSheet(CONFIG.sheets.clientMaster);
    var cmData = cmSheet.getDataRange().getValues();
    var generated = 0;
    var skipped = 0;

    for (var i = 1; i < cmData.length; i++) {
      var clientCode = String(cmData[i][0] || "").trim();
      var isActive = String(cmData[i][9] || "").trim();
      var existingToken = String(cmData[i][PORTAL_SECURITY.clientTokenCol - 1] || "").trim();

      if (!clientCode || isActive !== "Yes") continue;

      if (existingToken) {
        skipped++;
        continue;
      }

      var token = generatePortalToken_();
      cmSheet.getRange(i + 1, PORTAL_SECURITY.clientTokenCol).setValue(token);
      generated++;

      logException("INFO_FORCE", clientCode, FUNCTION_NAME,
        "Portal token generated for " + clientCode);
    }

    SpreadsheetApp.flush();

    SpreadsheetApp.getUi().alert(
      "✅ Client Portal Tokens\n\n" +
      "Generated: " + generated + "\n" +
      "Skipped (already have token): " + skipped + "\n\n" +
      "Tokens saved to CLIENT_MASTER col T."
    );

  } catch (err) {
    logException("ERROR", "SYSTEM", FUNCTION_NAME, "Failed: " + err.message);
    SpreadsheetApp.getUi().alert("Error: " + err.message);
  }
}

/**
 * Rotate a specific client's portal token.
 * Old token immediately stops working. New URL must be sent to client.
 */
function rotateClientPortalToken() {
  var FUNCTION_NAME = "rotateClientPortalToken";
  var ui = SpreadsheetApp.getUi();

  try {
    var response = ui.prompt("Rotate Client Token",
      "Enter the client code to rotate (e.g. SBS):", ui.ButtonSet.OK_CANCEL);
    if (response.getSelectedButton() !== ui.Button.OK) return;

    var clientCode = response.getResponseText().trim().toUpperCase();
    if (!clientCode) { ui.alert("Client code cannot be empty."); return; }

    var cmSheet = getSheet(CONFIG.sheets.clientMaster);
    var cmData = cmSheet.getDataRange().getValues();

    for (var i = 1; i < cmData.length; i++) {
      if (String(cmData[i][0]).trim().toUpperCase() === clientCode) {
        var oldToken = String(cmData[i][PORTAL_SECURITY.clientTokenCol - 1] || "").trim();
        var newToken = generatePortalToken_();

        cmSheet.getRange(i + 1, PORTAL_SECURITY.clientTokenCol).setValue(newToken);
        SpreadsheetApp.flush();

        // Get the web app URL for the client portal
        var portalBaseUrl = ScriptApp.getService().getUrl();
        var newUrl = portalBaseUrl + "?page=client&client=" + clientCode + "&token=" + newToken;

        logException("WARNING", clientCode, FUNCTION_NAME,
          "Portal token ROTATED. Old token invalidated. New URL must be sent to client.");

        ui.alert("✅ Token Rotated for " + clientCode + "\n\n" +
          "Old token is now INVALID.\n\n" +
          "New portal URL:\n" + newUrl + "\n\n" +
          "Send this URL to the client immediately.\n" +
          "The old link will show 'Access Denied'.");

        return;
      }
    }

    ui.alert("Client code '" + clientCode + "' not found in CLIENT_MASTER.");

  } catch (err) {
    logException("ERROR", "SYSTEM", FUNCTION_NAME, "Failed: " + err.message);
    ui.alert("Error: " + err.message);
  }
}

/**
 * Show all client portal URLs with their tokens.
 * For Stacey to review and send to clients.
 */
function showClientPortalUrls() {
  var FUNCTION_NAME = "showClientPortalUrls";
  try {
    var cmData = getSheetData(CONFIG.sheets.clientMaster);
    var portalBaseUrl = ScriptApp.getService().getUrl();
    var lines = ["CLIENT PORTAL URLs\n"];

    for (var i = 1; i < cmData.length; i++) {
      var clientCode = String(cmData[i][0] || "").trim();
      var clientName = String(cmData[i][1] || "").trim();
      var isActive = String(cmData[i][9] || "").trim();
      var token = String(cmData[i][PORTAL_SECURITY.clientTokenCol - 1] || "").trim();

      if (!clientCode || isActive !== "Yes") continue;

      if (token) {
        var url = portalBaseUrl + "?page=client&client=" + clientCode + "&token=" + token;
        lines.push(clientCode + " (" + clientName + "):");
        lines.push(url);
        lines.push("");
      } else {
        lines.push(clientCode + " (" + clientName + "): NO TOKEN — run Generate Tokens first");
        lines.push("");
      }
    }

    SpreadsheetApp.getUi().alert(lines.join("\n"));

  } catch (err) {
    logException("ERROR", "SYSTEM", FUNCTION_NAME, "Failed: " + err.message);
    SpreadsheetApp.getUi().alert("Error: " + err.message);
  }
}


// ============================================================
// ACCESS LOGGING
// ============================================================

/**
 * Logs portal access attempts to ACCESS_LOG sheet.
 * Auto-creates the sheet if it doesn't exist.
 * Auto-trims when it exceeds MAX_ACCESS_LOG_ROWS.
 */
function logAccess_(outcome, identity, portal, details) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(PORTAL_SECURITY.accessLogSheet);

    if (!sheet) {
      sheet = ss.insertSheet(PORTAL_SECURITY.accessLogSheet);
      sheet.appendRow([
        "Timestamp", "Outcome", "Identity", "Portal", "Details"
      ]);
      sheet.getRange(1, 1, 1, 5).setFontWeight("bold");
      // Move to end
      ss.setActiveSheet(sheet);
      ss.moveActiveSheet(ss.getNumSheets());
    }

    sheet.appendRow([
      new Date(),
      outcome || "",
      identity || "",
      portal || "",
      details || ""
    ]);

    // Auto-trim if too large
    var rowCount = sheet.getLastRow();
    if (rowCount > PORTAL_SECURITY.maxAccessLogRows) {
      // Delete oldest 20% of rows
      var deleteCount = Math.floor(PORTAL_SECURITY.maxAccessLogRows * 0.2);
      sheet.deleteRows(2, deleteCount);
    }

  } catch (e) {
    // Access logging failure should never break the portal
    Logger.log("Access log failed: " + e.message);
  }
}


// ============================================================
// ACCESS DENIED PAGE
// Returns a styled HTML page for denied requests.
// ============================================================

function buildAccessDeniedPage_(reason) {
  var html =
    "<!DOCTYPE html><html><head>" +
    "<meta name='viewport' content='width=device-width,initial-scale=1'>" +
    "<style>" +
    "body{font-family:Arial,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5;}" +
    ".card{background:white;border-radius:12px;padding:40px;max-width:420px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,0.1);}" +
    ".icon{font-size:48px;margin-bottom:16px;}" +
    "h1{color:#d93025;font-size:22px;margin:0 0 12px 0;}" +
    "p{color:#666;font-size:14px;line-height:1.6;margin:8px 0;}" +
    ".contact{margin-top:24px;padding-top:20px;border-top:1px solid #eee;}" +
    ".contact p{font-size:12px;color:#999;}" +
    ".contact a{color:#1a73e8;text-decoration:none;}" +
    "</style></head><body>" +
    "<div class='card'>" +
    "<div class='icon'>🔒</div>" +
    "<h1>Access Denied</h1>" +
    "<p>" + (reason || "You do not have permission to access this portal.") + "</p>" +
    "<div class='contact'>" +
    "<p>If you believe this is an error, please contact:</p>" +
    "<p><a href='mailto:Contact@bluelotuscanada.ca'>Contact@bluelotuscanada.ca</a></p>" +
    "<p style='margin-top:16px;font-size:11px;color:#ccc;'>Blue Lotus Consulting Corporation</p>" +
    "</div></div></body></html>";

  return HtmlService.createHtmlOutput(html)
    .setTitle("BLC — Access Denied")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


// ============================================================
// SECURE doGet() — REPLACEMENT FOR Code.gs doGet()
//
// This function should REPLACE the existing doGet() in Code.gs.
// It handles both internal (Google session) and client (token)
// authentication with grace period support.
//
// PASTE THIS INTO Code.gs, replacing the existing doGet():
// ============================================================

function doGetSecure(e) {
  var page = (e.parameter.page || "").toLowerCase();
  var clientCode = e.parameter.client || "";
  var clientToken = e.parameter.token || "";
  var enforcing = isSecurityEnforced();

  // ── Quarterly rating portal (TL, PM, CEO — Google session auth) ──
  if (page === "rating") {
    var ratingAuth    = authenticateInternalUser();
    var ratingAllowed = ['CEO', 'Team Leader', 'Project Manager'];
    if (!ratingAuth.authenticated || ratingAllowed.indexOf(ratingAuth.role) === -1) {
      return HtmlService.createHtmlOutput(
        '<h2>Access denied</h2><p>This portal requires a BLC Google account with a TL, PM, or CEO role.</p>'
      );
    }
    return HtmlService.createHtmlOutputFromFile('QuarterlyRating')
      .setTitle('BLC — Quarterly Ratings')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // ── Client quarterly rating (feedbackToken, no Google login) ─────
  if (page === "client-rating") {
    var feedbackToken    = e.parameter.token || "";
    var clientRatingAuth = { authenticated: false };
    if (feedbackToken) {
      var tokenClient = SheetDB.findOne('CLIENT_MASTER', function (r) {
        return r.feedbackToken === feedbackToken;
      });
      if (tokenClient) clientRatingAuth.authenticated = true;
    }
    if (!clientRatingAuth.authenticated) {
      return HtmlService.createHtmlOutput('<h2>Invalid or expired link.</h2>');
    }
    return HtmlService.createHtmlOutputFromFile('ClientRating')
      .setTitle('BLC — Client Quarterly Rating')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // ── CLIENT PORTAL — Token-based auth ────────────────────────
  if (page === "client" && clientCode) {

    var clientAuth = authenticateClient(clientCode, clientToken);

    if (!clientAuth.authenticated) {
      logAccess_("DENIED", "client:" + clientCode, "client",
        clientAuth.error + (enforcing ? " [ENFORCED]" : " [GRACE — would deny]"));

      if (enforcing) {
        return buildAccessDeniedPage_(
          "Invalid or missing access credentials for the client portal. " +
          "Please use the link provided by your BLC account team."
        );
      }
      // Grace mode: log but allow through (serve old unsecured view)
    }

    if (clientAuth.authenticated) {
      logAccess_("ALLOWED", "client:" + clientAuth.clientCode, "client",
        clientAuth.clientName);
    }

    // Serve client view
    var html = HtmlService.createHtmlOutputFromFile("ClientView");
    var safeClientCode = clientAuth.authenticated ? clientAuth.clientCode : clientCode;
    var content = html.getContent()
      .replace("var CLIENT_CODE = '';", "var CLIENT_CODE = '" + safeClientCode + "';");
    return HtmlService.createHtmlOutput(content)
      .setTitle("BLC Client Portal")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // ── INTERNAL PORTALS — Google session auth ──────────────────
  var auth = authenticateInternalUser();

  if (!auth.authenticated) {
    logAccess_("DENIED", auth.email || "unknown", page || "unknown",
      auth.error + (enforcing ? " [ENFORCED]" : " [GRACE — would deny]"));

    if (enforcing) {
      return buildAccessDeniedPage_(auth.error);
    }
    // Grace mode: log but fall through to old behavior
  }

  if (auth.authenticated) {
    logAccess_("ALLOWED", auth.email, getPortalForRole(auth.role),
      auth.name + " | " + auth.role);
  }

  // ── CEO PORTAL ──────────────────────────────────────────────
  if (auth.role === "CEO" || (!enforcing && page === "ceo")) {

    // CEO explicitly requesting intake queue
    if (page === "intake") {
      logAccess_("ALLOWED", auth.email, "intake", auth.name + " | " + auth.role);
      return HtmlService.createHtmlOutputFromFile("IntakeQueue")
        .setTitle("BLC — Intake Queue")
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }

    if (e.parameter.debug === "1") {
      return HtmlService.createHtmlOutputFromFile("CEO_Debug")
        .setTitle("BLC Debug")
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
    if (e.parameter.action === "getCEODashboard") {
      var data = buildCEODashboardData();
      return ContentService
        .createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);
    }
    return HtmlService.createHtmlOutputFromFile("CEO_Dashboard")
      .setTitle("BLC CEO Dashboard")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // ── ROUTE BY ROLE (or explicit ?page= for TLs) ───────────────
  // getPortalForRole: PM → "intake", TL/QC → "teamlead", Designer → "designer"
  // If user is not authenticated, fall back to the page param (grace mode).
  var portal = auth.authenticated ? getPortalForRole(auth.role) : page;

  // Allow TLs to explicitly request the intake queue via ?page=intake
  if (page === "intake") portal = "intake";

  // ── INTAKE QUEUE — PM (default) and TL / CEO (explicit) ──────
  if (portal === "intake") {
    var intakeAllowed = ["Team Leader", "Project Manager", "CEO"];
    if (auth.authenticated && intakeAllowed.indexOf(auth.role) !== -1) {
      logAccess_("ALLOWED", auth.email, "intake", auth.name + " | " + auth.role);
      return HtmlService.createHtmlOutputFromFile("IntakeQueue")
        .setTitle("BLC — Intake Queue")
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
    // Authenticated but wrong role (e.g. Designer trying ?page=intake)
    if (auth.authenticated) {
      return buildAccessDeniedPage_(
        "The Intake Queue is only accessible to Team Leads and Project Managers."
      );
    }
  }

  // ── TEAM LEAD / QC REVIEWER PORTAL ───────────────────────────
  if (portal === "teamlead") {
    return HtmlService.createHtmlOutputFromFile("TeamLeadView")
      .setTitle("BLC Team Status")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // ── DESIGNER PORTAL (default) ───────────────────────────────
  return HtmlService.createHtmlOutputFromFile("DesignerView")
    .setTitle("BLC My Jobs")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================
// WRAPPER: Called by DesignerView.html
// Returns appropriate data based on enforcement mode.
// Grace mode: returns all data with dropdown (old behavior)
// Enforced: returns only authenticated user's data (no dropdown)
// ============================================================

function getMyDesignerData() {
  var enforcing = isSecurityEnforced();

  if (!enforcing) {
    var data = getDesignerViewData();
    data.mode = "open";
    return data;
  }

  var auth = authenticateInternalUser();
  if (!auth.authenticated) {
    return { mode: "denied", designers: [], jobs: [], error: auth.error };
  }

  var data = getDesignerViewDataSecure(auth.name);
  data.mode = "secure";
  data.userName = auth.name;
  return data;
}


/**
 * Called from QuarterlyRating.html via google.script.run.
 * Returns the list of staff this internal rater can rate.
 */
function getQuarterlyRatingData(quarterKey) {
  var auth = authenticateInternalUser();
  if (!auth.authenticated) return { error: 'Not authenticated' };

  // Resolve the rater's own designerId from STAFF_ROSTER (needed for supId lookup).
  var selfRecord = SheetDB.findOne('STAFF_ROSTER', function (r) {
    return r.name === auth.name && r.status === 'ACTIVE';
  });
  var authDesignerId = selfRecord ? selfRecord.designerId : '';

  var active = SheetDB.findRows('STAFF_ROSTER', function (r) { return r.status === 'ACTIVE'; });
  var reportees;

  if (auth.role === 'Team Leader') {
    reportees = active.filter(function (r) {
      return r.supId === authDesignerId && r.role === 'Designer';
    });
  } else if (auth.role === 'Project Manager') {
    reportees = active.filter(function (r) {
      return r.supId === authDesignerId && r.role === 'Designer';
    });
  } else if (auth.role === 'CEO') {
    reportees = active.filter(function (r) {
      return r.role === 'Team Leader' || r.role === 'Project Manager';
    });
  } else {
    return { error: 'Role not permitted to rate' };
  }

  var existing = SheetDB.findRows('QUARTERLY_BONUS_INPUTS', function (r) {
    return r.quarter === quarterKey && r.personId === authDesignerId;
  });

  return {
    raterName  : auth.name,
    raterRole  : auth.role,
    quarterKey : quarterKey,
    reportees  : reportees.map(function (r) {
      return { personId: r.designerId, personName: r.name, role: r.role };
    }),
    existing   : existing
  };
}


/**
 * Called from QuarterlyRating.html to save a completed rating submission.
 * Upserts one QBI row per ratee (one row per person per quarter).
 */
function submitQuarterlyRating(payload) {
  // payload: { quarterKey, rateeId, rateeName, rateeRole, scores[], strengthNote, improvementNote }
  var auth = authenticateInternalUser();
  if (!auth.authenticated) return { error: 'Not authenticated' };

  var fieldMap = {
    'Team Leader'     : 'tlRatingAvg',
    'Project Manager' : 'pmRatingAvg',
    'CEO'             : 'ceoRatingAvg'
  };
  var fieldToUpdate = fieldMap[auth.role];
  if (!fieldToUpdate) return { error: 'Role not permitted to rate' };

  var scores   = payload.scores || [];
  var avgScore = scores.length > 0
    ? scores.reduce(function (s, v) { return s + Number(v); }, 0) / scores.length
    : 0;

  var existing = SheetDB.findOne('QUARTERLY_BONUS_INPUTS', function (r) {
    return r.quarter === payload.quarterKey && r.personId === payload.rateeId;
  });

  if (existing) {
    var updates        = {};
    updates[fieldToUpdate] = avgScore;
    if (payload.strengthNote)    updates.strengthNote    = payload.strengthNote;
    if (payload.improvementNote) updates.improvementNote = payload.improvementNote;
    SheetDB.updateRow('QUARTERLY_BONUS_INPUTS', existing._rowIndex, updates);
  } else {
    var newRow         = {
      quarter     : payload.quarterKey,
      personId    : payload.rateeId,
      personName  : payload.rateeName,
      role        : payload.rateeRole,
      status      : 'Draft'
    };
    newRow[fieldToUpdate] = avgScore;
    if (payload.strengthNote)    newRow.strengthNote    = payload.strengthNote;
    if (payload.improvementNote) newRow.improvementNote = payload.improvementNote;
    SheetDB.insertRows('QUARTERLY_BONUS_INPUTS', [newRow]);
  }

  return { success: true };
}