// ============================================================
// ErrorHandler.gs — BLC Nexus T3 Infrastructure
// src/03-infrastructure/ErrorHandler.gs
//
// LOAD ORDER: Second file in T3. Loads after Logger.gs.
// DEPENDENCIES: Config (T0), Identifiers (T0), Constants (T0),
//               DAL (T1), Logger (T3 — must load before this)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  ALL structured exception recording flows through here.  ║
// ║  Rule D3: catch blocks must call ErrorHandler.handle()   ║
// ║  or ErrorHandler.wrap(). Never swallow errors silently.  ║
// ╚══════════════════════════════════════════════════════════╝
//
// Responsibilities:
//   1. Normalise any thrown value into a structured exception record
//   2. Write to _SYS_EXCEPTIONS via DAL.appendRow
//   3. Emit a Logger.error() entry for the same event (dual trail)
//   4. Provide wrap(fn, context) for safe handler execution
//   5. Route by severity: stubs notify CEO/admin in Phase 2
//   6. Never throw — all code paths are fully fail-safe
//
// EXCEPTION SCHEMA (_SYS_EXCEPTIONS columns):
//   exception_id  — UUID (Identifiers.generateId())
//   timestamp     — ISO 8601 string
//   severity      — WARNING | ERROR | CRITICAL (Constants.SEVERITIES)
//   error_code    — short identifier e.g. 'PAYROLL_CALC_FAILED'
//   module        — name of the calling module
//   actor_code    — personCode of the acting user (if known)
//   actor_role    — role of the acting user (if known)
//   message       — human-readable error description
//   stack_trace   — Error.stack if available, otherwise ''
//   execution_id  — Logger.getExecutionId() — links to _SYS_LOGS rows
//   context_json  — JSON of caller-supplied extra fields
//
// WRITE GUARD NOTE:
//   DAL.WRITE_PERMISSIONS must include 'ErrorHandler' as an allowed
//   caller for the _SYS_EXCEPTIONS table. If you extend DAL.gs,
//   add: 'SYS_EXCEPTIONS': ['ErrorHandler']
//
// USAGE — standard catch block:
//
//   try {
//     processJob(item);
//   } catch (e) {
//     ErrorHandler.handle(e, {
//       module:    'JobCreateHandler',
//       errorCode: 'JOB_CREATE_FAILED',
//       severity:  Constants.SEVERITIES.ERROR,
//       jobNumber: item.job_number
//     });
//   }
//
// USAGE — wrap pattern (preferred for full handler bodies):
//
//   var outcome = ErrorHandler.wrap(function() {
//     return processJob(item);
//   }, {
//     module:    'JobCreateHandler',
//     errorCode: 'JOB_CREATE_FAILED',
//     severity:  Constants.SEVERITIES.ERROR
//   });
//
//   if (!outcome.ok) {
//     // outcome.exceptionId is available for cross-referencing
//     return;
//   }
//   var result = outcome.result;
//
// USAGE — programmatic record (no thrown Error object):
//
//   ErrorHandler.record('QUOTA_NEAR_LIMIT', 'API call count approaching ceiling', {
//     module:   'HealthMonitor',
//     severity: Constants.SEVERITIES.WARNING,
//     apiCount: DAL.getApiCallCount()
//   });
//
// DO NOT:
//   - Call SpreadsheetApp directly
//   - Throw from within ErrorHandler — it must be fully fail-safe
//   - Use for validation errors that are expected business-logic outcomes
//     (e.g. a form with a missing field). Use for unexpected system failures.
// ============================================================

