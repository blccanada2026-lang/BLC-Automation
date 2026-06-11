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

  /**
   * Normalises a Sheets date cell to 'YYYY-MM-DD'.
   * Google Sheets auto-converts date strings to Date objects on write;
   * String(dateObject).slice(0,10) gives 'Mon Jan 01', not '2024-01-01'.
   */
  function toIsoDate_(val) {
    if (!val) return '';
    if (val instanceof Date) {
      return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
    return String(val).slice(0, 10);
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
        var code  = String(row.actor_code || row.person_code || '').trim();
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
    // Filter to only ratings for this specific quarter — FACT_PERFORMANCE_RATINGS is
    // not partitioned so it accumulates all quarters; period_id == qPid selects this one.
    var byRatee = {};
    for (var i = 0; i < rows.length; i++) {
      var row       = rows[i];
      var rowPeriod = String(row.period_id   || '').trim();
      var rateeCode = String(row.ratee_code  || '').trim();
      var raterRole = String(row.rater_role  || '').toUpperCase().trim();
      var score     = parseFloat(row.avg_score_normalized);
      if (rowPeriod !== qPid) continue;   // skip ratings from other quarters
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

      if (role === 'DESIGNER' || role === 'QC' || role === 'QC_REVIEWER') {
        var tlScore = scores['TEAM_LEAD'];
        var pmScore = scores['PM'];
        var managerScore;
        if (tlScore !== undefined && pmScore !== undefined) {
          managerScore = (tlScore + pmScore) / 2;  // both present — average
        } else if (pmScore !== undefined) {
          managerScore = pmScore;                   // no TL → PM rates alone
        } else if (tlScore !== undefined) {
          managerScore = tlScore;                   // no PM → TL rates alone
        } else {
          managerScore = undefined;
        }
        if (managerScore === undefined) {
          result[code] = null;
        } else {
          result[code] = Math.round(managerScore * 10000) / 10000;
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

  /**
   * Writes bonus rows to FACT_PAYROLL_LEDGER.
   * Skips SKIPPED rows. Writes CALCULATED and PENDING rows.
   * Idempotent — existing keys are skipped with a warning.
   */
  function writeBonusLedger_(bonusRows, actorEmail, qPid) {
    for (var i = 0; i < bonusRows.length; i++) {
      var row = bonusRows[i];
      if (row.status === 'SKIPPED') continue;

      var idempotencyKey = 'QUARTERLY_BONUS|' + row.person_code + '|' + qPid;

      var existing;
      try {
        existing = DAL.readWhere(
          Config.TABLES.FACT_QUARTERLY_BONUS,
          { idempotency_key: idempotencyKey },
          { callerModule: MODULE }
        );
      } catch (e) {
        if (e.code === 'SHEET_NOT_FOUND') existing = [];
        else throw e;
      }

      if (existing.length > 0) {
        Logger.warn('QB_DUPLICATE_SKIP', { module: MODULE,
          message: 'Quarterly bonus already recorded — skipping',
          person_code: row.person_code, quarterPeriodId: qPid });
        continue;
      }

      DAL.appendRow(Config.TABLES.FACT_QUARTERLY_BONUS, {
        bonus_id:        Identifiers.generateId(),
        event_type:      'QUARTERLY_BONUS',
        person_code:     row.person_code,
        quarter_period_id: qPid,
        design_hours:    row.design_hours,
        client_score:    row.client_score    || 0,
        error_score:     row.error_score     || 0,
        rating_score:    row.rating_score    || 0,
        composite_score: row.composite_score || 0,
        bonus_inr:       row.bonus_inr       || 0,
        status:          row.status,
        pending_reason:  row.pending_reason  || '',
        actor_email:     actorEmail,
        timestamp:       new Date().toISOString(),
        idempotency_key: idempotencyKey
      }, { callerModule: MODULE });

      Logger.info('QB_ROW_WRITTEN', { module: MODULE,
        message: 'Quarterly bonus row written',
        person_code: row.person_code, status: row.status, amount_inr: row.bonus_inr });
    }
  }

  // ============================================================
  // SECTION 6: ANNUAL BONUS (stub — implemented in Task 10)
  // ============================================================

  /**
   * Reads all 4 quarterly bonus rows for the year and writes one
   * ANNUAL_BONUS row per person = sum of Q1+Q2+Q3+Q4 CALCULATED amounts.
   */
  function runAnnualBonus_(actorEmail, year) {
    var quarters  = ['Q1', 'Q2', 'Q3', 'Q4'];
    var yearStr   = String(year);
    var annualPid = 'ANNUAL-' + yearStr;
    var totals    = {};
    var written   = 0;
    var skipped   = 0;

    var allRows;
    try {
      allRows = DAL.readAll(Config.TABLES.FACT_QUARTERLY_BONUS, { callerModule: MODULE });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') allRows = [];
      else throw e;
    }

    var validQPids = {};
    for (var q = 0; q < quarters.length; q++) {
      validQPids[quarterPeriodId_(quarters[q], year)] = true;
    }

    for (var i = 0; i < allRows.length; i++) {
      var row    = allRows[i];
      var qPid   = String(row.quarter_period_id || '').trim();
      var evType = String(row.event_type        || '').trim();
      var status = String(row.status            || '').trim();
      var code   = String(row.person_code       || '').trim();
      var amt    = parseFloat(row.bonus_inr)    || 0;
      if (!validQPids[qPid] || evType !== 'QUARTERLY_BONUS' || status !== 'CALCULATED' || !code) continue;
      totals[code] = (totals[code] || 0) + amt;
    }

    var codes = Object.keys(totals);
    for (var j = 0; j < codes.length; j++) {
      if (j > 0 && j % 10 === 0 && HealthMonitor.isApproachingLimit()) {
        Logger.warn('QB_ANNUAL_QUOTA_CUTOFF', {
          module:    MODULE,
          message:   'Quota limit approaching — annual bonus run stopped early',
          processed: j,
          total:     codes.length
        });
        return { written: written, skipped: skipped, year: year, partial: true };
      }
      var personCode     = codes[j];
      var annualAmount   = Math.round(totals[personCode] * 100) / 100;
      var idempotencyKey = 'ANNUAL_BONUS|' + personCode + '|' + yearStr;

      var existing;
      try {
        existing = DAL.readWhere(
          Config.TABLES.FACT_QUARTERLY_BONUS,
          { idempotency_key: idempotencyKey },
          { callerModule: MODULE }
        );
      } catch (e) {
        if (e.code === 'SHEET_NOT_FOUND') existing = [];
        else throw e;
      }

      if (existing.length > 0) {
        Logger.warn('QB_ANNUAL_DUPLICATE', { module: MODULE,
          message: 'Annual bonus already recorded',
          person_code: personCode, year: year });
        skipped++;
        continue;
      }

      DAL.appendRow(Config.TABLES.FACT_QUARTERLY_BONUS, {
        bonus_id:          Identifiers.generateId(),
        event_type:        'ANNUAL_BONUS',
        person_code:       personCode,
        quarter_period_id: annualPid,
        design_hours:      0,
        client_score:      0,
        error_score:       0,
        rating_score:      0,
        composite_score:   0,
        bonus_inr:         annualAmount,
        status:            'CALCULATED',
        pending_reason:    '',
        actor_email:       actorEmail,
        timestamp:         new Date().toISOString(),
        idempotency_key:   idempotencyKey
      }, { callerModule: MODULE });

      Logger.info('QB_ANNUAL_WRITTEN', { module: MODULE,
        message: 'Annual bonus written',
        person_code: personCode, amount_inr: annualAmount, year: year });
      written++;
    }

    return { written: written, skipped: skipped, year: year };
  }

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
        start_date:      toIsoDate_(row.effective_from || row.start_date)
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
   * @returns {{ written: number, skipped: number, year: number }}
   */
  function runAnnualBonus(actorEmail, year) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN);
    RBAC.enforceFinancialAccess(actor);
    return runAnnualBonus_(actorEmail, year);
  }

  return {
    runQuarterlyBonus:     runQuarterlyBonus,
    previewQuarterlyBonus: previewQuarterlyBonus,
    runAnnualBonus:        runAnnualBonus
  };

}());

// ── Editor runners ─────────────────────────────────────────

/** Preview Q1 2026 bonus — writes nothing, logs results. */
function runPreviewQ1Bonus() {
  var result = QuarterlyBonusEngine.previewQuarterlyBonus('raj.nair@bluelotuscanada.ca', 'Q1', 2026);
  console.log(JSON.stringify(result, null, 2));
}

/** Commit Q1 2026 bonus to FACT_PAYROLL_LEDGER. Only run after reviewing preview. */
function runCommitQ1Bonus() {
  var result = QuarterlyBonusEngine.runQuarterlyBonus('raj.nair@bluelotuscanada.ca', 'Q1', 2026);
  console.log(JSON.stringify(result, null, 2));
}

/** Diagnostic — checks FACT_WORK_LOGS partitions for Q1 2026 and reports row counts. */
function runDiagnoseAllRatings() {
  try {
    var rows = DAL.readAll(Config.TABLES.FACT_PERFORMANCE_RATINGS, { callerModule: 'QuarterlyBonusEngine' });
    console.log('FACT_PERFORMANCE_RATINGS — ALL rows: ' + rows.length);
    var byPeriod = {};
    rows.forEach(function(r) {
      var pid = String(r.period_id || '(blank)').trim();
      if (!byPeriod[pid]) byPeriod[pid] = 0;
      byPeriod[pid]++;
    });
    Object.keys(byPeriod).sort().forEach(function(pid) {
      console.log('  period_id="' + pid + '": ' + byPeriod[pid] + ' rows');
    });
    if (rows.length > 0) {
      console.log('  Sample row: rater_code=' + rows[rows.length-1].rater_code +
                  ' rater_role=' + rows[rows.length-1].rater_role +
                  ' ratee_code=' + rows[rows.length-1].ratee_code +
                  ' period_id=' + rows[rows.length-1].period_id +
                  ' submitted_at=' + rows[rows.length-1].submitted_at);
    }
  } catch(e) { console.log('❌ ' + e.message); }
}

function runDiagnoseQ1Ratings() {
  var qPid = '2026-Q1';
  try {
    var rows = DAL.readAll(Config.TABLES.FACT_PERFORMANCE_RATINGS, { callerModule: 'QuarterlyBonusEngine' });
    var q1   = rows.filter(function(r) { return String(r.period_id || '').trim() === qPid; });
    console.log('FACT_PERFORMANCE_RATINGS — ' + qPid + ': ' + q1.length + ' rows total');
    if (q1.length === 0) { console.log('  ⚠️  No ratings found for ' + qPid); return; }
    // Group by ratee
    var byRatee = {};
    q1.forEach(function(r) {
      var ratee = String(r.ratee_code || '').trim();
      var role  = String(r.rater_role || '').trim().toUpperCase();
      var score = r.avg_score_normalized;
      if (!ratee) return;
      if (!byRatee[ratee]) byRatee[ratee] = {};
      byRatee[ratee][role] = score;
    });
    console.log('  Ratings by ratee:');
    Object.keys(byRatee).sort().forEach(function(code) {
      var scores = byRatee[code];
      var parts  = Object.keys(scores).map(function(role) { return role + '=' + scores[role]; });
      console.log('    ' + code + ': ' + parts.join(', '));
    });
    // Show who is missing what
    var staffRows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'QuarterlyBonusEngine' });
    console.log('  Missing ratings:');
    staffRows.forEach(function(s) {
      var code = String(s.person_code || '').trim();
      var role = String(s.role || '').toUpperCase().trim();
      if (!code || String(s.active || '').toUpperCase() !== 'TRUE') return;
      var scores = byRatee[code] || {};
      if (role === 'DESIGNER' || role === 'QC_REVIEWER') {
        // RULE: if no TL rating, PM rating alone suffices. Flag only if BOTH are missing.
        var hasTL = scores['TEAM_LEAD'] !== undefined;
        var hasPM = scores['PM']        !== undefined;
        if (!hasTL && !hasPM) {
          console.log('    ' + code + ' (' + role + '): missing both TEAM_LEAD and PM — no rating score');
        } else if (!hasPM) {
          console.log('    ' + code + ' (' + role + '): missing PM (TL-only score will be used)');
        } else if (!hasTL) {
          console.log('    ' + code + ' (' + role + '): no TL — PM score used as fallback');
        }
      } else if (role === 'TEAM_LEAD' || role === 'PM') {
        if (scores['CEO'] === undefined) console.log('    ' + code + ' (' + role + '): missing CEO');
      }
    });
  } catch(e) {
    console.log('❌ ' + e.message);
  }
}

