/**
 * QuarterlyBonusEngine.js
 * Quarterly and annual performance bonus engine for BLC.
 * Designers scored first; TL/PM scored using their designers' averages.
 * Formula: bonus_INR = design_hours x composite_score x INR_25
 *
 * Computation order (enforced in runQuarterlyBonus):
 *   1. getQuarterHours_       — hours per designer from MASTER
 *   2. getErrorRates_         — rework/design ratio per designer
 *   3. getClientQcReturnRates_ — return rate per supervisor
 *   4. getBonusInputs_        — ratings from QUARTERLY_BONUS_INPUTS
 *   5. computeDesignerScores_ — score every designer (PENDING if input missing)
 *   6. computeSupervisorScores_ — score TL then PM (needs designer scores)
 *   7. checkForcedDifferentiation_ — warning flag, not a block
 *   8. writeBonusLedger_      — clear + rewrite BONUS_LEDGER for the quarter
 *   9. runAnnualBonus (Dec only)
 */

/* global SheetDB, ConfigService, CONFIG, normaliseDesignerName, Logger,
          GmailApp, Utilities, getUiSafe_, buildDesignerProfileMap_ */

var QB_QUARTERS = {
  'Q1': [1, 2, 3],
  'Q2': [4, 5, 6],
  'Q3': [7, 8, 9],
  'Q4': [10, 11, 12]
};

var QB_MONTH_NAMES = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];

/**
 * Returns total design hours per normalised designer name for a quarter.
 * @param  {string} quarter  'Q1'|'Q2'|'Q3'|'Q4'
 * @param  {number} year     e.g. 2026
 * @return {Object}          { normalisedName: totalHours, … }
 */
function getQuarterHours_(quarter, year) {
  var months       = QB_QUARTERS[quarter];
  var validPeriods = {};
  months.forEach(function (m) {
    validPeriods[QB_MONTH_NAMES[m - 1] + ' ' + year] = true;
  });

  var rows   = SheetDB.getAll('MASTER');
  var totals = {};

  rows.forEach(function (row) {
    // SheetDB coerces BOOLEAN columns: 'Yes' → true
    if (row.isTest === true) return;
    var period = typeof row.billingPeriod === 'object' && row.billingPeriod instanceof Date
      ? Utilities.formatDate(row.billingPeriod, 'Asia/Kolkata', 'MMMM yyyy')
      : String(row.billingPeriod || '');
    if (!validPeriods[period]) return;

    var name  = normaliseDesignerName(row.designerName || '');
    var hours = Number(row.designHours) || 0;
    totals[name] = (totals[name] || 0) + hours;
  });

  return totals;
}

/**
 * Returns error rate per normalised designer name: rework_hours / total_design_hours.
 * @param  {string} quarter  'Q1'|'Q2'|'Q3'|'Q4'
 * @param  {number} year     e.g. 2026
 * @return {Object}          { normalisedName: rate } where rate is 0–1
 */
function getErrorRates_(quarter, year) {
  var months       = QB_QUARTERS[quarter];
  var validPeriods = {};
  months.forEach(function (m) {
    validPeriods[QB_MONTH_NAMES[m - 1] + ' ' + year] = true;
  });

  var rows         = SheetDB.getAll('MASTER');
  var designTotals = {};
  var reworkTotals = {};

  rows.forEach(function (row) {
    if (row.isTest === true) return;
    var period = String(row.billingPeriod || '');
    if (!validPeriods[period]) return;

    var name = normaliseDesignerName(row.designerName || '');
    designTotals[name] = (designTotals[name] || 0) + (Number(row.designHours)       || 0);
    reworkTotals[name] = (reworkTotals[name] || 0) + (Number(row.reworkHoursMajor) || 0)
                                                   + (Number(row.reworkHoursMinor) || 0);
  });

  var rates = {};
  Object.keys(designTotals).forEach(function (name) {
    var total  = designTotals[name];
    rates[name] = total > 0 ? (reworkTotals[name] || 0) / total : 0;
  });
  return rates;
}

