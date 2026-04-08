// ============================================================
// JobHoldHandler.gs — BLC Nexus T6 Handlers
// src/06-handlers/JobHoldHandler.gs
//
// LOAD ORDER: T6. Loads after all T0–T5 files.
// DEPENDENCIES: Config (T0), Constants (T0), Identifiers (T0),
//               DAL (T1), RBAC (T2), Logger (T3),
//               ValidationEngine (T4), QueueProcessor (T5),
//               StateMachine (T6)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  Handles FORM_TYPE = 'JOB_HOLD'                         ║
// ║  Moves a job to ON_HOLD state (from ALLOCATED or        ║
// ║  IN_PROGRESS). Stores the previous state in             ║
// ║  VW_JOB_CURRENT_STATE.prev_state for correct routing    ║
// ║  when the job is resumed.                               ║
// ╚══════════════════════════════════════════════════════════╝
//
// VALID TRANSITIONS:
//   ALLOCATED   → ON_HOLD
//   IN_PROGRESS → ON_HOLD
//
// FACT_JOB_EVENTS EVENT SCHEMA (JOB_HELD):
//   event_id, job_number, period_id, event_type = 'JOB_HELD',
//   timestamp, actor_code, actor_role, client_code, job_type,
//   product_code, quantity, notes, idempotency_key, payload_json
//
// VW_JOB_CURRENT_STATE UPDATES:
//   current_state → ON_HOLD
//   prev_state    → previous state (ALLOCATED or IN_PROGRESS)
//   updated_at    → now
//
// PAYLOAD SCHEMA:
//   job_number  string  required
//   notes       string  optional  max 500 chars
//
// PERMISSION REQUIRED: RBAC.ACTIONS.JOB_HOLD
// ============================================================

var JobHoldHandler = (function () {

  var JOB_HOLD_SCHEMA = {
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
    return Identifiers.buildIdempotencyKey('JOB_HOLD', queueId);
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

  function buildEvent_(payload, view, actor, periodId, idempotencyKey, rawPayloadJson) {
    return {
      event_id:        Identifiers.generateId(),
      job_number:      payload.job_number,
      period_id:       periodId,
      event_type:      Constants.EVENT_TYPES.JOB_HELD,
      timestamp:       new Date().toISOString(),
      actor_code:      actor.personCode     || '',
      actor_role:      actor.role           || '',
      client_code:     view.client_code     || '',
      job_type:        view.job_type        || '',
      product_code:    view.product_code    || '',
      quantity:        view.quantity        || 0,
      notes:           payload.notes        || '',
      idempotency_key: idempotencyKey,
      payload_json:    rawPayloadJson       || ''
    };
  }

  /**
   * @param {Object} queueItem
   * @param {Object} actor
   * @returns {string}  job_number
   */
  function handle(queueItem, actor) {
    var queueId = queueItem.queue_id || '(unknown)';

    Logger.info('JOB_HOLD_START', {
      module:   'JobHoldHandler',
      message:  'Starting job hold handler',
      queue_id: queueId
    });

    // ── Step 1: Parse ───────────────────────────────────────
    var rawPayload = queueItem.payload_json || '{}';
    var payload;
    try {
      payload = JSON.parse(rawPayload);
    } catch (e) {
      throw new Error('JobHoldHandler: invalid JSON in payload_json: ' + e.message);
    }

    // ── Step 2: Validate ────────────────────────────────────
    var cleanPayload = ValidationEngine.validate(
      JOB_HOLD_SCHEMA, payload, { module: 'JobHoldHandler', actor: actor }
    );
    var jobNumber = cleanPayload.job_number;

    // ── Step 3: Permission ──────────────────────────────────
    RBAC.enforcePermission(actor, RBAC.ACTIONS.JOB_HOLD);

    // ── Step 4: Look up job ─────────────────────────────────
    var view = StateMachine.getJobView(jobNumber);
    if (!view) {
      throw new Error('JobHoldHandler: job "' + jobNumber + '" not found in VW_JOB_CURRENT_STATE.');
    }

    // ── Step 5: Assert transition → ON_HOLD ─────────────────
    // Valid from ALLOCATED or IN_PROGRESS
    StateMachine.assertTransition(view.current_state, Config.STATES.ON_HOLD, { jobNumber: jobNumber });

    var previousState = view.current_state;

    // ── Step 6: Idempotency ─────────────────────────────────
    var idempotencyKey = buildIdempotencyKey_(queueId);
    if (isDuplicate_(idempotencyKey)) {
      Logger.warn('JOB_HOLD_DUPLICATE', {
        module:     'JobHoldHandler',
        message:    'Duplicate JOB_HOLD — skipping',
        queue_id:   queueId,
        job_number: jobNumber
      });
      return 'DUPLICATE';
    }

    // ── Step 7: Ensure FACT_JOB_EVENTS partition ───────────
    var periodId = Identifiers.generateCurrentPeriodId();
    DAL.ensurePartition(Config.TABLES.FACT_JOB_EVENTS, periodId, 'JobHoldHandler');

    // ── Step 8: Write JOB_HELD event ────────────────────────
    var eventRow = buildEvent_(cleanPayload, view, actor, periodId, idempotencyKey, rawPayload);
    DAL.appendRow(
      Config.TABLES.FACT_JOB_EVENTS,
      eventRow,
      { callerModule: 'JobHoldHandler', periodId: periodId }
    );

    // ── Step 9: Update VW ───────────────────────────────────
    // Store previousState so JobResumeHandler knows where to route back.
    DAL.updateWhere(
      Config.TABLES.VW_JOB_CURRENT_STATE,
      { job_number: jobNumber },
      {
        current_state: Config.STATES.ON_HOLD,
        prev_state:    previousState,
        updated_at:    eventRow.timestamp
      },
      { callerModule: 'JobHoldHandler' }
    );

    Logger.info('JOB_HELD', {
      module:         'JobHoldHandler',
      message:        'Job placed on hold',
      target_id:      jobNumber,
      queue_id:       queueId,
      job_number:     jobNumber,
      previous_state: previousState,
      event_id:       eventRow.event_id
    });

    return jobNumber;
  }

  (function register_() {
    try {
      QueueProcessor.registerHandler(Config.FORM_TYPES.JOB_HOLD, handle);
    } catch (e) {
      console.log('[JobHoldHandler REGISTRATION FAILED] ' + e.message);
    }
  }());

  return {
    handle:          handle,
    JOB_HOLD_SCHEMA: JOB_HOLD_SCHEMA
  };

}());
