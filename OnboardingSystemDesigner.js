/**
 * ============================================================================
 * OnboardingSystemDesigner.gs
 * Blue Lotus Consulting Corporation — Designer Onboarding System
 * 
 * Handles:
 *   1. New designer onboarding (full setup)
 *   2. Rejoining designer reactivation (re-enable existing record)
 * 
 * Dependencies: Code.gs (CONFIG, logException, normaliseDesignerName,
 *               syncFormDropdowns, getSheet, DESIGNER_NAME_MAP,
 *               NOTIFICATION_EMAIL)
 * 
 * File: OnboardingSystemDesigner.gs
 * Created: March 2026
 * ============================================================================
 */


// ============================================================================
// DESIGNER_MASTER COLUMN MAP (confirmed March 7, 2026)
// ============================================================================
var DMV2 = {
  employeeId: 1,      // Designer_ID — col A
  name: 2,            // Designer_Name — col B
  email: 3,           // Email — col C (CONFIRMED)
  phone: 4,           // Phone — col D
  role: 5,            // Role — col E
  teamLead: 6,        // Team_Lead — col F
  rate: 7,            // Hourly_Rate (INR) — col G
  startDate: 8,       // Start_Date — col H
  active: 9,          // Active — col I
  notes: 10,          // Notes — col J
  assignedClients: 11 // Assigned_Clients — col K
};

var DM_COLS = 11; // Total columns in DESIGNER_MASTER


// ============================================================================
// MENU ENTRY: onboardDesigner()
// Presents the choice: New Designer or Rejoin
// Called from menu: BLC System → Onboard / Reactivate Designer
// ============================================================================
function onboardDesigner() {
  var ui = SpreadsheetApp.getUi();

  var choice = ui.alert(
    "Designer Onboarding",
    "What would you like to do?\n\n" +
    "• Click YES to onboard a BRAND NEW designer\n" +
    "• Click NO to REACTIVATE a designer who previously left and is rejoining\n" +
    "• Click CANCEL to exit",
    ui.ButtonSet.YES_NO_CANCEL
  );

  if (choice === ui.Button.YES) {
    onboardNewDesigner_();
  } else if (choice === ui.Button.NO) {
    reactivateDesigner_();
  }
  // CANCEL = do nothing
}