/**
 * Returns client QC return rate per supervisor ID.
 * rate = client_returned_jobs / total_jobs for the quarter.
 * @param  {string} quarter  'Q1'|'Q2'|'Q3'|'Q4'
 * @param  {number} year     e.g. 2026
 * @return {Object}          { supId: rate } where rate is 0-1
 */
function getClientQcReturnRates_(quarter, year) {
  var months       = QB_QUARTERS[quarter];
  var validPeriods = {};
  months.forEach(function (m) {
    validPeriods[QB_MONTH_NAMES[m - 1] + ' ' + year] = true;
  });

  var rows         = SheetDB.getAll('MASTER');
  var jobCounts    = {};
  var returnCounts = {};

  rows.forEach(function (row) {
    if (row.isTest === true) return;
    var period = String(row.billingPeriod || '');
    if (!validPeriods[period]) return;

    var supId = String(row.supId || '').trim();
    if (!supId) return;

    jobCounts[supId]    = (jobCounts[supId] || 0) + 1;
    returnCounts[supId] = (returnCounts[supId] || 0) + (Number(row.clientReturn) || 0);
  });

  var rates = {};
  Object.keys(jobCounts).forEach(function (id) {
    rates[id] = jobCounts[id] > 0 ? returnCounts[id] / jobCounts[id] : 0;
  });
  return rates;
}

/**
 * Loads all QUARTERLY_BONUS_INPUTS rows for a quarter.
 * @param  {string} quarter  'Q1'|'Q2'|'Q3'|'Q4'
 * @param  {number} year     e.g. 2026
 * @return {Array}           filtered QBI rows
 */
function getBonusInputs_(quarter, year) {
  var quarterKey = quarter + '-' + year;
  return SheetDB.findRows('QUARTERLY_BONUS_INPUTS', function (row) {
    return row.quarter === quarterKey;
  });
}

/**
 * Returns true if >60% of the given inputs have tlRatingAvg > 4.0.
 * Warning flag only -- does not block the run.
 * @param  {string} raterName  Used for logging only
 * @param  {Array}  inputs     QBI rows for this rater's reportees
 * @return {boolean}
 */
function checkForcedDifferentiation_(raterName, inputs) {
  if (!inputs || inputs.length === 0) return false;
  var aboveFour = inputs.filter(function (r) {
    return (Number(r.tlRatingAvg) || 0) > 4.0;
  }).length;
  return (aboveFour / inputs.length) > 0.60;
}

/**
 * Scores every Designer row in inputs.
 * @param {string} quarter
 * @param {number} year
 * @param {Array}  inputs        All QBI rows for the quarter
 * @param {Object} errorRates    { normalisedName: rate } from getErrorRates_()
 * @param {Object} quarterHours  { normalisedName: hours } from getQuarterHours_()
 * @returns {Object}  { personId: { compositeScore, bonusINR, hours, status, pendingReason, ... } }
 */
function computeDesignerScores_(quarter, year, inputs, errorRates, quarterHours) {
  var rate    = ConfigService.getNumber('quarterly_bonus_rate_inr', 25);
  var results = {};

  inputs.forEach(function (row) {
    if (row.role !== 'Designer') return;

    var name  = normaliseDesignerName(row.personName || '');
    var hours = quarterHours[name] || 0;
    var eRate = errorRates[name]   || 0;

    var missing = [];
    if (!(Number(row.clientFeedbackAvg) > 0)) missing.push('client feedback');
    if (!(Number(row.tlRatingAvg)       > 0)) missing.push('TL rating');
    if (!(Number(row.pmRatingAvg)       > 0)) missing.push('PM rating');

    if (missing.length > 0) {
      results[row.personId] = {
        personId: row.personId, personName: row.personName, role: 'Designer',
        compositeScore: 0, bonusINR: 0, hours: hours,
        status: 'Pending', pendingReason: 'Missing: ' + missing.join(', ')
      };
      return;
    }

    var composite = 0.30 * (Number(row.clientFeedbackAvg) / 5)
                  + 0.30 * (1 - eRate)
                  + 0.25 * (Number(row.tlRatingAvg) / 5)
                  + 0.15 * (Number(row.pmRatingAvg) / 5);
    composite = Math.min(1, Math.max(0, composite));

    results[row.personId] = {
      personId: row.personId, personName: row.personName, role: 'Designer',
      compositeScore: composite,
      bonusINR: Math.round(hours * composite * rate),
      hours: hours,
      status: 'Draft',
      pendingReason: ''
    };
  });

  return results;
}

