// ============================================================
// BLC PAYROLL ENGINE — PayrollEngine.js
// Monthly payroll: base pay + supervisor bonus + pay stubs
// + payment report. Quarterly/annual bonus is separate.
//
// DATA SOURCES:
//   Hours    : MASTER_JOB_DATABASE (Design_Hours_Total, QC_Hours_Total)
//   Excluded : Rework_Hours_Major + Rework_Hours_Minor (not paid)
//   Rates    : STAFF_ROSTER (Hourly_Rate) → DESIGNER_MASTER fallback
//   Hierarchy: STAFF_ROSTER (Supervisor_ID chain walk for bonus)
//
// PAYROLL RULES:
//   1. All hours in billing period are paid (job need not be complete)
//   2. Rework_Hours_Major + Rework_Hours_Minor are EXCLUDED from pay
//   3. QC Reviewer hours generate NO supervisor bonus for anyone
//   4. Supervisor bonus = ₹25/hr, walks the full hierarchy chain
//      Designer → TL → PM each get ₹25 per designer paid hour
//   5. Pay period = monthly (matches Billing_Period in MASTER)
//   6. QC hours paid at same rate as design hours (if Pay_QC = Yes)
//
// SHEETS CREATED AUTOMATICALLY:
//   PAYROLL_LEDGER, PAYROLL_BONUS_LEDGER, PAYROLL_APPROVAL_LOG
//
// EMAIL:
//   Pay stubs are sent from blccanada2026@gmail.com.
//   IMPORTANT: That address must be added as a Gmail "Send As"
//   alias in the account running this script (Settings → Accounts).
// ============================================================

var PAYROLL_CONFIG = {
  supervisorBonusRate : 25,                         // INR per paid hour of direct report
  fromEmail           : 'blccanada2026@gmail.com',
  approvalEmail       : 'raj.nair@bluelotuscanada.ca',
  sheets: {
    payrollLedger  : 'PAYROLL_LEDGER',
    bonusLedger    : 'PAYROLL_BONUS_LEDGER',
    approvalLog    : 'PAYROLL_APPROVAL_LOG',
    staffRoster    : 'STAFF_ROSTER',
    ratesSnapshot  : 'PAYROLL_RATES_SNAPSHOT'
  }
};

// STAFF_ROSTER: row 0 = title, row 1 = headers, row 2+ = data (0-based)
var SR = {
  recordId   : 0,   // A Record_ID
  designerId : 1,   // B Designer_ID
  name       : 2,   // C Designer_Name
  role       : 3,   // D Role
  clientCode : 4,   // E Client_Code
  supId      : 5,   // F Supervisor_ID
  supName    : 6,   // G Supervisor_Name
  payDesign  : 7,   // H Pay_Design
  payQC      : 8,   // I Pay_QC
  bonusElig  : 9,   // J Supervisor_Bonus_Eligible
  rate       : 10,  // K Hourly_Rate
  effFrom    : 11,  // L Effective_From
  effTo      : 12,  // M Effective_To
  status     : 13   // N Status
};

// PAYROLL_LEDGER columns (1-based, for getRange)
var PL = {
  month          : 1,
  designerId     : 2,
  designerName   : 3,
  role           : 4,
  designHours    : 5,
  qcHours        : 6,
  reworkExcluded : 7,
  totalPaidHours : 8,
  rateINR        : 9,
  basePay        : 10,
  bonusHours     : 11,
  bonusINR       : 12,
  totalPay       : 13,
  status         : 14,  // Draft | Stub_Sent | Confirmed | Paid
  stubSentAt     : 15,
  confirmed      : 16,
  confirmedAt    : 17,
  runTimestamp   : 18
};

// PAYROLL_BONUS_LEDGER columns (1-based)
var PB = {
  month        : 1,
  supId        : 2,
  supName      : 3,
  designerId   : 4,
  designerName : 5,
  hours        : 6,
  bonusINR     : 7,
  runTimestamp : 8
};

// PAYROLL_APPROVAL_LOG columns (1-based)
var PA = {
  requestId    : 1,
  requestType  : 2,
  requestedBy  : 3,
  requestedAt  : 4,
  designerId   : 5,
  designerName : 6,
  oldSupId     : 7,
  oldSupName   : 8,
  newSupId     : 9,
  newSupName   : 10,
  effectiveDate: 11,
  status       : 12,  // Pending | Approved | Rejected
  reviewedBy   : 13,
  reviewedAt   : 14,
  notes        : 15
};


// ============================================================
// HELPER: Read a ledger Month cell safely.
// Google Sheets auto-converts "February 2026" to a Date object.
// This function returns the canonical "Month YYYY" string either way.
// ============================================================
function ledgerMonthStr_(val) {
  if (val instanceof Date) {
    var months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
    return months[val.getMonth()] + ' ' + val.getFullYear();
  }
  return String(val || '').trim();
}


// ============================================================
// ENSURE PAYROLL SHEETS EXIST
// ============================================================
function ensurePayrollSheets_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  function makeSheet(name, headers) {
    if (ss.getSheetByName(name)) return;
    var sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setBackground('#1a73e8')
      .setFontColor('#fff')
      .setFontWeight('bold');
    sh.setFrozenRows(1);
    for (var c = 1; c <= headers.length; c++) sh.autoResizeColumn(c);
  }

  makeSheet(PAYROLL_CONFIG.sheets.payrollLedger, [
    'Month', 'Designer_ID', 'Designer_Name', 'Role',
    'Design_Hours', 'QC_Hours', 'Rework_Excluded', 'Total_Paid_Hours',
    'Rate_INR', 'Base_Pay_INR', 'Bonus_Hours', 'Bonus_INR',
    'Total_Pay_INR', 'Status', 'Stub_Sent_At',
    'Confirmed', 'Confirmed_At', 'Run_Timestamp'
  ]);

  makeSheet(PAYROLL_CONFIG.sheets.bonusLedger, [
    'Month', 'Supervisor_ID', 'Supervisor_Name',
    'Designer_ID', 'Designer_Name',
    'Hours_Counted', 'Bonus_INR', 'Run_Timestamp'
  ]);

  makeSheet(PAYROLL_CONFIG.sheets.approvalLog, [
    'Request_ID', 'Request_Type', 'Requested_By', 'Requested_At',
    'Designer_ID', 'Designer_Name',
    'Old_Supervisor_ID', 'Old_Supervisor_Name',
    'New_Supervisor_ID', 'New_Supervisor_Name',
    'Effective_Date', 'Status', 'Reviewed_By', 'Reviewed_At', 'Notes'
  ]);
}


