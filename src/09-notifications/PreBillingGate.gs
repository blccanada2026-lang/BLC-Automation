// ============================================================
// PreBillingGate.gs — BLC Nexus T9 Notifications
// src/09-notifications/PreBillingGate.gs
//
// COMMIT 4 OF 7 — the pre-billing gate. Runs Checks 1, 2, 3, 8, 9
// (DataIntegrityChecks_WorkLog.gs / DataIntegrityChecks_Entity.gs),
// scoped to a specific billing period rather than "now", and produces
// a pass/fail verdict. Wired into BillingEngine.runBillingRun() and
// ClientTimesheetEngine.generate() — both abort before doing any work
// if the gate doesn't clear.
//
// BLOCKING RULE: all 5 checks block, not CRITICAL-severity only.
// These five were specifically selected because each one breaks
// billing correctness for the jobs about to be billed — a duplicate
// work log (Check 1, HIGH) over-bills hours exactly as surely as a
// missing rate (Check 9, CRITICAL) zero-bills. The daily monitor's
// severity levels describe alert *cadence* for the 15-min/daily
// notification cycle (commit 5); they are not a ruling that HIGH
// findings are safe to invoice. A gate that detects duplicate
// billable hours and bills anyway has failed its purpose. If this
// turns out to be too strict in practice, loosen to CRITICAL-only by
// filtering PBG_BLOCKING_CHECKS_ in runPreBillingChecks() — but ship
// strict by default; billing hasn't run from V3 yet (PROJECT_MEMORY
// §6, "June billing PENDING"), so there's no working pipeline this
// puts at regression risk.
//
// GATE ERROR vs. GATE FAILURE — these are different and are NOT
// conflated:
//   - Gate FAILURE (cleared: false): the checks ran successfully and
//     found real data problems. Callers convert this into a
//     "Billing blocked — N issue(s)" abort.
//   - Gate ERROR (thrown exception): something broke *inside* the
//     gate itself (a bad periodId, a missing sheet, a bug) before it
//     could produce a real verdict. This propagates as a raw
//     exception, not as blockers — folding a monitor bug into
//     blockers[] would send whoever's debugging a billing halt
//     looking for a data problem that isn't there. Every check call
//     in runPreBillingChecks() is UNGUARDED (no per-check try/catch)
//     specifically so a broken check surfaces as a loud failure
//     instead of silently contributing zero issues and producing a
//     false "cleared: true".
//
// Job-set scoping (pbgResolveJobsInPeriod_): mirrors
// BillingEngine.gs's buildHoursCache_ exactly — same date-range
// filter, same SUPERSEDED_MIGRATED (BTD/SNA) exclusion, same net>0
// hours requirement — so the gate checks precisely the jobs
// BillingEngine will actually attempt to bill for this period, no
// more and no less. Reuses BillingEngine.parseSemiMonthlyPeriod_
// (exposed on its public API despite the trailing underscore) rather
// than re-deriving period math. Checks 1 and 2 additionally receive
// jobFilter (not just monthPartition) so a duplicate/orphan on a job
// with no hours in THIS half of the month can't block it — jobFilter
// is job-level, though, not date-level: a job that has hours in both
// halves with a duplicate specifically dated in the OTHER half will
// still flag here, since the whole job is in scope. Known, accepted
// residual — narrower than the job-level gap it replaces.
//
// MANUAL RUN: runPreBillingReport(periodId) — prints a formatted
// pass/fail report to console. Doesn't throw; safe to run anytime to
// see what would block a real run.
// ============================================================

/**
 * Resolves the exact set of job_numbers BillingEngine would attempt
 * to bill for periodId — jobs with net positive FACT_WORK_LOGS hours
 * in the period's date range, after the same exclusions BillingEngine
 * applies. Read-only.
 * @param {string} periodId  e.g. '2026-07A'
 * @returns {{ monthPartition: string, jobFilter: Object }}
 */
function pbgResolveJobsInPeriod_(periodId) {
  var MODULE = 'PreBillingGate';
  var period = BillingEngine.parseSemiMonthlyPeriod_(periodId);

  var rows;
  try {
    rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
      callerModule: MODULE,
      periodId:     period.monthPartition
    });
  } catch (e) {
    if (e.code === 'SHEET_NOT_FOUND') rows = [];
    else throw e;
  }

  // Mirrors BillingEngine.gs buildHoursCache_ exactly — see that
  // function's comment for why BTD/SNA WORK_LOG_MIGRATED rows are
  // excluded (superseded by WORK_LOG_AMENDED corrections).
  var SUPERSEDED_MIGRATED = { 'BTD': true, 'SNA': true };
  var fromYMD = pbgDateToYMD_(period.fromDate);
  var toYMD   = pbgDateToYMD_(period.toDate);

  var hoursByJob = {};
  rows.forEach(function(row) {
    var evType  = String(row.event_type || '');
    var actCode = String(row.actor_code || '').trim().toUpperCase();
    if (evType === 'WORK_LOG_MIGRATED' && SUPERSEDED_MIGRATED[actCode]) return;

    var parsedDate = pbgParseWorkDate_(row.work_date, period.year);
    if (!parsedDate) return;
    var ymd = pbgDateToYMD_(parsedDate);
    if (ymd < fromYMD || ymd > toYMD) return;

    var jobNum = String(row.job_number || '').trim().split(/\s+/)[0];
    var hours  = parseFloat(row.hours);
    if (!jobNum || isNaN(hours) || hours === 0) return;

    hoursByJob[jobNum] = (hoursByJob[jobNum] || 0) + hours;
  });

  var jobFilter = {};
  Object.keys(hoursByJob).forEach(function(jn) {
    if (hoursByJob[jn] > 0) jobFilter[jn] = true;
  });

  return { monthPartition: period.monthPartition, jobFilter: jobFilter };
}

