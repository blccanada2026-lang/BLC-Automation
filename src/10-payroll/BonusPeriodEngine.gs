// ============================================================
// BonusPeriodEngine.gs — BLC Nexus T10 Payroll
// src/10-payroll/BonusPeriodEngine.gs
//
// LOAD ORDER: T10. Loads after QuarterlyBonusEngine.gs (same tier).
// DEPENDENCIES: Config (T0), Identifiers (T0), DAL (T1), RBAC (T2),
//               Logger (T3), QuarterlyBonusEngine (T10)
//
// Period-parameterized bonus entry point — runBonusForPeriod(periodType,
// periodValue) replacing hardcoded "current quarter" assumptions.
// periodType: 'QUARTER' | 'ANNUAL'. periodValue: '2026-Q2' | '2026-ANNUAL'.
//
// This file holds the PURE period-parsing/date-validation logic (no DAL,
// fully unit-testable — see tests/bonus-period.test.js). The
// DAL-dependent period-commit/idempotency/supersede layer is in
// BonusPeriodCommit.gs (same tier).
// ============================================================

var BONUS_QUARTER_END_MONTH_DAY_ = {
  Q1: { month: 2,  day: 31 }, // March (0-indexed month 2), last day 31
  Q2: { month: 5,  day: 30 }, // June
  Q3: { month: 8,  day: 30 }, // September
  Q4: { month: 11, day: 31 }  // December
};

/**
 * Parses and validates a (periodType, periodValue) pair.
 *
 * @param {string} periodType   'QUARTER' | 'ANNUAL'
 * @param {string} periodValue  'YYYY-Qn' for QUARTER, 'YYYY-ANNUAL' for ANNUAL
 * @returns {{ periodType: string, year: number, quarter: (string|undefined) }}
 * @throws {Error} on any unrecognised periodType or malformed periodValue
 */
function parseBonusPeriod_(periodType, periodValue) {
  var pv = String(periodValue || '').trim();

  if (periodType === 'QUARTER') {
    var qm = pv.match(/^(\d{4})-(Q[1-4])$/);
    if (!qm) {
      throw new Error('parseBonusPeriod_: QUARTER periodValue must match "YYYY-Qn" (Q1-Q4), got "' + pv + '".');
    }
    return { periodType: 'QUARTER', year: parseInt(qm[1], 10), quarter: qm[2] };
  }

  if (periodType === 'ANNUAL') {
    var am = pv.match(/^(\d{4})-ANNUAL$/);
    if (!am) {
      throw new Error('parseBonusPeriod_: ANNUAL periodValue must match "YYYY-ANNUAL", got "' + pv + '".');
    }
    return { periodType: 'ANNUAL', year: parseInt(am[1], 10) };
  }

  throw new Error('parseBonusPeriod_: unrecognised periodType "' + periodType + '" — must be QUARTER or ANNUAL.');
}

/**
 * Returns a Date for the last calendar day of the given quarter, at
 * midnight (local time).
 * @param {string} quarter  'Q1'|'Q2'|'Q3'|'Q4'
 * @param {number} year
 * @returns {Date}
 */
function bonusQuarterEndDate_(quarter, year) {
  var md = BONUS_QUARTER_END_MONTH_DAY_[quarter];
  if (!md) throw new Error('bonusQuarterEndDate_: unrecognised quarter "' + quarter + '".');
  return new Date(Date.UTC(year, md.month, md.day));
}

/**
 * Returns true if the given quarter has fully ended as of asOfDate
 * (defaults to now — pass an explicit date in tests for determinism).
 * A quarter is NOT closed on its own last calendar day (still in
 * progress until that day is over) — only from the day after.
 *
 * @param {string} quarter
 * @param {number} year
 * @param {Date}   [asOfDate]
 * @returns {boolean}
 */
function isQuarterClosed_(quarter, year, asOfDate) {
  var asOf = asOfDate || new Date();
  var endDate = bonusQuarterEndDate_(quarter, year);
  // Compare by UTC calendar day: closed once asOf's date is strictly
  // after the quarter's last day.
  var asOfUTC = Date.UTC(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  return asOfUTC > endDate.getTime();
}