// ============================================================
// BUILD DESIGNER PROFILE MAP FROM STAFF_ROSTER
// Returns a map keyed by normalised designer name:
//   { 'Sarty Gosh': { designerId, role, rate, payQC,
//                     bonusEligible, supId, supName }, ... }
// Also builds _byId: { 'SGO': { name, profile } }
// Multi-client rows for the same designer are deduplicated —
// rate / role / supervisor must be consistent across clients.
// ============================================================
function buildDesignerProfileMap_() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PAYROLL_CONFIG.sheets.staffRoster);
  if (!sheet) throw new Error('STAFF_ROSTER sheet not found. Cannot run payroll.');

  var data = sheet.getDataRange().getValues();
  var map  = {};      // by normalised name
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  for (var i = 2; i < data.length; i++) {   // row 0 = title, row 1 = headers
    var row    = data[i];
    var status = String(row[SR.status] || '').trim().toUpperCase();
    if (status !== 'ACTIVE') continue;

    // Skip rows whose Effective_To has passed
    var effTo = row[SR.effTo];
    if (effTo && effTo !== '') {
      var effToDate = new Date(effTo);
      effToDate.setHours(0, 0, 0, 0);
      if (effToDate < today) continue;
    }

    var rawName  = String(row[SR.name] || '').trim();
    var normName = normaliseDesignerName(rawName);
    if (!normName) continue;

    // First active row for this designer wins
    if (map[normName]) continue;

    map[normName] = {
      designerId    : String(row[SR.designerId] || '').trim(),
      role          : String(row[SR.role]       || '').trim(),
      rate          : parseFloat(String(row[SR.rate] || '0').replace(/[₹,\s]/g, '')) || 0,
      payQC         : String(row[SR.payQC]      || '').trim().toLowerCase() === 'yes',
      bonusEligible : String(row[SR.bonusElig]  || '').trim().toLowerCase() === 'yes',
      supId         : String(row[SR.supId]      || '').trim(),
      supName       : String(row[SR.supName]    || '').trim()
    };
  }

  // Build reverse lookup by Designer_ID
  map._byId = {};
  for (var n in map) {
    if (n === '_byId') continue;
    var id = map[n].designerId;
    if (id) map._byId[id] = { name: n, profile: map[n] };
  }

  return map;
}


// ============================================================
// AGGREGATE MASTER HOURS FOR A BILLING PERIOD
// Returns: { 'Designer Name': { designHours, qcHours, reworkHours } }
// Excludes Is_Test = 'Yes' rows.
// ============================================================
function getMasterHoursForPeriod_(billingPeriod) {
  var masterData = getSheetData(CONFIG.sheets.masterJob);
  var MJ         = CONFIG.masterCols;
  var hours      = {};

  // Convert "February 2026" → "2026-02" prefix for matching bi-monthly periods
  // e.g. "2026-02 | 1-15" and "2026-02 | 16-End" both belong to February 2026
  var monthNames = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
  var periodPrefix = '';
  for (var m = 0; m < monthNames.length; m++) {
    if (billingPeriod.indexOf(monthNames[m]) === 0) {
      var yearPart  = billingPeriod.replace(monthNames[m], '').trim();
      var monthNum  = m + 1;
      periodPrefix  = yearPart + '-' + (monthNum < 10 ? '0' + monthNum : String(monthNum));
      break;
    }
  }

  for (var i = 1; i < masterData.length; i++) {
    var row    = masterData[i];
    var period = String(row[MJ.billingPeriod - 1] || '').trim();
    var isTest = String(row[MJ.isTest        - 1] || '').trim();

    // Match exact string OR bi-monthly prefix (e.g. "2026-02 | 1-15")
    var match = (period === billingPeriod) ||
                (periodPrefix !== '' && period.indexOf(periodPrefix) === 0);
    if (!match)             continue;
    if (isTest === 'Yes')   continue;

    var name = normaliseDesignerName(row[MJ.designerName - 1]);
    if (!name) continue;

    var dH  = parseFloat(row[MJ.designHoursTotal  - 1]) || 0;
    var qH  = parseFloat(row[MJ.qcHoursTotal      - 1]) || 0;
    var rwM = parseFloat(row[MJ.reworkHoursMajor  - 1]) || 0;
    var rwm = parseFloat(row[MJ.reworkHoursMinor  - 1]) || 0;

    if (!hours[name]) hours[name] = { designHours: 0, qcHours: 0, reworkHours: 0 };
    hours[name].designHours  += dH;
    hours[name].qcHours      += qH;
    hours[name].reworkHours  += (rwM + rwm);
  }

  return hours;
}


// ============================================================
// CALCULATE SUPERVISOR BONUSES
// For each designer (role != 'QC Reviewer'), walks up the
// STAFF_ROSTER hierarchy. Every Supervisor_Bonus_Eligible
// person in the chain gets ₹25 per paid hour.
//
// Example chain: Designer → TL → PM
//   Designer logs 10 hrs → TL gets ₹250, PM gets ₹250
//   TL logs 5 hrs design → PM gets ₹125
//   QC Reviewer logs any hrs → nobody gets bonus
//
// Returns: { 'Supervisor Name': { supId, totalBonusHours,
//   totalBonusINR, breakdown: [{designerId,designerName,hours,bonusINR}] } }
// ============================================================
function calculateSupervisorBonuses_(designerPaidHours, profileMap) {
  var bonuses = {};

  for (var name in designerPaidHours) {
    var profile   = profileMap[name];
    if (!profile) continue;
    if (profile.role === 'QC Reviewer') continue;

    var paidHours = designerPaidHours[name];
    if (paidHours <= 0) continue;

    // Walk up the chain
    var currentId   = profile.supId;
    var loopGuard   = 0;

    while (currentId && loopGuard < 5) {
      loopGuard++;
      var supEntry = profileMap._byId[currentId];
      if (!supEntry) break;

      var supName    = supEntry.name;
      var supProfile = supEntry.profile;

      if (supProfile.bonusEligible) {
        var bonusAmt = paidHours * PAYROLL_CONFIG.supervisorBonusRate;

        if (!bonuses[supName]) {
          bonuses[supName] = {
            supId          : currentId,
            totalBonusHours: 0,
            totalBonusINR  : 0,
            breakdown      : []
          };
        }
        bonuses[supName].totalBonusHours += paidHours;
        bonuses[supName].totalBonusINR   += bonusAmt;
        bonuses[supName].breakdown.push({
          designerId   : profile.designerId,
          designerName : name,
          hours        : paidHours,
          bonusINR     : bonusAmt
        });
      }

      // Move up one level
      currentId = supProfile.supId;
    }
  }

  return bonuses;
}


// ============================================================
// SNAPSHOT RATES USED IN THIS RUN
// ============================================================
function snapshotPayrollRates_(billingPeriod, profileMap, timestamp) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PAYROLL_CONFIG.sheets.ratesSnapshot);
  if (!sheet) return;

  var rows = [];
  for (var name in profileMap) {
    if (name === '_byId') continue;
    rows.push([billingPeriod, name, profileMap[name].rate, timestamp]);
  }
  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
  }
}


