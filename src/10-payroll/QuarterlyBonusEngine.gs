// ============================================================
// QuarterlyBonusEngine.gs — BLC Nexus T10 Payroll
// src/10-payroll/QuarterlyBonusEngine.gs
//
// LOAD ORDER: T10. Loads after all T0–T9 files.
// DEPENDENCIES: Config (T0), Identifiers (T0), DAL (T1),
//               RBAC (T2), Logger (T3), ClientFeedback (T9)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  Quarterly performance bonus for designers, TLs, PMs.   ║
// ║                                                         ║
// ║  Formula:                                               ║
// ║    composite = client(30%) + error(40%) + rating(30%)   ║
// ║    bonus_INR = design_hours × composite × INR 25        ║
// ║                                                         ║
// ║  Annual bonus = sum of Q1+Q2+Q3+Q4 amounts              ║
// ║                                                         ║
// ║  Entry points:                                          ║
// ║    runQuarterlyBonus(actorEmail, quarter, year)          ║
// ║    runAnnualBonus(actorEmail, year)                      ║
// ║    previewQuarterlyBonus(actorEmail, quarter, year)      ║
// ║                                                         ║
// ║  Permission: PAYROLL_RUN (CEO only)                     ║
// ║  Writes to: FACT_PAYROLL_LEDGER (separate from payroll) ║
// ╚══════════════════════════════════════════════════════════╝
//
// ELIGIBILITY:
//   Staff must have start_date >= 1 year ago, OR bonus_eligible=TRUE
//   (CEO override). active must be TRUE.
//
// IDEMPOTENCY:
//   Key: QUARTERLY_BONUS|{person_code}|{quarterPeriodId}
//        ANNUAL_BONUS|{person_code}|{year}
//   Safe to re-run — existing keys are skipped.
//
// CALL PATTERN:
//   QuarterlyBonusEngine.runQuarterlyBonus('raj@blc.ca', 'Q1', 2026);
//   QuarterlyBonusEngine.runAnnualBonus('raj@blc.ca', 2026);
// ============================================================