function runDiagnoseQ1Hours() {
  var periods = ['2026-01', '2026-02', '2026-03'];
  periods.forEach(function(pid) {
    try {
      var rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, { callerModule: 'QuarterlyBonusEngine', periodId: pid });
      var totalHours = 0;
      rows.forEach(function(r) { totalHours += parseFloat(r.hours) || 0; });
      console.log(pid + ': ' + rows.length + ' rows, ' + totalHours + ' total hours');
      if (rows.length > 0) {
        var sample = rows[0];
        console.log('  columns in row 0: ' + Object.keys(sample).join(', '));
        console.log('  actor_code="' + sample.actor_code + '"  person_code="' + sample.person_code + '"  hours="' + sample.hours + '"');
        var withCode = 0, withoutCode = 0, hoursWithCode = 0;
        rows.forEach(function(r) {
          var code = String(r.actor_code || '').trim();
          if (code) { withCode++; hoursWithCode += parseFloat(r.hours) || 0; }
          else { withoutCode++; }
        });
        console.log('  rows WITH actor_code: ' + withCode + ' (' + hoursWithCode + ' hrs)');
        console.log('  rows WITHOUT actor_code: ' + withoutCode);
      }
    } catch(e) {
      console.log(pid + ': ❌ ' + e.message);
    }
  });
}

/**
 * Per-designer Q1 2026 hours audit.
 * Logs one row per designer: code | name | Jan hrs | Feb hrs | Mar hrs | Q1 total | QC hrs | flags
 * Flags: MISSING_CODE (actor_code blank, person_code used), INACTIVE (not active in roster),
 *        NOT_IN_ROSTER (code not found in DIM_STAFF_ROSTER).
 * Run in Apps Script editor — output goes to Execution Log.
 */
function runQ1BonusAuditDetailed() {
  var periods      = ['2026-01', '2026-02', '2026-03'];
  var MODULE_AUDIT = 'QuarterlyBonusEngine:Audit';

  // 1. Build roster lookup: person_code → { name, role, active }
  var rosterRows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: MODULE_AUDIT });
  var rosterMap  = {};
  rosterRows.forEach(function(r) {
    var code = String(r.person_code || '').trim();
    if (!code) return;
    rosterMap[code] = {
      name:   String(r.full_name || r.name || '').trim(),
      role:   String(r.role || '').trim().toUpperCase(),
      active: String(r.active || '').toLowerCase() === 'true'
    };
  });

  // 2. Accumulate hours per code, per month
  //    perCode[code] = { jan: 0, feb: 0, mar: 0, qcHrs: 0, missingCodeRows: 0, dupeKeys: {} }
  var perCode    = {};
  var dupeCheck  = {};   // key → count (for duplicate row detection)

  periods.forEach(function(pid, pIdx) {
    var monthKey = ['jan', 'feb', 'mar'][pIdx];
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, { callerModule: MODULE_AUDIT, periodId: pid });
    } catch(e) {
      if (e.code === 'SHEET_NOT_FOUND') {
        console.log('⚠️  ' + pid + ': partition not found — skipped');
        return;
      }
      throw e;
    }

    rows.forEach(function(row) {
      var rawCode   = String(row.actor_code  || '').trim();
      var fallback  = String(row.person_code || '').trim();
      var code      = rawCode || fallback;
      var role      = String(row.actor_role  || '').toUpperCase();
      var hours     = parseFloat(row.hours)  || 0;
      var isMissing = !rawCode && !!fallback;

      if (!code || hours <= 0) return;

      // Duplicate detection: same code + date + hours in same partition
      var dupeKey = pid + '|' + code + '|' + (row.work_date || row.date || '') + '|' + hours;
      dupeCheck[dupeKey] = (dupeCheck[dupeKey] || 0) + 1;

      if (!perCode[code]) {
        perCode[code] = { jan: 0, feb: 0, mar: 0, qcHrs: 0, missingCodeRows: 0 };
      }

      if (role === 'QC') {
        perCode[code].qcHrs += hours;
      } else {
        perCode[code][monthKey] += hours;
      }

      if (isMissing) perCode[code].missingCodeRows++;
    });
  });

  // 3. Detect duplicate rows
  var dupeCodes = {};
  Object.keys(dupeCheck).forEach(function(k) {
    if (dupeCheck[k] > 1) {
      var code = k.split('|')[1];
      dupeCodes[code] = (dupeCodes[code] || 0) + (dupeCheck[k] - 1);
    }
  });

  // 4. Print header
  console.log('\n====== Q1 2026 Per-Designer Hours Audit ======');
  console.log('CODE       | NAME                     | JAN    | FEB    | MAR    | Q1 TOT | QC HRS | FLAGS');
  console.log('-----------|--------------------------|--------|--------|--------|--------|--------|-------------------------');

  var codes = Object.keys(perCode).sort();
  var grandTotal = 0;

  codes.forEach(function(code) {
    var d       = perCode[code];
    var roster  = rosterMap[code];
    var jan     = Math.round(d.jan  * 100) / 100;
    var feb     = Math.round(d.feb  * 100) / 100;
    var mar     = Math.round(d.mar  * 100) / 100;
    var q1tot   = Math.round((jan + feb + mar) * 100) / 100;
    var qcHrs   = Math.round(d.qcHrs * 100) / 100;
    grandTotal += q1tot;

    var flags = [];
    if (d.missingCodeRows > 0) flags.push('MISSING_CODE(' + d.missingCodeRows + ')');
    if (dupeCodes[code])       flags.push('DUPE_ROWS(' + dupeCodes[code] + ')');
    if (!roster)               flags.push('NOT_IN_ROSTER');
    else if (!roster.active)   flags.push('INACTIVE');

    var name = roster ? roster.name : '???';
    console.log(
      pad_(code, 10) + ' | ' + pad_(name, 24) + ' | ' +
      pad_(jan,  6)  + ' | ' + pad_(feb, 6) + ' | ' + pad_(mar, 6) + ' | ' +
      pad_(q1tot, 6) + ' | ' + pad_(qcHrs, 6) + ' | ' +
      (flags.length ? flags.join(', ') : 'OK')
    );
  });

  console.log('-----------|--------------------------|--------|--------|--------|--------|--------|');
  console.log('           | GRAND TOTAL DESIGN HRS   |        |        |        | ' + Math.round(grandTotal * 100) / 100);
  console.log('\nDuplicate row count (extra occurrences): ' + Object.keys(dupeCodes).length + ' designers affected');
  console.log('Designers not in roster: ' + codes.filter(function(c) { return !rosterMap[c]; }).length);
  console.log('Inactive designers with hours: ' + codes.filter(function(c) { return rosterMap[c] && !rosterMap[c].active; }).length);
  console.log('====== End Audit ======\n');
}

