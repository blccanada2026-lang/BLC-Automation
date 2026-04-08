// ============================================================
// JobResumeHandler.gs — BLC Nexus T6 Handlers
// src/06-handlers/JobResumeHandler.gs
//
// LOAD ORDER: T6. Loads after all T0–T5 files.
// DEPENDENCIES: Config (T0), Constants (T0), Identifiers (T0),
//               DAL (T1), RBAC (T2), Logger (T3),
//               ValidationEngine (T4), QueueProcessor (T5),
//               StateMachine (T6)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  Handles FORM_TYPE = 'JOB_RESUME'                       ║
// ║  Moves a job out of ON_HOLD back to its previous state. ║
// ║  Uses VW_JOB_CURRENT_STATE.prev_state (set by           ║
// ║  JobHoldHandler) to route correctly.                    ║
// ╚══════════════════════════════════════════════════════════╝
//
// VALID TRANSITIONS (source: Config.TRANSITIONS.ON_HOLD):
//   ON_HOLD → IN_PROGRESS  (most common — was in progress)
//   ON_HOLD → ALLOCATED    (was allocated but not yet started)
//
// ROUTING LOGIC:
//   1. Read view.prev_state from VW_JOB_CURRENT_STATE
//   2. If prev_state is a valid transition from ON_HOLD → use it
//   3. Otherwise fall back to IN_PROGRESS (safe default)
//
// VW_JOB_CURRENT_STATE UPDATES:
//   current_state → prev_state (restored)
//   prev_state    → ''  (cleared)
//   updated_at    → now
//
// PAYLOAD SCHEMA:
//   job_number  string  required
//   notes       string  optional  max 500 chars
//
// PERMISSION REQUIRED: RBAC.ACTIONS.JOB_RESUME
// ============================================================