/**
 * Scores every Team Leader and Project Manager.
 * MUST be called after computeDesignerScores_().
 * @param {string} quarter
 * @param {number} year
 * @param {Array}  inputs          All QBI rows for the quarter
 * @param {Object} designerScores  Output of computeDesignerScores_()
 * @param {Object} returnRates     Output of getClientQcReturnRates_() -- keyed by personId
 * @param {Object} profileMap      From buildDesignerProfileMap_() -- keyed by normalised name
 * @returns {Object}  { personId: { compositeScore, bonusINR, hours, status, ... } }
 */
function computeSupervisorScores_(quarter, year, inputs, designerScores, returnRates, profileMap) {
  var rate     = ConfigService.getNumber('quarterly_bonus_rate_inr', 25);
  var results  = {};
  var supRoles = ['Team Leader', 'Project Manager'];

  inputs.forEach(function (row) {
    if (supRoles.indexOf(row.role) === -1) return;

    if (!(Number(row.ceoRatingAvg) > 0)) {
      results[row.personId] = {
        personId: row.personId, personName: row.personName, role: row.role,
        compositeScore: 0, bonusINR: 0, hours: 0,
        status: 'Pending', pendingReason: 'Missing: CEO rating'
      };
      return;
    }

    var reporteeScores = [];
    var totalHours     = 0;

    Object.keys(designerScores).forEach(function (dId) {
      var ds      = designerScores[dId];
      var profile = profileMap[normaliseDesignerName(ds.personName || '')];
      if (!profile) return;

      var reportsToThis = row.role === 'Team Leader'
        ? profile.supId  === row.personId
        : profile.pmCode === row.personId;
      if (!reportsToThis) return;

      if (ds.status === 'Draft') {
        reporteeScores.push(ds.compositeScore);
        totalHours += (ds.hours || 0);
      }
    });

    var avgScore     = reporteeScores.length > 0
      ? reporteeScores.reduce(function (s, v) { return s + v; }, 0) / reporteeScores.length
      : 0;
    var qcReturnRate = returnRates[row.personId] || 0;
    var composite    = 0.30 * (1 - qcReturnRate)
                     + 0.40 * avgScore
                     + 0.30 * (Number(row.ceoRatingAvg) / 5);
    composite = Math.min(1, Math.max(0, composite));

    results[row.personId] = {
      personId: row.personId, personName: row.personName, role: row.role,
      compositeScore: composite,
      bonusINR: Math.round(totalHours * composite * rate),
      hours: totalHours,
      status: 'Draft',
      pendingReason: ''
    };
  });

  return results;
}

function toPerformanceTier_(score) {
  if (score >= 0.80) return 'HIGH';
  if (score >= 0.60) return 'AVERAGE';
  return 'NEEDS_IMPROVEMENT';
}

/**
 * Clears BONUS_LEDGER rows for this quarter+QUARTERLY type, then writes new rows.
 * Safe to re-run: existing rows are deleted first.
 * @param {Array}  entries  Combined designer + supervisor score entries
 * @param {string} quarter  'Q1'|'Q2'|'Q3'|'Q4'
 * @param {number} year     e.g. 2026
 */
function writeBonusLedger_(entries, quarter, year) {
  var periodKey = quarter + '-' + year;

  SheetDB.deleteWhere('BONUS_LEDGER', function (row) {
    return row.calculationPeriod === periodKey && row.bonusType === 'QUARTERLY';
  });

  var ts   = new Date();
  var rows = entries.map(function (e) {
    return {
      bonusType         : 'QUARTERLY',
      calculationPeriod : periodKey,
      personId          : e.personId,
      personName        : e.personName,
      role              : e.role,
      hours             : e.hours,
      feedbackScore     : e.compositeScore,
      performanceTier   : toPerformanceTier_(e.compositeScore),
      bonusINR          : e.bonusINR,
      status            : e.status || 'Draft',
      notes             : e.pendingReason || '',
      computedAt        : ts
    };
  });

  SheetDB.insertRows('BONUS_LEDGER', rows);
}