/** Left-pads or truncates a value to a fixed width for console alignment. */
function pad_(val, width) {
  var s = String(val);
  if (s.length > width) return s.slice(0, width);
  while (s.length < width) s = s + ' ';
  return s;
}

/**
 * Dumps the first 30 raw rows for a specific designer in a given partition.
 * Use to confirm whether work_date is populated and whether rows are truly duplicated.
 * Example: runQ1DupeInspector('BCH', '2026-01')
 */
function runQ1DupeInspector(code, periodId) {
  code     = code     || 'BCH';
  periodId = periodId || '2026-01';
  var rows;
  try {
    rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, { callerModule: 'QuarterlyBonusEngine', periodId: periodId });
  } catch(e) {
    console.log('❌ ' + e.message);
    return;
  }
  var myRows = rows.filter(function(r) {
    var c = String(r.actor_code || r.person_code || '').trim();
    return c === code;
  });
  console.log('=== ' + code + ' in ' + periodId + ' — ' + myRows.length + ' rows ===');
  console.log('Available columns: ' + (myRows.length ? Object.keys(myRows[0]).join(', ') : '—'));
  myRows.slice(0, 30).forEach(function(r, i) {
    console.log(
      i + ') work_date="' + (r.work_date||r.date||'') + '"' +
      '  hours=' + r.hours +
      '  actor_role=' + (r.actor_role||'') +
      '  source=' + (r.source||r.import_batch||'') +
      '  event_id=' + (r.event_id||r.row_id||'')
    );
  });
}

/**
 * For each Q1 partition, counts total rows, unique (actor_code+date+hours) keys, and excess rows.
 * Prints a per-partition summary to confirm whether double-import occurred at the batch level.
 */
