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
      '      <tr style="border-bottom:1px solid #eee;"><td style="padding:9px 12px;">Performance Rating</td><td style="text-align:right;padding:9px 12px;">' + (ratingScore * 100).toFixed(1) + '%</td><td style="text-align:right;padding:9px 12px;color:#555;">30%</td></tr>',
      '      <tr style="border-bottom:1px solid #eee;"><td style="padding:9px 12px;">Client Feedback</td><td style="text-align:right;padding:9px 12px;">' + (clientScore * 100).toFixed(1) + '%</td><td style="text-align:right;padding:9px 12px;color:#555;">30%</td></tr>',
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
