// ============================================================
// Logger.gs — BLC Nexus T3 Infrastructure
// src/03-infrastructure/Logger.gs
//
// LOAD ORDER: First file in T3. Loads after T0, T1 (DAL), T2 (RBAC).
// DEPENDENCIES: Config (T0), Identifiers (T0), DAL (T1), RBAC (T2)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  ALL structured logging flows through this module.      ║
// ║  Rule D2: never call console.log() or Logger.log()      ║
// ║  directly in handlers or engines. Use Logger.info() etc. ║
// ╚══════════════════════════════════════════════════════════╝
//
// Responsibilities:
//   1. Write structured rows to _SYS_LOGS via DAL.appendRow
//   2. Filter writes by environment log level (Config.isLogLevelActive)
//   3. Register itself into DAL.setLogHook() at module load time
//   4. Register itself into RBAC.setDeniedLogHook() at module load time
//   5. Provide a thread-level actor so handlers set it once per request
//   6. Provide buffer mode for high-throughput operations (payroll/billing)
//
// CIRCULAR DEPENDENCY GUARD:
//   Logger → DAL.appendRow → DAL.emit_() → Logger (hook)
//   This re-entrant call is detected via the _writing flag.
//   While a write is in progress, inbound hook calls fall back
//   to console.log() and return immediately — no second write.
//
// USAGE IN HANDLERS (standard pattern):
//
//   function handle(queueItem) {
//     var actor = RBAC.resolveActor(queueItem.submitter_email);
//     RBAC.enforcePermission(actor, RBAC.ACTIONS.JOB_CREATE);
//     Logger.setActor(actor);   // thread-level actor for this request
//
//     try {
//       // ... handler logic ...
//       Logger.info('JOB_CREATED', {
//         module:    'JobCreateHandler',
//         target_id: jobNumber,
//         message:   'Job created successfully'
//       });
//     } finally {
//       Logger.clearActor();    // always clear — prevents actor bleed between runs
//     }
//   }
//
// HIGH-THROUGHPUT PATTERN (payroll / billing):
//
//   Logger.enableBuffer();
//   for (var i = 0; i < designers.length; i++) {
//     // ... calculate payroll ...
//     Logger.info('PAYROLL_ROW', { module: 'PayrollEngine', ... });
//   }
//   Logger.flushBuffer();  // one DAL.appendRows() call for all rows
//
// RBAC DENIED EVENTS:
//   RBAC.emitDenied_() calls the hook registered here.
//   Denials always write to _SYS_LOGS regardless of log level threshold.
//
// DO NOT:
//   - Call SpreadsheetApp directly (DAL handles all sheet access)
//   - Call Logger from within the _writing guard path (use console.log)
//   - Throw from within Logger — it must be fully fail-safe
//   - Use Logger for validation errors (those go to _SYS_EXCEPTIONS via ErrorHandler)
// ============================================================