function runQ1DupeSummaryByPartition() {
  var periods = ['2026-01', '2026-02', '2026-03'];
  periods.forEach(function(pid) {
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, { callerModule: 'QuarterlyBonusEngine', periodId: pid });
    } catch(e) {
      console.log(pid + ': ❌ ' + e.message);
      return;
    }
    var keyCount = {};
    var totalHours = 0;
    rows.forEach(function(r) {
      var code  = String(r.actor_code || r.person_code || '').trim();
      var hrs   = parseFloat(r.hours) || 0;
      var date  = String(r.work_date || r.date || '').trim();
      var role  = String(r.actor_role || '').toUpperCase();
      if (role !== 'QC') totalHours += hrs;
      var key = code + '|' + date + '|' + hrs;
      keyCount[key] = (keyCount[key] || 0) + 1;
    });
    var uniqueKeys    = Object.keys(keyCount).length;
    var excessRows    = Object.values(keyCount).reduce(function(s, v) { return s + (v - 1); }, 0);
    var noDateRows    = rows.filter(function(r) { return !String(r.work_date || r.date || '').trim(); }).length;
    console.log(pid + ': total=' + rows.length + '  uniqueKeys=' + uniqueKeys + '  excessRows=' + excessRows + '  noDateRows=' + noDateRows + '  designHrs=' + Math.round(totalHours * 100) / 100);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Q1 2026 MANUAL CORRECTION BASELINE
// Source: HR manual calculations file, verified 2026-06-11.
// Authoritative hours from Stacey V2 source.  Composite scores from system.
// Correct bonus per designer = hours × composite × INR 25.
// ─────────────────────────────────────────────────────────────────────────────
var Q1_MANUAL_HRS_ = {
  'AR001': { name: 'Abhisek Rit',      hrs: 64,     comp: 0.4750 },
  'NMM':   { name: 'Nitesh Mishra',    hrs: 24.75,  comp: 0.5313 },
  'PRS':   { name: 'Priyanka S',       hrs: 110,    comp: 0.5313 },
  'RKU':   { name: 'Raj Kumar',        hrs: 361.25, comp: 0.6250 },
  'DBG':   { name: 'Debby Gosh',       hrs: 450.5,  comp: 0.6063 },
  'DBS':   { name: 'Deb Sen',          hrs: 346.25, comp: 0.6063 },
  'PBG':   { name: 'Pabitra Gosh',     hrs: 306.5,  comp: 0.6250 },
  'SVN':   { name: 'Savvy Nath',       hrs: 442,    comp: 0.6813 },
  'SDA':   { name: 'Samar Kumar Das',  hrs: 512.5,  comp: 0.6250 },
  'BCH':   { name: 'Bharath Charles',  hrs: 451,    comp: 0.6250 },
  'SGO':   { name: 'Sarty Gosh',       hrs: 236.5,  comp: 0.6625 },
  'RKG':   { name: 'RaviKumar G',      hrs: 297,    comp: 0.6063 },
  'VKV':   { name: 'Vani KV',          hrs: 92.9,   comp: 0.5500 },
  'SYR':   { name: 'Sayan Roy',        hrs: 460.25, comp: 0.6063 },
  'ABB':   { name: 'Abhijit Bera',     hrs: 512.5,  comp: 0.5875 },
  'JYS':   { name: 'Joy Sarkar',       hrs: 29.75,  comp: 0.5219 }
};

/**
 * Full Q1 2026 correction report — two sections:
 *  Part 1: Hours — manual vs system corrected vs system inflated, with root-cause per designer.
 *  Part 2: Bonus — correct bonus (manual hrs × composite × 25) vs current ledger, delta per designer.
 *
 * Run this first. Review the output. Then run runQ1ApplyManualCorrections() to write amendments.
 */
function runQ1ManualCorrectionReport() {
  var qPid    = '2026-Q1';
  var periods = ['2026-01', '2026-02', '2026-03'];
  var CALLER  = 'QuarterlyBonusEngine:Corr';

  // ── Step 1: compute per-designer hours from FACT_WORK_LOGS ──────────────
  var inflated = {}, corrected = {}, qcHrs = {}, seen = {};
  var monthly  = {};   // code → { jan, feb, mar }  — corrected design only

  periods.forEach(function(pid, pIdx) {
    var mKey = ['jan', 'feb', 'mar'][pIdx];
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, { callerModule: CALLER, periodId: pid });
    } catch(e) {
      if (e.code === 'SHEET_NOT_FOUND') { console.log('⚠️  ' + pid + ' not found'); return; }
      throw e;
    }
    rows.forEach(function(row) {
      var code  = String(row.actor_code || row.person_code || '').trim();
      var role  = String(row.actor_role || '').toUpperCase();
      var hours = parseFloat(row.hours) || 0;
      var date  = String(row.work_date || row.date || '').trim();
      if (!code || hours <= 0) return;

      var key   = pid + '|' + code + '|' + date + '|' + hours;
      var isNew = !seen[key];
      seen[key] = true;

      if (role === 'QC') {
        if (isNew) qcHrs[code] = (qcHrs[code] || 0) + hours;
      } else {
        inflated[code] = (inflated[code] || 0) + hours;
        if (isNew) {
          corrected[code] = (corrected[code] || 0) + hours;
          if (!monthly[code]) monthly[code] = { jan: 0, feb: 0, mar: 0 };
          monthly[code][mKey] += hours;
        }
      }
    });
  });

  // ── Step 2: read current ledger state ───────────────────────────────────
  var ledgerRows = DAL.readAll(Config.TABLES.FACT_QUARTERLY_BONUS, { callerModule: CALLER });
  var ledger = {};
  ledgerRows.forEach(function(r) {
    if (String(r.quarter_period_id || '').trim() !== qPid) return;
    var code = String(r.person_code || '').trim();
    if (!code) return;
    if (!ledger[code] || r.event_type === 'QUARTERLY_BONUS_AMENDMENT') ledger[code] = r;
  });

  // ── Part 1: Hours comparison ─────────────────────────────────────────────
  console.log('\n══════ PART 1 — Q1 2026 HOURS (Manual vs System) ══════');
  console.log('CODE   DESIGNER              MAN.HRS  SYS.CORR  SYS.INFL  QC.FILT  J/F/M (corrected)       ROOT CAUSE');
  console.log('────── ─────────────────── ──────── ─────────  ──────── ──────── ─────────────────────── ─────────────────────────────────────');

  var codes = Object.keys(Q1_MANUAL_HRS_).sort();
  codes.forEach(function(code) {
    var m   = Q1_MANUAL_HRS_[code];
    var inf = Math.round((inflated[code]  || 0) * 100) / 100;
    var cor = Math.round((corrected[code] || 0) * 100) / 100;
    var qc  = Math.round((qcHrs[code]    || 0) * 100) / 100;
    var dupe = Math.round((inf - cor) * 100) / 100;
    var mc  = monthly[code] || { jan: 0, feb: 0, mar: 0 };
    var mthStr = 'J:' + mc.jan + ' F:' + mc.feb + ' M:' + Math.round(mc.mar * 100) / 100;

    var reason;
    var diff = cor - m.hrs;
    if (code === 'RKU') {
      reason = 'QC role filter removed ' + qc + ' hrs. Manual counts all hours.';
    } else if (Math.abs(diff) < 2 && dupe === 0) {
      reason = 'CLEAN — hours match';
    } else if (Math.abs(diff) < 2 && dupe > 0) {
      reason = 'Dup rows (' + dupe + ' hrs) but corrected total matches manual';
    } else if (cor >= m.hrs * 1.9 && cor <= m.hrs * 2.1 && dupe < 1) {
      reason = '⚠️  CROSS-PERIOD: ' + (m.hrs) + ' hrs imported under 2 period_ids';
    } else if (diff > 10) {
      reason = '⚠️  OVER-IMPORT: +' + Math.round(diff*100)/100 + ' extra hrs vs Stacey V2' + (dupe > 1 ? ' (incl. ' + dupe + ' dup hrs)' : '');
    } else if (diff < -10) {
      reason = '⚠️  UNDER-IMPORT: ' + Math.round(-diff*100)/100 + ' hrs missing from Nexus' + (dupe > 1 ? ' (plus ' + dupe + ' dup hrs)' : '');
    } else {
      reason = (dupe > 0 ? 'Minor dup rows (' + dupe + ' hrs) ' : '') + 'Small gap (' + Math.round(diff*100)/100 + ' hrs)';
    }

    console.log(
      pad_(code,7) + pad_(m.name,19) + '  ' +
      pad_(m.hrs,8) + ' ' + pad_(cor,9) + '  ' + pad_(inf,8) + ' ' + pad_(qc,8) + ' ' +
      pad_(mthStr,23) + ' ' + reason
    );
  });

  // ── Part 2: Bonus comparison ─────────────────────────────────────────────
  console.log('\n══════ PART 2 — Q1 2026 BONUS (Correct vs Ledger) ══════');
  console.log('CODE   DESIGNER              MAN.HRS  COMPOSITE  CORRECT BONUS  LEDGER BONUS   DELTA        LEDGER HRS');
  console.log('────── ─────────────────── ──────── ─────────  ─────────────  ─────────────  ───────────  ──────────');

  var totalCorrect = 0, totalLedger = 0;
  codes.forEach(function(code) {
    var m       = Q1_MANUAL_HRS_[code];
    var le      = ledger[code];
    var ledComp = le ? (parseFloat(le.composite_score) || m.comp) : m.comp;
    var correct = Math.round(m.hrs * ledComp * 25 * 100) / 100;
    var paid    = le ? (Math.round((parseFloat(le.bonus_inr) || 0) * 100) / 100) : 0;
    var lHrs    = le ? (parseFloat(le.design_hours) || 0) : 0;
    var delta   = Math.round((correct - paid) * 100) / 100;
    totalCorrect += correct;
    totalLedger  += paid;

    var flag = !le ? '⚠️ NOT IN LEDGER' : (Math.abs(delta) < 1 ? '✓' : (delta > 0 ? '↑ PAY MORE' : '↓ REDUCE'));
    console.log(
      pad_(code,7) + pad_(m.name,19) + '  ' +
      pad_(m.hrs,8) + ' ' + pad_(Math.round(ledComp*10000)/100 + '%', 9) + '  ' +
      '₹' + pad_(correct,13) + ' ₹' + pad_(paid,13) + ' ₹' + pad_(delta,11) + '  ' + lHrs + '  ' + flag
    );
  });

  console.log('────── ─────────────────── ──────── ─────────  ─────────────  ─────────────  ───────────');
  console.log(pad_('TOTAL',7) + pad_('',19) + '  ' + pad_('',8) + ' ' + pad_('',9) + '  ' +
    '₹' + pad_(Math.round(totalCorrect),13) + ' ₹' + pad_(Math.round(totalLedger),13) + ' ₹' + Math.round(totalCorrect - totalLedger));

  // ── BSG check ────────────────────────────────────────────────────────────
  var bsgEntry = ledger['BSG'];
  if (bsgEntry) {
    console.log('\n⚠️  BSG (Banik Sagar — INACTIVE, not in manual): ledger shows ₹' + bsgEntry.bonus_inr + '. Verify eligibility before paying.');
  }

  console.log('\n─── Next step ───────────────────────────────────────────────────');
  console.log('If Part 2 DELTA column looks correct → run runQ1ApplyManualCorrections().');
  console.log('That writes QUARTERLY_BONUS_AMENDMENT rows using manual hours. Idempotent — safe to re-run.');
}

/**
 * Writes QUARTERLY_BONUS_AMENDMENT rows to FACT_QUARTERLY_BONUS using the manual
 * correction baseline (Q1_MANUAL_HRS_).  Copies component scores from the existing
 * ledger entry; overrides design_hours, composite_score, and bonus_inr.
 * Idempotent: uses QB_MANUAL_CORR|{code}|2026-Q1 key — safe to re-run.
 *
 * Run ONLY after reviewing runQ1ManualCorrectionReport() output.
 */