/**
 * Computes annual bonuses for the full year.
 * Called automatically in December by runQuarterlyBonus().
 * Uses hours-weighted composite across included quarters.
 * @param {number} year  e.g. 2026
 */
function runAnnualBonus(year) {
  var rate    = ConfigService.getNumber('quarterly_bonus_rate_inr', 25);
  var periods = ['Q1-'+year, 'Q2-'+year, 'Q3-'+year, 'Q4-'+year];

  var qRows = SheetDB.findRows('BONUS_LEDGER', function (row) {
    return row.bonusType === 'QUARTERLY' &&
           periods.indexOf(row.calculationPeriod) !== -1;
  });

  var byPerson = {};
  qRows.forEach(function (row) {
    if (!byPerson[row.personId]) byPerson[row.personId] = [];
    byPerson[row.personId].push(row);
  });

  SheetDB.deleteWhere('BONUS_LEDGER', function (row) {
    return row.bonusType === 'ANNUAL' && String(row.calculationPeriod) === String(year);
  });

  var ts         = new Date();
  var annualRows = [];

  Object.keys(byPerson).forEach(function (personId) {
    var rows     = byPerson[personId];
    var included = rows.filter(function (r) { return r.status !== 'Pending'; });
    var excluded = rows.filter(function (r) { return r.status === 'Pending'; });

    var totalHours    = 0;
    var weightedScore = 0;
    included.forEach(function (r) {
      totalHours    += (Number(r.hours)        || 0);
      weightedScore += (Number(r.feedbackScore) || 0) * (Number(r.hours) || 0);
    });

    var composite   = totalHours > 0 ? weightedScore / totalHours : 0;
    var excludeNote = excluded.length > 0
      ? 'Excluded PENDING quarters: ' + excluded.map(function (r) { return r.calculationPeriod; }).join(', ')
      : '';

    annualRows.push({
      bonusType         : 'ANNUAL',
      calculationPeriod : String(year),
      personId          : personId,
      personName        : rows[0].personName || '',
      role              : rows[0].role       || '',
      hours             : totalHours,
      feedbackScore     : composite,
      performanceTier   : toPerformanceTier_(composite),
      bonusINR          : Math.round(totalHours * composite * rate),
      status            : 'Draft',
      notes             : excludeNote,
      computedAt        : ts
    });
  });

  SheetDB.insertRows('BONUS_LEDGER', annualRows);
  Logger.log('[QuarterlyBonusEngine] Annual bonus ' + year + ': ' + annualRows.length + ' rows written.');
}

/**
 * Main entry point. Called from BLC Menu or directly.
 * Prompts for quarter and year when called interactively (no args).
 */