// ============================================================================
// FLOW 1: ONBOARD NEW DESIGNER
// ============================================================================
function onboardNewDesigner_() {
  var ui = SpreadsheetApp.getUi();

  try {
    // ---------------------------------------------------------------------
    // STEP 1: Collect designer information
    // ---------------------------------------------------------------------
    var fullName = promptRequired_(ui, "Full Name", 
      "Enter the designer's full canonical name (e.g. Arun Patel).\n\nThis is the name that will appear everywhere in the system.");
    if (!fullName) return;
    fullName = fullName.trim();

    // Check for duplicate name
    var dmSheet = getSheet(CONFIG.sheets.designerMaster);
    var dmData = dmSheet.getDataRange().getValues();
    for (var i = 1; i < dmData.length; i++) {
      if (String(dmData[i][DMV2.name - 1]).toLowerCase().trim() === fullName.toLowerCase()) {
        var existingActive = dmData[i][DMV2.active - 1];
        if (String(existingActive).toLowerCase() === "yes") {
          ui.alert("Duplicate Designer", 
            "A designer named '" + fullName + "' already exists and is ACTIVE in DESIGNER_MASTER (row " + (i + 1) + ").\n\nOnboarding cancelled.", 
            ui.ButtonSet.OK);
          return;
        } else {
          // Inactive designer found — suggest reactivation instead
          var switchFlow = ui.alert("Designer Found (Inactive)",
            "A designer named '" + fullName + "' exists but is currently INACTIVE (row " + (i + 1) + ").\n\n" +
            "Would you like to REACTIVATE them instead of creating a new record?\n\n" +
            "Click YES to reactivate, NO to cancel.",
            ui.ButtonSet.YES_NO);
          if (switchFlow === ui.Button.YES) {
            reactivateDesignerByRow_(dmSheet, dmData, i, ui);
          }
          return;
        }
      }
    }

    var email = promptRequired_(ui, "Email Address", "Enter the designer's email address:");
    if (!email) return;

    var phone = promptOptional_(ui, "Phone Number", "Enter the designer's phone number (or leave blank):");

    var role = promptOptionalWithDefault_(ui, "Role", 
      "Enter the role (Designer / Team Leader / QC Reviewer).\nDefault: Designer", "Designer");

    // Team Lead selection
    var teamLead = promptRequired_(ui, "Team Leader", 
      "Who is this designer's Team Leader?\n\nCurrent TLs: Bharath Charles, Samar Kumar Das, Savvy Nath\nManager: Sarty Gosh");
    if (!teamLead) return;

    var rate = promptRequired_(ui, "Hourly Rate (INR)", 
      "Enter the hourly rate in INR (numbers only, e.g. 300):");
    if (!rate) return;
    rate = parseFloat(rate);
    if (isNaN(rate)) {
      ui.alert("Error", "Rate must be a number. Onboarding cancelled.", ui.ButtonSet.OK);
      return;
    }

    var assignedClients = promptOptional_(ui, "Assigned Clients", 
      "Enter assigned client codes, comma-separated (e.g. NELSON, SBS).\nLeave blank to assign later.");

    // ---------------------------------------------------------------------
    // STEP 2: Generate Employee ID
    // ---------------------------------------------------------------------
    var empId = generateEmployeeId_(fullName, dmData);

    // ---------------------------------------------------------------------
    // STEP 3: Confirm
    // ---------------------------------------------------------------------
    var confirmMsg = "Please confirm the new designer:\n\n" +
      "Employee ID: " + empId + "\n" +
      "Name: " + fullName + "\n" +
      "Email: " + email + "\n" +
      "Role: " + role + "\n" +
      "Team Leader: " + teamLead + "\n" +
      "Rate: \u20B9" + rate + " INR/hr\n" +
      "Assigned Clients: " + (assignedClients || "(none yet)") + "\n\n" +
      "Proceed?";

    var confirm = ui.alert("Confirm Onboarding", confirmMsg, ui.ButtonSet.YES_NO);
    if (confirm !== ui.Button.YES) {
      ui.alert("Cancelled", "Designer onboarding cancelled.", ui.ButtonSet.OK);
      return;
    }

    // ---------------------------------------------------------------------
    // STEP 4: Create DESIGNER_MASTER row
    // ---------------------------------------------------------------------
    var newRow = new Array(DM_COLS).fill("");
    newRow[DMV2.employeeId - 1] = empId;
    newRow[DMV2.name - 1] = fullName;
    newRow[DMV2.email - 1] = email;
    newRow[DMV2.phone - 1] = phone;
    newRow[DMV2.role - 1] = role;
    newRow[DMV2.teamLead - 1] = teamLead;
    newRow[DMV2.rate - 1] = rate;
    newRow[DMV2.startDate - 1] = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
    newRow[DMV2.active - 1] = "Yes";
    newRow[DMV2.notes - 1] = "Onboarded " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
    newRow[DMV2.assignedClients - 1] = assignedClients;

    dmSheet.appendRow(newRow);

    logException("INFO", empId, "OnboardingSystemDesigner",
      "DESIGNER_MASTER row created for " + fullName + " (" + empId + "), TL: " + teamLead + ", Rate: " + rate);

    // ---------------------------------------------------------------------
    // STEP 5: Sync form dropdowns
    // ---------------------------------------------------------------------
    try {
      syncFormDropdowns();
      logException("INFO", empId, "OnboardingSystemDesigner",
        "Form dropdowns synced — " + fullName + " now appears in all forms");
    } catch (syncErr) {
      logException("WARNING", empId, "OnboardingSystemDesigner",
        "Dropdown sync failed: " + syncErr.message + ". Run BLC System → Sync Form Dropdowns manually.");
    }

    // ---------------------------------------------------------------------
    // STEP 6: Send welcome email to new designer
    // ---------------------------------------------------------------------
    try {
      var subject = "Welcome to Blue Lotus Consulting — " + fullName;
      var body = "Dear " + fullName + ",\n\n" +
        "Welcome to Blue Lotus Consulting Corporation. Your account has been set up in our system.\n\n" +
        "YOUR DETAILS:\n" +
        "Employee ID: " + empId + "\n" +
        "Role: " + role + "\n" +
        "Team Leader: " + teamLead + "\n" +
        "Assigned Clients: " + (assignedClients || "To be confirmed") + "\n\n" +
        "IMPORTANT — BANK DETAILS:\n" +
        "Please reply to this email with your bank account number and IFSC code.\n" +
        "These are required for payroll processing.\n\n" +
        "YOUR CONTACTS:\n" +
        "• Raj Nair — Account Support — raj.nair@bluelotuscanada.ca\n" +
        "• Sarty Gosh — Project Manager — sarty@bluelotuscanada.ca\n" +
        "• Stacey Watt — Admin — Contact@bluelotuscanada.ca\n" +
        "• HR — hr@bluelotuscanada.ca\n\n" +
        "Your Team Leader " + teamLead + " will coordinate your first job assignment.\n" +
        "Please review the client SOP documents before starting any work.\n\n" +
        "Welcome aboard!\n\n" +
        "Best regards,\n" +
        "Blue Lotus Consulting Corporation";

      MailApp.sendEmail({
        to: email,
        cc: "blccanada2026@gmail.com",
        subject: subject,
        body: body
      });

      logException("INFO", empId, "OnboardingSystemDesigner",
        "Welcome email sent to " + email);
    } catch (emailErr) {
      logException("WARNING", empId, "OnboardingSystemDesigner",
        "Welcome email failed: " + emailErr.message + ". Send manually to " + email);
    }

    // ---------------------------------------------------------------------
    // STEP 7: Success summary
    // ---------------------------------------------------------------------
    var successMsg = "Designer onboarded successfully!\n\n" +
      "EMPLOYEE ID: " + empId + "\n" +
      "NAME: " + fullName + "\n" +
      "TEAM LEADER: " + teamLead + "\n\n" +
      "WHAT WAS DONE:\n" +
      "\u2713 DESIGNER_MASTER row created\n" +
      "\u2713 Form dropdowns synced\n" +
      "\u2713 Welcome email sent to " + email + "\n\n" +
      "\u26A0 STILL TO DO MANUALLY:\n" +
      "1. Add name variants to DESIGNER_NAME_MAP in Code.gs\n" +
      "   e.g. '" + generateNameVariantExample_(fullName) + "': '" + fullName + "'\n\n" +
      "2. Update PAYROLL_TEAM_CONFIG in PayrollV2_Engine.gs:\n" +
      "   Add '" + fullName + "' to " + teamLead + "'s directReports array\n\n" +
      "3. Collect bank account + IFSC code when designer replies\n" +
      "   Update DESIGNER_MASTER cols L and M\n\n" +
      "4. Notify Sarty that " + fullName + " is active and available";

    ui.alert("Onboarding Complete", successMsg, ui.ButtonSet.OK);

  } catch (err) {
    logException("ERROR", "NEW_DESIGNER", "OnboardingSystemDesigner",
      "New designer onboarding failed: " + err.message);
    ui.alert("Error", "Designer onboarding failed: " + err.message +
      "\n\nCheck EXCEPTIONS_LOG for details.", ui.ButtonSet.OK);
  }
}