function runQ1ApplyManualCorrections() {
  var qPid   = '2026-Q1';
  var CALLER = 'QuarterlyBonusEngine';
  var actor  = Session.getActiveUser().getEmail();

  // ── Read existing ledger ─────────────────────────────────────
  var ledgerRows = DAL.readAll(Config.TABLES.FACT_QUARTERLY_BONUS, { callerModule: CALLER });
  var byPerson = {}, existingAmendKeys = {};
  ledgerRows.forEach(function(r) {
    var code = String(r.person_code || '').trim();
    var key  = String(r.idempotency_key || '').trim();
    if (key.indexOf('QB_MANUAL_CORR|') === 0) existingAmendKeys[key] = true;
    if (code && String(r.quarter_period_id || '').trim() === qPid) {
      if (!byPerson[code] || r.event_type === 'QUARTERLY_BONUS_AMENDMENT') byPerson[code] = r;
    }
  });

  // ── Compute average rating score across the 16 manual designers ──
  // Used as client_score proxy — Q1 client feedback was not collected.
  // Rationale: team performance rating is the closest proxy for client satisfaction.
  var ratingSamples = Object.keys(Q1_MANUAL_HRS_).map(function(c) {
    return byPerson[c] ? (parseFloat(byPerson[c].rating_score) || 0) : 0;
  }).filter(function(s) { return s > 0; });

  var avgRating = ratingSamples.length
    ? ratingSamples.reduce(function(a, b) { return a + b; }, 0) / ratingSamples.length
    : 0;
  avgRating = Math.round(avgRating * 10000) / 10000;

  console.log('Q1 client score proxy (avg team rating): ' + Math.round(avgRating * 10000) / 100 + '%');
  console.log('Composite = avg_rating×30% + error×40% + own_rating×30%\n');

  var written = 0, skipped = 0;
  Object.keys(Q1_MANUAL_HRS_).sort().forEach(function(code) {
    var m        = Q1_MANUAL_HRS_[code];
    var amendKey = 'QB_MANUAL_CORR|' + code + '|' + qPid;

    if (existingAmendKeys[amendKey]) {
      console.log('  SKIP ' + code + ' — already corrected');
      skipped++;
      return;
    }

    var existing    = byPerson[code] || {};
    var errorScore  = parseFloat(existing.error_score)  || 0;
    var ownRating   = parseFloat(existing.rating_score) || 0;
    var composite   = Math.round((avgRating * 0.30 + errorScore * 0.40 + ownRating * 0.30) * 10000) / 10000;
    var bonusInr    = Math.round(m.hrs * composite * 25 * 100) / 100;

    DAL.appendRow(Config.TABLES.FACT_QUARTERLY_BONUS, {
      bonus_id:          Identifiers.generateId(),
      event_type:        'QUARTERLY_BONUS_AMENDMENT',
      person_code:       code,
      quarter_period_id: qPid,
      design_hours:      m.hrs,
      client_score:      avgRating,
      error_score:       errorScore,
      rating_score:      ownRating,
      composite_score:   composite,
      bonus_inr:         bonusInr,
      status:            'CALCULATED',
      pending_reason:    'Manual correction 2026-06-11: hrs from Stacey V2; client_score = avg team rating (Q1 proxy)',
      actor_email:       actor,
      timestamp:         new Date().toISOString(),
      idempotency_key:   amendKey
    }, { callerModule: CALLER });

    console.log('  ' + pad_(code,6) + pad_(m.name,22) +
                m.hrs + 'h  client=' + Math.round(avgRating*10000)/100 + '%' +
                '  err=' + Math.round(errorScore*10000)/100 + '%' +
                '  rating=' + Math.round(ownRating*10000)/100 + '%' +
                '  → composite=' + Math.round(composite*10000)/100 + '%' +
                '  → ₹' + bonusInr);
    written++;
  });

  console.log('\nDone. ' + written + ' amendments written, ' + skipped + ' already applied.');
  if (written > 0) console.log('Next: run runSendQ1BonusLetters()');
}

/** Diagnoses supervisor_code and pm_code for designers who are still missing ratings. */
function runDiagnoseRatingAssignments() {
  var missing = ['DBG','DBS','PRS','NMM','AR001','BSG','RKU'];
  var rows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'QuarterlyBonusEngine' });
  var seen = {};
  console.log('supervisor_code and pm_code for missing-rating staff:');
  rows.forEach(function(r) {
    var code = String(r.person_code || '').trim();
    if (!code || seen[code]) return;
    if (missing.indexOf(code) === -1) return;
    seen[code] = true;
    console.log('  ' + code + ' | active=' + r.active + ' | role=' + r.role +
                ' | supervisor_code="' + (r.supervisor_code||'') + '"' +
                ' | pm_code="' + (r.pm_code||'') + '"' +
                ' | email="' + (r.email||'') + '"');
  });
}

/**
 * Recomputes Q1 2026 design hours per designer after deduplicating by (actor_code, work_date, hours).
 * This is the TRUE baseline the bonus engine should have used.
 * noDateRows=0 confirmed → duplicates are real double-imports, not false positives.
 */
function runQ1CorrectedHours() {
  var periods      = ['2026-01', '2026-02', '2026-03'];
  var MODULE_AUDIT = 'QuarterlyBonusEngine:Audit';

  var rosterRows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: MODULE_AUDIT });
  var rosterMap  = {};
  rosterRows.forEach(function(r) {
    var code = String(r.person_code || '').trim();
    if (code) rosterMap[code] = String(r.full_name || r.name || code).trim();
  });

  var perCode  = {};  // code → { jan, feb, mar, qcHrs }
  var seen     = {};  // global dedup key set

  periods.forEach(function(pid, pIdx) {
    var monthKey = ['jan', 'feb', 'mar'][pIdx];
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, { callerModule: MODULE_AUDIT, periodId: pid });
    } catch(e) {
      if (e.code === 'SHEET_NOT_FOUND') { console.log('⚠️  ' + pid + ' not found'); return; }
      throw e;
    }
    rows.forEach(function(row) {
      var code  = String(row.actor_code || row.person_code || '').trim();
      var role  = String(row.actor_role || '').toUpperCase();
      var hours = parseFloat(row.hours) || 0;
      var date  = String(row.work_date || row.date || '').trim();
      if (!code || hours <= 0) return;
      var key = pid + '|' + code + '|' + date + '|' + hours;
      if (seen[key]) return;
      seen[key] = true;
      if (!perCode[code]) perCode[code] = { jan: 0, feb: 0, mar: 0, qcHrs: 0 };
      if (role === 'QC') perCode[code].qcHrs += hours;
      else perCode[code][monthKey] += hours;
    });
  });

  console.log('\n====== Q1 2026 CORRECTED Hours (Deduplicated) ======');
  console.log('CODE       | NAME                     | JAN    | FEB    | MAR    | Q1 TRUE');
  console.log('-----------|--------------------------|--------|--------|--------|--------');
  var grandTrue = 0;
  Object.keys(perCode).sort().forEach(function(code) {
    var d    = perCode[code];
    var jan  = Math.round(d.jan  * 100) / 100;
    var feb  = Math.round(d.feb  * 100) / 100;
    var mar  = Math.round(d.mar  * 100) / 100;
    var tot  = Math.round((jan + feb + mar) * 100) / 100;
    grandTrue += tot;
    console.log(pad_(code,10) + ' | ' + pad_(rosterMap[code]||'???',24) + ' | ' +
                pad_(jan,6) + ' | ' + pad_(feb,6) + ' | ' + pad_(mar,6) + ' | ' + tot);
  });
  console.log('-----------|--------------------------|--------|--------|--------|--------');
  console.log('           | GRAND TRUE DESIGN TOTAL  |        |        |        | ' + Math.round(grandTrue * 100) / 100);
  console.log('====== End Corrected Hours ======\n');
}

/**
 * Reads FACT_QUARTERLY_BONUS, computes corrected hours via deduplication,
 * then shows per-designer: hours used, corrected hours, bonus paid, corrected bonus, and delta.
 * Negative delta = overpayment. Call this BEFORE writing any amendments.
 */
