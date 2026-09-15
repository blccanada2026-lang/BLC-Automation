// ============================================================
// QuarterlyReadinessEngine.gs — BLC Nexus T12 Migration/Diagnostic
//
// Portal-run "is this quarter ready for a bonus run" check. Generalizes
// three one-off Q2 2026 diagnostic scripts into one reusable, any-quarter
// bundle, reachable from the portal instead of the Apps Script editor:
//   - Q2RatingsPreflightCheck.gs's ratings-completeness count (rewritten
//     here to call the REAL QuarterlyBonusEngine.getInternalRatings_,
//     not a reimplementation — see 2026-09-15 CTO_TASK_QUEUE.md entry for
//     why a hardcoded rater-code list was dropped in favor of this)
//   - QuarterlyBonusEngine.gs's reworkCycleBackfillCore_ (dry-run only,
//     here — see applyReworkCycleBackfill below for the write path)
//   - QuarterlyBonusEngine.gs's runQ2RatingsPeriodIdCheck /
//     runQ2BonusLedgerPeriodIdCheck (already quarter-agnostic; reused
//     via a shared local helper instead of duplicated)
// Plus one check with no prior one-off precedent, added 2026-09-15 on
// direct request: client feedback response completeness per month of the
// quarter, via the REAL ClientFeedback.getFeedbackStatus — feedback and
// ratings are the two inputs QuarterlyBonusEngine.computeBonuses_ needs,
// but only ratings had ever had a preflight tool before this.
//
// Deliberately dropped: Q2RatingsPreflightCheck.gs's second check
// (getMyRatees() resolution against the pre-2026-07-01 supervisor
// structure) — a one-time sanity check for that specific cutover, not
// something any future quarter needs.
//
// READ-ONLY orchestrator (runQuarterlyReadinessCheck) + ONE separate
// write action (applyReworkCycleBackfill) — never bundled, matching this
// codebase's universal preview→commit pattern (BonusPeriodCommit.gs,
// PayrollEngine's payout-statement preview, etc.). The check is
// PAYROLL_VIEW-gated (CEO + HR_ACCOUNTING); the write action is CEO-only
// (PAYROLL_RUN + enforceFinancialAccess).
// ============================================================

