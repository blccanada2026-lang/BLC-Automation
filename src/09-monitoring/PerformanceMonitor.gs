// ============================================================
// PerformanceMonitor.gs — BLC Nexus T9 Monitoring
// src/09-monitoring/PerformanceMonitor.gs
//
// LOAD ORDER: T9. Loads after T0–T6.
// DEPENDENCIES: Config (T0), Identifiers (T0), DAL (T1),
//               RBAC (T2), Logger (T3), HealthMonitor (T3)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  Daily health check for the BLC Nexus system.           ║
// ║  Designed to run on a daily time-based trigger.         ║
// ║                                                          ║
// ║  Checks performed each run:                             ║
// ║    1. Jobs stuck in INTAKE_RECEIVED > 24 hours          ║
// ║    2. ERROR-level events in _SYS_LOGS last 24 hours     ║
// ║    3. RBAC denial events in _SYS_LOGS last 24 hours     ║
// ║    4. PayrollEngine last run timestamp (staleness)      ║
// ║                                                          ║
// ║  Writes one summary row to _SYS_LOGS per run:           ║
// ║    level INFO  — all thresholds clear                   ║
// ║    level WARN  — one or more thresholds breached        ║
// ╚══════════════════════════════════════════════════════════╝
//
// TRIGGER SETUP (add to Triggers.gs):
//   function runDailyHealthCheck() {
//     PerformanceMonitor.runHealthCheck();
//   }
//   Install via: ScriptApp.newTrigger('runDailyHealthCheck')
//                  .timeBased().everyDays(1).atHour(6).create()
//
// PUBLIC API:
//   PerformanceMonitor.runHealthCheck()  →  result Object
// ============================================================