function runQ1BonusOverpaymentReport() {
  var qPid         = '2026-Q1';
  var MODULE_AUDIT = 'QuarterlyBonusEngine:Audit';
  var periods      = ['2026-01', '2026-02', '2026-03'];

  // 1. Build corrected (deduped) hours map
  var correctedHrs = {};
  var seen = {};
  periods.forEach(function(pid) {
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, { callerModule: MODULE_AUDIT, periodId: pid });
    } catch(e) {
      if (e.code === 'SHEET_NOT_FOUND') return;
      throw e;
    }
    rows.forEach(function(row) {
      var code  = String(row.actor_code || row.person_code || '').trim();
      var role  = String(row.actor_role || '').toUpperCase();
      var hours = parseFloat(row.hours) || 0;
      var date  = String(row.work_date || row.date || '').trim();
      if (!code || hours <= 0 || role === 'QC') return;
      var key = pid + '|' + code + '|' + date + '|' + hours;
      if (seen[key]) return;
      seen[key] = true;
      correctedHrs[code] = (correctedHrs[code] || 0) + hours;
    });
  });

  // 2. Read committed ledger rows for 2026-Q1
  var ledgerRows = DAL.readAll(Config.TABLES.FACT_QUARTERLY_BONUS, { callerModule: MODULE_AUDIT });
  var q1rows = ledgerRows.filter(function(r) {
    return String(r.quarter_period_id || '').trim() === qPid &&
           (String(r.event_type || '').trim() === 'QUARTERLY_BONUS' ||
            String(r.event_type || '').trim() === 'QUARTERLY_BONUS_AMENDMENT');
  });

  // Keep latest entry per person (AMENDMENT overrides QUARTERLY_BONUS)
  var byPerson = {};
  q1rows.forEach(function(r) {
    var code = String(r.person_code || '').trim();
    if (!code) return;
    if (!byPerson[code] || r.event_type === 'QUARTERLY_BONUS_AMENDMENT') byPerson[code] = r;
  });

  // 3. Print report
  console.log('\n====== Q1 2026 Bonus Overpayment Report ======');
  console.log('CODE  | HRS USED | HRS TRUE | BONUS PAID | TRUE BONUS | DELTA INR | COMP SCORE');
  console.log('------|----------|----------|------------|------------|-----------|----------');

  var totalPaid = 0, totalTrue = 0, totalDelta = 0;

  Object.keys(byPerson).sort().forEach(function(code) {
    var row           = byPerson[code];
    var hrsUsed       = parseFloat(row.design_hours)   || 0;
    var bonusPaid     = parseFloat(row.bonus_inr)       || 0;
    var composite     = parseFloat(row.composite_score) || 0;
    var hrsTrue       = Math.round((correctedHrs[code] || 0) * 100) / 100;
    var trueBonus     = Math.round(hrsTrue * composite * BONUS_INR_PER_HOUR * 100) / 100;
    var delta         = Math.round((trueBonus - bonusPaid) * 100) / 100;

    totalPaid  += bonusPaid;
    totalTrue  += trueBonus;
    totalDelta += delta;

    var flag = delta < -100 ? ' ⚠️' : delta > 50 ? ' ↑' : '';
    console.log(
      pad_(code,6) + '| ' + pad_(hrsUsed,9) + '| ' + pad_(hrsTrue,9) + '| ' +
      pad_(bonusPaid,11) + '| ' + pad_(trueBonus,11) + '| ' + pad_(delta,10) + '| ' +
      composite + flag
    );
  });

  console.log('------|----------|----------|------------|------------|-----------|----------');
  console.log('TOTAL |          |          | ' + pad_(Math.round(totalPaid),11) + '| ' + pad_(Math.round(totalTrue),11) + '| ' + Math.round(totalDelta));
  console.log('\n⚠️  Negative DELTA = overpayment (system paid more than correct amount)');
  console.log('Next step: run runQ1WriteHoursCorrections() to write QUARTERLY_BONUS_AMENDMENT rows.');
  console.log('====== End Report ======\n');
}

/**
 * Dumps all Q1 2026 rows from FACT_PERFORMANCE_RATINGS — rater_code, rater_role, ratee_code, score.
 * Also prints the role of each rater from DIM_STAFF_ROSTER.
 * Run this to diagnose why TL/PM submissions aren't counting.
 */
function runDiagnoseQ1RatingRows() {
  var qPid = '2026-Q1';
  var ratings = DAL.readAll(Config.TABLES.FACT_PERFORMANCE_RATINGS, { callerModule: 'QuarterlyBonusEngine' });
  var q1 = ratings.filter(function(r) { return String(r.period_id || '').trim() === qPid; });
  console.log('FACT_PERFORMANCE_RATINGS rows for ' + qPid + ': ' + q1.length);

  // Build role lookup from DIM_STAFF_ROSTER
  var staffRows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'QuarterlyBonusEngine' });
  var roleMap = {};
  staffRows.forEach(function(s) {
    var code = String(s.person_code || '').trim();
    if (code && !roleMap[code]) roleMap[code] = String(s.role || '').trim();
  });

  q1.forEach(function(r) {
    var raterCode = String(r.rater_code || '').trim();
    var rosterRole = roleMap[raterCode] || '(not in roster)';
    console.log('  rater=' + raterCode + ' (roster_role=' + rosterRole + ')' +
                ' | rater_role_recorded=' + (r.rater_role||'') +
                ' | ratee=' + (r.ratee_code||'') +
                ' | score=' + (r.avg_score_normalized||'') +
                ' | submitted_at=' + (r.submitted_at||''));
  });

  // Also show role lookup for key raters
  var keyRaters = ['SGO','PBG','SDA','BCH'];
  console.log('Roster roles for key raters:');
  keyRaters.forEach(function(code) {
    console.log('  ' + code + ' -> ' + (roleMap[code] || '(not found)'));
  });
}

/**
 * Diagnoses FACT_CLIENT_FEEDBACK — shows row count, period breakdown,
 * and sample rows. Run this to check whether client feedback data exists
 * and whether designer_code / period_id fields are populated correctly.
 */
function runDiagnoseClientFeedback() {
  var rows;
  try {
    rows = DAL.readAll(Config.TABLES.FACT_CLIENT_FEEDBACK, { callerModule: 'QuarterlyBonusEngine' });
  } catch (e) {
    console.log('❌ Could not read FACT_CLIENT_FEEDBACK: ' + e.message);
    return;
  }

  console.log('FACT_CLIENT_FEEDBACK — total rows: ' + rows.length);
  if (rows.length === 0) {
    console.log('  ⚠️  Table is empty — no client feedback has been recorded.');
    return;
  }

  // Period breakdown
  var byPeriod = {};
  rows.forEach(function(r) {
    var pid = String(r.period_id || '(blank)').trim();
    if (!byPeriod[pid]) byPeriod[pid] = 0;
    byPeriod[pid]++;
  });
  console.log('  Rows by period_id:');
  Object.keys(byPeriod).sort().forEach(function(pid) {
    console.log('    "' + pid + '": ' + byPeriod[pid] + ' rows');
  });

  // Field population check on last 3 rows
  console.log('  Last 3 rows (field check):');
  var sample = rows.slice(-3);
  sample.forEach(function(r) {
    console.log('    period_id="' + (r.period_id||'') + '"' +
                ' | designer_code="' + (r.designer_code||'') + '"' +
                ' | client_code="' + (r.client_code||'') + '"' +
                ' | normalized_score="' + (r.normalized_score||'') + '"' +
                ' | raw_score="' + (r.raw_score||'') + '"');
  });

  // Q1 2026 specific summary
  var q1Months = ['2026-01','2026-02','2026-03'];
  var q1Rows = rows.filter(function(r) {
    return q1Months.indexOf(String(r.period_id || '').trim()) !== -1;
  });
  console.log('  Q1 2026 rows (period_id in 2026-01/02/03): ' + q1Rows.length);
  if (q1Rows.length > 0) {
    var blankDesigner = q1Rows.filter(function(r) { return !String(r.designer_code||'').trim(); }).length;
    console.log('    Rows with blank designer_code: ' + blankDesigner);
  }
}

/**
 * Sends one HTML bonus letter per staff member to the CEO's inbox for review.
 * Reads committed rows from FACT_QUARTERLY_BONUS for the given quarter.
 * Only sends for CALCULATED rows with bonus_inr > 0.
 *
 * Run from the Apps Script editor. Emails land in the running account's inbox.
 * The CEO can then forward each to HR for disbursement.
 *
 * @param {string} quarterPeriodId  e.g. '2026-Q1'
 */