// ============================================================
// MAIN: RUN MONTHLY PAYROLL
// ============================================================
// billingPeriod must match EXACTLY what is in MASTER.Billing_Period
// e.g. "March 2026". Prompts if not passed.
// Safe to re-run — asks before overwriting existing data.
// ============================================================
function runMonthlyPayroll(billingPeriod) {
  var ui  = SpreadsheetApp.getUi();

  if (!billingPeriod) {
    var r = ui.prompt(
      'Run Monthly Payroll',
      'Enter the billing period exactly as stored in MASTER\n(e.g. "March 2026"):',
      ui.ButtonSet.OK_CANCEL
    );
    if (r.getSelectedButton() !== ui.Button.OK) return;
    billingPeriod = r.getResponseText().trim();
    if (!billingPeriod) return;
  }

  ensurePayrollSheets_();

  var ss         = SpreadsheetApp.getActiveSpreadsheet();
  var ledger     = ss.getSheetByName(PAYROLL_CONFIG.sheets.payrollLedger);
  var bonusSheet = ss.getSheetByName(PAYROLL_CONFIG.sheets.bonusLedger);
  var now        = new Date();

  // ── Guard: check if already run for this period ──────────
  var existingLedger = ledger.getDataRange().getValues();
  var alreadyExists  = false;
  for (var e = 1; e < existingLedger.length; e++) {
    if (ledgerMonthStr_(existingLedger[e][PL.month - 1]) === billingPeriod) {
      alreadyExists = true;
      break;
    }
  }
  if (alreadyExists) {
    var overwrite = ui.alert(
      'Payroll Already Run',
      'Payroll for "' + billingPeriod + '" already exists.\nOverwrite it?',
      ui.ButtonSet.YES_NO
    );
    if (overwrite !== ui.Button.YES) return;
    // Delete existing rows for this period (bottom-up)
    var ledgerData = ledger.getDataRange().getValues();
    for (var del = ledgerData.length - 1; del >= 1; del--) {
      if (ledgerMonthStr_(ledgerData[del][PL.month - 1]) === billingPeriod) {
        ledger.deleteRow(del + 1);
      }
    }
    var bonusData = bonusSheet.getDataRange().getValues();
    for (var delB = bonusData.length - 1; delB >= 1; delB--) {
      if (String(bonusData[delB][PB.month - 1]).trim() === billingPeriod) {
        bonusSheet.deleteRow(delB + 1);
      }
    }
  }

  // ── Load data ─────────────────────────────────────────────
  var profileMap = buildDesignerProfileMap_();
  var rawHours   = getMasterHoursForPeriod_(billingPeriod);

  var rawKeys = Object.keys(rawHours);
  if (rawKeys.length === 0) {
    ui.alert(
      '❌ No hours found for "' + billingPeriod + '"\n\n' +
      'Check the Billing_Period column in MASTER_JOB_DATABASE.\n' +
      'The value must match exactly (case-sensitive).'
    );
    return;
  }

  // Debug: confirm what was found before calculating
  Logger.log('runMonthlyPayroll: rawHours designers (' + rawKeys.length + '): ' + rawKeys.join(', '));
  Logger.log('runMonthlyPayroll: profileMap designers (' + Object.keys(profileMap).filter(function(k){return k!=='_byId';}).length + '): ' + Object.keys(profileMap).filter(function(k){return k!=='_byId';}).join(', '));

  // ── Calculate base pay per designer ──────────────────────
  var ledgerRows       = [];
  var designerPaidHrs  = {};  // name → paid hours (used for bonus calc)

  for (var name in rawHours) {
    var profile = profileMap[name];
    var h       = rawHours[name];

    var designH = h.designHours;
    var qcH     = (profile && profile.payQC) ? h.qcHours : 0;
    var reworkH = h.reworkHours;
    var paidH   = designH + qcH;

    // Fallback rate from DESIGNER_MASTER if not in STAFF_ROSTER
    var rate = 0;
    if (profile && profile.rate > 0) {
      rate = profile.rate;
    } else {
      var dmData = getSheetData(CONFIG.sheets.designerMaster);
      for (var dm = 1; dm < dmData.length; dm++) {
        if (String(dmData[dm][1] || '').trim() === name) {
          rate = parseFloat(String(dmData[dm][6] || '0').replace(/[₹,\s]/g, '')) || 0;
          break;
        }
      }
    }

    designerPaidHrs[name] = paidH;
    ledgerRows.push({
      name       : name,
      designerId : profile ? profile.designerId : '',
      role       : profile ? profile.role       : 'Unknown',
      designH    : designH,
      qcH        : qcH,
      reworkH    : reworkH,
      paidH      : paidH,
      rate       : rate,
      basePay    : paidH * rate,
      bonusHours : 0,   // filled after bonus calc
      bonusINR   : 0
    });
  }

  // ── Calculate supervisor bonuses ─────────────────────────
  var bonuses = calculateSupervisorBonuses_(designerPaidHrs, profileMap);

  // Add bonus figures to the relevant ledger rows
  for (var supName in bonuses) {
    for (var lr = 0; lr < ledgerRows.length; lr++) {
      if (ledgerRows[lr].name === supName) {
        ledgerRows[lr].bonusHours = bonuses[supName].totalBonusHours;
        ledgerRows[lr].bonusINR   = bonuses[supName].totalBonusINR;
        break;
      }
    }
  }

  // ── Write PAYROLL_LEDGER ──────────────────────────────────
  var ledgerOut = [];
  for (var o = 0; o < ledgerRows.length; o++) {
    var row = ledgerRows[o];
    ledgerOut.push([
      billingPeriod,
      row.designerId,
      row.name,
      row.role,
      row.designH,
      row.qcH,
      row.reworkH,
      row.paidH,
      row.rate,
      row.basePay,
      row.bonusHours,
      row.bonusINR,
      row.basePay + row.bonusINR,  // total pay
      'Draft',
      '', '', '',
      now
    ]);
  }
  if (ledgerOut.length > 0) {
    ledger.getRange(ledger.getLastRow() + 1, 1, ledgerOut.length, 18)
          .setValues(ledgerOut);
  }

  // ── Write PAYROLL_BONUS_LEDGER (full breakdown) ───────────
  var bonusOut = [];
  for (var bSup in bonuses) {
    var b = bonuses[bSup];
    for (var bd = 0; bd < b.breakdown.length; bd++) {
      var brow = b.breakdown[bd];
      bonusOut.push([
        billingPeriod, b.supId, bSup,
        brow.designerId, brow.designerName,
        brow.hours, brow.bonusINR, now
      ]);
    }
  }
  if (bonusOut.length > 0) {
    bonusSheet.getRange(bonusSheet.getLastRow() + 1, 1, bonusOut.length, 8)
              .setValues(bonusOut);
  }

  // ── Snapshot rates for audit ──────────────────────────────
  snapshotPayrollRates_(billingPeriod, profileMap, now);
  SpreadsheetApp.flush();

  logException('INFO', 'SYSTEM', 'runMonthlyPayroll',
    'Payroll draft: ' + billingPeriod +
    ' | Designers: ' + ledgerOut.length +
    ' | Supervisors with bonus: ' + Object.keys(bonuses).length);

  ui.alert(
    '✅ Payroll Draft Complete — ' + billingPeriod + '\n\n' +
    'Raw designers found : ' + rawKeys.length + '\n' +
    'Designers processed : ' + ledgerOut.length + '\n' +
    'Supervisors w/ bonus: ' + Object.keys(bonuses).length + '\n\n' +
    (ledgerOut.length === 0
      ? '⚠️ 0 rows written — check Apps Script Logs (View → Logs) for details.\n\n'
      : 'Status: DRAFT — review PAYROLL_LEDGER before sending stubs.\n\n') +
    'Next step → BLC Menu → Send Pay Stubs'
  );
}


