// ============================================================
// HealthMonitor.gs — BLC Nexus T3 Infrastructure
// src/03-infrastructure/HealthMonitor.gs
//
// LOAD ORDER: Third file in T3. Loads after Logger.gs, ErrorHandler.gs.
// DEPENDENCIES: Config (T0), DAL (T1), Logger (T3 — must load before this)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  Observes execution health. NEVER stops execution.      ║
// ║  Call startExecution() at handler entry, endExecution() ║
// ║  in the finally block, checkLimits() inside hot loops.  ║
// ╚══════════════════════════════════════════════════════════╝
//
// Responsibilities:
//   1. Track wall-clock execution time per handler invocation
//   2. Track DAL SpreadsheetApp API call count (via DAL.getApiCallCount)
//   3. Emit Logger.warn() when thresholds are approached
//   4. Emit Logger.error() when critical thresholds are breached
//   5. Provide isApproachingLimit() boolean for loop exit decisions
//
// THRESHOLDS:
//   API calls > 70  → WARN   (approaching GAS quota ceiling)
//   API calls > 90  → WARN at ERROR severity (critical — imminent quota failure)
//   Execution > 20s → WARN   (approaching the 5-min GAS limit early)
//
// DESIGN: HealthMonitor is intentionally stateless between executions.
//   GAS VMs are isolated per trigger invocation — state resets automatically.
//   Within a single execution, state is held in module-level vars (_startTime,
//   _module) and is reset by startExecution() on each handler call.
//
// STANDARD PATTERN — single handler:
//
//   function handle(queueItem) {
//     HealthMonitor.startExecution('JobCreateHandler');
//     try {
//       // ... handler body ...
//     } finally {
//       HealthMonitor.endExecution();
//     }
//   }
//
// HIGH-THROUGHPUT PATTERN — loop with mid-run checks:
//
//   HealthMonitor.startExecution('PayrollEngine');
//   try {
//     for (var i = 0; i < designers.length; i++) {
//       if (!HealthMonitor.isApproachingLimit()) {
//         processDesigner(designers[i]);
//         HealthMonitor.checkLimits();  // log if threshold crossed
//       } else {
//         Logger.warn('PAYROLL_RUN_PARTIAL', {
//           module:    'PayrollEngine',
//           message:   'Stopping early — quota limit approaching',
//           processed: i,
//           total:     designers.length
//         });
//         break;
//       }
//     }
//   } finally {
//     HealthMonitor.endExecution();
//   }
//
// DO NOT:
//   - Call SpreadsheetApp directly
//   - Throw from within HealthMonitor (all paths are fail-safe)
//   - Use HealthMonitor to gate or halt execution (log only)
// ============================================================

