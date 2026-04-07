// ============================================================
// SopIntegration.js
// Blue Lotus Consulting Corporation
// SOP checklist email delivery and form URL management.
//
// Architecture:
//   - Each client has two SOP Google Forms: Designer checklist + QC checklist
//   - Form URLs are stored in CLIENT_MASTER cols 20 & 21
//   - On job allocation → email designer their pre-filled checklist link
//   - On Ready For QC → if SOP not marked done, send reminder + notify Sarty
//   - On first QC log entry → email reviewer their QC checklist link
//   - Sarty can manually mark SOP/QC checklist done from the BLC menu
//
// QC EXEMPT (FPO) jobs:
//   - No SOP email sent — job goes directly to Ready For Billing when complete
// ============================================================


// Columns added to CLIENT_MASTER (after existing col 19)
var CM_SOP = {
  designerSopFormUrl: 20,   // Google Form URL — designer checklist
  qcSopFormUrl:       21    // Google Form URL — QC checklist
};


// ─────────────────────────────────────────────────────────────
// MENU FUNCTION: Set SOP Form URLs per client
// BLC System → Set Client SOP Form URLs
// ─────────────────────────────────────────────────────────────

function setSopFormUrls() {
  var ui = SpreadsheetApp.getUi();

  var codeResp = ui.prompt(
    'Set Client SOP Form URLs',
    'Enter client code (e.g. SBS, ALBERTA TRUSS, MATIX-SK, NORSPAN-MB):',
    ui.ButtonSet.OK_CANCEL
  );
  if (codeResp.getSelectedButton() !== ui.Button.OK) return;
  var clientCode = codeResp.getResponseText().trim().toUpperCase();

  var designerUrlResp = ui.prompt(
    'Designer SOP Form URL — ' + clientCode,
    'Paste the Google Form URL for the DESIGNER checklist.\n(Leave blank to skip.)',
    ui.ButtonSet.OK_CANCEL
  );
  if (designerUrlResp.getSelectedButton() !== ui.Button.OK) return;
  var designerUrl = designerUrlResp.getResponseText().trim();

  var qcUrlResp = ui.prompt(
    'QC SOP Form URL — ' + clientCode,
    'Paste the Google Form URL for the QC checklist.\n(Leave blank to skip.)',
    ui.ButtonSet.OK_CANCEL
  );
  if (qcUrlResp.getSelectedButton() !== ui.Button.OK) return;
  var qcUrl = qcUrlResp.getResponseText().trim();

  var cmSheet = getSheet(CONFIG.sheets.clientMaster);
  var cmData  = cmSheet.getDataRange().getValues();

  for (var i = 1; i < cmData.length; i++) {
    if (String(cmData[i][0] || '').trim().toUpperCase() !== clientCode) continue;
    if (designerUrl) cmSheet.getRange(i + 1, CM_SOP.designerSopFormUrl).setValue(designerUrl);
    if (qcUrl)       cmSheet.getRange(i + 1, CM_SOP.qcSopFormUrl).setValue(qcUrl);
    SpreadsheetApp.flush();
    ui.alert('Done', 'SOP form URLs saved for ' + clientCode + '.', ui.ButtonSet.OK);
    logException('INFO', 'SYSTEM', 'setSopFormUrls', 'SOP URLs set for ' + clientCode);
    return;
  }

  ui.alert('Not Found', 'Client code "' + clientCode + '" not found in CLIENT_MASTER.', ui.ButtonSet.OK);
}


// ─────────────────────────────────────────────────────────────
// MENU FUNCTION: Manually mark SOP / QC checklist as submitted
// Used by Sarty until cross-spreadsheet trigger is built
// ─────────────────────────────────────────────────────────────

