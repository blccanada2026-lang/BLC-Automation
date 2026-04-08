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
  /**
   * Computes QC error score per designer from VW_JOB_CURRENT_STATE.
   * error_rate  = count(jobs where rework_cycle > 0) / total_jobs
   * error_score = 1 - error_rate  (higher is better)
   * Returns: { person_code: error_score 0.0–1.0 }
   */
  function getQcErrorRates_(quarter, year) {
    var periodIds = monthPeriodIds_(quarter, year);
    var allRows;
    try {
      allRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return {};
      throw e;
    }

    var pidSet = {};
    for (var p = 0; p < periodIds.length; p++) { pidSet[periodIds[p]] = true; }

    var accum = {};
    for (var i = 0; i < allRows.length; i++) {
      var row  = allRows[i];
      var pid  = String(row.period_id || '').slice(0, 7);
      if (!pidSet[pid]) continue;

      var code = String(row.allocated_to || '').trim();
      if (!code) continue;

      if (!accum[code]) accum[code] = { total: 0, reworkCount: 0 };
      accum[code].total++;
      if (parseInt(row.rework_cycle || 0, 10) > 0) accum[code].reworkCount++;
    }

    var result = {};
    var codes  = Object.keys(accum);
    for (var j = 0; j < codes.length; j++) {
      var a         = accum[codes[j]];
      var errorRate = a.total > 0 ? a.reworkCount / a.total : 0;
      result[codes[j]] = Math.round((1 - errorRate) * 10000) / 10000;
    }
    return result;
  }
  /**
   * Aggregates client feedback scores across all 3 months of the quarter.
   * avg_normalized is 0–100; divides by 100 to get 0.0–1.0.
   * Response-count weighted average when a designer has scores in multiple months.
   * Returns: { person_code: score 0.0–1.0 }
   */
  function getClientScores_(quarter, year) {
    var periodIds = monthPeriodIds_(quarter, year);
    var accum = {};

    for (var p = 0; p < periodIds.length; p++) {
      var summary;
      try {
        summary = ClientFeedback.getFeedbackSummary(periodIds[p]);
      } catch (e) {
        Logger.warn('QB_CLIENT_SCORE_READ_FAIL', { module: MODULE,
          message: 'Could not read client feedback for period',
          periodId: periodIds[p], error: e.message });
        continue;
      }

      var codes = Object.keys(summary || {});
      for (var i = 0; i < codes.length; i++) {
        var code  = codes[i];
        var entry = summary[code];
        var count = parseInt(entry.response_count || 0, 10);
        if (count <= 0) continue;
        var norm  = parseFloat(entry.avg_normalized || 0);
        if (!accum[code]) accum[code] = { weightedSum: 0, totalCount: 0 };
        accum[code].weightedSum += norm * count;
        accum[code].totalCount  += count;
      }
    }

    var result = {};
    var keys   = Object.keys(accum);
    for (var j = 0; j < keys.length; j++) {
      var a = accum[keys[j]];
      result[keys[j]] = a.totalCount > 0
        ? Math.round((a.weightedSum / a.totalCount) / 100 * 10000) / 10000
        : 0;
    }
    return result;
  }
  /**
   * Reads FACT_PERFORMANCE_RATINGS for the quarter.
   * Designers need TL + PM scores (both required). TLs/PMs need CEO score.
   * Returns: { person_code: score 0.0–1.0 | null }
   *   null = ratings incomplete — caller marks row PENDING
   */
  function getInternalRatings_(qPid) {
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.FACT_PERFORMANCE_RATINGS, {
        callerModule: MODULE,
        periodId:     qPid
      });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return {};
      throw e;
    }

    // Group by ratee: { ratee_code: { TEAM_LEAD: score, PM: score, CEO: score } }
    var byRatee = {};
    for (var i = 0; i < rows.length; i++) {
      var row       = rows[i];
      var rateeCode = String(row.ratee_code  || '').trim();
      var raterRole = String(row.rater_role  || '').toUpperCase().trim();
      var score     = parseFloat(row.avg_score_normalized);
      if (!rateeCode || isNaN(score)) continue;
      if (!byRatee[rateeCode]) byRatee[rateeCode] = {};
      byRatee[rateeCode][raterRole] = score;  // last write wins per role
    }

    var staffCache = buildStaffCache_();
    var result     = {};
    var ratees     = Object.keys(byRatee);

    for (var j = 0; j < ratees.length; j++) {
      var code   = ratees[j];
      var scores = byRatee[code];
      var staff  = staffCache[code];
      var role   = staff ? staff.role : '';

      if (role === 'DESIGNER') {
        var tlScore = scores['TEAM_LEAD'];
        var pmScore = scores['PM'];
        if (tlScore === undefined || pmScore === undefined) {
          result[code] = null;
        } else {
          result[code] = Math.round(((tlScore + pmScore) / 2) * 10000) / 10000;
        }
      } else if (role === 'TEAM_LEAD' || role === 'PM') {
        var ceoScore = scores['CEO'];
        result[code] = (ceoScore !== undefined) ? ceoScore : null;
      } else {
        result[code] = null;
      }
    }
    return result;
  }

  // ============================================================
  // SECTION 3: SCORE COMPUTATION (stub — implemented in Task 8)
  // ============================================================

  /**
   * Weighted composite: client(30%) + error(40%) + rating(30%)
   * All inputs 0.0–1.0. Returns 0.0–1.0 rounded to 4dp.
   */
  function computeCompositeScore_(clientScore, errorScore, ratingScore) {
    var c = WEIGHTS.client * (parseFloat(clientScore) || 0);
    var e = WEIGHTS.error  * (parseFloat(errorScore)  || 0);
    var r = WEIGHTS.rating * (parseFloat(ratingScore) || 0);
    return Math.round((c + e + r) * 10000) / 10000;
  }

  // ============================================================
  // SECTION 4: BONUS ROWS (stub — implemented in Task 8)
  // ============================================================

  /**
   * Builds bonus row objects — one per eligible staff member.
   * status = 'CALCULATED' | 'PENDING' | 'SKIPPED'
   */
  function computeBonuses_(staffCache, hoursMap, errorRates, clientScores, ratings, qPid) {
    var today = new Date();
    var rows  = [];
    var codes = Object.keys(staffCache);

    for (var i = 0; i < codes.length; i++) {
      var code  = codes[i];
      var staff = staffCache[code];

      if (!isEligible_(staff, today)) {
        rows.push({
          person_code:     code,
          name:            staff.name,
          role:            staff.role,
          quarter_period:  qPid,
          design_hours:    0,
          composite_score: 0,
          bonus_inr:       0,
          status:          'SKIPPED',
          pending_reason:  'not_eligible'
        });
        continue;
      }

      var designHours = hoursMap[code]    || 0;
      var errorScore  = (errorRates[code]  !== undefined) ? errorRates[code]  : 1.0;
      var clientScore = (clientScores[code] !== undefined) ? clientScores[code] : 0;
      var ratingScore = ratings[code];  // null = incomplete

      if (ratingScore === null || ratingScore === undefined) {
        rows.push({
          person_code:     code,
          name:            staff.name,
          role:            staff.role,
          quarter_period:  qPid,
          design_hours:    designHours,
          composite_score: 0,
          bonus_inr:       0,
          status:          'PENDING',
          pending_reason:  'ratings_incomplete'
        });
        continue;
      }

      var composite = computeCompositeScore_(clientScore, errorScore, ratingScore);
      var bonusInr  = Math.round(designHours * composite * BONUS_INR_PER_HOUR * 100) / 100;

      rows.push({
        person_code:     code,
        name:            staff.name,
        role:            staff.role,
        quarter_period:  qPid,
        design_hours:    designHours,
        client_score:    clientScore,
        error_score:     errorScore,
        rating_score:    ratingScore,
        composite_score: composite,
        bonus_inr:       bonusInr,
        status:          'CALCULATED'
      });
    }
    return rows;
  }

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