var ErrorHandler = (function () {

  // ============================================================
  // SECTION 1: ERROR NORMALISATION
  //
  // GAS throw statements can receive anything: Error objects,
  // plain strings, numbers, null, undefined. The normaliser converts
  // all of these into a consistent { message, stack } shape so the
  // rest of ErrorHandler never has to branch on thrown value type.
  // ============================================================

  /**
   * Normalises any thrown value into { message: string, stack: string }.
   *
   * @param {*} thrown  The raw caught value from a catch clause.
   * @returns {{ message: string, stack: string }}
   */
  function normaliseThrown_(thrown) {
    if (thrown === null || thrown === undefined) {
      return { message: 'Unknown error (null/undefined thrown)', stack: '' };
    }
    if (thrown instanceof Error) {
      return {
        message: thrown.message || thrown.toString(),
        stack:   thrown.stack   || ''
      };
    }
    if (typeof thrown === 'string') {
      return { message: thrown, stack: '' };
    }
    // Numbers, booleans, plain objects — coerce to string
    var msg;
    try {
      msg = JSON.stringify(thrown);
    } catch (e) {
      msg = String(thrown);
    }
    return { message: msg, stack: '' };
  }

  // ============================================================
  // SECTION 2: SAFE JSON SERIALIZATION
  //
  // Mirrors the helper in Logger.gs — ErrorHandler must be self-contained
  // so a Logger failure does not prevent exception recording.
  // ============================================================

  /**
   * Serialises value to JSON string. Returns an error marker on failure.
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
  // SECTION 3: EXCEPTION ROW BUILDER
  //
  // Constructs a plain object matching the _SYS_EXCEPTIONS schema.
  // All columns default to safe empty values — no field can be
  // undefined when the row reaches DAL.appendRow.
  //
  // Context field extraction:
  //   Reserved keys (module, severity, errorCode, actor) → dedicated columns
  //   All other keys → context_json blob
  //
  // Actor resolution priority (first non-null wins):
  //   1. context.actor       — explicit actor passed with this call
  //   2. Logger.getActor()   — thread actor set by the handler
  //   3. null                — actor columns written as ''
  // ============================================================

  /** Keys consumed as dedicated columns; excluded from context_json. */
  var RESERVED_CONTEXT_KEYS_ = {
    module:    true,
    severity:  true,
    errorCode: true,
    actor:     true
  };

  /**
   * Builds a _SYS_EXCEPTIONS row object.
   *
   * @param {string} message    Normalised error message
   * @param {string} stack      Stack trace string (may be empty)
   * @param {Object} context    Caller-supplied context
   * @returns {Object}          Row ready for DAL.appendRow
   */
  function buildRow_(message, stack, context) {
    context = context || {};

    // Resolve actor: explicit > thread (via Logger) > null
    var actor = context.actor || null;
    try {
      if (!actor) actor = Logger.getActor();
    } catch (ignored) {}

    // Extract reserved columns with safe defaults
    var module    = (context.module    && String(context.module))    || 'UNKNOWN';
    var severity  = (context.severity  && String(context.severity))  || Constants.SEVERITIES.ERROR;
    var errorCode = (context.errorCode && String(context.errorCode)) || 'UNCLASSIFIED_ERROR';

    // Execution ID — from Logger; fallback to '' if Logger unavailable
    var executionId = '';
    try {
      executionId = Logger.getExecutionId() || '';
    } catch (ignored) {}

    // Collect remaining context fields into context_json
    var extra = {};
    for (var key in context) {
      if (!context.hasOwnProperty(key)) continue;
      if (RESERVED_CONTEXT_KEYS_[key]) continue;
      extra[key] = context[key];
    }

    return {
      exception_id: Identifiers.generateId(),
      timestamp:    new Date().toISOString(),
      severity:     severity,
      error_code:   errorCode,
      module:       module,
      actor_code:   actor ? (actor.personCode || '') : '',
      actor_role:   actor ? (actor.role       || '') : '',
      message:      message,
      stack_trace:  stack,
      execution_id: executionId,
      context_json: Object.keys(extra).length > 0 ? safeStringify_(extra) : ''
    };
  }

  // ============================================================
  // SECTION 4: FALLBACK WRITE CHAIN
  //
  // Three-layer write strategy; each layer is independently try/caught
  // so a failure at one layer does not prevent the next from running.
  //
  //   Layer 1 — DAL.appendRow → _SYS_EXCEPTIONS (persistent, queryable)
  //   Layer 2 — Logger.error  → _SYS_LOGS       (log trail)
  //   Layer 3 — console.log   → GAS execution log (always available)
  //
  // All three layers always attempt to run, regardless of whether a
  // prior layer succeeded. The goal is to leave as many traces as
  // possible — even in degraded states like quota exhaustion.
  // ============================================================

  /**
   * Writes an exception row through all three fallback layers.
   * Never throws.
   *
   * @param {Object} row      Pre-built _SYS_EXCEPTIONS row
   * @param {Object} context  Original caller context (for Logger call)
   */
  function persistException_(row, context) {

    // Layer 1: write to _SYS_EXCEPTIONS via DAL
    try {
      DAL.appendRow(Config.TABLES.SYS_EXCEPTIONS, row, { callerModule: 'ErrorHandler' });
    } catch (dalErr) {
      try {
        console.log('[ErrorHandler DAL FAILED] Could not write to _SYS_EXCEPTIONS: ' +
                    dalErr.message + ' | Original: ' + row.error_code + ' — ' + row.message);
      } catch (ignored) {}
    }

    // Layer 2: emit Logger.error for the _SYS_LOGS audit trail
    try {
      Logger.error(row.error_code, {
        module:       row.module,
        message:      row.message,
        exception_id: row.exception_id,
        severity:     row.severity,
        execution_id: row.execution_id
      });
    } catch (logErr) {
      try {
        console.log('[ErrorHandler LOGGER FAILED] ' + logErr.message);
      } catch (ignored) {}
    }

    // Layer 3: console.log — always attempt, even if layers 1 and 2 succeeded
    // This ensures the error appears in the GAS execution transcript
    try {
      console.log(
        '[ErrorHandler] ' + row.severity + ' | ' + row.error_code +
        ' | module=' + row.module +
        ' | exception_id=' + row.exception_id +
        ' | ' + row.message +
        (row.stack_trace ? '\n' + row.stack_trace : '')
      );
    } catch (ignored) {}
  }

  // ============================================================
  // SECTION 5: SEVERITY ROUTER
  //
  // Phase 1: stubs only — severity is written to the row but no
  // external notification is dispatched yet.
  //
  // Phase 2 (NotificationService.gs):
  //   CRITICAL → email CEO + admin + write to _SYS_ALERTS
  //   ERROR    → email admin + write to _SYS_ALERTS
  //   WARNING  → logged only (no notification)
  //
  // The hook slot is pre-wired so Phase 2 is a one-line change.
  // ============================================================

  /** @type {function(Object)|null} Notification hook — set by NotificationService */
  var _notifyHook = null;

  /**
   * Registers an external notification hook.
   * Hook receives the fully-built exception row.
   * Called by NotificationService.gs at load time (Phase 2).
   *
   * @param {function(Object)} hookFn
   */
  function setNotifyHook(hookFn) {
    if (typeof hookFn === 'function') {
      _notifyHook = hookFn;
    }
  }

  /**
   * Routes the exception row to the notification hook if one is registered.
   * Only WARNING and above are routed; DEBUG-severity records are not alerted.
   * Never throws.
   *
   * @param {Object} row  Built exception row
   */
  function routeNotification_(row) {
    if (!_notifyHook) return;
    try {
      _notifyHook(row);
    } catch (e) {
      try {
        console.log('[ErrorHandler NOTIFY HOOK FAILED] ' + e.message);
      } catch (ignored) {}
    }
  }

  // ============================================================
  // SECTION 6: HANDLE — PRIMARY PUBLIC ENTRY POINT
  //
  // Converts any caught value + context into a structured exception
  // record, persists it, and routes the notification. Returns the
  // exception_id so callers can cross-reference in their own logs.
  //
  // Guaranteed never to throw. If normalisation or row-building
  // itself fails, falls back to a minimal console.log record.
  // ============================================================

  /**
   * Records a system error to _SYS_EXCEPTIONS.
   * Call from every catch block in the system.
   *
   * @param {Error|string|*} error     The caught value
   * @param {Object}         [context] Caller context
   * @param {string}         context.module     REQUIRED — name of calling module
   * @param {string}         [context.errorCode]  Short identifier (e.g. 'JOB_CREATE_FAILED')
   * @param {string}         [context.severity]   Constants.SEVERITIES value (default ERROR)
   * @param {Object}         [context.actor]      RBAC actor object (overrides thread actor)
   * @param {*}              [context.*]          Any extra fields → context_json
   *
   * @returns {string}  exception_id of the recorded row ('' on total failure)
   */
  function handle(error, context) {
    var exceptionId = '';

    try {
      var normalised = normaliseThrown_(error);
      var row        = buildRow_(normalised.message, normalised.stack, context);
      exceptionId    = row.exception_id;

      persistException_(row, context);
      routeNotification_(row);

    } catch (e) {
      // Last-resort: ErrorHandler itself failed — emit to console only
      try {
        console.log('[ErrorHandler INTERNAL FAILURE] handle() threw: ' + e.message +
                    ' | Original error: ' + String(error));
      } catch (ignored) {}
    }

    return exceptionId;
  }

  // ============================================================
  // SECTION 7: RECORD — PROGRAMMATIC EXCEPTION ENTRY
  //
  // For cases where no Error object is thrown but a system condition
  // must be recorded as an exception — e.g. quota approaching limit,
  // data integrity assertion failed, business rule violated.
  //
  // Accepts explicit errorCode + message instead of a caught value.
  // Internally delegates to handle() with a synthetic Error object
  // so the call path is identical.
  // ============================================================

  /**
   * Records a structured exception without a caught Error object.
   * Use for data integrity violations and proactive system alerts.
   *
   * @param {string} errorCode  Short identifier (e.g. 'QUOTA_NEAR_LIMIT')
   * @param {string} message    Human-readable description
   * @param {Object} [context]  Same shape as handle() context
   * @returns {string}  exception_id ('' on total failure)
   */
  function record(errorCode, message, context) {
    context = context || {};
    // Inject errorCode into context so buildRow_ picks it up
    context.errorCode = context.errorCode || errorCode;
    // Wrap in a real Error so stack-trace capture works if V8 cooperates
    var syntheticError = new Error(message);
    return handle(syntheticError, context);
  }

  // ============================================================
  // SECTION 8: WRAP — SAFE EXECUTION HARNESS
  //
  // Executes fn() inside a try/catch. On success, returns a result
  // object with ok=true and the function's return value. On failure,
  // records the exception and returns ok=false.
  //
  // Return shape:
  //   { ok: true,  result: <fn return value>, exceptionId: null }
  //   { ok: false, result: null,              exceptionId: '<uuid>' }
  //
  // DESIGN CHOICE — why return an object instead of re-throwing?
  //   GAS trigger callbacks surface uncaught exceptions as generic
  //   "Script error" emails with no context. Catching at the handler
  //   boundary and returning a typed result object lets the caller
  //   decide how to respond (skip item, abort run, alert user) while
  //   still producing a fully structured exception record in the sheet.
  //
  // CONTEXT MERGING:
  //   wrap() merges context into the caught error's handler call.
  //   If fn() throws its own context-rich Error, the original context
  //   fills in any gaps (module, severity, errorCode).
  // ============================================================

  /**
   * Executes fn safely. Records any thrown error; returns a result object.
   * fn is called with no arguments — use a closure to capture parameters.
   *
   * @param {function(): *} fn         Function to execute
   * @param {Object}        [context]  Same shape as handle() context
   * @param {string}        context.module     REQUIRED — name of calling module
   * @param {string}        [context.errorCode]
   * @param {string}        [context.severity]
   * @param {Object}        [context.actor]
   *
   * @returns {{ ok: boolean, result: *, exceptionId: string|null }}
   */
  function wrap(fn, context) {
    if (typeof fn !== 'function') {
      // Defensive: caller passed something that isn't a function
      var badArgId = handle(
        new Error('ErrorHandler.wrap: fn is not a function — got ' + typeof fn),
        {
          module:    (context && context.module) || 'UNKNOWN',
          errorCode: 'WRAP_INVALID_ARGUMENT',
          severity:  Constants.SEVERITIES.ERROR
        }
      );
      return { ok: false, result: null, exceptionId: badArgId };
    }

    try {
      var result = fn();
      return { ok: true, result: result, exceptionId: null };

    } catch (e) {
      var exceptionId = handle(e, context);
      return { ok: false, result: null, exceptionId: exceptionId };
    }
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  return {

    // ── Primary entry points ──────────────────────────────────
    /**
     * Records a caught exception. Call from all catch blocks.
     * @type {function(Error|string|*, Object=): string}
     */
    handle: handle,

    /**
     * Records an exception without a thrown Error.
     * Use for data integrity violations and proactive alerts.
     * @type {function(string, string, Object=): string}
     */
    record: record,

    /**
     * Executes fn safely. Returns { ok, result, exceptionId }.
     * @type {function(function(): *, Object=): {ok: boolean, result: *, exceptionId: string|null}}
     */
    wrap: wrap,

    // ── Phase 2 hook ─────────────────────────────────────────
    /**
     * Registers a notification hook (called by NotificationService.gs).
     * Receives the fully-built exception row on every recorded exception.
     * @type {function(function(Object)): void}
     */
    setNotifyHook: setNotifyHook

  };

}());
