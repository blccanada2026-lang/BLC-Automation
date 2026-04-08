// ============================================================
// StateMachine.gs — BLC Nexus T6 Handlers
// src/06-handlers/StateMachine.gs
//
// LOAD ORDER: T6. Loads after all T0–T5 files.
// DEPENDENCIES: Config (T0), DAL (T1), Logger (T3)
//
// PURPOSE: State transition validation and job state lookup.
//   Used by all job-lifecycle handlers before writing any event.
//
// Key rules:
//   - Never writes data — read-only module
//   - Uses Config.TRANSITIONS as the single source of truth
//   - Reads VW_JOB_CURRENT_STATE for current job state
//   - assertTransition() throws on invalid transition — caller
//     lets this propagate to QueueProcessor for FAILED marking
//
// USAGE IN HANDLERS:
//   var view = StateMachine.getJobView(jobNumber);
//   if (!view) throw new Error('Job not found: ' + jobNumber);
//   StateMachine.assertTransition(view.current_state, Config.STATES.IN_PROGRESS,
//                                 { jobNumber: jobNumber });
// ============================================================

var StateMachine = (function () {

  // ============================================================
  // SECTION 1: INTERNAL HELPERS
  // ============================================================

  /**
   * Logs a state machine operation at DEBUG level.
   * @param {string} action
   * @param {Object} context
   */
  function log_(action, context) {
    Logger.debug(action, Object.assign({ module: 'StateMachine' }, context || {}));
  }

  // ============================================================
  // SECTION 2: JOB VIEW LOOKUP
  //
  // Reads VW_JOB_CURRENT_STATE for a single job.
  // This is the handler's way to find the job's current state
  // without scanning the entire FACT_JOB_EVENTS ledger.
  //
  // Returns null if the job has never been created (or if the
  // VW has not yet been populated by JobCreateHandler).
  // ============================================================

  /**
   * Returns the VW_JOB_CURRENT_STATE row for a job, or null.
   *
   * @param {string} jobNumber  e.g. 'BLC-00042'
   * @returns {Object|null}  Full VW row, or null if not found
   */
  function getJobView(jobNumber) {
    if (!jobNumber) return null;

    try {
      var rows = DAL.readWhere(
        Config.TABLES.VW_JOB_CURRENT_STATE,
        { job_number: jobNumber }
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (e) {
      // SHEET_NOT_FOUND means no jobs have been created yet
      if (e.code === 'SHEET_NOT_FOUND') return null;
      throw e;
    }
  }

  /**
   * Returns the current_state string for a job, or null if not found.
   * Convenience wrapper around getJobView().
   *
   * @param {string} jobNumber
   * @returns {string|null}
   */
  function getCurrentState(jobNumber) {
    var view = getJobView(jobNumber);
    return view ? (view.current_state || null) : null;
  }

  // ============================================================
  // SECTION 3: TRANSITION VALIDATION
  //
  // assertTransition() is the core safety gate — every handler
  // that changes job state must call this before writing to FACT.
  //
  // Error codes attached to thrown errors:
  //   INVALID_TRANSITION  — Config.TRANSITIONS does not allow the move
  //   JOB_STATE_UNKNOWN   — fromState is not in Config.STATES
  //
  // Throwing lets QueueProcessor mark the item FAILED so it can
  // be inspected and retried after the underlying issue is fixed.
  // ============================================================

  /**
   * Asserts that a state transition is valid according to Config.TRANSITIONS.
   * Throws a descriptive error if the transition is not allowed.
   *
   * @param {string} fromState  Current state (must be a Config.STATES value)
   * @param {string} toState    Desired next state
   * @param {Object} [context]  Optional — { jobNumber } for error messages
   * @throws {Error}  With .code = 'INVALID_TRANSITION' | 'JOB_STATE_UNKNOWN'
   */
  function assertTransition(fromState, toState, context) {
    var jobRef = (context && context.jobNumber) ? ' for job ' + context.jobNumber : '';

    // fromState must be a known state
    if (!fromState || !Config.STATES.hasOwnProperty(fromState)) {
      var unknownErr = new Error(
        'StateMachine: unknown current state "' + fromState + '"' + jobRef +
        '. Allowed states: ' + Object.keys(Config.STATES).join(', ')
      );
      unknownErr.code = 'JOB_STATE_UNKNOWN';
      unknownErr.fromState = fromState;
      throw unknownErr;
    }

    // Check transition is valid
    if (!Config.isTransitionValid(fromState, toState)) {
      var allowed = Config.getAllowedTransitions(fromState);
      var transErr = new Error(
        'StateMachine: transition not allowed — ' + fromState + ' → ' + toState + jobRef +
        '. Allowed transitions from ' + fromState + ': [' +
        (allowed.length > 0 ? allowed.join(', ') : 'none — terminal state') + ']'
      );
      transErr.code = 'INVALID_TRANSITION';
      transErr.fromState = fromState;
      transErr.toState = toState;
      throw transErr;
    }

    log_('TRANSITION_VALID', {
      from_state: fromState,
      to_state:   toState,
      job_number: (context && context.jobNumber) || ''
    });
  }

  // ============================================================
  // SECTION 4: TERMINAL STATE CHECK
  // ============================================================

  /**
   * Returns true if the given state is terminal (no outgoing transitions).
   * Handlers use this to reject updates to INVOICED jobs.
   *
   * @param {string} state
   * @returns {boolean}
   */
  function isTerminal(state) {
    return Config.getAllowedTransitions(state).length === 0;
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  return {

    /**
     * Look up the current VW_JOB_CURRENT_STATE row for a job.
     * Returns null if the job does not exist in the view.
     *
     * @type {function(string): Object|null}
     */
    getJobView: getJobView,

    /**
     * Returns the current_state string for a job.
     * @type {function(string): string|null}
     */
    getCurrentState: getCurrentState,

    /**
     * Asserts a state transition is valid — throws on failure.
     * Call this in every handler before writing any FACT event.
     *
     * @type {function(string, string, Object=): void}
     */
    assertTransition: assertTransition,

    /**
     * Returns true if the state is terminal (INVOICED).
     * @type {function(string): boolean}
     */
    isTerminal: isTerminal

  };

}());