// ============================================================================
// FLOW 2: REACTIVATE RETURNING DESIGNER
// ============================================================================
function reactivateDesigner_() {
  var ui = SpreadsheetApp.getUi();

  try {
    var dmSheet = getSheet(CONFIG.sheets.designerMaster);
    var dmData = dmSheet.getDataRange().getValues();

    // Find all inactive designers
    var inactiveList = [];
    var inactiveRows = [];
    for (var i = 1; i < dmData.length; i++) {
      if (String(dmData[i][DMV2.active - 1]).toLowerCase() !== "yes") {
        inactiveList.push(dmData[i][DMV2.name - 1] + " (" + dmData[i][DMV2.employeeId - 1] + ")");
        inactiveRows.push(i);
      }
    }

    if (inactiveList.length === 0) {
      ui.alert("No Inactive Designers", 
        "There are no inactive designers in DESIGNER_MASTER to reactivate.\n\nIf you need to onboard a new designer, use the 'New Designer' option.", 
        ui.ButtonSet.OK);
      return;
    }

    // Show list and ask which one
    var listMsg = "The following designers are currently INACTIVE:\n\n";
    for (var j = 0; j < inactiveList.length; j++) {
      listMsg += (j + 1) + ". " + inactiveList[j] + "\n";
    }
    listMsg += "\nEnter the NUMBER of the designer to reactivate (e.g. 1):";

    var response = ui.prompt("Select Designer to Reactivate", listMsg, ui.ButtonSet.OK_CANCEL);
    if (response.getSelectedButton() !== ui.Button.OK) return;

    var selection = parseInt(response.getResponseText().trim());
    if (isNaN(selection) || selection < 1 || selection > inactiveList.length) {
      ui.alert("Invalid Selection", "Please enter a valid number between 1 and " + inactiveList.length + ".", ui.ButtonSet.OK);
      return;
    }

    var rowIndex = inactiveRows[selection - 1];
    reactivateDesignerByRow_(dmSheet, dmData, rowIndex, ui);

  } catch (err) {
    logException("ERROR", "REACTIVATE", "OnboardingSystemDesigner",
      "Designer reactivation failed: " + err.message);
    ui.alert("Error", "Reactivation failed: " + err.message +
      "\n\nCheck EXCEPTIONS_LOG for details.", ui.ButtonSet.OK);
  }
}