var QuarterlyReadinessEngine = (function () {
  var MODULE = 'QuarterlyReadinessEngine';

  function validatePeriod_(fnName, quarter, year) {
    var q = String(quarter || '').toUpperCase().trim();
    var y = parseInt(year, 10);
    if (!/^Q[1-4]$/.test(q) || !y) {
      throw new Error(fnName + ': quarter must be one of Q1-Q4 and year a valid number — got ' +
                       'quarter="' + quarter + '", year="' + year + '".');
    }
    return { quarter: q, year: y };
  }

  /**
   * Read-only period_id/quarter_period_id coercion check, shared core
   * behind QuarterlyBonusEngine.gs's runQ2RatingsPeriodIdCheck() /
   * runQ2BonusLedgerPeriodIdCheck() — same detection (Date-instance vs
   * clean string), returning structured data instead of only console.log,
   * so runQuarterlyReadinessCheck can fold it into one report.
   */
  function periodIdCoercionCheck_(tableName, periodField) {
    var rows;
    try {
      rows = DAL.readAll(tableName, { callerModule: MODULE });
    } catch (e) {
      return { totalRows: 0, corruptedCount: 0, sample: [], error: e.message };
    }
    var corruptedCount = 0;
    var sample = [];
    rows.forEach(function (r) {
      var val = r[periodField];
      var isDate = val instanceof Date;
      if (isDate) corruptedCount++;
      if (sample.length < 5) sample.push({ raw: String(val), isDate: isDate });
    });
    return { totalRows: rows.length, corruptedCount: corruptedCount, sample: sample };
  }

  /**
   * Bundled readiness report for one quarter. Read-only — the rework
   * backfill portion always runs as a dry-run preview here regardless of
   * what the bonus run would eventually do; use applyReworkCycleBackfill
   * (below) as the separate, explicit write step.
   *
   * @param {string} actorEmail
   * @param {string} quarter  'Q1'..'Q4'
   * @param {number} year
   * @returns {{
   *   period_id: string,
   *   ratings: { staff_total:number, staff_confirmed:number, staff_missing:Array },
   *   client_feedback: { total_responses:number, by_month:Array },
   *   rework_backfill: { dryRun:boolean, affected:number, updated:number, notFound:number },
   *   period_id_integrity: { ratings:Object, ledger:Object }
   * }}
   */
  function runQuarterlyReadinessCheck(actorEmail, quarter, year) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_VIEW);

    var period = validatePeriod_('runQuarterlyReadinessCheck', quarter, year);
    var qPid   = period.year + '-' + period.quarter;

    // ── 1. Ratings completeness — via the REAL functions computeBonuses_ uses ──
    var qStart     = QuarterlyBonusEngine.quarterDateRange_(period.quarter, period.year).start;
    var staffCache = QuarterlyBonusEngine.buildStaffCache_(QuarterlyBonusEngine.toIsoDate_(qStart));
    var ratings    = QuarterlyBonusEngine.getInternalRatings_(qPid);

    var RELEVANT_ROLES = { DESIGNER: true, QC: true, QC_REVIEWER: true, TEAM_LEAD: true, PM: true };
    var codes = Object.keys(staffCache).filter(function (code) {
      var s = staffCache[code];
      return RELEVANT_ROLES[s.role] && String(s.active).toUpperCase() === 'TRUE';
    });

    var missing = [];
    codes.forEach(function (code) {
      var score = ratings[code];
      if (score === null || score === undefined) {
        missing.push({ code: code, name: staffCache[code].name, role: staffCache[code].role });
      }
    });

    // ── 2. Client feedback completeness — via the REAL ClientFeedback.getFeedbackStatus,
    // one call per month of the quarter (client feedback is tracked per-month, not
    // per-quarter — same 3-month split getClientScores_ uses internally). ──
    var monthIds  = QuarterlyBonusEngine.monthPeriodIds_(period.quarter, period.year);
    var byMonth   = monthIds.map(function (pid) {
      var status = ClientFeedback.getFeedbackStatus(actorEmail, pid);
      return { period_id: pid, responses_received: status.responses_received, per_designer: status.per_designer };
    });
    var totalFeedbackResponses = byMonth.reduce(function (sum, m) { return sum + m.responses_received; }, 0);

    // ── 3. Rework-cycle backfill — dry run only in a readiness check ──
    var reworkPreview = reworkCycleBackfillCore_(period.quarter, period.year, true);

    // ── 4. period_id coercion — both tables the Q2 investigation flagged ──
    var ratingsIntegrity = periodIdCoercionCheck_(Config.TABLES.FACT_PERFORMANCE_RATINGS, 'period_id');
    var ledgerIntegrity  = periodIdCoercionCheck_(Config.TABLES.FACT_QUARTERLY_BONUS, 'quarter_period_id');

    var report = {
      period_id: qPid,
      ratings: {
        staff_total:     codes.length,
        staff_confirmed: codes.length - missing.length,
        staff_missing:   missing
      },
      client_feedback: {
        total_responses: totalFeedbackResponses,
        by_month:         byMonth
      },
      rework_backfill: reworkPreview,
      period_id_integrity: {
        ratings: ratingsIntegrity,
        ledger:  ledgerIntegrity
      }
    };

    console.log('\n══════ Quarterly Readiness Check — ' + qPid + ' ══════');
    console.log('Ratings: ' + report.ratings.staff_confirmed + '/' + report.ratings.staff_total + ' confirmed.');
    if (missing.length > 0) {
      console.log('  Missing: ' + missing.map(function (m) { return m.code + ' (' + m.name + ')'; }).join(', '));
    }
    console.log('Client feedback: ' + totalFeedbackResponses + ' response(s) across ' + monthIds.join(', ') +
                (totalFeedbackResponses === 0 ? ' — NONE received yet' : ''));
    console.log('Rework backfill: ' + reworkPreview.affected + ' job(s) would be updated' +
                (reworkPreview.affected > 0 ? ' — apply via applyReworkCycleBackfill()' : ' — none needed'));
    console.log('period_id integrity: ratings ' +
                (ratingsIntegrity.corruptedCount > 0 ? 'CORRUPTED (' + ratingsIntegrity.corruptedCount + ')' : 'clean') +
                ', ledger ' + (ledgerIntegrity.corruptedCount > 0 ? 'CORRUPTED (' + ledgerIntegrity.corruptedCount + ')' : 'clean'));
    console.log('══════ End check ══════\n');

    return report;
  }

  /**
   * The one write action this module exposes — applies the rework-cycle
   * backfill for real. CEO-only (financial access), separate from the
   * read-only check above by design; never called automatically by it.
   *
   * @param {string} actorEmail
   * @param {string} quarter  'Q1'..'Q4'
   * @param {number} year
   * @returns {{dryRun:boolean, affected:number, updated:number, notFound:number}}
   */
  function applyReworkCycleBackfill(actorEmail, quarter, year) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN);
    RBAC.enforceFinancialAccess(actor);

    var period = validatePeriod_('applyReworkCycleBackfill', quarter, year);
    return reworkCycleBackfillCore_(period.quarter, period.year, false);
  }

  return {
    runQuarterlyReadinessCheck: runQuarterlyReadinessCheck,
    applyReworkCycleBackfill:   applyReworkCycleBackfill
  };
}());