function runQuarterlyBonus(quarter, year) {
  var ui = getUiSafe_();

  if (!quarter || !year) {
    if (!ui) {
      Logger.log('[QuarterlyBonusEngine] runQuarterlyBonus requires quarter and year when called non-interactively.');
      return;
    }
    var qResp = ui.prompt('Quarterly Bonus', 'Enter quarter (Q1/Q2/Q3/Q4):', ui.ButtonSet.OK_CANCEL);
    if (qResp.getSelectedButton() !== ui.Button.OK) return;
    quarter = qResp.getResponseText().trim().toUpperCase();

    var yResp = ui.prompt('Quarterly Bonus', 'Enter year (e.g. 2026):', ui.ButtonSet.OK_CANCEL);
    if (yResp.getSelectedButton() !== ui.Button.OK) return;
    year = parseInt(yResp.getResponseText().trim(), 10);
  }

  if (!QB_QUARTERS[quarter]) {
    Logger.log('[QuarterlyBonusEngine] Invalid quarter: ' + quarter);
    if (ui) ui.alert('Invalid quarter: ' + quarter + '. Use Q1, Q2, Q3, or Q4.');
    return;
  }

  Logger.log('[QuarterlyBonusEngine] Starting ' + quarter + '-' + year + '...');

  var quarterHours = getQuarterHours_(quarter, year);
  var errorRates   = getErrorRates_(quarter, year);
  var returnRates  = getClientQcReturnRates_(quarter, year);
  var inputs       = getBonusInputs_(quarter, year);
  var profileMap   = buildDesignerProfileMap_();

  var designerResults   = computeDesignerScores_(quarter, year, inputs, errorRates, quarterHours);
  var supervisorResults = computeSupervisorScores_(quarter, year, inputs, designerResults, returnRates, profileMap);

  // Forced differentiation warnings (warning only -- not a block)
  inputs.filter(function (r) {
    return r.role === 'Team Leader' || r.role === 'Project Manager';
  }).forEach(function (supRow) {
    var reporteeInputs = inputs.filter(function (r) {
      var profile = profileMap[normaliseDesignerName(r.personName || '')];
      return profile && (profile.supId === supRow.personId || profile.pmCode === supRow.personId);
    });
    if (checkForcedDifferentiation_(supRow.personName, reporteeInputs)) {
      Logger.log('[QuarterlyBonusEngine] FORCED DIFF WARNING: ' + supRow.personName +
                 ' rated >60% of their designers above 4.0 -- please review.');
      if (ui) ui.alert('Warning: ' + supRow.personName +
                       ' has rated more than 60% of their designers above 4.0.\nPlease review differentiation before approving.');
    }
  });

  var allEntries = [];
  Object.keys(designerResults).forEach(function (id)   { allEntries.push(designerResults[id]);   });
  Object.keys(supervisorResults).forEach(function (id) { allEntries.push(supervisorResults[id]); });

  writeBonusLedger_(allEntries, quarter, year);

  if (quarter === 'Q4') {
    runAnnualBonus(year);
  }

  var pending = allEntries.filter(function (e) { return e.status === 'Pending'; }).length;
  var summary = quarter + '-' + year + ' complete. ' + allEntries.length + ' entries written. ' +
                pending + ' pending.';
  Logger.log('[QuarterlyBonusEngine] ' + summary);
  if (ui) ui.alert('Quarterly Bonus Run Complete', summary, ui.ButtonSet.OK);
}

/**
 * Shows a preview summary of the bonus run without writing any rows.
 * Prompts for quarter and year when called from the menu.
 */
function previewQuarterlyBonus(quarter, year) {
  var ui = getUiSafe_();
  if (!ui) return;

  if (!quarter || !year) {
    var qResp = ui.prompt('Preview Bonus', 'Enter quarter (Q1/Q2/Q3/Q4):', ui.ButtonSet.OK_CANCEL);
    if (qResp.getSelectedButton() !== ui.Button.OK) return;
    quarter = qResp.getResponseText().trim().toUpperCase();
    var yResp = ui.prompt('Preview Bonus', 'Enter year:', ui.ButtonSet.OK_CANCEL);
    if (yResp.getSelectedButton() !== ui.Button.OK) return;
    year = parseInt(yResp.getResponseText().trim(), 10);
  }

  var quarterHours    = getQuarterHours_(quarter, year);
  var errorRates      = getErrorRates_(quarter, year);
  var returnRates     = getClientQcReturnRates_(quarter, year);
  var inputs          = getBonusInputs_(quarter, year);
  var profileMap      = buildDesignerProfileMap_();
  var designerResults = computeDesignerScores_(quarter, year, inputs, errorRates, quarterHours);
  var supResults      = computeSupervisorScores_(quarter, year, inputs, designerResults, returnRates, profileMap);

  var all  = Object.keys(designerResults).map(function (id) { return designerResults[id]; })
             .concat(Object.keys(supResults).map(function (id) { return supResults[id]; }));

  var draft    = all.filter(function (e) { return e.status === 'Draft'; });
  var pending  = all.filter(function (e) { return e.status === 'Pending'; });
  var totalINR = draft.reduce(function (s, e) { return s + (e.bonusINR || 0); }, 0);

  var msg = 'PREVIEW — ' + quarter + '-' + year + '\n\n' +
            'Total staff: ' + all.length + '\n' +
            'Ready (Draft): ' + draft.length + '\n' +
            'Pending (missing inputs): ' + pending.length + '\n' +
            'Total bonus pool: Rs.' + totalINR.toLocaleString();

  if (pending.length > 0) {
    msg += '\n\nPending staff:\n' +
           pending.map(function (e) { return '  - ' + e.personName + ': ' + e.pendingReason; }).join('\n');
  }

  ui.alert('Quarterly Bonus Preview', msg, ui.ButtonSet.OK);
}