// ============================================================================
// SHARED: Reactivate a specific designer by row index
// ============================================================================
function reactivateDesignerByRow_(dmSheet, dmData, rowIndex, ui) {
  var row = dmData[rowIndex];
  var empId = row[DMV2.employeeId - 1];
  var name = row[DMV2.name - 1];
  var oldEmail = row[DMV2.email - 1];
  var oldRate = row[DMV2.rate - 1];
  var oldTeamLead = row[DMV2.teamLead - 1];
  var oldRole = row[DMV2.role - 1];
  var sheetRow = rowIndex + 1; // 1-indexed for sheet operations

  // Ask what needs updating
  var updateMsg = "Reactivating: " + name + " (" + empId + ")\n\n" +
    "Current record:\n" +
    "• Email: " + oldEmail + "\n" +
    "• Role: " + oldRole + "\n" +
    "• Team Leader: " + oldTeamLead + "\n" +
    "• Rate: \u20B9" + oldRate + " INR/hr\n\n" +
    "Would you like to UPDATE any of these details?\n\n" +
    "Click YES to review and update each field\n" +
    "Click NO to reactivate with existing details as-is";

  var wantUpdate = ui.alert("Review Details", updateMsg, ui.ButtonSet.YES_NO);

  var newEmail = oldEmail;
  var newRate = oldRate;
  var newTeamLead = oldTeamLead;
  var newRole = oldRole;
  var newClients = "";

  if (wantUpdate === ui.Button.YES) {
    // Email
    var emailResp = promptOptionalWithDefault_(ui, "Email Address",
      "Current email: " + oldEmail + "\n\nEnter new email or leave blank to keep current:", String(oldEmail));
    newEmail = emailResp;

    // Role
    var roleResp = promptOptionalWithDefault_(ui, "Role",
      "Current role: " + oldRole + "\n\nEnter new role or leave blank to keep current:", String(oldRole));
    newRole = roleResp;

    // Team Lead
    var tlResp = promptOptionalWithDefault_(ui, "Team Leader",
      "Current TL: " + oldTeamLead + "\n\nCurrent TLs: Bharath Charles, Samar Kumar Das, Savvy Nath\nManager: Sarty Gosh\n\nEnter new TL or leave blank to keep current:", String(oldTeamLead));
    newTeamLead = tlResp;

    // Rate
    var rateResp = promptOptionalWithDefault_(ui, "Hourly Rate (INR)",
      "Current rate: \u20B9" + oldRate + "\n\nEnter new rate or leave blank to keep current:", String(oldRate));
    newRate = parseFloat(rateResp);
    if (isNaN(newRate)) newRate = oldRate;

    // Assigned clients
    newClients = promptOptional_(ui, "Assigned Clients",
      "Enter assigned client codes, comma-separated (e.g. NELSON, SBS).\nLeave blank to keep current.");
  }

  // Confirm reactivation
  var confirmMsg = "Confirm reactivation of " + name + ":\n\n" +
    "Email: " + newEmail + "\n" +
    "Role: " + newRole + "\n" +
    "Team Leader: " + newTeamLead + "\n" +
    "Rate: \u20B9" + newRate + " INR/hr\n\n" +
    "This will:\n" +
    "\u2713 Set Active = Yes\n" +
    "\u2713 Update any changed fields\n" +
    "\u2713 Re-sync all form dropdowns\n" +
    "\u2713 Send a welcome-back email\n\n" +
    "Proceed?";

  var confirm = ui.alert("Confirm Reactivation", confirmMsg, ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) {
    ui.alert("Cancelled", "Reactivation cancelled.", ui.ButtonSet.OK);
    return;
  }

  // Update the row
  dmSheet.getRange(sheetRow, DMV2.active).setValue("Yes");
  dmSheet.getRange(sheetRow, DMV2.email).setValue(newEmail);
  dmSheet.getRange(sheetRow, DMV2.role).setValue(newRole);
  dmSheet.getRange(sheetRow, DMV2.teamLead).setValue(newTeamLead);
  dmSheet.getRange(sheetRow, DMV2.rate).setValue(newRate);

  if (newClients) {
    dmSheet.getRange(sheetRow, DMV2.assignedClients).setValue(newClients);
  }

  // Add a note about the reactivation
  var existingNotes = dmSheet.getRange(sheetRow, DMV2.notes).getValue();
  var reactivationNote = "Reactivated " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd") +
    " | TL: " + newTeamLead + " | Rate: " + newRate;
  var updatedNotes = existingNotes ? existingNotes + " | " + reactivationNote : reactivationNote;
  dmSheet.getRange(sheetRow, DMV2.notes).setValue(updatedNotes);

  logException("INFO", empId, "OnboardingSystemDesigner",
    "Designer REACTIVATED: " + name + " (" + empId + "), TL: " + newTeamLead + ", Rate: " + newRate);

  // Sync dropdowns
  try {
    syncFormDropdowns();
    logException("INFO", empId, "OnboardingSystemDesigner",
      "Form dropdowns synced — " + name + " re-added to all forms");
  } catch (syncErr) {
    logException("WARNING", empId, "OnboardingSystemDesigner",
      "Dropdown sync failed: " + syncErr.message + ". Run BLC System → Sync Form Dropdowns manually.");
  }

  // Send welcome-back email
  try {
    var subject = "Welcome Back to Blue Lotus Consulting — " + name;
    var body = "Dear " + name + ",\n\n" +
      "Welcome back to Blue Lotus Consulting Corporation! Your account has been reactivated.\n\n" +
      "YOUR UPDATED DETAILS:\n" +
      "Employee ID: " + empId + "\n" +
      "Role: " + newRole + "\n" +
      "Team Leader: " + newTeamLead + "\n\n" +
      "IMPORTANT — PLEASE CONFIRM YOUR BANK DETAILS:\n" +
      "If your bank account or IFSC code has changed since you last worked with us,\n" +
      "please reply to this email with your updated details for payroll.\n\n" +
      "YOUR CONTACTS:\n" +
      "• Raj Nair — Account Support — raj.nair@bluelotuscanada.ca\n" +
      "• Sarty Gosh — Project Manager — sarty@bluelotuscanada.ca\n" +
      "• Stacey Watt — Admin — Contact@bluelotuscanada.ca\n" +
      "• HR — hr@bluelotuscanada.ca\n\n" +
      "Your Team Leader " + newTeamLead + " will coordinate your next job assignment.\n" +
      "Please review any updated client SOPs before starting work.\n\n" +
      "Great to have you back!\n\n" +
      "Best regards,\n" +
      "Blue Lotus Consulting Corporation";

    MailApp.sendEmail({
      to: newEmail,
      cc: "blccanada2026@gmail.com",
      subject: subject,
      body: body
    });

    logException("INFO", empId, "OnboardingSystemDesigner",
      "Welcome-back email sent to " + newEmail);
  } catch (emailErr) {
    logException("WARNING", empId, "OnboardingSystemDesigner",
      "Welcome-back email failed: " + emailErr.message + ". Send manually to " + newEmail);
  }

  // Success
  var successMsg = "Designer reactivated successfully!\n\n" +
    "NAME: " + name + "\n" +
    "EMPLOYEE ID: " + empId + "\n" +
    "STATUS: Active\n\n" +
    "WHAT WAS DONE:\n" +
    "\u2713 Active set to Yes in DESIGNER_MASTER\n" +
    "\u2713 Details updated (if changed)\n" +
    "\u2713 Reactivation logged in Notes column\n" +
    "\u2713 Form dropdowns re-synced\n" +
    "\u2713 Welcome-back email sent to " + newEmail + "\n\n" +
    "\u26A0 STILL TO DO MANUALLY:\n" +
    "1. Re-add '" + name + "' to PAYROLL_TEAM_CONFIG in PayrollV2_Engine.gs\n" +
    "   → Add to " + newTeamLead + "'s directReports array\n\n" +
    "2. Check DESIGNER_NAME_MAP in Code.gs still has their variants\n\n" +
    "3. Confirm bank details are still current (cols L and M)\n\n" +
    "4. Notify Sarty that " + name + " is available for jobs again";

  ui.alert("Reactivation Complete", successMsg, ui.ButtonSet.OK);
}