var PerformanceMonitor = (function () {

  var MODULE = 'PerformanceMonitor';

  // ── System actor used for all trigger-invoked runs ──────────
  // Triggers fire as the script owner. 'system@blclotus.com'
  // resolves to SYSTEM role (RBAC.PERMISSION_MATRIX.SYSTEM),
  // which holds ADMIN_CONFIG permission required here.
  var SYSTEM_EMAIL = 'system@blclotus.com';

  // ── Breach thresholds ────────────────────────────────────────
  // Any breach flips the summary row from INFO → WARN.
  var THRESHOLDS = {
    STUCK_JOBS_MAX:     0,    // any job stuck > 24h is a warning
    ERROR_EVENTS_MAX:   0,    // any ERROR log in 24h is a warning
    RBAC_DENIAL_MAX:    10,   // > 10 denials in 24h is suspicious
    PAYROLL_STALE_DAYS: 45    // no payroll run in 45 days → warn
  };

  var MS_PER_HOUR = 60 * 60 * 1000;
  var MS_PER_DAY  = 24 * MS_PER_HOUR;

  // ============================================================
  // SECTION 1: STUCK JOBS CHECK
  //
  // Reads the flat VW_JOB_CURRENT_STATE projection rather than
  // scanning partitioned FACT_JOB_EVENTS — cheaper (one sheet
  // read vs. N partition reads) and sufficient because the view
  // already reflects current state.
  // ============================================================

  /**
   * Returns all jobs currently in INTAKE_RECEIVED whose updated_at
   * is more than 24 hours old.
   *
   * @returns {{ count: number, jobs: Array<{job_number:string, age_hours:number}>, error: string= }}
   */
  function checkStuckJobs_() {
    var cutoff = new Date(Date.now() - MS_PER_DAY);
    var stuck  = [];

    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, {
        callerModule: MODULE
      });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') {
        return { count: 0, jobs: [], error: 'VW_JOB_CURRENT_STATE not found' };
      }
      throw e;
    }

    for (var i = 0; i < rows.length; i++) {
      if (i % 20 === 0 && HealthMonitor.isApproachingLimit()) {
        Logger.warn('HEALTH_CHECK_QUOTA_CUTOFF', {
          module:  MODULE,
          message: 'checkStuckJobs_: quota limit approaching — partial result',
          scanned: i,
          total:   rows.length
        });
        break;
      }

      var row = rows[i];
      if (String(row.current_state || '').trim() !== Config.STATES.INTAKE_RECEIVED) continue;

      // updated_at is preferred; fall back to created_at for older rows
      var ts = new Date(row.updated_at || row.created_at || 0);
      if (isNaN(ts.getTime())) continue;

      var ageHours = (Date.now() - ts.getTime()) / MS_PER_HOUR;
      if (ageHours > 24) {
        stuck.push({ job_number: String(row.job_number || ''), age_hours: Math.round(ageHours) });
      }
    }

    return { count: stuck.length, jobs: stuck };
  }

  // ============================================================
  // SECTION 2: _SYS_LOGS SCAN
  //
  // Single pass over _SYS_LOGS collects three values at once:
  //   a) ERROR-level count in the last 24 hours
  //   b) RBAC denial count (module='RBAC') in the last 24 hours
  //   c) Last PAYROLL_RUN_COMPLETE timestamp (any age)
  //
  // Single read avoids a second full-table scan.
  // ============================================================

  /**
   * Scans _SYS_LOGS in one pass and returns error counts, RBAC denial
   * counts (both for the last 24 hours), and the last payroll run timestamp.
   *
   * @returns {{ errorCount: number, rbacDenialCount: number, lastPayrollRun: string|null, error: string= }}
   */
  function scanSysLogs_() {
    var cutoff         = new Date(Date.now() - MS_PER_DAY);
    var errorCount     = 0;
    var rbacCount      = 0;
    var lastPayrollRun = null;

    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.SYS_LOGS, { callerModule: MODULE });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') {
        return { errorCount: 0, rbacDenialCount: 0, lastPayrollRun: null,
                 error: '_SYS_LOGS not found' };
      }
      throw e;
    }

    for (var i = 0; i < rows.length; i++) {
      if (i % 20 === 0 && HealthMonitor.isApproachingLimit()) {
        Logger.warn('HEALTH_CHECK_QUOTA_CUTOFF', {
          module:  MODULE,
          message: 'scanSysLogs_: quota limit approaching — partial result',
          scanned: i,
          total:   rows.length
        });
        break;
      }

      var row    = rows[i];
      var ts     = new Date(row.timestamp || 0);
      var level  = String(row.level  || '').trim();
      var mod    = String(row.module || '').trim();
      var action = String(row.action || '').trim();

      // Track last payroll run across all time (not just 24h window)
      if (mod === 'PayrollEngine' && action === 'PAYROLL_RUN_COMPLETE') {
        if (!isNaN(ts.getTime())) {
          if (!lastPayrollRun || ts > new Date(lastPayrollRun)) {
            lastPayrollRun = row.timestamp;
          }
        }
      }

      // Threshold counts are 24h only
      if (isNaN(ts.getTime()) || ts < cutoff) continue;

      if (level === 'ERROR') errorCount++;
      if (mod   === 'RBAC')  rbacCount++;
    }

    return { errorCount: errorCount, rbacDenialCount: rbacCount,
             lastPayrollRun: lastPayrollRun };
  }

  // ============================================================
  // SECTION 3: PAYROLL STALENESS
  // ============================================================

  /**
   * Returns whether the last payroll run was more than
   * THRESHOLDS.PAYROLL_STALE_DAYS days ago (or has never run).
   *
   * @param   {string|null} lastPayrollRun  ISO timestamp or null
   * @returns {{ stale: boolean, daysSince: number|null }}
   */
  function checkPayrollStaleness_(lastPayrollRun) {
    if (!lastPayrollRun) return { stale: true, daysSince: null };
    var ts = new Date(lastPayrollRun);
    if (isNaN(ts.getTime())) return { stale: true, daysSince: null };
    var daysSince = (Date.now() - ts.getTime()) / MS_PER_DAY;
    return {
      stale:     daysSince > THRESHOLDS.PAYROLL_STALE_DAYS,
      daysSince: Math.round(daysSince)
    };
  }

  // ============================================================
  // SECTION 4: SUMMARY WRITER
  // ============================================================

  /**
   * Evaluates all check results against thresholds and writes one
   * summary row to _SYS_LOGS at INFO (all clear) or WARN (any breach).
   *
   * @param {{ stuckJobs, errorCount, rbacDenialCount, payroll }} results
   */
  function writeSummary_(results) {
    var breaches = [];

    if (results.stuckJobs.count > THRESHOLDS.STUCK_JOBS_MAX) {
      breaches.push(results.stuckJobs.count + ' job(s) stuck in INTAKE_RECEIVED > 24h');
    }
    if (results.errorCount > THRESHOLDS.ERROR_EVENTS_MAX) {
      breaches.push(results.errorCount + ' ERROR event(s) in last 24h');
    }
    if (results.rbacDenialCount > THRESHOLDS.RBAC_DENIAL_MAX) {
      breaches.push(results.rbacDenialCount + ' RBAC denial(s) in last 24h (threshold: '
                    + THRESHOLDS.RBAC_DENIAL_MAX + ')');
    }
    if (results.payroll.stale) {
      breaches.push('PayrollEngine last run: ' + (
        results.payroll.daysSince !== null
          ? results.payroll.daysSince + ' day(s) ago'
          : 'never'
      ));
    }

    var isWarn  = breaches.length > 0;
    var message = isWarn
      ? 'Health check WARN — ' + breaches.join('; ')
      : 'Health check OK — all metrics within thresholds';

    var context = {
      module:           MODULE,
      message:          message,
      stuck_jobs:       results.stuckJobs.count,
      stuck_job_list:   results.stuckJobs.jobs.length > 0
                          ? JSON.stringify(results.stuckJobs.jobs) : '',
      error_events_24h: results.errorCount,
      rbac_denials_24h: results.rbacDenialCount,
      payroll_days_ago: results.payroll.daysSince !== null
                          ? results.payroll.daysSince : 'never',
      payroll_stale:    results.payroll.stale
    };

    if (isWarn) {
      Logger.warn('HEALTH_CHECK_SUMMARY', context);
    } else {
      Logger.info('HEALTH_CHECK_SUMMARY', context);
    }
  }

  // ============================================================
  // SECTION 5: PUBLIC API — runHealthCheck
  // ============================================================

  /**
   * Runs the daily system health check and writes one summary row
   * to _SYS_LOGS (INFO if all clear, WARN if any threshold breached).
   *
   * Intended to be called from a daily time-based trigger in Triggers.gs.
   * Resolves a SYSTEM actor (system@blclotus.com) and enforces
   * ADMIN_CONFIG permission — SYSTEM role passes unconditionally.
   *
   * @returns {{ stuckJobs: Object, errorCount: number, rbacDenialCount: number, payroll: Object }}
   * @throws  {Error}  Only on unexpected DAL or RBAC failure (SHEET_NOT_FOUND is caught internally)
   */
  function runHealthCheck() {
    HealthMonitor.startExecution();

    // ── Step 1: RBAC — must be first (R3 / S1) ─────────────────
    var actor = RBAC.resolveActor(SYSTEM_EMAIL);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);
    Logger.setActor(actor);

    try {
      Logger.info('HEALTH_CHECK_START', {
        module:  MODULE,
        message: 'Daily health check starting'
      });

      // ── Step 2: Stuck jobs ──────────────────────────────────
      var stuckJobs = checkStuckJobs_();

      // ── Step 3: _SYS_LOGS scan (errors + RBAC + payroll) ───
      var logs = scanSysLogs_();

      // ── Step 4: Payroll staleness ───────────────────────────
      var payroll = checkPayrollStaleness_(logs.lastPayrollRun);

      // ── Step 5: Write summary ───────────────────────────────
      var results = {
        stuckJobs:       stuckJobs,
        errorCount:      logs.errorCount,
        rbacDenialCount: logs.rbacDenialCount,
        payroll:         payroll
      };

      writeSummary_(results);

      return results;

    } catch (e) {
      Logger.error('HEALTH_CHECK_FAILED', {
        module:  MODULE,
        message: 'Health check threw an exception: ' + e.message
      });
      throw e;

    } finally {
      Logger.clearActor();
      HealthMonitor.endExecution();
    }
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  return {
    /** @type {function(): Object} */
    runHealthCheck: runHealthCheck
  };

}());
