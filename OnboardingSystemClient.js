/**
 * ============================================================================
 * OnboardingSystemClient.gs
 * Blue Lotus Consulting Corporation — Client Onboarding System
 * 
 * Handles: New client onboarding, return form creation, trigger setup,
 *          dropdown sync, and welcome email.
 * 
 * Dependencies: Code.gs (CONFIG, logException, normaliseDesignerName,
 *               syncFormDropdowns, getSheet, NOTIFICATION_EMAIL)
 * 
 * File: OnboardingSystemClient.gs
 * Created: March 2026
 * ============================================================================
 */


// ============================================================================
// CLIENT MASTER COLUMN MAP (19 cols — confirmed March 7, 2026)
// ============================================================================
var CM = {
  clientCode: 1,
  clientName: 2,
  contactName: 3,
  email: 4,
  phone: 5,
  billingRate: 6,
  qcRate: 7,
  sopLink: 8,
  contractStart: 9,
  active: 10,
  notes: 11,
  currency: 12,
  gstApplicable: 13,
  address: 14,
  paymentTerms: 15,
  returnFormId: 16,
  returnFormUrl: 17,
  portalUrl: 18,
  formCreatedDate: 19
};


// ============================================================================
// MAIN FUNCTION: onboardNewClient()
// Called from menu: BLC System → Onboard New Client
// ============================================================================
function onboardNewClient() {
  var ui = SpreadsheetApp.getUi();
  
  try {
    // -----------------------------------------------------------------------
    // STEP 1: Collect client information via dialog boxes
    // -----------------------------------------------------------------------
    var clientCode = promptRequired_(ui, "Client Code", "Enter the client code (e.g. NELSON or NELSON-AB):");
    if (!clientCode) return;
    clientCode = clientCode.toUpperCase().trim();
    
    // Check for duplicate client code
    var cmSheet = getSheet(CONFIG.sheets.clientMaster);
    var cmData = cmSheet.getDataRange().getValues();
    for (var i = 1; i < cmData.length; i++) {
      if (String(cmData[i][CM.clientCode - 1]).toUpperCase().trim() === clientCode) {
        ui.alert("Duplicate Client", "A client with code '" + clientCode + "' already exists in CLIENT_MASTER (row " + (i + 1) + "). Onboarding cancelled.", ui.ButtonSet.OK);
        return;
      }
    }
    
    var clientName = promptRequired_(ui, "Company Name", "Enter the full company name (e.g. Nelson Lumber Ltd.):");
    if (!clientName) return;
    
    var contactName = promptRequired_(ui, "Contact Name", "Enter the primary contact name:");
    if (!contactName) return;
    
    var contactEmail = promptRequired_(ui, "Contact Email", "Enter the primary contact email address:");
    if (!contactEmail) return;
    
    var contactPhone = promptOptional_(ui, "Contact Phone", "Enter the contact phone number (or leave blank):");
    
    var billingRate = promptRequired_(ui, "Billing Rate", "Enter the billing rate per hour (CAD, numbers only, e.g. 65):");
    if (!billingRate) return;
    billingRate = parseFloat(billingRate);
    if (isNaN(billingRate)) {
      ui.alert("Error", "Billing rate must be a number. Onboarding cancelled.", ui.ButtonSet.OK);
      return;
    }
    
    var qcRate = promptRequired_(ui, "QC Rate", "Enter the QC rate per hour (CAD, numbers only, e.g. 55):");
    if (!qcRate) return;
    qcRate = parseFloat(qcRate);
    if (isNaN(qcRate)) {
      ui.alert("Error", "QC rate must be a number. Onboarding cancelled.", ui.ButtonSet.OK);
      return;
    }
    
    var sopLink = promptOptional_(ui, "SOP Link", "Enter the Google Drive link to the client's SOP (or leave blank to add later):");
    
    var contractStart = promptOptional_(ui, "Contract Start Date", "Enter the contract start date (YYYY-MM-DD format, or leave blank):");
    
    var currency = promptOptionalWithDefault_(ui, "Currency", "Enter the currency (default: CAD):", "CAD");
    
    var gstApplicable = promptOptionalWithDefault_(ui, "GST Applicable", "Is GST applicable? (Yes/No, default: Yes):", "Yes");
    
    var billingAddress = promptOptional_(ui, "Billing Address", "Enter the client's billing address (or leave blank to add later):");
    
    var paymentTerms = promptOptionalWithDefault_(ui, "Payment Terms", "Enter the payment terms (default: Net 15):", "Net 15");
    
    // -----------------------------------------------------------------------
    // STEP 2: Confirm before proceeding
    // -----------------------------------------------------------------------
    var confirmMsg = "Please confirm the new client details:\n\n" +
      "Client Code: " + clientCode + "\n" +
      "Company Name: " + clientName + "\n" +
      "Contact: " + contactName + " (" + contactEmail + ")\n" +
      "Billing Rate: $" + billingRate + " CAD/hr\n" +
      "QC Rate: $" + qcRate + " CAD/hr\n" +
      "Currency: " + currency + "\n" +
      "GST: " + gstApplicable + "\n" +
      "Payment Terms: " + paymentTerms + "\n\n" +
      "Proceed with onboarding?";
    
    var confirm = ui.alert("Confirm Onboarding", confirmMsg, ui.ButtonSet.YES_NO);
    if (confirm !== ui.Button.YES) {
      ui.alert("Cancelled", "Client onboarding cancelled.", ui.ButtonSet.OK);
      return;
    }
    
    // -----------------------------------------------------------------------
    // STEP 3: Create CLIENT_MASTER row
    // -----------------------------------------------------------------------
    var newRow = new Array(19).fill("");
    newRow[CM.clientCode - 1] = clientCode;
    newRow[CM.clientName - 1] = clientName;
    newRow[CM.contactName - 1] = contactName;
    newRow[CM.email - 1] = contactEmail;
    newRow[CM.phone - 1] = contactPhone;
    newRow[CM.billingRate - 1] = billingRate;
    newRow[CM.qcRate - 1] = qcRate;
    newRow[CM.sopLink - 1] = sopLink;
    newRow[CM.contractStart - 1] = contractStart;
    newRow[CM.active - 1] = "Yes";
    newRow[CM.notes - 1] = "";
    newRow[CM.currency - 1] = currency;
    newRow[CM.gstApplicable - 1] = gstApplicable;
    newRow[CM.address - 1] = billingAddress;
    newRow[CM.paymentTerms - 1] = paymentTerms;
    // Cols 16-19 (returnFormId, returnFormUrl, portalUrl, formCreatedDate) filled below
    
    cmSheet.appendRow(newRow);
    var newRowIndex = cmSheet.getLastRow(); // row number of the row we just added
    
    logException("INFO", clientCode, "OnboardingSystemClient", 
      "CLIENT_MASTER row created for " + clientName + " (" + clientCode + ")");
    
    // -----------------------------------------------------------------------
    // STEP 4: Create the Client Return Google Form
    // -----------------------------------------------------------------------
    var formTitle = clientName + " — Design Return Form";
    var form = FormApp.create(formTitle);
    
    form.setDescription(
      "Use this form to report any issues found in designs delivered by Blue Lotus Consulting.\n\n" +
      "Client: " + clientName + " (" + clientCode + ")\n" +
      "All submissions are automatically logged and routed to your BLC account team."
    );
    
    // Add form fields
    form.addTextItem()
      .setTitle("Job Number")
      .setHelpText("Enter the BLC job number (e.g. NL-2026-001)")
      .setRequired(true);
    
    form.addDateItem()
      .setTitle("Date Issue Noticed")
      .setHelpText("When did you first notice this issue?")
      .setRequired(true);
    
    form.addParagraphTextItem()
      .setTitle("Issue Description")
      .setHelpText("Describe the issue in detail — what is wrong, where in the design, and any reference to specific drawings or pages.")
      .setRequired(true);
    
    form.addMultipleChoiceItem()
      .setTitle("Issue Severity")
      .setChoiceValues(["Minor — Labelling / formatting error", "Moderate — Dimension or specification issue", "Major — Structural or design concern"])
      .setRequired(true);
    
    form.addTextItem()
      .setTitle("Submitted By")
      .setHelpText("Your name")
      .setRequired(true);
    
    form.addTextItem()
      .setTitle("Your Email")
      .setHelpText("So we can follow up with you directly")
      .setRequired(false);
    
    form.addParagraphTextItem()
      .setTitle("Additional Notes")
      .setHelpText("Any additional context, file references, or screenshots to attach separately")
      .setRequired(false);
    
    // Set form to collect email addresses
    form.setCollectEmail(false); // Don't force Google sign-in — external clients may not have Google accounts
    
    // Get form details
    var formId = form.getId();
    var formUrl = form.getPublishedUrl();
    var editUrl = form.getEditUrl();
    
    // Write form details back to CLIENT_MASTER
    cmSheet.getRange(newRowIndex, CM.returnFormId).setValue(formId);
    cmSheet.getRange(newRowIndex, CM.returnFormUrl).setValue(formUrl);
    cmSheet.getRange(newRowIndex, CM.formCreatedDate).setValue(new Date());
    
    logException("INFO", clientCode, "OnboardingSystemClient", 
      "Client Return Form created. Form ID: " + formId);
    
    // -----------------------------------------------------------------------
    // STEP 5: Set up form submit trigger for onClientReturnSubmit
    // -----------------------------------------------------------------------
    try {
      var formFile = FormApp.openById(formId);
      ScriptApp.newTrigger("onClientReturnSubmit")
        .forForm(formFile)
        .onFormSubmit()
        .create();
      
      logException("INFO", clientCode, "OnboardingSystemClient", 
        "Form submit trigger created for client return form");
    } catch (triggerErr) {
      logException("WARNING", clientCode, "OnboardingSystemClient", 
        "Could not create form trigger automatically: " + triggerErr.message + 
        ". Run BLC System → Setup Client Return Triggers manually.");
    }
    
    // -----------------------------------------------------------------------
    // STEP 6: Sync form dropdowns (adds new client to Job Start form etc.)
    // -----------------------------------------------------------------------
    try {
      syncFormDropdowns();
      logException("INFO", clientCode, "OnboardingSystemClient", 
        "Form dropdowns synced — " + clientCode + " now appears in all forms");
    } catch (syncErr) {
      logException("WARNING", clientCode, "OnboardingSystemClient", 
        "Dropdown sync failed: " + syncErr.message + 
        ". Run BLC System → Sync Form Dropdowns manually.");
    }
    
    // -----------------------------------------------------------------------
    // STEP 7: Send welcome email to client contact
    // -----------------------------------------------------------------------
    try {
      var subject = "Welcome to Blue Lotus Consulting — " + clientName;
      var body = "Dear " + contactName + ",\n\n" +
        "Welcome to Blue Lotus Consulting Corporation. We are delighted to begin working with " + clientName + ".\n\n" +
        "Your account has been set up in our system. Here are your key resources:\n\n" +
        "CLIENT CODE: " + clientCode + "\n" +
        "This code will be used on all job tracking and invoices.\n\n" +
        "DESIGN RETURN FORM:\n" + formUrl + "\n" +
        "Use this form to report any issues you find in delivered designs. " +
        "Every submission is automatically logged and routed to your project manager and design team.\n\n" +
        "YOUR BLC ACCOUNT TEAM:\n" +
        "• Raj Nair — Account Support — raj.nair@bluelotuscanada.ca\n" +
        "• Sarty Gosh — Project Manager — sarty@bluelotuscanada.ca\n" +
        "• Deb Sen — Senior Designer — deb.sen@bluelotuscanada.ca\n" +
        "• Abhishek Rit — Senior Designer — abhisek@bluelotuscanada.ca\n\n" +
        "GENERAL CONTACTS:\n" +
        "• Admin & General Enquiries — Stacey Watt — Contact@bluelotuscanada.ca\n" +
        "• HR — hr@bluelotuscanada.ca\n\n" +
        "For day-to-day job coordination, your primary point of contact is Sarty Gosh.\n\n" +
        "We look forward to a productive partnership.\n\n" +
        "Best regards,\n" +
        "Blue Lotus Consulting Corporation";
      
      MailApp.sendEmail({
        to: contactEmail,
        cc: "blccanada2026@gmail.com",
        subject: subject,
        body: body
      });
      
      logException("INFO", clientCode, "OnboardingSystemClient", 
        "Welcome email sent to " + contactEmail);
    } catch (emailErr) {
      logException("WARNING", clientCode, "OnboardingSystemClient", 
        "Welcome email failed: " + emailErr.message + 
        ". Send manually to " + contactEmail);
    }
    
    // -----------------------------------------------------------------------
    // STEP 8: Success — show summary
    // -----------------------------------------------------------------------
    var successMsg = "Client onboarded successfully!\n\n" +
      "CLIENT CODE: " + clientCode + "\n" +
      "COMPANY: " + clientName + "\n\n" +
      "WHAT WAS CREATED:\n" +
      "✓ CLIENT_MASTER row added\n" +
      "✓ Client Return Form created\n" +
      "✓ Form trigger set up\n" +
      "✓ Form dropdowns synced\n" +
      "✓ Welcome email sent to " + contactEmail + "\n\n" +
      "RETURN FORM URL:\n" + formUrl + "\n\n" +
      "STILL TO DO MANUALLY:\n" +
      "• Create the Google Sites portal page for " + clientName + "\n" +
      "• Paste the portal URL into CLIENT_MASTER col R\n" +
      "• Assign designers to this client in DESIGNER_MASTER col K\n" +
      "• Add name variants to DESIGNER_NAME_MAP if needed\n" +
      "• Notify Sarty that " + clientName + " is active";
    
    ui.alert("Onboarding Complete", successMsg, ui.ButtonSet.OK);
    
  } catch (err) {
    logException("ERROR", "NEW_CLIENT", "OnboardingSystemClient", 
      "Onboarding failed: " + err.message);
    ui.alert("Error", "Client onboarding failed: " + err.message + 
      "\n\nCheck EXCEPTIONS_LOG for details.", ui.ButtonSet.OK);
  }
}