var JobResumeHandler = (function () {

  var JOB_RESUME_SCHEMA = {
    job_number: {
      type:      'string',
      required:  true,
      minLength: 7,
      maxLength: 20,
      pattern:   /^BLC-\d{5}$/,
      label:     'Job Number'
    },
    notes: {
      type:      'string',
      required:  false,
      maxLength: 500,
      label:     'Notes'
    }
  };

  function buildIdempotencyKey_(queueId) {
    return Identifiers.buildIdempotencyKey('JOB_RESUME', queueId);
  }

  function isDuplicate_(idempotencyKey) {
    try {
      var periodId = Identifiers.generateCurrentPeriodId();
      var existing = DAL.readWhere(
        Config.TABLES.FACT_JOB_EVENTS,
        { idempotency_key: idempotencyKey },
        { periodId: periodId }
      );
      return existing.length > 0;
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return false;
      throw e;
    }
  }

  /**
   * Determines the state to resume to.
   * Uses prev_state from the VW if it's a valid ON_HOLD transition.
   * Falls back to IN_PROGRESS.
   *
   * @param {string} prevState  view.prev_state value
   * @returns {string}
   */
  function resolveResumeState_(prevState) {
    var allowed = Config.getAllowedTransitions(Config.STATES.ON_HOLD);
    for (var i = 0; i < allowed.length; i++) {
      if (allowed[i] === prevState) return prevState;
    }
    // prev_state is missing or invalid — default to IN_PROGRESS
    return Config.STATES.IN_PROGRESS;
  }

  function buildEvent_(payload, view, actor, periodId, targetState, idempotencyKey, rawPayloadJson) {
    return {
      event_id:        Identifiers.generateId(),
      job_number:      payload.job_number,
      period_id:       periodId,
      event_type:      Constants.EVENT_TYPES.JOB_RESUMED,
      timestamp:       new Date().toISOString(),
      actor_code:      actor.personCode  || '',
      actor_role:      actor.role        || '',
      client_code:     view.client_code  || '',
      job_type:        view.job_type     || '',
      product_code:    view.product_code || '',
      quantity:        view.quantity     || 0,
      notes:           payload.notes     || '',
      idempotency_key: idempotencyKey,
      payload_json:    rawPayloadJson    || ''
    };
  }

  /**
   * @param {Object} queueItem
   * @param {Object} actor
   * @returns {string}  job_number
   */
  function handle(queueItem, actor) {
    var queueId = queueItem.queue_id || '(unknown)';

    Logger.info('JOB_RESUME_START', {
      module:   'JobResumeHandler',
      message:  'Starting job resume handler',
      queue_id: queueId
    });

    // ── Step 1: Parse ───────────────────────────────────────
    var rawPayload = queueItem.payload_json || '{}';
    var payload;
    try {
      payload = JSON.parse(rawPayload);
    } catch (e) {
      throw new Error('JobResumeHandler: invalid JSON in payload_json: ' + e.message);
    }

    // ── Step 2: Validate ────────────────────────────────────
    var cleanPayload = ValidationEngine.validate(
      JOB_RESUME_SCHEMA, payload, { module: 'JobResumeHandler', actor: actor }
    );
    var jobNumber = cleanPayload.job_number;

    // ── Step 3: Permission ──────────────────────────────────
    RBAC.enforcePermission(actor, RBAC.ACTIONS.JOB_RESUME);

    // ── Step 4: Look up job ─────────────────────────────────
    var view = StateMachine.getJobView(jobNumber);
    if (!view) {
      throw new Error('JobResumeHandler: job "' + jobNumber + '" not found in VW_JOB_CURRENT_STATE.');
    }

    // ── Step 5: Resolve target state + assert transition ────
    var targetState = resolveResumeState_(view.prev_state || '');
    StateMachine.assertTransition(view.current_state, targetState, { jobNumber: jobNumber });

    Logger.info('JOB_RESUME_ROUTING', {
      module:       'JobResumeHandler',
      message:      'Resuming job',
      job_number:   jobNumber,
      from_state:   view.current_state,
      to_state:     targetState,
      prev_state:   view.prev_state || '(none)'
    });

    // ── Step 6: Idempotency ─────────────────────────────────
    var idempotencyKey = buildIdempotencyKey_(queueId);
    if (isDuplicate_(idempotencyKey)) {
      Logger.warn('JOB_RESUME_DUPLICATE', {
        module:     'JobResumeHandler',
        message:    'Duplicate JOB_RESUME — skipping',
        queue_id:   queueId,
        job_number: jobNumber
      });
      return 'DUPLICATE';
    }

    // ── Step 7: Ensure partition ────────────────────────────
    var periodId = Identifiers.generateCurrentPeriodId();
    DAL.ensurePartition(Config.TABLES.FACT_JOB_EVENTS, periodId, 'JobResumeHandler');

    // ── Step 8: Write JOB_RESUMED event ─────────────────────
    var eventRow = buildEvent_(cleanPayload, view, actor, periodId, targetState, idempotencyKey, rawPayload);
    DAL.appendRow(
      Config.TABLES.FACT_JOB_EVENTS,
      eventRow,
      { callerModule: 'JobResumeHandler', periodId: periodId }
    );

    // ── Step 9: Update VW — restore state, clear prev_state ─
    DAL.updateWhere(
      Config.TABLES.VW_JOB_CURRENT_STATE,
      { job_number: jobNumber },
      {
        current_state: targetState,
        prev_state:    '',
        updated_at:    eventRow.timestamp
      },
      { callerModule: 'JobResumeHandler' }
    );

    Logger.info('JOB_RESUMED', {
      module:      'JobResumeHandler',
      message:     'Job resumed successfully',
      target_id:   jobNumber,
      queue_id:    queueId,
      job_number:  jobNumber,
      to_state:    targetState,
      event_id:    eventRow.event_id
    });

    return jobNumber;
  }

  (function register_() {
    try {
      QueueProcessor.registerHandler(Config.FORM_TYPES.JOB_RESUME, handle);
    } catch (e) {
      console.log('[JobResumeHandler REGISTRATION FAILED] ' + e.message);
    }
  }());

  return {
    handle:            handle,
    JOB_RESUME_SCHEMA: JOB_RESUME_SCHEMA
  };

}());