// ============================================================
// SEND PAY STUBS
// Emails every Draft/Stub_Sent designer their breakdown.
// From: blccanada2026@gmail.com (must be a Gmail Send As alias).
// ============================================================
function sendPayStubs(billingPeriod) {
  var ui = SpreadsheetApp.getUi();
  if (!billingPeriod) {
    var r = ui.prompt('Send Pay Stubs',
      'Billing period (e.g. "March 2026"):',
      ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    billingPeriod = r.getResponseText().trim();
    if (!billingPeriod) return;
  }

  var ss     = SpreadsheetApp.getActiveSpreadsheet();
  var ledger = ss.getSheetByName(PAYROLL_CONFIG.sheets.payrollLedger);
  if (!ledger) { ui.alert('PAYROLL_LEDGER not found. Run payroll first.'); return; }

  var data   = ledger.getDataRange().getValues();
  var dmData = getSheetData(CONFIG.sheets.designerMaster);
  var now    = new Date();

  // Build email lookup from DESIGNER_MASTER
  var emailMap = {};
  for (var d = 1; d < dmData.length; d++) {
    var dName  = String(dmData[d][1] || '').trim();
    var dEmail = String(dmData[d][2] || '').trim();
    var dActive= String(dmData[d][8] || '').trim();
    if (dName && dEmail && dActive === 'Yes') emailMap[dName] = dEmail;
  }

  var sent = 0, skipped = 0;

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (ledgerMonthStr_(row[PL.month - 1]) !== billingPeriod) continue;

    var status = String(row[PL.status - 1]).trim();
    if (status !== 'Draft' && status !== 'Stub_Sent') continue;

    var name     = String(row[PL.designerName   - 1]).trim();
    var role     = String(row[PL.role           - 1]).trim();
    var designH  = Number(row[PL.designHours    - 1]) || 0;
    var qcH      = Number(row[PL.qcHours        - 1]) || 0;
    var reworkH  = Number(row[PL.reworkExcluded - 1]) || 0;
    var paidH    = Number(row[PL.totalPaidHours - 1]) || 0;
    var rate     = Number(row[PL.rateINR        - 1]) || 0;
    var basePay  = Number(row[PL.basePay        - 1]) || 0;
    var bonusH   = Number(row[PL.bonusHours     - 1]) || 0;
    var bonusINR = Number(row[PL.bonusINR       - 1]) || 0;
    var totalPay = Number(row[PL.totalPay       - 1]) || 0;

    var email = emailMap[name];
    if (!email) {
      logException('WARNING', name, 'sendPayStubs', 'No email found — stub skipped');
      skipped++;
      continue;
    }

    var firstName = name.split(' ')[0];
    var bonusRow  = bonusINR > 0
      ? '<tr><td style="padding:6px 10px;">Supervisor Bonus (' +
          bonusH.toFixed(1) + ' hrs × ₹' + PAYROLL_CONFIG.supervisorBonusRate + ')</td>' +
          '<td style="padding:6px 10px;text-align:right;">₹' + bonusINR.toFixed(2) + '</td></tr>'
      : '';
    var qcRow = qcH > 0
      ? '<tr><td style="padding:6px 10px;">QC Hours</td>' +
          '<td style="padding:6px 10px;text-align:right;">' + qcH.toFixed(2) + ' hrs</td></tr>'
      : '';
    var reworkRow = reworkH > 0
      ? '<tr style="color:#999;"><td style="padding:6px 10px;">Rework Hours (excluded from pay)</td>' +
          '<td style="padding:6px 10px;text-align:right;">−' + reworkH.toFixed(2) + ' hrs</td></tr>'
      : '';

    var html =
      '<div style="font-family:Arial,sans-serif;max-width:540px;margin:0 auto;' +
      'border:1px solid #e0e0e0;border-radius:6px;overflow:hidden;">' +

      '<div style="background:#1a73e8;padding:20px 24px;">' +
      '<h2 style="color:#fff;margin:0;font-size:18px;">BLC Pay Statement</h2>' +
      '<p style="color:#c8dcff;margin:4px 0 0;">Period: ' + billingPeriod + '</p>' +
      '</div>' +

      '<div style="padding:20px 24px;">' +
      '<p>Hi ' + firstName + ',</p>' +
      '<p>Please find your pay breakdown for <strong>' + billingPeriod + '</strong> below. ' +
      'Reply to this email to confirm, or flag any discrepancy.</p>' +

      '<table style="width:100%;border-collapse:collapse;margin:16px 0;">' +

      '<tr style="background:#f0f4ff;">' +
      '<td style="padding:6px 10px;font-weight:bold;">Item</td>' +
      '<td style="padding:6px 10px;text-align:right;font-weight:bold;">Detail</td>' +
      '</tr>' +

      '<tr><td style="padding:6px 10px;">Design Hours</td>' +
      '<td style="padding:6px 10px;text-align:right;">' + designH.toFixed(2) + ' hrs</td></tr>' +

      qcRow + reworkRow +

      '<tr style="background:#f8f8f8;font-weight:bold;">' +
      '<td style="padding:6px 10px;">Total Paid Hours</td>' +
      '<td style="padding:6px 10px;text-align:right;">' + paidH.toFixed(2) + ' hrs</td></tr>' +

      '<tr><td style="padding:6px 10px;">Hourly Rate</td>' +
      '<td style="padding:6px 10px;text-align:right;">₹' + rate + '/hr</td></tr>' +

      '<tr><td style="padding:6px 10px;">Base Pay</td>' +
      '<td style="padding:6px 10px;text-align:right;">₹' + basePay.toFixed(2) + '</td></tr>' +

      bonusRow +

      '<tr style="background:#e8f5e9;">' +
      '<td style="padding:10px;font-weight:bold;font-size:15px;">Total Pay</td>' +
      '<td style="padding:10px;text-align:right;font-size:15px;color:#2e7d32;font-weight:bold;">' +
      '₹' + totalPay.toFixed(2) + '</td></tr>' +

      '</table>' +

      '<p style="font-size:13px;">Please <strong>reply to confirm</strong> this statement is correct.<br>' +
      'If there is an error, reply with details and we will review before processing payment.</p>' +

      '<p style="font-size:11px;color:#aaa;margin-top:16px;">' +
      'Blue Lotus Consulting Corporation — Automated Payroll System</p>' +
      '</div></div>';

    try {
      GmailApp.sendEmail(
        email,
        'BLC Pay Statement — ' + billingPeriod + ' — Please Confirm',
        'Please enable HTML to view your pay statement.',
        { htmlBody: html, name: 'BLC Payroll', from: PAYROLL_CONFIG.fromEmail }
      );
      ledger.getRange(i + 1, PL.status,    1, 1).setValue('Stub_Sent');
      ledger.getRange(i + 1, PL.stubSentAt,1, 1).setValue(now);
      sent++;
    } catch (err) {
      logException('ERROR', name, 'sendPayStubs', 'Email failed: ' + err.message);
      skipped++;
    }
  }

  SpreadsheetApp.flush();
  logException('INFO', 'SYSTEM', 'sendPayStubs',
    billingPeriod + ' | Sent: ' + sent + ' | Skipped: ' + skipped);

  ui.alert(
    '✅ Pay stubs sent: ' + sent + '\n' +
    'Skipped (no email): ' + skipped + '\n\n' +
    'Once designers confirm, run:\nBLC Menu → Mark Pay Stub Confirmed\n' +
    'Then: BLC Menu → Generate Payment Report'
  );
}