// ============================================================================
// HELPER: Sync client return form dropdowns for all active clients
// Called from menu: BLC System → Setup Client Return Triggers
// ============================================================================
function setupClientReturnTriggersFromOnboarding() {
  var ui = SpreadsheetApp.getUi();
  
  try {
    var cmSheet = getSheet(CONFIG.sheets.clientMaster);
    var cmData = cmSheet.getDataRange().getValues();
    var triggersCreated = 0;
    var errors = [];
    
    for (var i = 1; i < cmData.length; i++) {
      var formId = cmData[i][CM.returnFormId - 1];
      var clientCode = cmData[i][CM.clientCode - 1];
      var active = cmData[i][CM.active - 1];
      
      if (active !== "Yes" || !formId) continue;
      
      try {
        var form = FormApp.openById(formId);
        
        // Check if trigger already exists
        var existingTriggers = ScriptApp.getProjectTriggers();
        var alreadyHasTrigger = false;
        for (var t = 0; t < existingTriggers.length; t++) {
          if (existingTriggers[t].getHandlerFunction() === "onClientReturnSubmit" &&
              existingTriggers[t].getTriggerSourceId() === formId) {
            alreadyHasTrigger = true;
            break;
          }
        }
        
        if (!alreadyHasTrigger) {
          ScriptApp.newTrigger("onClientReturnSubmit")
            .forForm(form)
            .onFormSubmit()
            .create();
          triggersCreated++;
        }
      } catch (formErr) {
        errors.push(clientCode + ": " + formErr.message);
      }
    }
    
    var msg = "Triggers setup complete.\n\n" +
      "New triggers created: " + triggersCreated + "\n";
    if (errors.length > 0) {
      msg += "\nErrors:\n" + errors.join("\n");
    }
    
    ui.alert("Client Return Triggers", msg, ui.ButtonSet.OK);
    
  } catch (err) {
    logException("ERROR", "TRIGGERS", "OnboardingSystemClient", 
      "Trigger setup failed: " + err.message);
    ui.alert("Error", "Trigger setup failed: " + err.message, ui.ButtonSet.OK);
  }
}


// ============================================================================
// PROMPT HELPERS
// ============================================================================

/**
 * Prompts for a required field. Returns null if user cancels.
 */
function promptRequired_(ui, title, message) {
  var response = ui.prompt(title, message, ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) {
    ui.alert("Cancelled", "Onboarding cancelled.", ui.ButtonSet.OK);
    return null;
  }
  var value = response.getResponseText().trim();
  if (!value) {
    ui.alert("Required Field", title + " is required. Onboarding cancelled.", ui.ButtonSet.OK);
    return null;
  }
  return value;
}

/**
 * Prompts for an optional field. Returns empty string if skipped.
 */
function promptOptional_(ui, title, message) {
  var response = ui.prompt(title, message, ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return "";
  return response.getResponseText().trim();
}

/**
 * Prompts for an optional field with a default value.
 */
function promptOptionalWithDefault_(ui, title, message, defaultValue) {
  var response = ui.prompt(title, message, ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return defaultValue;
  var value = response.getResponseText().trim();
  return value || defaultValue;
}