var QuarterlyBonusEngine = (function () {

  var MODULE                    = 'QuarterlyBonusEngine';
  var BONUS_INR_PER_HOUR        = 25;
  var WEIGHTS                   = { client: 0.30, error: 0.40, rating: 0.30 };
  var QUARTER_MONTHS            = {
    Q1: ['01', '02', '03'],
    Q2: ['04', '05', '06'],
    Q3: ['07', '08', '09'],
    Q4: ['10', '11', '12']
  };

  // ============================================================
  // SECTION 1: HELPERS
  // ============================================================

  /** Returns '2026-Q1' style string. */
  function quarterPeriodId_(quarter, year) {
    return String(year) + '-' + quarter;
  }

  /** Returns ['2026-01','2026-02','2026-03'] for Q1 2026. */
  function monthPeriodIds_(quarter, year) {
    var months = QUARTER_MONTHS[quarter];
    if (!months) throw new Error(MODULE + ': invalid quarter "' + quarter + '". Use Q1/Q2/Q3/Q4.');
    return months.map(function (m) { return String(year) + '-' + m; });
  }

  /**
   * Returns true if the staff member is eligible for a quarterly bonus.
   * Eligible when:
   *   a) start_date is >= 1 year before today, OR
   *   b) bonus_eligible = TRUE (CEO override)
   * AND active = TRUE.
   */
  function isEligible_(staffRow, today) {
    var active = String(staffRow.active || '').toUpperCase();
    if (active !== 'TRUE' && active !== 'YES' && active !== '1') return false;

    var override = String(staffRow.bonus_eligible || '').toUpperCase();
    if (override === 'TRUE') return true;

    var startStr = String(staffRow.start_date || '').slice(0, 10);
    if (!startStr) return false;

    var startDate    = new Date(startStr);
    var oneYearAgo   = new Date(today);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    return startDate <= oneYearAgo;
  }

  // ============================================================
  // SECTION 2: DATA GATHERING (stubs — implemented in Tasks 4-7)
  // ============================================================

  /**
   * Sums design_hours from FACT_WORK_LOGS across all 3 months of the quarter.
   * Returns: { person_code: design_hours_total }
   * Only design hours (actor_role !== 'QC') are included.
   */
  function aggregateQuarterHours_(quarter, year) {
    var periodIds = monthPeriodIds_(quarter, year);
    var hoursMap  = {};

    for (var p = 0; p < periodIds.length; p++) {
      var rows;
      try {
        rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
          callerModule: MODULE,
          periodId:     periodIds[p]
        });
      } catch (e) {
        if (e.code === 'SHEET_NOT_FOUND') continue;
        throw e;
      }

      for (var i = 0; i < rows.length; i++) {
        var row   = rows[i];
        var code  = String(row.actor_code || '').trim();
        var role  = String(row.actor_role || '').toUpperCase();
        var hours = parseFloat(row.hours) || 0;
        if (!code || hours <= 0 || role === 'QC') continue;
        hoursMap[code] = (hoursMap[code] || 0) + hours;
      }
    }

    var codes = Object.keys(hoursMap);
    for (var j = 0; j < codes.length; j++) {
      hoursMap[codes[j]] = Math.round(hoursMap[codes[j]] * 100) / 100;
    }
    return hoursMap;
  }
  function getQcErrorRates_(quarter, year)        { return {}; }
  function getClientScores_(quarter, year)        { return {}; }
  function getInternalRatings_(qPid)              { return {}; }

  // ============================================================
  // SECTION 3: SCORE COMPUTATION (stub — implemented in Task 8)
  // ============================================================

  function computeCompositeScore_(clientScore, errorScore, ratingScore) { return 0; }

  // ============================================================
  // SECTION 4: BONUS ROWS (stub — implemented in Task 8)
  // ============================================================

  function computeBonuses_(staffCache, hoursMap, errorRates, clientScores, ratings, qPid) { return []; }

  // ============================================================
  // SECTION 5: LEDGER (stub — implemented in Task 9)
  // ============================================================

  function writeBonusLedger_(bonusRows, actorEmail, qPid) {}

  // ============================================================
  // SECTION 6: ANNUAL BONUS (stub — implemented in Task 10)
  // ============================================================

  function runAnnualBonus_(actorEmail, year) {}

  // ============================================================
  // SECTION 7: STAFF CACHE
  // ============================================================

  function buildStaffCache_() {
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: MODULE });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') {
        Logger.warn('QB_NO_STAFF_TABLE', { module: MODULE, message: 'DIM_STAFF_ROSTER not found' });
        return {};
      }
      throw e;
    }
    var cache = {};
    for (var i = 0; i < rows.length; i++) {
      var row  = rows[i];
      var code = String(row.person_code || '').trim();
      if (!code) continue;
      cache[code] = {
        name:            String(row.name            || code),
        email:           String(row.email           || '').trim().toLowerCase(),
        role:            String(row.role            || '').toUpperCase().trim(),
        supervisor_code: String(row.supervisor_code || '').trim(),
        pm_code:         String(row.pm_code         || '').trim(),
        bonus_eligible:  String(row.bonus_eligible  || '').toUpperCase() === 'TRUE',
        active:          String(row.active          || ''),
        start_date:      String(row.start_date      || '')
      };
    }
    return cache;
  }

  // ============================================================
  // SECTION 8: PUBLIC ENTRY POINTS
  // ============================================================

  /**
   * Runs the quarterly bonus calculation and writes to FACT_PAYROLL_LEDGER.
   * CEO only.
   * @param {string} actorEmail
   * @param {string} quarter  'Q1'|'Q2'|'Q3'|'Q4'
   * @param {number} year     e.g. 2026
   * @returns {Object} { written, pending, skipped, quarterPeriodId }
   */
  function runQuarterlyBonus(actorEmail, quarter, year) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN);
    RBAC.enforceFinancialAccess(actor);

    Logger.info('QB_RUN_START', { module: MODULE,
      message: 'Quarterly bonus run started', quarter: quarter, year: year });

    var qPid         = quarterPeriodId_(quarter, year);
    var staffCache   = buildStaffCache_();
    var hoursMap     = aggregateQuarterHours_(quarter, year);
    var errorRates   = getQcErrorRates_(quarter, year);
    var clientScores = getClientScores_(quarter, year);
    var ratings      = getInternalRatings_(qPid);

    var bonusRows  = computeBonuses_(staffCache, hoursMap, errorRates, clientScores, ratings, qPid);
    writeBonusLedger_(bonusRows, actorEmail, qPid);

    var written = bonusRows.filter(function (r) { return r.status === 'CALCULATED'; }).length;
    var pending = bonusRows.filter(function (r) { return r.status === 'PENDING'; }).length;
    var skipped = bonusRows.filter(function (r) { return r.status === 'SKIPPED'; }).length;

    Logger.info('QB_RUN_COMPLETE', { module: MODULE,
      message: 'Quarterly bonus run complete',
      quarter: quarter, year: year, written: written, pending: pending, skipped: skipped });

    return { written: written, pending: pending, skipped: skipped, quarterPeriodId: qPid };
  }

  /**
   * Same as runQuarterlyBonus but writes nothing — returns preview data.
   * @param {string} actorEmail
   * @param {string} quarter
   * @param {number} year
   * @returns {Object[]} bonusRows array (not persisted)
   */
  function previewQuarterlyBonus(actorEmail, quarter, year) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_VIEW);

    var qPid         = quarterPeriodId_(quarter, year);
    var staffCache   = buildStaffCache_();
    var hoursMap     = aggregateQuarterHours_(quarter, year);
    var errorRates   = getQcErrorRates_(quarter, year);
    var clientScores = getClientScores_(quarter, year);
    var ratings      = getInternalRatings_(qPid);

    return computeBonuses_(staffCache, hoursMap, errorRates, clientScores, ratings, qPid);
  }

  /**
   * Sums Q1-Q4 quarterly bonuses and writes a single ANNUAL_BONUS row per person.
   * @param {string} actorEmail
   * @param {number} year
   */
  function runAnnualBonus(actorEmail, year) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN);
    RBAC.enforceFinancialAccess(actor);
    runAnnualBonus_(actorEmail, year);
  }

  return {
    runQuarterlyBonus:     runQuarterlyBonus,
    previewQuarterlyBonus: previewQuarterlyBonus,
    runAnnualBonus:        runAnnualBonus
  };

}());