// ============================================================
// MARK PAY STUB CONFIRMED (admin action when designer replies)
// ============================================================
function markPayStubConfirmed() {
  var ui = SpreadsheetApp.getUi();

  var nr = ui.prompt('Mark Confirmed',
    'Designer name (exactly as in PAYROLL_LEDGER):',
    ui.ButtonSet.OK_CANCEL);
  if (nr.getSelectedButton() !== ui.Button.OK) return;
  var targetName = nr.getResponseText().trim();

  var pr = ui.prompt('Mark Confirmed',
    'Billing period (e.g. "March 2026"):',
    ui.ButtonSet.OK_CANCEL);
  if (pr.getSelectedButton() !== ui.Button.OK) return;
  var billingPeriod = pr.getResponseText().trim();

  var ss     = SpreadsheetApp.getActiveSpreadsheet();
  var ledger = ss.getSheetByName(PAYROLL_CONFIG.sheets.payrollLedger);
  if (!ledger) { ui.alert('PAYROLL_LEDGER not found.'); return; }

  var data  = ledger.getDataRange().getValues();
  var now   = new Date();
  var found = false;

  for (var i = 1; i < data.length; i++) {
    if (ledgerMonthStr_(data[i][PL.month - 1]) === billingPeriod &&
        String(data[i][PL.designerName - 1]).trim() === targetName) {
      ledger.getRange(i + 1, PL.confirmed,   1, 1).setValue('Yes');
      ledger.getRange(i + 1, PL.confirmedAt, 1, 1).setValue(now);
      ledger.getRange(i + 1, PL.status,      1, 1).setValue('Confirmed');
      found = true;
      break;
    }
  }

  SpreadsheetApp.flush();
  ui.alert(found
    ? '✅ ' + targetName + ' confirmed for ' + billingPeriod
    : '❌ Not found: ' + targetName + ' / ' + billingPeriod + '\n\nCheck spelling matches PAYROLL_LEDGER exactly.');
}


// ============================================================
// GENERATE PAYMENT REPORT
// Creates a PAY_REPORT_<PERIOD> tab showing all designers,
// confirmed and pending. Grand total of confirmed amounts.
// This is your "ready to pay" list for OFX / bank transfer.
// ============================================================
function generatePaymentReport(billingPeriod) {
  var ui = SpreadsheetApp.getUi();
  if (!billingPeriod) {
    var r = ui.prompt('Generate Payment Report',
      'Billing period (e.g. "March 2026"):',
      ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    billingPeriod = r.getResponseText().trim();
    if (!billingPeriod) return;
  }

  var ss     = SpreadsheetApp.getActiveSpreadsheet();
  var ledger = ss.getSheetByName(PAYROLL_CONFIG.sheets.payrollLedger);
  if (!ledger) { ui.alert('PAYROLL_LEDGER not found. Run payroll first.'); return; }

  var data      = ledger.getDataRange().getValues();
  var confirmed = [];
  var pending   = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (ledgerMonthStr_(row[PL.month - 1]) !== billingPeriod) continue;

    var status = String(row[PL.status - 1]).trim();
    var entry  = {
      id      : String(row[PL.designerId     - 1]).trim(),
      name    : String(row[PL.designerName   - 1]).trim(),
      role    : String(row[PL.role           - 1]).trim(),
      paidH   : Number(row[PL.totalPaidHours - 1]) || 0,
      basePay : Number(row[PL.basePay        - 1]) || 0,
      bonus   : Number(row[PL.bonusINR       - 1]) || 0,
      total   : Number(row[PL.totalPay       - 1]) || 0,
      status  : status
    };

    if (status === 'Confirmed') confirmed.push(entry);
    else                        pending.push(entry);
  }

  if (confirmed.length === 0 && pending.length === 0) {
    ui.alert('No payroll data found for: ' + billingPeriod);
    return;
  }

  // ── Create / reset report tab ────────────────────────────
  var tabName = 'PAY_REPORT_' + billingPeriod.replace(/\s+/g, '_').toUpperCase();
  var report  = ss.getSheetByName(tabName);
  if (!report) report = ss.insertSheet(tabName);
  else report.clearContents().clearFormats();

  var now = new Date();

  // Title block
  report.getRange(1, 1).setValue('BLC Payment Report — ' + billingPeriod)
    .setFontWeight('bold').setFontSize(14);
  report.getRange(2, 1).setValue(
    'Generated: ' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm')
  );
  report.getRange(3, 1).setValue(
    'Confirmed: ' + confirmed.length + ' | Pending: ' + pending.length
  );

  // Header row at row 5
  var headers = ['Designer_ID', 'Designer_Name', 'Role',
                 'Total_Paid_Hours', 'Base_Pay_INR', 'Supervisor_Bonus_INR',
                 'Total_Pay_INR', 'Status'];
  report.getRange(5, 1, 1, headers.length)
    .setValues([headers])
    .setBackground('#1a73e8').setFontColor('#fff').setFontWeight('bold');

  var dataRows = [];
  var grandTotal = 0;

  // Confirmed first
  for (var c = 0; c < confirmed.length; c++) {
    var e = confirmed[c];
    dataRows.push([e.id, e.name, e.role, e.paidH, e.basePay, e.bonus, e.total, '✅ Confirmed']);
    grandTotal += e.total;
  }
  // Pending below
  for (var p = 0; p < pending.length; p++) {
    var pe = pending[p];
    dataRows.push([pe.id, pe.name, pe.role, pe.paidH, pe.basePay, pe.bonus, pe.total, '⏳ ' + pe.status]);
  }
  // Grand total row
  dataRows.push(['', 'GRAND TOTAL (Confirmed)', '', '', '', '', grandTotal, '']);

  report.getRange(6, 1, dataRows.length, 8).setValues(dataRows);

  // Bold grand total row + separator
  var totalRowIdx = 6 + dataRows.length - 1;
  report.getRange(totalRowIdx, 1, 1, 8)
    .setBackground('#e8f5e9').setFontWeight('bold');

  // Shade pending rows
  for (var pr2 = confirmed.length; pr2 < confirmed.length + pending.length; pr2++) {
    report.getRange(6 + pr2, 1, 1, 8).setBackground('#fff8e1');
  }

  for (var col = 1; col <= 8; col++) report.autoResizeColumn(col);
  report.setFrozenRows(5);
  SpreadsheetApp.flush();

  logException('INFO', 'SYSTEM', 'generatePaymentReport',
    billingPeriod + ' | Confirmed: ₹' + grandTotal.toFixed(2));

  ui.alert(
    '✅ Payment Report Generated\n\n' +
    'Tab: ' + tabName + '\n' +
    'Confirmed: ' + confirmed.length + ' designers\n' +
    'Pending:   ' + pending.length + '\n' +
    'Grand Total (confirmed): ₹' + grandTotal.toFixed(2) + '\n\n' +
    (pending.length > 0
      ? '⚠️ ' + pending.length + ' designers have not yet confirmed.\nThey appear in yellow — do not pay until confirmed.'
      : '✅ All confirmed — ready to process payment.')
  );
}