/**
 * Sends quarterly rating reminder emails.
 * Phase 1 (bonus_links_send_direct=false): all to blccanada2026@gmail.com for manual forwarding.
 * Phase 2 (bonus_links_send_direct=true):  direct to each recipient.
 */
function sendBonusRatingReminders(quarter, year) {
  var sendDirect   = ConfigService.getBoolean('bonus_links_send_direct', false);
  var stagingEmail = ConfigService.get('payroll_from_email', 'blccanada2026@gmail.com');
  var baseUrl      = ConfigService.get('portal_base_url', '');
  var quarterKey   = quarter + '-' + year;

  function buildRatingUrl(params) {
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    return baseUrl + '?' + qs;
  }

  function dispatchEmail(toEmail, subject, body, forLabel) {
    var actualTo  = sendDirect ? toEmail : stagingEmail;
    var fullBody  = sendDirect ? body : ('[FOR: ' + forLabel + ']\n\n' + body);
    GmailApp.sendEmail(actualTo, subject, fullBody);
  }

  // ── Client rating links (token-secured) ──────────────────────
  var clients = SheetDB.getAll('CLIENT_MASTER');
  clients.forEach(function (client) {
    if (!client.feedbackToken) return;
    var url  = buildRatingUrl({ page: 'client-rating', token: client.feedbackToken, quarter: quarterKey });
    var body = 'Dear ' + (client.billingContact || 'Client') + ',\n\n' +
               'Please rate the designers who worked on your projects this quarter (' + quarterKey + ').\n\n' +
               'Your rating link:\n' + url + '\n\n' +
               'This link is unique to your account. Please do not share it.\n\n' +
               'Thank you,\nBlue Lotus Consulting';
    dispatchEmail(
      client.feedbackEmail || '',
      'BLC Quarterly Rating — ' + quarterKey,
      body,
      (client.billingContact || '') + ' <' + (client.feedbackEmail || '') + '>'
    );
  });

  // ── Internal rater links (Google session auth) ────────────────
  var internalRaters = SheetDB.findRows('STAFF_ROSTER', function (r) {
    return r.status === 'ACTIVE' &&
           (r.role === 'Team Leader' || r.role === 'Project Manager' || r.role === 'CEO');
  });
  internalRaters.forEach(function (rater) {
    if (!rater.email) {
      Logger.log('[sendBonusRatingReminders] No email for: ' + rater.name);
      return;
    }
    var url  = buildRatingUrl({ page: 'rating', quarter: quarterKey });
    var body = 'Hi ' + rater.name + ',\n\n' +
               'Please submit your quarterly ratings for ' + quarterKey + '.\n\n' +
               'Rating portal:\n' + url + '\n\n' +
               'Sign in with your BLC Google account when prompted.\n\n' +
               'Thank you,\nBlue Lotus Consulting';
    dispatchEmail(
      rater.email,
      'BLC Quarterly Ratings — ' + quarterKey,
      body,
      rater.name + ' (' + rater.role + ') <' + rater.email + '>'
    );
  });

  Logger.log('[sendBonusRatingReminders] Done for ' + quarterKey +
             (sendDirect ? ' — direct' : ' — staging to ' + stagingEmail));
}