var HealthMonitor = (function () {

  // ============================================================
  // SECTION 1: THRESHOLD CONSTANTS
  //
  // Operational policy values — intentionally tighter than the
  // GAS platform hard limits (200 calls, 6 min). These give
  // handlers a safe window to flush buffers, log summaries,
  // and exit cleanly before the platform kills the execution.
  //
  // Not stored in Config.LIMITS because they are HealthMonitor-
  // specific policy, not system-wide configuration.
  // ============================================================

  // API_WARN and API_CRITICAL are percentages applied to the
  // Config runtime value quotaApiCallWarning (DEV=500, PROD=200).
  // Stored as integers: 70 = 70%, 90 = 90%.
  // Computed absolute values: warnAt_() and critAt_() below.
  var THRESHOLDS = {
    API_WARN_PCT:    70,          // WARN at 70% of quotaApiCallWarning
    API_CRIT_PCT:    90,          // ERROR at 90% of quotaApiCallWarning
    EXEC_WARN_MS: 20000           // WARN: 20 seconds elapsed
  };

  /** Returns absolute API call count at which WARN fires. */
  function warnAt_() {
    var quota = Config.get('quotaApiCallWarning', 200);
    return Math.floor(quota * THRESHOLDS.API_WARN_PCT / 100);
  }

  /** Returns absolute API call count at which CRITICAL fires. */
  function critAt_() {
    var quota = Config.get('quotaApiCallWarning', 200);
    return Math.floor(quota * THRESHOLDS.API_CRIT_PCT / 100);
  }

  // ============================================================
  // SECTION 2: PRIVATE STATE (reset per startExecution call)
  // ============================================================

  var _startTime      = null;   // Date.now() at startExecution()
  var _module         = null;   // calling module name (optional)
  var _lastApiCount   = 0;      // API count at last checkLimits() call
  var _warnedApi      = false;  // true after API_WARN log emitted this run
  var _warnedApiCrit  = false;  // true after API_CRITICAL log emitted this run
  var _warnedExec     = false;  // true after EXEC_WARN log emitted this run

  // ============================================================
  // SECTION 3: INTERNAL HELPERS
  // ============================================================

  /**
   * Returns elapsed milliseconds since startExecution(), or 0 if not started.
   * @returns {number}
   */
  function elapsedMs_() {
    if (_startTime === null) return 0;
    return Date.now() - _startTime;
  }

  /**
   * Returns the current DAL API call count. Fail-safe — returns 0
   * if DAL is unavailable (e.g. during unit tests without GAS stubs).
   * @returns {number}
   */
  function getApiCount_() {
    try {
      return DAL.getApiCallCount();
    } catch (e) {
      return 0;
    }
  }

  /**
   * Returns the execution_id from Logger. Fail-safe — returns '' on error.
   * Injected into every log entry's detail so all HealthMonitor events
   * are queryable alongside other rows from the same execution.
   * @returns {string}
   */
  function getExecutionId_() {
    try {
      return Logger.getExecutionId() || '';
    } catch (e) {
      return '';
    }
  }

  /**
   * Emits a Logger.warn call. Fail-safe — swallows Logger failures so
   * a logging error never surfaces to the handler.
   *
   * @param {string} action   Event identifier e.g. 'API_QUOTA_WARN'
   * @param {Object} detail   Extra fields for detail_json
   */
  function emitWarn_(action, detail) {
    try {
      detail.execution_id = getExecutionId_();
      if (_module) detail.module = _module;
      Logger.warn(action, detail);
    } catch (e) {
      try {
        console.log('[HealthMonitor WARN FAILED] ' + action + ': ' + e.message);
      } catch (ignored) {}
    }
  }

  /**
   * Emits a Logger.error call for critical threshold breaches.
   * Fail-safe — never throws.
   *
   * @param {string} action
   * @param {Object} detail
   */
  function emitError_(action, detail) {
    try {
      detail.execution_id = getExecutionId_();
      if (_module) detail.module = _module;
      Logger.error(action, detail);
    } catch (e) {
      try {
        console.log('[HealthMonitor ERROR FAILED] ' + action + ': ' + e.message);
      } catch (ignored) {}
    }
  }

  // ============================================================
  // SECTION 4: startExecution
  //
  // Call once at the top of every handler. Resets all state for
  // a fresh observation window. Safe to call multiple times in
  // the same GAS execution (e.g. QueueProcessor runs multiple
  // handlers sequentially — each gets its own timing window).
  // ============================================================

  /**
   * Marks the start of a monitored execution window.
   * Resets all thresholds and warning flags.
   *
   * @param {string} [moduleName]  Name of the calling module for log context
   */
  function startExecution(moduleName) {
    _startTime     = Date.now();
    _module        = moduleName || null;
    _lastApiCount  = getApiCount_();
    _warnedApi     = false;
    _warnedApiCrit = false;
    _warnedExec    = false;
  }

  // ============================================================
  // SECTION 5: endExecution
  //
  // Call in the finally block of every handler. Emits a single
  // INFO-level summary log with duration and total API calls.
  // No-op if startExecution() was never called (safe to call
  // defensively in finally even if handler setup threw).
  // ============================================================

  /**
   * Marks the end of the monitored execution window.
   * Logs a summary of total duration and API call usage.
   * Always call in a finally block.
   */
  function endExecution() {
    if (_startTime === null) return;  // startExecution was never called

    var durationMs = elapsedMs_();
    var apiCalls   = getApiCount_();

    try {
      Logger.info('EXECUTION_COMPLETE', {
        module:       _module || 'UNKNOWN',
        message:      'Execution completed',
        execution_id: getExecutionId_(),
        duration_ms:  durationMs,
        api_calls:    apiCalls
      });
    } catch (e) {
      try {
        console.log('[HealthMonitor endExecution FAILED] ' + e.message);
      } catch (ignored) {}
    }

    // Reset state — handler is done
    _startTime     = null;
    _module        = null;
    _lastApiCount  = 0;
    _warnedApi     = false;
    _warnedApiCrit = false;
    _warnedExec    = false;
  }

  // ============================================================
  // SECTION 6: checkLimits
  //
  // Checks current API call count and elapsed time against all
  // thresholds. Emits logs for any breach not yet logged this run
  // (de-duplicated via _warned* flags). Returns a status object
  // so callers can optionally inspect the result.
  //
  // De-duplication rationale:
  //   checkLimits() may be called inside tight loops (every item).
  //   Without de-duplication, a loop of 50 items where API calls
  //   exceed the WARN threshold at item 30 would emit 20 identical
  //   WARN rows — noise that obscures real signals in _SYS_LOGS.
  //   Each threshold fires at most once per startExecution() window.
  // ============================================================

  /**
   * Checks all health thresholds and logs any breaches.
   * Safe to call frequently — each threshold logs at most once per window.
   * No-op if startExecution() was never called.
   *
   * @returns {{ ok: boolean, warnings: string[] }}
   *   ok:       true if no threshold breaches were detected this call
   *   warnings: array of action strings for any breach logged this call
   */
  function checkLimits() {
    if (_startTime === null) {
      return { ok: true, warnings: [] };
    }

    var warnings  = [];
    var apiCalls  = getApiCount_();
    var elapsed   = elapsedMs_();

    var warnAt = warnAt_();
    var critAt = critAt_();

    // ── API call — CRITICAL threshold ────────────────────────
    if (apiCalls > critAt && !_warnedApiCrit) {
      _warnedApiCrit = true;
      emitError_('API_QUOTA_CRITICAL', {
        message:    'SpreadsheetApp API calls critically high — quota failure imminent',
        api_calls:  apiCalls,
        threshold:  critAt,
        elapsed_ms: elapsed
      });
      warnings.push('API_QUOTA_CRITICAL');
    }

    // ── API call — WARN threshold ─────────────────────────────
    // Only fire WARN if CRITICAL hasn't already fired (avoid double-log)
    if (apiCalls > warnAt && !_warnedApi && !_warnedApiCrit) {
      _warnedApi = true;
      emitWarn_('API_QUOTA_WARN', {
        message:    'SpreadsheetApp API calls approaching quota ceiling',
        api_calls:  apiCalls,
        threshold:  warnAt,
        elapsed_ms: elapsed
      });
      warnings.push('API_QUOTA_WARN');
    }

    // ── Execution time — WARN threshold (> 20s) ──────────────
    if (elapsed > THRESHOLDS.EXEC_WARN_MS && !_warnedExec) {
      _warnedExec = true;
      emitWarn_('EXECUTION_TIME_WARN', {
        message:    'Execution time exceeding 20 seconds — consider reducing batch size',
        elapsed_ms: elapsed,
        threshold:  THRESHOLDS.EXEC_WARN_MS,
        api_calls:  apiCalls
      });
      warnings.push('EXECUTION_TIME_WARN');
    }

    return {
      ok:       warnings.length === 0,
      warnings: warnings
    };
  }

  // ============================================================
  // SECTION 7: isApproachingLimit
  //
  // Convenience boolean for loop exit conditions.
  // Returns true when either API threshold has been breached OR
  // execution time is over the warn threshold.
  //
  // Usage in loop:
  //   while (hasMore && !HealthMonitor.isApproachingLimit()) { ... }
  //
  // Note: does NOT emit a log. Use checkLimits() to emit.
  //   Typically call both: check the boolean first, then call
  //   checkLimits() when you decide to break the loop.
  // ============================================================

  /**
   * Returns true if any health threshold has been breached.
   * Does NOT emit log entries — call checkLimits() for that.
   * Safe to call in tight loops — no side effects.
   *
   * @returns {boolean}
   */
  function isApproachingLimit() {
    if (_startTime === null) return false;

    var apiCalls = getApiCount_();
    var elapsed  = elapsedMs_();

    return (
      apiCalls > warnAt_()              ||
      elapsed  > THRESHOLDS.EXEC_WARN_MS
    );
  }

  // ============================================================
  // SECTION 8: getStatus
  //
  // Returns a plain snapshot of current execution health.
  // Useful for HealthMonitor summary reports and admin dashboards.
  // Does not emit any logs.
  // ============================================================

  /**
   * Returns a snapshot of current execution metrics.
   * Safe to call at any point — returns zeros if not started.
   *
   * @returns {{
   *   running:    boolean,
   *   module:     string|null,
   *   elapsed_ms: number,
   *   api_calls:  number,
   *   thresholds: { api_warn: number, api_critical: number, exec_warn_ms: number }
   * }}
   */
  function getStatus() {
    return {
      running:    _startTime !== null,
      module:     _module,
      elapsed_ms: elapsedMs_(),
      api_calls:  getApiCount_(),
      thresholds: {
        api_warn:     warnAt_(),
        api_critical: critAt_(),
        exec_warn_ms: THRESHOLDS.EXEC_WARN_MS
      }
    };
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  return {

    // ── Lifecycle ────────────────────────────────────────────
    /**
     * Call at handler entry. Resets all monitoring state.
     * @type {function(string=): void}
     */
    startExecution: startExecution,

    /**
     * Call in handler finally block. Logs execution summary.
     * @type {function(): void}
     */
    endExecution: endExecution,

    // ── Threshold checks ─────────────────────────────────────
    /**
     * Check all thresholds and emit logs for any breach.
     * Returns { ok, warnings[] }. Call inside hot loops.
     * @type {function(): { ok: boolean, warnings: string[] }}
     */
    checkLimits: checkLimits,

    /**
     * Boolean shorthand for loop exit decisions. No side effects.
     * @type {function(): boolean}
     */
    isApproachingLimit: isApproachingLimit,

    // ── Inspection ───────────────────────────────────────────
    /**
     * Returns a snapshot of current execution metrics.
     * @type {function(): Object}
     */
    getStatus: getStatus,

    // ── Threshold constants (read-only reference) ─────────────
    THRESHOLDS: THRESHOLDS

  };

}());