/** Same as BillingEngine.gs's private dateToYMD_ — duplicated because
 *  that function isn't on BillingEngine's public API (only
 *  parseSemiMonthlyPeriod_ is). Timezone-safe local-time comparison. */
function pbgDateToYMD_(d) {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** Same as BillingEngine.gs's private parseWorkDate_ (ISO / mangled
 *  Date.toString() / last-resort JS parse) — duplicated for the same
 *  reason as pbgDateToYMD_. Kept in sync manually if that function's
 *  format-handling ever changes. */
function pbgParseWorkDate_(raw, fallbackYear) {
  if (!raw) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;

  var s = String(raw).trim();
  if (!s) return null;

  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10));

  var MONTH_MAP = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
  var mangled = s.match(/[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})/);
  if (mangled) {
    var monthIdx = MONTH_MAP[mangled[1].toLowerCase()];
    if (monthIdx !== undefined) return new Date(fallbackYear || new Date().getFullYear(), monthIdx, parseInt(mangled[2], 10));
  }

  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Runs Checks 1, 2, 3, 8, 9 scoped to periodId's billing period.
 * Every issue any of the five returns is a blocker (see BLOCKING RULE
 * above — not CRITICAL-only). No per-check try/catch: a broken check
 * throws out of this function rather than silently producing a false
 * "cleared: true" (see GATE ERROR vs. GATE FAILURE above).
 *
 * @param {string} [periodId]  e.g. '2026-07A'. Defaults to the
 *   current semi-monthly period (BillingEngine.generateCurrentBillingPeriodId_()).
 * @returns {{ cleared: boolean, blockers: Object[], periodId: string,
 *             monthPartition: string, checkedAt: string }}
 * @throws  If periodId is malformed or a DAL read fails — a gate
 *          error, not a data finding. See header comment.
 */
function runPreBillingChecks(periodId) {
  var MODULE = 'PreBillingGate';

  try {
    periodId = periodId || BillingEngine.generateCurrentBillingPeriodId_();

    var resolved       = pbgResolveJobsInPeriod_(periodId);
    var monthPartition = resolved.monthPartition;
    var jobFilter       = resolved.jobFilter;

    var blockers = [];
    blockers = blockers.concat(checkDuplicateWorkLogs_(monthPartition, jobFilter));
    blockers = blockers.concat(checkOrphanedWorkLogs_(monthPartition, jobFilter));
    blockers = blockers.concat(checkClientCodeConsistency_(jobFilter));
    blockers = blockers.concat(checkAllocatedToValidity_(jobFilter));
    blockers = blockers.concat(checkRateConfigurationCompleteness_(jobFilter));

    var result = {
      cleared:        blockers.length === 0,
      blockers:       blockers,
      periodId:       periodId,
      monthPartition: monthPartition,
      checkedAt:      new Date().toISOString()
    };

    Logger.info('PRE_BILLING_GATE_CHECKED', {
      module: MODULE, period_id: periodId, cleared: result.cleared, blocker_count: blockers.length
    });

    return result;

  } catch (e) {
    Logger.error('PRE_BILLING_GATE_ERROR', {
      module: MODULE, period_id: periodId, error: e.message
    });
    // Re-throw with a distinct prefix so this is never mistaken for a
    // "Billing blocked — N issues" data-finding abort in logs/alerts.
    throw new Error('PRE_BILLING_GATE_ERROR: pre-billing gate could not complete for period "' +
                     periodId + '": ' + e.message);
  }
}

/**
 * Manual diagnostic runner — prints a formatted pass/fail report to
 * console. Never throws (catches and reports gate errors too) so it's
 * always safe to run before a real billing/timesheet run.
 * @param {string} [periodId]  e.g. '2026-07A'. Defaults to current period.
 */
function runPreBillingReport(periodId) {
  console.log('=== Pre-Billing Report ===');

  var result;
  try {
    result = runPreBillingChecks(periodId);
  } catch (e) {
    console.log('❌ GATE ERROR — could not complete checks: ' + e.message);
    console.log('This is a problem with the gate itself, not a data finding. Fix before relying on this report.');
    return;
  }

  console.log('Period: ' + result.periodId + ' (partition ' + result.monthPartition + ')');
  console.log('Checked at: ' + result.checkedAt);

  if (result.cleared) {
    console.log('✅ CLEARED — no blockers found across checks 1, 2, 3, 8, 9.');
    return;
  }

  console.log('🔴 BLOCKED — ' + result.blockers.length + ' issue(s) found:');
  var bySeverity = { CRITICAL: [], HIGH: [], MEDIUM: [], INFO: [] };
  result.blockers.forEach(function(b) { (bySeverity[b.severity] || bySeverity.INFO).push(b); });

  ['CRITICAL', 'HIGH', 'MEDIUM', 'INFO'].forEach(function(sev) {
    bySeverity[sev].forEach(function(b) {
      console.log('  • [' + sev + '] ' + b.check + ' — ' + b.message);
      if (b.recommendedAction) console.log('      → ' + b.recommendedAction);
    });
  });

  console.log('Resolve the above before running billing/timesheets for ' + result.periodId + '.');
}