// ============================================================
// SUPERVISOR CHANGE REQUEST (submitted via portal by Sarty)
// Logs a pending request to PAYROLL_APPROVAL_LOG.
// Sends approval email to Raj.
// Called from the web app (doGet → intake portal).
// ============================================================
function submitSupervisorChangeRequest(requestData) {
  // requestData: { requestedBy, designerId, designerName,
  //   newSupId, newSupName, effectiveDate }
  ensurePayrollSheets_();

  var ss     = SpreadsheetApp.getActiveSpreadsheet();
  var log    = ss.getSheetByName(PAYROLL_CONFIG.sheets.approvalLog);
  var now    = new Date();
  var reqId  = 'SCR-' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd') +
               '-' + Math.floor(Math.random() * 9000 + 1000);

  // Find current supervisor from STAFF_ROSTER
  var profileMap = buildDesignerProfileMap_();
  var profile    = profileMap[requestData.designerName] ||
                   (profileMap._byId[requestData.designerId]
                     ? profileMap[profileMap._byId[requestData.designerId].name]
                     : null);
  var oldSupId   = profile ? profile.supId   : '';
  var oldSupName = profile ? profile.supName : '';

  log.appendRow([
    reqId,
    'SUPERVISOR_CHANGE',
    requestData.requestedBy,
    now,
    requestData.designerId,
    requestData.designerName,
    oldSupId,
    oldSupName,
    requestData.newSupId,
    requestData.newSupName,
    requestData.effectiveDate,
    'Pending',
    '', '', ''
  ]);

  // Notify Raj for approval
  var approvalHtml =
    '<p>A supervisor change request has been submitted and requires your approval.</p>' +
    '<table style="border-collapse:collapse;width:100%;">' +
    '<tr><td style="padding:6px;font-weight:bold;">Designer</td><td style="padding:6px;">' + requestData.designerName + ' (' + requestData.designerId + ')</td></tr>' +
    '<tr><td style="padding:6px;font-weight:bold;">Current Supervisor</td><td style="padding:6px;">' + (oldSupName || 'None') + '</td></tr>' +
    '<tr><td style="padding:6px;font-weight:bold;">New Supervisor</td><td style="padding:6px;">' + requestData.newSupName + ' (' + requestData.newSupId + ')</td></tr>' +
    '<tr><td style="padding:6px;font-weight:bold;">Effective Date</td><td style="padding:6px;">' + requestData.effectiveDate + '</td></tr>' +
    '<tr><td style="padding:6px;font-weight:bold;">Requested By</td><td style="padding:6px;">' + requestData.requestedBy + '</td></tr>' +
    '<tr><td style="padding:6px;font-weight:bold;">Request ID</td><td style="padding:6px;">' + reqId + '</td></tr>' +
    '</table>' +
    '<p>To approve: BLC Menu → Approve Supervisor Change → enter Request ID: <strong>' + reqId + '</strong></p>';

  try {
    GmailApp.sendEmail(
      PAYROLL_CONFIG.approvalEmail,
      'Supervisor Change Approval Required — ' + requestData.designerName,
      'Please enable HTML.',
      { htmlBody: approvalHtml, name: 'BLC System' }
    );
  } catch (e) {
    logException('WARNING', 'SYSTEM', 'submitSupervisorChangeRequest',
      'Approval email failed: ' + e.message);
  }

  logException('INFO', requestData.designerId, 'submitSupervisorChangeRequest',
    'Request ' + reqId + ' submitted by ' + requestData.requestedBy);

  return reqId;
}