function runSendBonusLetters(quarterPeriodId) {
  quarterPeriodId = quarterPeriodId || '2026-Q1';
  var recipientEmail = Session.getActiveUser().getEmail();

  console.log('Sending bonus letters for ' + quarterPeriodId + ' to ' + recipientEmail);

  // ── Build name + role lookup from roster ─────────────────────
  var staffRows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'QuarterlyBonusEngine' });
  var staffMap  = {};
  staffRows.forEach(function(s) {
    var code = String(s.person_code || '').trim();
    if (code && !staffMap[code]) {
      staffMap[code] = {
        name:  String(s.display_name || s.name || code).trim(),
        role:  String(s.role || '').trim(),
        email: String(s.email || '').trim()
      };
    }
  });

  // ── Load individual rater scores for per-designer rating breakdown ──
  // Use role-keyed map (last-write-wins per role) to match getInternalRatings_ dedup logic.
  var rateeRatingsMap = {};
  try {
    var perfRows = DAL.readAll(Config.TABLES.FACT_PERFORMANCE_RATINGS, { callerModule: 'QuarterlyBonusEngine' });
    perfRows.forEach(function(r) {
      if (String(r.period_id || '').trim() !== quarterPeriodId) return;
      var ratee = String(r.ratee_code || '').trim();
      var rater = String(r.rater_code || '').trim();
      var role  = String(r.rater_role || '').trim().toUpperCase();
      var score = parseFloat(r.avg_score_normalized) || 0;
      if (!ratee || score === 0) return;
      if (!rateeRatingsMap[ratee]) rateeRatingsMap[ratee] = {};
      rateeRatingsMap[ratee][role] = {
        role:  role,
        name:  (staffMap[rater] && staffMap[rater].name) ? staffMap[rater].name : rater,
        score: score
      };
    });
    // Flatten role map → array for downstream rendering
    Object.keys(rateeRatingsMap).forEach(function(ratee) {
      rateeRatingsMap[ratee] = Object.values(rateeRatingsMap[ratee]);
    });
  } catch(e) {
    console.log('⚠️  Could not load rating details: ' + e.message);
  }

  // ── Read committed bonus rows ─────────────────────────────────
  var allRows = DAL.readAll(Config.TABLES.FACT_QUARTERLY_BONUS, { callerModule: 'QuarterlyBonusEngine' });
  var bonusRows = allRows.filter(function(r) {
    var evType = String(r.event_type || '').trim();
    return String(r.quarter_period_id || '').trim() === quarterPeriodId &&
           (evType === 'QUARTERLY_BONUS' || evType === 'QUARTERLY_BONUS_AMENDMENT') &&
           String(r.status || '').trim() === 'CALCULATED' &&
           (parseFloat(r.bonus_inr) || 0) > 0;
  });

  // Deduplicate — keep latest row per person if multiple exist
  var latestByCode = {};
  bonusRows.forEach(function(r) {
    var code = String(r.person_code || '').trim();
    if (!code) return;
    if (!latestByCode[code] ||
        String(r.timestamp) > String(latestByCode[code].timestamp)) {
      latestByCode[code] = r;
    }
  });

  var codes = Object.keys(latestByCode);
  console.log('Eligible staff to send: ' + codes.length);

  if (codes.length === 0) {
    console.log('⚠️  No CALCULATED rows found for ' + quarterPeriodId + '. Run runCommitQ1Bonus first.');
    return;
  }

  var sent = 0;
  codes.forEach(function(code) {
    var row   = latestByCode[code];
    var staff = staffMap[code] || { name: code, role: '', email: '' };

    var bonusInr      = parseFloat(row.bonus_inr)      || 0;
    var designHours   = parseFloat(row.design_hours)   || 0;
    var clientScore   = parseFloat(row.client_score)   || 0;
    var errorScore    = parseFloat(row.error_score)    || 0;
    var ratingScore   = parseFloat(row.rating_score)   || 0;
    var compositeScore= parseFloat(row.composite_score)|| 0;

    var roleLabel = staff.role
      .replace('_', ' ')
      .replace(/\b\w/g, function(c) { return c.toUpperCase(); });

    var quarter = quarterPeriodId.split('-')[1] || quarterPeriodId;
    var year    = quarterPeriodId.split('-')[0] || '';

    // Build per-rater sub-rows for this designer
    var ROLE_ORDER = { 'TEAM_LEAD': 0, 'PM': 1, 'CEO': 2 };
    var ROLE_LABEL = { 'TEAM_LEAD': 'Team Lead', 'PM': 'Project Manager', 'CEO': 'CEO' };
    var myRaters = (rateeRatingsMap[code] || []).slice().sort(function(a, b) {
      return (ROLE_ORDER[a.role] || 9) - (ROLE_ORDER[b.role] || 9);
    });
    var raterSubRows = myRaters.map(function(r) {
      return '      <tr style="background:#f7f9fc;">' +
             '<td style="padding:4px 12px 4px 28px;color:#7a8a9a;font-size:12px;">' +
               '&nbsp;&nbsp;→&nbsp;' + (ROLE_LABEL[r.role] || r.role) + ' (' + r.name + ')' +
             '</td>' +
             '<td style="text-align:right;padding:4px 12px;color:#7a8a9a;font-size:12px;">' + (r.score * 100).toFixed(1) + '%</td>' +
             '<td></td></tr>';
    }).join('\n');
    var raterBorderStyle = myRaters.length ? 'border-bottom:none' : 'border-bottom:1px solid #eee';
    var clientLabel = clientScore > 0
      ? 'Client Score <span style="font-size:11px;color:#aaa;font-weight:normal;">(Q1 proxy: avg team rating)</span>'
      : 'Client Feedback';

    var html = [
      '<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#222;">',

      // Header
      '<div style="background:#1a3c6e;padding:24px 28px;border-radius:6px 6px 0 0;">',
      '  <h2 style="margin:0;color:#fff;font-size:20px;letter-spacing:0.5px;">Blue Lotus Consulting Corporation</h2>',
      '  <p style="margin:6px 0 0;color:#a8c4e8;font-size:13px;">Performance Bonus Statement</p>',
      '</div>',

      // Body
      '<div style="border:1px solid #ddd;border-top:none;padding:28px;border-radius:0 0 6px 6px;">',
      '  <p style="font-size:13px;color:#666;margin:0 0 18px;">',
      '    ' + quarter + ' ' + year + ' &nbsp;|&nbsp; Issued ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd MMM yyyy'),
      '  </p>',
      '  <p style="font-size:15px;margin:0 0 6px;">Dear <strong>' + staff.name + '</strong>,</p>',
      '  <p style="font-size:14px;line-height:1.6;margin:0 0 22px;">',
      '    We are pleased to confirm your performance bonus for ' + quarter + ' ' + year + ',',
      '    based on your hours worked and performance scores during this period.',
      '  </p>',

      // Score table
      '  <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">',
      '    <thead>',
      '      <tr style="background:#f4f7fb;">',
      '        <th style="text-align:left;padding:10px 12px;border-bottom:2px solid #dde3ee;color:#1a3c6e;">Component</th>',
      '        <th style="text-align:right;padding:10px 12px;border-bottom:2px solid #dde3ee;color:#1a3c6e;">Score</th>',
      '        <th style="text-align:right;padding:10px 12px;border-bottom:2px solid #dde3ee;color:#1a3c6e;">Weight</th>',
      '      </tr>',
      '    </thead>',
      '    <tbody>',
      '      <tr style="border-bottom:1px solid #eee;"><td style="padding:9px 12px;">Design Hours</td><td style="text-align:right;padding:9px 12px;">' + designHours.toFixed(2) + ' hrs</td><td style="text-align:right;padding:9px 12px;color:#888;">—</td></tr>',
      '      <tr style="border-bottom:1px solid #eee;"><td style="padding:9px 12px;">Error Rate Score</td><td style="text-align:right;padding:9px 12px;">' + (errorScore * 100).toFixed(1) + '%</td><td style="text-align:right;padding:9px 12px;color:#555;">40%</td></tr>',
      '      <tr style="' + raterBorderStyle + ';"><td style="padding:9px 12px;">Performance Rating</td><td style="text-align:right;padding:9px 12px;">' + (ratingScore * 100).toFixed(1) + '%</td><td style="text-align:right;padding:9px 12px;color:#555;">30%</td></tr>',
      raterSubRows,
      '      <tr style="border-bottom:1px solid #eee;' + (myRaters.length ? 'border-top:1px solid #eee;' : '') + '"><td style="padding:9px 12px;">' + clientLabel + '</td><td style="text-align:right;padding:9px 12px;">' + (clientScore * 100).toFixed(1) + '%</td><td style="text-align:right;padding:9px 12px;color:#555;">30%</td></tr>',
      '      <tr style="background:#f9f9f9;font-weight:bold;"><td style="padding:9px 12px;">Composite Score</td><td style="text-align:right;padding:9px 12px;">' + (compositeScore * 100).toFixed(2) + '%</td><td style="text-align:right;padding:9px 12px;color:#888;">—</td></tr>',
      '    </tbody>',
      '  </table>',

      // Bonus callout
      '  <div style="background:#eaf4ea;border-left:4px solid #2e7d32;padding:16px 20px;border-radius:4px;margin-bottom:24px;">',
      '    <p style="margin:0;font-size:13px;color:#555;">Q' + quarter.replace('Q','') + ' ' + year + ' Performance Bonus</p>',
      '    <p style="margin:6px 0 0;font-size:24px;font-weight:bold;color:#2e7d32;">₹' + bonusInr.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' INR</p>',
      '  </div>',

      // Staff info
      '  <table style="font-size:13px;color:#555;margin-bottom:20px;">',
      '    <tr><td style="padding:3px 16px 3px 0;font-weight:bold;">Name</td><td>' + staff.name + '</td></tr>',
      '    <tr><td style="padding:3px 16px 3px 0;font-weight:bold;">Role</td><td>' + roleLabel + '</td></tr>',
      '    <tr><td style="padding:3px 16px 3px 0;font-weight:bold;">Period</td><td>' + quarter + ' ' + year + ' (Jan – Mar)</td></tr>',
      '  </table>',

      '  <p style="font-size:13px;color:#888;border-top:1px solid #eee;padding-top:14px;margin-bottom:0;">',
      '    This bonus will be processed with the next payroll cycle.',
      '    Please contact HR if you have any questions.',
      '  </p>',
      '  <p style="font-size:11px;color:#bbb;margin:8px 0 0;">FOR HR USE ONLY — Please do not forward until verified.</p>',
      '</div>',
      '</div>'
    ].join('\n');

    var subject = '[BLC] Q' + quarter.replace('Q','') + ' ' + year +
                  ' Bonus Letter — ' + staff.name + ' (' + code + ')';

    GmailApp.sendEmail(recipientEmail, subject, '', { htmlBody: html });
    sent++;
    console.log('  ✓ Sent: ' + staff.name + ' (' + code + ') — ₹' + bonusInr.toFixed(2));
  });

  console.log('─────────────────────────────────────────');
  console.log('✅ Done. ' + sent + ' bonus letters sent to ' + recipientEmail);
}

