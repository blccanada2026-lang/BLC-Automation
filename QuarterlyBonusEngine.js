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
    reworkTotals[name] = (reworkTotals[name] || 0) + (Number(row.reworkHoursMajor)  || 0);
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

// Functions added in subsequent tasks.