// ============================================================
// APPROVE SUPERVISOR CHANGE (Raj approves from BLC menu)
// Updates STAFF_ROSTER: sets Effective_To on old row,
// adds new row with new supervisor from Effective_Date.
// ============================================================
function approveSupervisorChange() {
  var ui = SpreadsheetApp.getUi();

  var rr = ui.prompt('Approve Supervisor Change',
    'Enter Request ID (e.g. SCR-20260318-1234):',
    ui.ButtonSet.OK_CANCEL);
  if (rr.getSelectedButton() !== ui.Button.OK) return;
  var reqId = rr.getResponseText().trim();

  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var logSh   = ss.getSheetByName(PAYROLL_CONFIG.sheets.approvalLog);
  var rosterSh= ss.getSheetByName(PAYROLL_CONFIG.sheets.staffRoster);
  if (!logSh || !rosterSh) {
    ui.alert('Required sheets not found.'); return;
  }

  // Find the request
  var logData = logSh.getDataRange().getValues();
  var reqRow  = -1;
  var req     = null;
  for (var i = 1; i < logData.length; i++) {
    if (String(logData[i][PA.requestId - 1]).trim() === reqId) {
      reqRow = i + 1;
      req    = logData[i];
      break;
    }
  }
  if (!req) {
    ui.alert('Request ID not found: ' + reqId); return;
  }
  if (String(req[PA.status - 1]).trim() !== 'Pending') {
    ui.alert('This request has already been ' + req[PA.status - 1]); return;
  }

  var designerId   = String(req[PA.designerId   - 1]).trim();
  var designerName = String(req[PA.designerName - 1]).trim();
  var oldSupId     = String(req[PA.oldSupId     - 1]).trim();
  var newSupId     = String(req[PA.newSupId     - 1]).trim();
  var newSupName   = String(req[PA.newSupName   - 1]).trim();
  var effectDate   = req[PA.effectiveDate - 1];

  var confirm = ui.alert(
    'Confirm Approval',
    'Approve supervisor change?\n\n' +
    'Designer: '    + designerName + '\n' +
    'New Supervisor: ' + newSupName + ' (' + newSupId + ')\n' +
    'Effective: '   + effectDate,
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  var now      = new Date();
  var rosterData = rosterSh.getDataRange().getValues();

  // Find the designer's current active row and set Effective_To
  var templateRow = null;
  for (var r = 2; r < rosterData.length; r++) {
    var row = rosterData[r];
    if (String(row[SR.designerId] || '').trim() === designerId &&
        String(row[SR.status]     || '').trim().toUpperCase() === 'ACTIVE' &&
        (!row[SR.effTo] || row[SR.effTo] === '')) {
      // Set Effective_To = effectDate on this row
      rosterSh.getRange(r + 1, SR.effTo + 1).setValue(effectDate);
      if (!templateRow) templateRow = row.slice();  // keep first for template
    }
  }

  // Add new row with new supervisor
  if (templateRow) {
    var newRecordId = 'SR-' + Math.floor(Math.random() * 0xFFFFFFFF).toString(16).toUpperCase().padStart(8, '0');
    var newRow      = templateRow.slice();
    newRow[SR.recordId]  = newRecordId;
    newRow[SR.supId]     = newSupId;
    newRow[SR.supName]   = newSupName;
    newRow[SR.effFrom]   = effectDate;
    newRow[SR.effTo]     = '';
    newRow[SR.changeType]= 'SUPERVISOR_CHANGE';
    // Pad to full column width if needed
    while (newRow.length < 18) newRow.push('');
    newRow[14] = 'SUPERVISOR_CHANGE';
    newRow[15] = 'Approved via portal — Request ' + reqId;
    newRow[16] = 'Raj Nair';
    newRow[17] = now;
    rosterSh.appendRow(newRow);
  }

  // Update approval log
  logSh.getRange(reqRow, PA.status,     1, 1).setValue('Approved');
  logSh.getRange(reqRow, PA.reviewedBy, 1, 1).setValue('Raj Nair');
  logSh.getRange(reqRow, PA.reviewedAt, 1, 1).setValue(now);

  SpreadsheetApp.flush();
  logException('INFO', designerId, 'approveSupervisorChange',
    'Request ' + reqId + ' approved. New supervisor: ' + newSupId);

  ui.alert(
    '✅ Supervisor change approved.\n\n' +
    'Designer: '       + designerName + '\n' +
    'New Supervisor: ' + newSupName + '\n' +
    'Effective: '      + effectDate + '\n\n' +
    'STAFF_ROSTER has been updated.\n' +
    'New payroll runs will use the new supervisor from the effective date.'
  );
}


// ============================================================
// SUPERVISOR CHANGE FORM DATA (called from web portal)
// Returns active designers + their current supervisors,
// plus list of eligible new supervisors.
// Only accessible to Project Manager and CEO roles.
// ============================================================
function getSupervisorChangeFormData() {
  try {
    var auth = authenticateInternalUser();
    if (!auth.authenticated) return { ok: false, error: auth.error };
    if (auth.role !== 'Project Manager' && auth.role !== 'CEO') {
      return { ok: false, error: 'Only Project Managers can submit supervisor changes.' };
    }

    var profileMap = buildDesignerProfileMap_();
    var dmData     = getSheetData(CONFIG.sheets.designerMaster);
    var designers  = [];
    var supervisors= [];

    for (var i = 1; i < dmData.length; i++) {
      var name   = String(dmData[i][1] || '').trim();
      var active = String(dmData[i][8] || '').trim();
      var role   = String(dmData[i][4] || '').trim();
      if (!name || active !== 'Yes') continue;

      var profile = profileMap[normaliseDesignerName(name)];
      designers.push({
        name:           name,
        designerId:     profile ? profile.designerId  : '',
        role:           role,
        currentSupName: profile ? profile.supName     : '—',
        currentSupId:   profile ? profile.supId       : ''
      });

      if (role === 'Team Leader' || role === 'Project Manager' || role === 'CEO') {
        supervisors.push({ name: name, designerId: profile ? profile.designerId : '' });
      }
    }

    designers.sort(function(a,b)  { return a.name.localeCompare(b.name); });
    supervisors.sort(function(a,b){ return a.name.localeCompare(b.name); });

    return { ok: true, requestedBy: auth.name, designers: designers, supervisors: supervisors };

  } catch (err) {
    return { ok: false, error: 'Server error: ' + err.message };
  }
}


// ============================================================
// PAYROLL SUMMARY (quick view — no output sheet)
// Logs a readable breakdown to the Exceptions log for review.
// ============================================================
function previewPayrollSummary() {
  var ui = SpreadsheetApp.getUi();
  var r  = ui.prompt('Preview Payroll Summary',
    'Billing period (e.g. "March 2026"):',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var billingPeriod = r.getResponseText().trim();
  if (!billingPeriod) return;

  var ss     = SpreadsheetApp.getActiveSpreadsheet();
  var ledger = ss.getSheetByName(PAYROLL_CONFIG.sheets.payrollLedger);
  if (!ledger) { ui.alert('PAYROLL_LEDGER not found. Run payroll first.'); return; }

  var data   = ledger.getDataRange().getValues();
  var lines  = ['PAYROLL SUMMARY — ' + billingPeriod, '─'.repeat(50)];
  var grandTotal = 0;

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (ledgerMonthStr_(row[PL.month - 1]) !== billingPeriod) continue;
    var name     = String(row[PL.designerName - 1]).trim();
    var paidH    = Number(row[PL.totalPaidHours - 1]) || 0;
    var basePay  = Number(row[PL.basePay - 1]) || 0;
    var bonus    = Number(row[PL.bonusINR - 1]) || 0;
    var total    = Number(row[PL.totalPay - 1]) || 0;
    var status   = String(row[PL.status - 1]).trim();
    grandTotal  += total;
    lines.push(
      name + ' | ' + paidH.toFixed(1) + ' hrs | ' +
      'Base ₹' + basePay.toFixed(0) +
      (bonus > 0 ? ' + Bonus ₹' + bonus.toFixed(0) : '') +
      ' = ₹' + total.toFixed(0) + ' [' + status + ']'
    );
  }
  lines.push('─'.repeat(50));
  lines.push('GRAND TOTAL: ₹' + grandTotal.toFixed(2));

  var result = lines.join('\n');
  Logger.log(result);
  ui.alert(result);
}


// ============================================================
// DIAGNOSE PAYROLL PERIOD
// Run this if payroll returns ₹0 or "no hours found".
// Shows you exactly what billing periods exist in MASTER
// and what hours are recorded.
// ============================================================
function diagnosePayrollPeriod() {
  var ui = SpreadsheetApp.getUi();
  var r  = ui.prompt('Diagnose Payroll Period',
    'Enter month to diagnose (e.g. "February 2026"):',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var billingPeriod = r.getResponseText().trim();
  if (!billingPeriod) return;

  try {
    var masterData = getSheetData(CONFIG.sheets.masterJob);
    var MJ         = CONFIG.masterCols;

    // Find all unique billing periods in MASTER
    var allPeriods = {};
    var matchRows  = [];

    // Build prefix same way getMasterHoursForPeriod_ does
    var monthNames = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];
    var periodPrefix = '';
    for (var m = 0; m < monthNames.length; m++) {
      if (billingPeriod.indexOf(monthNames[m]) === 0) {
        var yearPart = billingPeriod.replace(monthNames[m], '').trim();
        var monthNum = m + 1;
        periodPrefix = yearPart + '-' + (monthNum < 10 ? '0' + monthNum : String(monthNum));
        break;
      }
    }

    for (var i = 1; i < masterData.length; i++) {
      var period   = String(masterData[i][MJ.billingPeriod - 1] || '').trim();
      var isTest   = String(masterData[i][MJ.isTest - 1] || '').trim();
      var designer = String(masterData[i][MJ.designerName - 1] || '').trim();
      var dHrs     = parseFloat(masterData[i][MJ.designHoursTotal - 1]) || 0;
      var qHrs     = parseFloat(masterData[i][MJ.qcHoursTotal - 1])    || 0;

      if (period) allPeriods[period] = (allPeriods[period] || 0) + 1;

      var match = (period === billingPeriod) ||
                  (periodPrefix !== '' && period.indexOf(periodPrefix) === 0);
      if (!match || isTest === 'Yes') continue;
      matchRows.push({ designer: designer, dHrs: dHrs, qHrs: qHrs, period: period });
    }

    var lines = ['PAYROLL DIAGNOSIS — ' + billingPeriod, ''];

    if (matchRows.length === 0) {
      lines.push('❌ NO rows found matching this period.');
      if (periodPrefix) lines.push('   (Looking for period starting with: "' + periodPrefix + '")');
    } else {
      lines.push('✅ ' + matchRows.length + ' matching rows found:');
      var byDesigner = {};
      for (var j = 0; j < matchRows.length; j++) {
        var d = matchRows[j].designer || '(blank)';
        if (!byDesigner[d]) byDesigner[d] = { dHrs: 0, qHrs: 0 };
        byDesigner[d].dHrs += matchRows[j].dHrs;
        byDesigner[d].qHrs += matchRows[j].qHrs;
      }
      for (var name in byDesigner) {
        lines.push('  ' + name + ' → Design: ' + byDesigner[name].dHrs.toFixed(1) +
                   ' hrs | QC: ' + byDesigner[name].qHrs.toFixed(1) + ' hrs');
      }
    }

    lines.push('');
    lines.push('ALL BILLING PERIODS IN MASTER:');
    var sortedPeriods = Object.keys(allPeriods).sort();
    for (var p = 0; p < sortedPeriods.length; p++) {
      lines.push('  "' + sortedPeriods[p] + '"  (' + allPeriods[sortedPeriods[p]] + ' rows)');
    }

    ui.alert(lines.join('\n'));

  } catch (err) {
    ui.alert('Error: ' + err.message);
  }
}


// ============================================================
// SYNC STAFF_ROSTER FROM DESIGNER_MASTER
// Rebuilds STAFF_ROSTER (data rows only) from DESIGNER_MASTER.
// Skips inactive designers and anyone without a rate.
// Safe to run at any time — existing payroll ledger is untouched.
// ============================================================
function syncStaffRosterFromDesignerMaster() {
  var FUNCTION_NAME = 'syncStaffRosterFromDesignerMaster';
  var ui = SpreadsheetApp.getUi();

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // ── Get or create STAFF_ROSTER ─────────────────────────
    var rosterSheet = ss.getSheetByName(PAYROLL_CONFIG.sheets.staffRoster);
    if (!rosterSheet) {
      rosterSheet = ss.insertSheet(PAYROLL_CONFIG.sheets.staffRoster);
      // Row 1: title
      rosterSheet.getRange(1, 1).setValue('STAFF_ROSTER — BLC Payroll Rate Card');
      rosterSheet.getRange(1, 1).setBackground('#1a73e8').setFontColor('#fff').setFontWeight('bold');
      // Row 2: headers
      var headers = [
        'Record_ID','Designer_ID','Designer_Name','Role',
        'Client_Code','Supervisor_ID','Supervisor_Name',
        'Pay_Design','Pay_QC','Supervisor_Bonus_Eligible',
        'Hourly_Rate','Effective_From','Effective_To','Status'
      ];
      rosterSheet.getRange(2, 1, 1, headers.length).setValues([headers])
        .setBackground('#34a853').setFontColor('#fff').setFontWeight('bold');
      rosterSheet.setFrozenRows(2);
    }

    // ── Read DESIGNER_MASTER ───────────────────────────────
    var dmData = getSheetData(CONFIG.sheets.designerMaster);

    // Build name → ID map for supervisor lookup
    var nameToId = {};
    for (var n = 1; n < dmData.length; n++) {
      var dId   = String(dmData[n][0] || '').trim();
      var dName = String(dmData[n][1] || '').trim();
      if (dId && dName) nameToId[dName.toLowerCase()] = dId;
    }

    // ── Build new data rows ────────────────────────────────
    var newRows  = [];
    var counter  = 1;

    for (var i = 1; i < dmData.length; i++) {
      var designerId   = String(dmData[i][0]  || '').trim();
      var name         = String(dmData[i][1]  || '').trim();
      var role         = String(dmData[i][4]  || '').trim();
      var supName      = String(dmData[i][5]  || '').trim();
      var rateRaw      = String(dmData[i][6]  || '').trim();
      var startDate    = dmData[i][7]  || '';
      var active       = String(dmData[i][8]  || '').trim();
      var clients      = String(dmData[i][10] || '').trim();

      if (active !== 'Yes') continue;

      var rate = parseFloat(rateRaw.replace(/[₹,\s]/g, ''));
      if (!rate || isNaN(rate)) continue;   // no rate → skip (e.g. Raj Nair)

      // Supervisor lookup
      var supId = supName ? (nameToId[supName.toLowerCase()] || '') : '';

      // Pay rules by role
      var payDesign = 'Yes';
      var payQC     = 'No';
      var bonusElig = 'No';

      if (role === 'QC Reviewer') {
        payDesign = 'No';
        payQC     = 'Yes';
        bonusElig = 'No';
      } else if (role === 'Team Leader') {
        payDesign = 'Yes';
        payQC     = 'Yes';
        bonusElig = 'Yes';
      } else if (role === 'Project Manager') {
        payDesign = 'Yes';
        payQC     = 'No';
        bonusElig = 'Yes';
      }

      var recordId = 'SR' + String(counter).padStart(3, '0');
      counter++;

      var effFrom = startDate
        ? Utilities.formatDate(new Date(startDate), Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : '2026-01-01';

      newRows.push([
        recordId,
        designerId,
        name,
        role,
        clients,
        supId,
        supName,
        payDesign,
        payQC,
        bonusElig,
        '₹' + rate.toFixed(2),
        effFrom,
        '',        // Effective_To — blank = no end date
        'ACTIVE'
      ]);
    }

    // ── Clear existing data rows and rewrite ───────────────
    var lastRow = rosterSheet.getLastRow();
    if (lastRow > 2) {
      rosterSheet.getRange(3, 1, lastRow - 2, 14).clearContent();
    }
    if (newRows.length > 0) {
      rosterSheet.getRange(3, 1, newRows.length, 14).setValues(newRows);
      for (var c = 1; c <= 14; c++) rosterSheet.autoResizeColumn(c);
    }

    logException('INFO', 'SYSTEM', FUNCTION_NAME,
      'STAFF_ROSTER synced. Rows written: ' + newRows.length);

    ui.alert(
      '✅ STAFF_ROSTER synced from DESIGNER_MASTER.\n\n' +
      'Active designers written: ' + newRows.length + '\n\n' +
      'You can now run payroll.\n' +
      '(Inactive designers and those without a rate are excluded.)'
    );

  } catch (err) {
    logException('ERROR', 'SYSTEM', FUNCTION_NAME,
      'syncStaffRosterFromDesignerMaster failed: ' + err.message);
    ui.alert('❌ Error: ' + err.message);
  }
}