/** Shortcut runner — sends Q1 2026 bonus letters. */
function runSendQ1BonusLetters() {
  runSendBonusLetters('2026-Q1');
}

/**
 * Writes QUARTERLY_BONUS_AMENDMENT rows for staff whose Q1 ledger entry is
 * still PENDING (from an earlier partial run before ratings were complete).
 * Idempotent — uses QB_AMEND|{code}|{period} idempotency key.
 * Run once, then re-run runSendQ1BonusLetters to pick up all 16 staff.
 */
function runAmendQ1BonusLedger() {
  var actorEmail = Session.getActiveUser().getEmail();
  var qPid       = '2026-Q1';
  var CALLER     = 'QuarterlyBonusEngine';

  // Fresh calculation
  var preview = QuarterlyBonusEngine.previewQuarterlyBonus(actorEmail, 'Q1', 2026);

  // Read current ledger state
  var existing = DAL.readAll(Config.TABLES.FACT_QUARTERLY_BONUS, { callerModule: CALLER });

  // Which person_codes already have a CALCULATED row?
  var hasCalculated = {};
  existing.forEach(function(r) {
    if (String(r.status || '').trim() === 'CALCULATED') {
      hasCalculated[String(r.person_code || '').trim()] = true;
    }
  });

  // Which amendment keys already exist?
  var existingAmendKeys = {};
  existing.forEach(function(r) {
    var k = String(r.idempotency_key || '').trim();
    if (k.indexOf('QB_AMEND|') === 0) existingAmendKeys[k] = true;
  });

  var amended = 0, alreadyDone = 0;
  preview.forEach(function(row) {
    if (row.status !== 'CALCULATED') return;
    if ((parseFloat(row.bonus_inr) || 0) === 0) return;   // skip ₹0 rows
    if (hasCalculated[row.person_code]) return;            // already has CALCULATED

    var amendKey = 'QB_AMEND|' + row.person_code + '|' + qPid;
    if (existingAmendKeys[amendKey]) { alreadyDone++; return; }

    DAL.appendRow(Config.TABLES.FACT_QUARTERLY_BONUS, {
      bonus_id:          Identifiers.generateId(),
      event_type:        'QUARTERLY_BONUS_AMENDMENT',
      person_code:       row.person_code,
      quarter_period_id: qPid,
      design_hours:      row.design_hours,
      client_score:      row.client_score   || 0,
      error_score:       row.error_score    || 0,
      rating_score:      row.rating_score   || 0,
      composite_score:   row.composite_score|| 0,
      bonus_inr:         row.bonus_inr      || 0,
      status:            'CALCULATED',
      pending_reason:    '',
      actor_email:       actorEmail,
      timestamp:         new Date().toISOString(),
      idempotency_key:   amendKey
    }, { callerModule: CALLER });

    amended++;
    console.log('  Amended: ' + row.person_code + ' — ₹' + row.bonus_inr);
  });

  console.log('Done. ' + amended + ' amendment rows written, ' + alreadyDone + ' already amended.');
}

/**
 * Shows per-designer Q1 component scores from the ledger.
 * Flags designers where rating_score = 0 (ratings not included in composite).
 * A rating_score of 0 means the 30% rating weight is missing from their bonus.
 */
function runQ1RatingScoreCheck() {
  var qPid   = '2026-Q1';
  var CALLER = 'QuarterlyBonusEngine';

  var ledgerRows = DAL.readAll(Config.TABLES.FACT_QUARTERLY_BONUS, { callerModule: CALLER });

  // Latest row per person for Q1
  var byPerson = {};
  ledgerRows.forEach(function(r) {
    if (String(r.quarter_period_id || '').trim() !== qPid) return;
    var code = String(r.person_code || '').trim();
    if (!code) return;
    if (!byPerson[code] ||
        String(r.event_type) === 'QUARTERLY_BONUS_AMENDMENT' ||
        String(r.event_type) === 'QB_MANUAL_CORR' ||
        r.idempotency_key.indexOf('QB_MANUAL_CORR') === 0) {
      byPerson[code] = r;
    }
  });

  console.log('\n══ Q1 2026 Component Score Check ══');
  console.log('CODE   STATUS     CLIENT  ERROR   RATING  COMPOSITE  RATING INCLUDED?');
  console.log('────── ─────────  ──────  ──────  ──────  ─────────  ────────────────');

  var missingRatings = [];
  Object.keys(byPerson).sort().forEach(function(code) {
    var r         = byPerson[code];
    var client    = Math.round((parseFloat(r.client_score)    || 0) * 10000) / 100;
    var error     = Math.round((parseFloat(r.error_score)     || 0) * 10000) / 100;
    var rating    = Math.round((parseFloat(r.rating_score)    || 0) * 10000) / 100;
    var composite = Math.round((parseFloat(r.composite_score) || 0) * 10000) / 100;
    var status    = String(r.status || '').trim();
    var hasRating = rating > 0;

    if (!hasRating) missingRatings.push(code);

    console.log(
      pad_(code, 7) + pad_(status, 11) +
      pad_(client  + '%', 8) + pad_(error   + '%', 8) +
      pad_(rating  + '%', 8) + pad_(composite + '%', 11) +
      (hasRating ? '✓ Yes' : '⚠️  MISSING — bonus uses client+error only')
    );
  });

  console.log('────── ─────────  ──────  ──────  ──────  ─────────');
  if (missingRatings.length === 0) {
    console.log('✅ All designers have ratings included in their composite.');
  } else {
    console.log('⚠️  ' + missingRatings.length + ' designer(s) with rating_score = 0: ' + missingRatings.join(', '));
    console.log('   These designers are missing the 30% rating component.');
    console.log('   Collect missing ratings via portal → re-run bonus calculation → re-run runQ1ApplyManualCorrections().');
  }
}

/** Dumps all rows from FACT_QUARTERLY_BONUS to diagnose field names and filter mismatches. */
function runDiagnoseQ1BonusLedger() {
  var rows = DAL.readAll(Config.TABLES.FACT_QUARTERLY_BONUS, { callerModule: 'QuarterlyBonusEngine' });
  console.log('FACT_QUARTERLY_BONUS — total rows: ' + rows.length);
  if (rows.length === 0) { console.log('  ⚠️  Empty.'); return; }
  console.log('  Sample row (field names + values):');
  var sample = rows[0];
  Object.keys(sample).forEach(function(k) {
    console.log('    ' + k + ' = "' + sample[k] + '"');
  });
  console.log('  All rows (person_code | quarter_period_id | event_type | status | bonus_inr):');
  rows.forEach(function(r) {
    console.log('    ' + (r.person_code||'?') +
                ' | qpid="' + (r.quarter_period_id||'') + '"' +
                ' | type="' + (r.event_type||'') + '"' +
                ' | status="' + (r.status||'') + '"' +
                ' | bonus=' + (r.bonus_inr||''));
  });
}