function markSopChecklistSubmitted() {
  var ui      = SpreadsheetApp.getUi();
  var resp    = ui.prompt('Mark SOP Checklist Submitted', 'Enter Job Number:', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var jobNumber = resp.getResponseText().trim().toUpperCase();
  _setChecklistFlag(jobNumber, CONFIG.masterCols.sopChecklistSubmitted, 'SOP Checklist', ui);
}

function markQcChecklistSubmitted() {
  var ui      = SpreadsheetApp.getUi();
  var resp    = ui.prompt('Mark QC Checklist Submitted', 'Enter Job Number:', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var jobNumber = resp.getResponseText().trim().toUpperCase();
  _setChecklistFlag(jobNumber, CONFIG.masterCols.qcChecklistSubmitted, 'QC Checklist', ui);
}

function _setChecklistFlag(jobNumber, col, label, ui) {
  var jobRow = findJobRow(jobNumber);
  if (jobRow < 1) {
    ui.alert('Not found', 'Job ' + jobNumber + ' not found in MASTER.', ui.ButtonSet.OK);
    return;
  }
  var master = getSheet(CONFIG.sheets.masterJob);
  master.getRange(jobRow, col).setValue('Yes');
  master.getRange(jobRow, CONFIG.masterCols.lastUpdated).setValue(getTimestamp());
  master.getRange(jobRow, CONFIG.masterCols.lastUpdatedBy).setValue('Manual — ' + label);
  SpreadsheetApp.flush();
  ui.alert('Done', label + ' marked as submitted for job ' + jobNumber + '.', ui.ButtonSet.OK);
  logException('INFO', jobNumber, 'markChecklist', label + ' manually marked submitted');
}


// ─────────────────────────────────────────────────────────────
// EMAIL: Send SOP checklist link to designer on allocation
// ─────────────────────────────────────────────────────────────

function sendSopChecklistEmail_(jobNumber, designerName, clientCode) {
  try {
    var designerEmail = getDesignerEmail_(designerName);
    if (!designerEmail) {
      logException('WARNING', jobNumber, 'sendSopChecklistEmail_',
        'No email for designer ' + designerName + ' — SOP email skipped');
      return;
    }

    var formUrl = getClientSopFormUrl_(clientCode, false);
    if (!formUrl) {
      logException('WARNING', jobNumber, 'sendSopChecklistEmail_',
        'No Designer SOP form URL for client ' + clientCode + ' — SOP email skipped');
      return;
    }

    var subject = 'BLC | Action Required: SOP Checklist — Job ' + jobNumber;
    var body =
      '<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:560px;">' +
      '<h2 style="color:#1a73e8;margin-bottom:4px;">📋 SOP Checklist Required</h2>' +
      '<p style="color:#888;margin-top:0;font-size:12px;">BLC Job Management System</p>' +
      '<p>Hi <strong>' + designerName + '</strong>,</p>' +
      '<p>You have been allocated <strong>Job ' + jobNumber + '</strong> for client ' +
        '<strong>' + clientCode + '</strong>.</p>' +
      '<p>Before starting work, please complete the client SOP checklist:</p>' +
      '<p style="margin:24px 0;">' +
        '<a href="' + formUrl + '" style="background:#1a73e8;color:#fff;padding:12px 28px;' +
          'text-decoration:none;border-radius:4px;font-weight:bold;font-size:15px;' +
          'display:inline-block;">✅ Open SOP Checklist</a></p>' +
      '<table style="border-collapse:collapse;width:100%;max-width:400px;' +
        'border:1px solid #e0e0e0;border-radius:4px;margin-bottom:16px;">' +
      '<tr style="background:#f8f9fa;"><td style="padding:8px 12px;font-weight:bold;' +
        'color:#555;width:45%;border-bottom:1px solid #e0e0e0;">Job Number</td>' +
        '<td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;">' + jobNumber + '</td></tr>' +
      '<tr><td style="padding:8px 12px;font-weight:bold;color:#555;' +
        'border-bottom:1px solid #e0e0e0;">Your Name</td>' +
        '<td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;">' + designerName + '</td></tr>' +
      '<tr style="background:#f8f9fa;"><td style="padding:8px 12px;font-weight:bold;' +
        'color:#555;">Client</td>' +
        '<td style="padding:8px 12px;">' + clientCode + '</td></tr>' +
      '</table>' +
      '<p style="color:#c62828;font-weight:bold;">⚠️ Please complete before submitting for QC.</p>' +
      '<p style="font-size:12px;color:#aaa;margin-top:24px;">' +
        'Automated notification — do not reply.</p>' +
      '</div>';

    GmailApp.sendEmail(designerEmail, subject, '', {
      htmlBody: body,
      name:     'BLC Job System',
      from:     NOTIFICATION_EMAIL
    });

    logException('INFO', jobNumber, 'sendSopChecklistEmail_',
      'SOP email sent to ' + designerName + ' <' + designerEmail + '>');

  } catch (err) {
    logException('WARNING', jobNumber, 'sendSopChecklistEmail_',
      'SOP email failed: ' + err.message);
  }
}


// ─────────────────────────────────────────────────────────────
// EMAIL: Remind designer when they submit for QC without checklist
// ─────────────────────────────────────────────────────────────

function sendSopReminderEmail_(jobNumber, designerName, clientCode) {
  try {
    var designerEmail = getDesignerEmail_(designerName);
    if (!designerEmail) return;

    var formUrl = getClientSopFormUrl_(clientCode, false);
    if (!formUrl) return;

    var subject = '⚠️ BLC | SOP Checklist Not Submitted — Job ' + jobNumber;
    var body =
      '<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:560px;">' +
      '<h2 style="color:#e65100;margin-bottom:4px;">⚠️ SOP Checklist Missing</h2>' +
      '<p style="color:#888;margin-top:0;font-size:12px;">BLC Job Management System</p>' +
      '<p>Hi <strong>' + designerName + '</strong>,</p>' +
      '<p>Your job <strong>' + jobNumber + '</strong> has been submitted for QC, but your ' +
        '<strong>SOP checklist has not been submitted</strong>.</p>' +
      '<p>Your job will proceed — but please complete the checklist now. ' +
        'If you skip this, the accountability is on record.</p>' +
      '<p style="margin:24px 0;">' +
        '<a href="' + formUrl + '" style="background:#e65100;color:#fff;padding:12px 28px;' +
          'text-decoration:none;border-radius:4px;font-weight:bold;font-size:15px;' +
          'display:inline-block;">⚠️ Complete SOP Checklist Now</a></p>' +
      '<p style="color:#555;"><strong>Job Number:</strong> ' + jobNumber + '</p>' +
      '<p style="font-size:12px;color:#aaa;margin-top:24px;">' +
        'Automated notification — do not reply.</p>' +
      '</div>';

    GmailApp.sendEmail(designerEmail, subject, '', {
      htmlBody: body,
      name:     'BLC Job System',
      from:     NOTIFICATION_EMAIL
    });

    // Also alert Sarty so he can follow up
    var sartyEmail = getSartyEmail_();
    if (sartyEmail) {
      GmailApp.sendEmail(sartyEmail,
        '⚠️ SOP Missing: ' + jobNumber + ' (' + designerName + ')',
        designerName + ' submitted job ' + jobNumber +
          ' for QC without completing the SOP checklist. Please follow up.',
        { name: 'BLC Job System', from: NOTIFICATION_EMAIL }
      );
    }

  } catch (err) {
    logException('WARNING', jobNumber, 'sendSopReminderEmail_', 'Reminder failed: ' + err.message);
  }
}


// ─────────────────────────────────────────────────────────────
// EMAIL: Send QC checklist link when job enters QC queue
// Called from onDailyLogSubmit when Ready For QC = Yes
// ─────────────────────────────────────────────────────────────

function sendQcChecklistEmailToTeam_(jobNumber, clientCode) {
  try {
    var formUrl = getClientSopFormUrl_(clientCode, true);
    if (!formUrl) {
      logException('WARNING', jobNumber, 'sendQcChecklistEmailToTeam_',
        'No QC SOP form URL for client ' + clientCode + ' — QC checklist email skipped');
      return;
    }

    // Send to Sarty (PM) — he'll pass to the assigned TL
    var sartyEmail = getSartyEmail_();
    if (!sartyEmail) return;

    var subject = 'BLC | QC Checklist Required — Job ' + jobNumber;
    var body =
      '<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:560px;">' +
      '<h2 style="color:#2e7d32;margin-bottom:4px;">🔍 QC Checklist Required</h2>' +
      '<p style="color:#888;margin-top:0;font-size:12px;">BLC Job Management System</p>' +
      '<p><strong>Job ' + jobNumber + '</strong> (' + clientCode + ') has been submitted for QC.</p>' +
      '<p>Please ensure the reviewer completes the QC checklist before logging the outcome:</p>' +
      '<p style="margin:24px 0;">' +
        '<a href="' + formUrl + '" style="background:#2e7d32;color:#fff;padding:12px 28px;' +
          'text-decoration:none;border-radius:4px;font-weight:bold;font-size:15px;' +
          'display:inline-block;">🔍 Open QC Checklist</a></p>' +
      '<p style="color:#555;"><strong>Job Number:</strong> ' + jobNumber + '<br>' +
        '<strong>Client:</strong> ' + clientCode + '</p>' +
      '<p style="font-size:12px;color:#aaa;margin-top:24px;">' +
        'Automated notification — do not reply.</p>' +
      '</div>';

    GmailApp.sendEmail(sartyEmail, subject, '', {
      htmlBody: body,
      name:     'BLC Job System',
      from:     NOTIFICATION_EMAIL
    });

    logException('INFO', jobNumber, 'sendQcChecklistEmailToTeam_',
      'QC checklist email sent to ' + sartyEmail);

  } catch (err) {
    logException('WARNING', jobNumber, 'sendQcChecklistEmailToTeam_',
      'QC checklist email failed: ' + err.message);
  }
}


// ─────────────────────────────────────────────────────────────
// EMAIL: Send QC checklist directly to reviewer (from onQCLogSubmit)
// ─────────────────────────────────────────────────────────────

function sendQcChecklistEmail_(jobNumber, reviewerName, clientCode) {
  try {
    var reviewerEmail = getDesignerEmail_(reviewerName);
    if (!reviewerEmail) {
      logException('WARNING', jobNumber, 'sendQcChecklistEmail_',
        'No email for reviewer ' + reviewerName + ' — QC checklist email skipped');
      return;
    }

    var formUrl = getClientSopFormUrl_(clientCode, true);
    if (!formUrl) {
      logException('WARNING', jobNumber, 'sendQcChecklistEmail_',
        'No QC SOP form URL for client ' + clientCode + ' — QC checklist email skipped');
      return;
    }

    var subject = '⚠️ BLC | QC Checklist Not Submitted — Job ' + jobNumber;
    var body =
      '<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:560px;">' +
      '<h2 style="color:#e65100;margin-bottom:4px;">⚠️ QC Checklist Missing</h2>' +
      '<p style="color:#888;margin-top:0;font-size:12px;">BLC Job Management System</p>' +
      '<p>Hi <strong>' + reviewerName + '</strong>,</p>' +
      '<p>You have logged QC work on <strong>Job ' + jobNumber + '</strong>, but the ' +
        '<strong>QC checklist has not been submitted</strong>.</p>' +
      '<p>Please complete it — your accountability is on record if skipped:</p>' +
      '<p style="margin:24px 0;">' +
        '<a href="' + formUrl + '" style="background:#e65100;color:#fff;padding:12px 28px;' +
          'text-decoration:none;border-radius:4px;font-weight:bold;font-size:15px;' +
          'display:inline-block;">⚠️ Complete QC Checklist Now</a></p>' +
      '<table style="border-collapse:collapse;width:100%;max-width:400px;' +
        'border:1px solid #e0e0e0;border-radius:4px;">' +
      '<tr style="background:#f8f9fa;"><td style="padding:8px 12px;font-weight:bold;' +
        'color:#555;width:45%;border-bottom:1px solid #e0e0e0;">Job Number</td>' +
        '<td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;">' + jobNumber + '</td></tr>' +
      '<tr><td style="padding:8px 12px;font-weight:bold;color:#555;">Reviewer</td>' +
        '<td style="padding:8px 12px;">' + reviewerName + '</td></tr>' +
      '</table>' +
      '<p style="font-size:12px;color:#aaa;margin-top:24px;">' +
        'Automated notification — do not reply.</p>' +
      '</div>';

    GmailApp.sendEmail(reviewerEmail, subject, '', {
      htmlBody: body,
      name:     'BLC Job System',
      from:     NOTIFICATION_EMAIL
    });

    logException('INFO', jobNumber, 'sendQcChecklistEmail_',
      'QC checklist reminder sent to ' + reviewerName + ' <' + reviewerEmail + '>');

  } catch (err) {
    logException('WARNING', jobNumber, 'sendQcChecklistEmail_',
      'QC checklist email failed: ' + err.message);
  }
}


// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function getDesignerEmail_(designerName) {
  try {
    var data = getSheetData(CONFIG.sheets.designerMaster);
    var normTarget = normaliseDesignerName(designerName);
    for (var i = 1; i < data.length; i++) {
      var rowName = String(data[i][1] || '').trim();
      if (normaliseDesignerName(rowName) === normTarget || rowName === designerName.trim()) {
        return String(data[i][2] || '').trim(); // col 3 = Email
      }
    }
    return '';
  } catch (err) {
    return '';
  }
}

function getSartyEmail_() {
  try {
    var data = getSheetData(CONFIG.sheets.designerMaster);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][4] || '').trim() === 'Project Manager') {
        return String(data[i][2] || '').trim(); // col 3 = Email
      }
    }
    return '';
  } catch (err) {
    return '';
  }
}

function getClientSopFormUrl_(clientCode, isQc) {
  try {
    var data = getSheetData(CONFIG.sheets.clientMaster);
    var colIdx = (isQc ? CM_SOP.qcSopFormUrl : CM_SOP.designerSopFormUrl) - 1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0] || '').trim().toUpperCase() === clientCode.toUpperCase()) {
        return String(data[i][colIdx] || '').trim();
      }
    }
    return '';
  } catch (err) {
    return '';
  }
}