// ============================================================================
// HELPER: Generate Employee ID from name
// Format: First initial + Last initial + sequential number (e.g. AP001)
// ============================================================================
function generateEmployeeId_(fullName, dmData) {
  var parts = fullName.trim().split(/\s+/);
  var initials = "";

  if (parts.length >= 2) {
    initials = parts[0].charAt(0).toUpperCase() + parts[parts.length - 1].charAt(0).toUpperCase();
  } else {
    initials = parts[0].substring(0, 2).toUpperCase();
  }

  // Find the highest existing number for these initials
  var maxNum = 0;
  for (var i = 1; i < dmData.length; i++) {
    var existingId = String(dmData[i][DMV2.employeeId - 1]);
    if (existingId.substring(0, 2).toUpperCase() === initials) {
      var num = parseInt(existingId.substring(2));
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
  }

  var newNum = String(maxNum + 1);
  while (newNum.length < 3) newNum = "0" + newNum;

  return initials + newNum;
}


// ============================================================================
// HELPER: Generate example name variant for DESIGNER_NAME_MAP hint
// ============================================================================
function generateNameVariantExample_(fullName) {
  var parts = fullName.trim().split(/\s+/);
  if (parts.length >= 2) {
    var fi = parts[0].charAt(0).toUpperCase();
    var li = parts[parts.length - 1].charAt(0).toUpperCase();
    return fi + li + "-" + parts[0] + " " + parts[parts.length - 1];
  }
  return fullName.substring(0, 2).toUpperCase() + "-" + fullName;
}


// ============================================================================
// PROMPT HELPERS
// These functions are defined in OnboardingSystemClient.gs:
//   promptRequired_(ui, title, message)
//   promptOptional_(ui, title, message)
//   promptOptionalWithDefault_(ui, title, message, defaultValue)
//
// If OnboardingSystemClient.gs is loaded in the same project (which it should
// be), these are available automatically. No need to redefine them here.
// ============================================================================