var Logger = (function () {

  // ============================================================
  // SECTION 1: LEVEL CONSTANTS
  //
  // Mirrors Config.LOG_LEVELS numeric values for comparison, but
  // stores the string names used in the _SYS_LOGS.level column.
  // Config.isLogLevelActive(levelName) maps name → numeric threshold.
  // ============================================================

  var LEVELS = {
    DEBUG: 'DEBUG',  // Dev-only; filtered out in STAGING and PROD
    INFO:  'INFO',   // Significant events; filtered out in PROD
    WARN:  'WARN',   // Degraded operations; always written
    ERROR: 'ERROR'   // Failures; always written
  };

  // ============================================================
  // SECTION 2: PRIVATE STATE (per GAS execution)
  // ============================================================

  var _threadActor = null;    // Set via setActor(); shared across one handler invocation
  var _writing     = false;   // Re-entrancy guard — prevents Logger→DAL→Logger loop
  var _bufferMode  = false;   // When true, rows queue in _buffer instead of writing immediately
  var _buffer      = [];      // Row objects awaiting flushBuffer()

  // Execution ID — one UUID per GAS execution (generated at IIFE load time).
  // GAS executions are isolated: each trigger invocation starts a fresh VM,
  // so this value is unique per run. Every log row carries it in detail_json,
  // allowing all rows from one execution to be retrieved with a single filter:
  //   SELECT * FROM _SYS_LOGS WHERE detail_json CONTAINS '<execution_id>'
  var _executionId = Identifiers.generateId();

  // ============================================================
  // SECTION 3: SAFE JSON SERIALIZATION
  //
  // JSON.stringify can throw on circular references or BigInt values.
  // All calls to stringify inside Logger go through this helper so
  // a serialization failure never propagates to the caller.
  // ============================================================

  /**
   * Safely serialises a value to a JSON string.
   * Returns an error marker string on failure rather than throwing.
   *
   * @param {*} value
   * @returns {string}
   */
  function safeStringify_(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch (e) {
      return '{"_serializeError":"' + e.message + '"}';
    }
  }

  // ============================================================
  // SECTION 4: LOG ROW BUILDER
  //
  // Constructs a plain object matching the _SYS_LOGS schema exactly.
  // Column order mirrors SCHEMA_REFERENCE.md — DAL maps by header name
  // so order does not matter, but keeping them aligned aids review.
  //
  // Actor resolution priority (first non-null wins):
  //   1. context.actor  — explicit actor passed with this log call
  //   2. _threadActor   — set via Logger.setActor() for the request
  //   3. null           — actor fields written as empty strings
  //
  // detail_json contains all context fields that are NOT reserved
  // column names. Reserved names: module, message, target_id, actor.
  // ============================================================

  /** Reserved context keys that map to dedicated _SYS_LOGS columns. */
  var RESERVED_CONTEXT_KEYS = {
    module:    true,
    message:   true,
    target_id: true,
    actor:     true
  };

  /**
   * Builds a _SYS_LOGS row object from the log call parameters.
   *
   * @param {string} level    One of LEVELS values
   * @param {string} action   Action identifier (e.g. 'JOB_CREATED')
   * @param {Object} context  Caller-supplied context object
   * @returns {Object}  Row object ready for DAL.appendRow
   */
  function buildRow_(level, action, context) {
    context = context || {};

    // Resolve actor: explicit > thread-level > null
    var actor = context.actor || _threadActor || null;

    // Extract known columns
    var module   = (context.module   && String(context.module))   || 'UNKNOWN';
    var message  = (context.message  && String(context.message))  || action;
    var targetId = (context.target_id && String(context.target_id)) || '';

    // Collect remaining fields into detail_json
    var detail = {};
    for (var key in context) {
      if (!context.hasOwnProperty(key)) continue;
      if (RESERVED_CONTEXT_KEYS[key]) continue;
      detail[key] = context[key];
    }

    // Always inject execution_id so every row is queryable by execution
    detail.execution_id = _executionId;

    return {
      log_id:      Identifiers.generateId(),
      timestamp:   new Date().toISOString(),
      level:       level,
      module:      module,
      actor_code:  actor ? (actor.personCode || '') : '',
      actor_role:  actor ? (actor.role       || '') : '',
      action:      action,
      target_id:   targetId,
      message:     message,
      detail_json: safeStringify_(detail)
    };
  }

  // ============================================================
  // SECTION 5: CORE WRITE ENGINE
  //
  // All log writes — immediate, buffered, or hook-sourced — pass
  // through write_() or writeRow_(). These are the only functions
  // that touch DAL. Both are fully fail-safe: they never throw.
  //
  // REENTRANCY GUARD:
  //   _writing is set true before DAL.appendRow and cleared in finally.
  //   Any Logger call that arrives while _writing === true (e.g. from
  //   the DAL log hook firing mid-write) is caught here and falls back
  //   to console.log — no second write attempt is made.
  //
  // LEVEL FILTER:
  //   Config.isLogLevelActive() reads the environment's loggingLevel
  //   (e.g. PROD = WARN → DEBUG and INFO calls are skipped entirely).
  //   Security events (RBAC denials) bypass this filter — see writeRow_().
  // ============================================================

  /**
   * Writes a pre-built row object to _SYS_LOGS via DAL.
   * Handles reentrancy guard and fail-safe catching.
   * Does NOT apply level filtering — caller decides whether to call this.
   *
   * @param {Object}  row             Pre-built _SYS_LOGS row
   * @param {boolean} [bypassGuard]   If true, use console.log fallback immediately.
   *                                  Used by hooks that detect they are already inside a write.
   */
  function writeRow_(row, bypassGuard) {
    if (bypassGuard || _writing) {
      // Re-entrant call or explicit bypass — fall back to console.log
      // console.log is intentional here: it is the only safe fallback
      // inside the re-entrancy window. Rule D2 does not apply to Logger itself.
      try {
        console.log('[Logger] ' + row.level + ' [' + row.module + '] ' +
                    row.action + ' — ' + row.message);
      } catch (ignored) {}
      return;
    }

    _writing = true;
    try {
      if (_bufferMode) {
        // In buffer mode, queue the row for flushBuffer() — do not write yet
        _buffer.push(row);
      } else {
        DAL.appendRow(Config.TABLES.SYS_LOGS, row, { callerModule: 'Logger' });
      }
    } catch (e) {
      // Fail-safe: a logging failure must never surface to the caller
      try {
        console.log('[Logger WRITE FAILED] action=' + row.action +
                    ' level=' + row.level + ' err=' + e.message);
      } catch (ignored) {}
    } finally {
      _writing = false;
    }
  }

  /**
   * Applies level filtering, builds the row, then delegates to writeRow_().
   * Entry point for all public log methods (debug, info, warn, error).
   *
   * @param {string} level    One of LEVELS values
   * @param {string} action   Action identifier
   * @param {Object} context  Caller-supplied context
   */
  function write_(level, action, context) {
    // Skip write if level is below the active environment threshold.
    // In DEV, emit a console note so filtered calls are still visible
    // during local testing without writing to the sheet.
    if (!Config.isLogLevelActive(level)) {
      if (Config.isDev()) {
        try {
          console.log('[Logger ' + level + ' FILTERED] [' +
                      ((context && context.module) || 'UNKNOWN') + '] ' + action);
        } catch (ignored) {}
      }
      return;
    }

    var row = buildRow_(level, action, context);
    writeRow_(row, false);
  }

  // ============================================================
  // SECTION 6: PUBLIC LOG METHODS
  // ============================================================

  /**
   * Logs a DEBUG-level event. Only written in DEV environment.
   * Use for verbose diagnostic output during development.
   *
   * @param {string} action   Short identifier (e.g. 'QUEUE_ITEM_PICKED')
   * @param {Object} [context]
   * @param {string} context.module     REQUIRED — name of calling module
   * @param {string} [context.message]  Human-readable note (defaults to action)
   * @param {string} [context.target_id] ID of entity being acted on
   * @param {Object} [context.actor]    Actor object (overrides thread actor)
   * @param {*}      [context.*]        Any extra fields → detail_json
   */
  function debug(action, context) {
    write_(LEVELS.DEBUG, action, context);
  }

  /**
   * Logs an INFO-level event. Written in DEV and STAGING.
   * Use for significant state changes: job created, queue item processed, etc.
   *
   * @param {string} action
   * @param {Object} [context]  See debug() for field descriptions
   */
  function info(action, context) {
    write_(LEVELS.INFO, action, context);
  }

  /**
   * Logs a WARN-level event. Written in all environments.
   * Use for degraded-but-continuing states: quota approaching, retry scheduled, etc.
   *
   * @param {string} action
   * @param {Object} [context]
   */
  function warn(action, context) {
    write_(LEVELS.WARN, action, context);
  }

  /**
   * Logs an ERROR-level event. Written in all environments.
   * Use for handler failures, DAL errors, and unexpected exceptions.
   * For data integrity failures, also call ErrorHandler.record() (T3).
   *
   * @param {string} action
   * @param {Object} [context]
   */
  function error(action, context) {
    write_(LEVELS.ERROR, action, context);
  }

  // ── Aliases (user-requested method names) ───────────────────
  /** Alias for info(). Satisfies logInfo(action, context) requirement. */
  function logInfo(action, context)  { info(action, context);  }
  /** Alias for warn(). Satisfies logWarn(action, context) requirement. */
  function logWarn(action, context)  { warn(action, context);  }
  /** Alias for error(). Satisfies logError(action, context) requirement. */
  function logError(action, context) { error(action, context); }

  // ============================================================
  // SECTION 7: THREAD ACTOR MANAGEMENT
  //
  // Handlers set the actor once at the start of their handle() function
  // so every Logger call within the request carries the correct identity
  // without passing actor through every intermediate function call.
  //
  // IMPORTANT: always call clearActor() in a finally block to prevent
  // actor identity bleeding into the next handler invocation when GAS
  // reuses the execution context within a single trigger run.
  //
  // Pattern:
  //   Logger.setActor(actor);
  //   try { ... handler body ... }
  //   finally { Logger.clearActor(); }
  // ============================================================

  /**
   * Sets the thread-level actor for this handler invocation.
   * All subsequent Logger calls will use this actor for actor_code
   * and actor_role columns unless an explicit actor is passed in context.
   *
   * @param {{ personCode: string, role: string }} actor  From RBAC.resolveActor()
   */
  function setActor(actor) {
    _threadActor = actor || null;
  }

  /**
   * Clears the thread-level actor. Call in a finally block at the end
   * of every handler to prevent identity bleed between executions.
   */
  function clearActor() {
    _threadActor = null;
  }

  /**
   * Returns the currently set thread actor, or null.
   * Used by ErrorHandler.gs (T3) to attach actor to exception records.
   *
   * @returns {{ personCode: string, role: string }|null}
   */
  function getActor() {
    return _threadActor;
  }

  // ============================================================
  // SECTION 8: BUFFER MODE
  //
  // High-throughput operations (payroll: ~100 rows, billing: variable)
  // would individually write a log row per designer/job, consuming
  // one API call each. Buffer mode accumulates rows in memory and
  // writes them all in a single DAL.appendRows() call on flush.
  //
  // Safety: if execution terminates before flushBuffer() is called
  // (quota cutoff, uncaught exception), buffered rows are lost.
  // Handlers must call flushBuffer() before returning — even on error.
  //
  // Pattern:
  //   Logger.enableBuffer();
  //   try {
  //     for (...) { Logger.info(...); }
  //   } finally {
  //     Logger.flushBuffer();  // writes all buffered rows
  //   }
  // ============================================================

  /**
   * Enables buffer mode. Subsequent log writes queue in memory
   * instead of writing to the sheet immediately.
   * Has no effect if buffer mode is already active.
   */
  function enableBuffer() {
    _bufferMode = true;
  }

  /**
   * Flushes all buffered log rows to _SYS_LOGS in a single
   * DAL.appendRows() call, then disables buffer mode.
   *
   * Safe to call when buffer is empty — becomes a no-op.
   * Always call in a finally block to prevent row loss on error.
   */
  function flushBuffer() {
    _bufferMode = false;  // disable first so any rows written during flush go direct

    if (!_buffer.length) return;

    var rows = _buffer.slice();
    _buffer  = [];

    if (_writing) {
      // Mid-write reentrancy — fall back to console for each buffered row
      try {
        console.log('[Logger FLUSH BLOCKED] ' + rows.length +
                    ' buffered rows lost — writing was in progress.');
      } catch (ignored) {}
      return;
    }

    _writing = true;
    try {
      DAL.appendRows(Config.TABLES.SYS_LOGS, rows, { callerModule: 'Logger' });
    } catch (e) {
      try {
        console.log('[Logger FLUSH FAILED] ' + rows.length +
                    ' rows lost. Error: ' + e.message);
      } catch (ignored) {}
    } finally {
      _writing = false;
    }
  }

  /**
   * Returns the number of rows currently held in the buffer.
   * Useful for HealthMonitor checks inside high-throughput loops.
   *
   * @returns {number}
   */
  function getBufferDepth() {
    return _buffer.length;
  }

  // ============================================================
  // SECTION 9: DAL LOG HOOK
  //
  // Registered into DAL via DAL.setLogHook() during Logger init.
  // DAL calls this as: hookFn(level, action, context)
  //
  // Policy: only WARN and ERROR DAL events write to _SYS_LOGS.
  //   - INFO events (READ_ALL, APPEND_ROW, etc.) are too noisy —
  //     they would generate a log row for every single sheet operation,
  //     doubling API quota usage and obscuring meaningful signals.
  //   - WARN events (READ_ALL_NO_PERIOD, queue depth alerts) are
  //     operationally significant and must be persisted.
  //   - ERROR events are always critical.
  //
  // The RBAC denied hook fires during some of these calls.
  // The reentrancy guard in writeRow_() prevents infinite loops.
  // ============================================================

  /**
   * Hook function registered into DAL.setLogHook().
   * Receives DAL's internal events and selectively writes them.
   *
   * @param {string} level    'INFO' | 'WARN' | 'ERROR'
   * @param {string} action   DAL event identifier (e.g. 'WRITE_GUARD_DENIED')
   * @param {Object} context  DAL-supplied event context
   */
  function dalHook_(level, action, context) {
    // Only persist WARN and ERROR from DAL — INFO is too high-volume
    if (level !== LEVELS.WARN && level !== LEVELS.ERROR) return;

    var row = buildRow_(level, 'DAL:' + action, {
      module:    'DAL',
      message:   action,
      dal_event: safeStringify_(context)
    });

    // Pass bypassGuard=true when we detect reentrancy:
    // if _writing is already set, this hook fired mid-write — fall back to console
    writeRow_(row, _writing);
  }

  // ============================================================
  // SECTION 10: RBAC DENIED LOG HOOK
  //
  // Registered into RBAC via RBAC.setDeniedLogHook() during Logger init.
  // RBAC calls this as: hookFn({ action, email, personCode, role,
  //                               errorCode, timestamp })
  //
  // Policy: all RBAC denials are written to _SYS_LOGS regardless of
  // the environment's log level threshold. A permission denial is always
  // an operationally significant security event.
  // ============================================================

  /**
   * Hook function registered into RBAC.setDeniedLogHook().
   * Receives every denied-action event from RBAC's enforcement functions.
   *
   * @param {{ action, email, personCode, role, errorCode, timestamp }} entry
   */
  function rbacDeniedHook_(entry) {
    entry = entry || {};

    // Build row directly (bypasses level filter — denials always persist)
    var row = {
      log_id:      Identifiers.generateId(),
      timestamp:   entry.timestamp || new Date().toISOString(),
      level:       LEVELS.WARN,                          // RBAC denials are WARN severity
      module:      'RBAC',
      actor_code:  entry.personCode || '',
      actor_role:  entry.role       || '',
      action:      entry.action     || 'UNKNOWN_ACTION',
      target_id:   '',
      message:     'Permission denied: ' + (entry.action || 'UNKNOWN_ACTION'),
      detail_json: safeStringify_({
        email:        entry.email,
        errorCode:    entry.errorCode,
        execution_id: _executionId
      })
    };

    // Bypass reentrancy guard check is handled inside writeRow_()
    writeRow_(row, _writing);
  }

  // ============================================================
  // SECTION 11: INITIALIZATION
  //
  // Executes immediately as part of this module's IIFE evaluation.
  // By the time Logger.gs is parsed, DAL (T1) and RBAC (T2) are
  // already defined — their hook slots are open and waiting.
  //
  // After this block runs:
  //   - DAL.emit_() routes WARN/ERROR events through dalHook_
  //   - RBAC.emitDenied_() routes all denials through rbacDeniedHook_
  //
  // Failures here are non-fatal: the system still operates, but
  // logging will fall back to console.log for the affected subsystem.
  // ============================================================

  (function init_() {
    try {
      DAL.setLogHook(dalHook_);
    } catch (e) {
      console.log('[Logger INIT] Failed to register DAL log hook: ' + e.message);
    }

    try {
      RBAC.setDeniedLogHook(rbacDeniedHook_);
    } catch (e) {
      console.log('[Logger INIT] Failed to register RBAC denied hook: ' + e.message);
    }
  }());

  // ============================================================
  // PUBLIC API
  // ============================================================
  return {

    // ── Level constants ───────────────────────────────────────
    LEVELS: LEVELS,

    // ── Primary log methods ───────────────────────────────────
    debug:    debug,
    info:     info,
    warn:     warn,
    error:    error,

    // ── Aliases (user-requested names) ────────────────────────
    logInfo:  logInfo,
    logWarn:  logWarn,
    logError: logError,

    // ── Thread actor management ───────────────────────────────
    // Set once per handler invocation; clear in finally block.
    setActor:   setActor,
    clearActor: clearActor,
    getActor:   getActor,

    // ── Buffer mode (high-throughput operations) ──────────────
    // Enable before loops; flush after. Always flush in finally.
    enableBuffer:   enableBuffer,
    flushBuffer:    flushBuffer,
    getBufferDepth: getBufferDepth,

    // ── Observability ─────────────────────────────────────────
    // Unique UUID for this GAS execution; embedded in every row's detail_json.
    // Query all rows from one run: WHERE detail_json CONTAINS getExecutionId().
    getExecutionId: function() { return _executionId; }

  };

}());
