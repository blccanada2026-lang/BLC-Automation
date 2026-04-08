// ============================================================
// WorkLogHandler.gs — BLC Nexus T6 Handlers
// src/06-handlers/WorkLogHandler.gs
//
// LOAD ORDER: T6. Loads after all T0–T5 files.
// DEPENDENCIES: Config (T0), Constants (T0), Identifiers (T0),
//               DAL (T1), RBAC (T2), Logger (T3),
//               ValidationEngine (T4), QueueProcessor (T5),
//               StateMachine (T6)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  Handles FORM_TYPE = 'WORK_LOG'                         ║
// ║  Appends a WORK_LOG_SUBMITTED event to FACT_WORK_LOGS.  ║
// ║  Does NOT change job state — work logs accumulate        ║
// ║  independently of state transitions.                     ║
// ╚══════════════════════════════════════════════════════════╝
//
// FACT_WORK_LOGS EVENT SCHEMA (WORK_LOG_SUBMITTED):
//   event_id        — UUID
//   job_number      — from payload
//   period_id       — current period
//   event_type      — 'WORK_LOG_SUBMITTED'
//   timestamp       — ISO 8601 string
//   actor_code      — person_code of the submitting designer/QC
//   actor_role      — role of actor
//   hours           — hours worked (0.25 – 24)
//   work_date       — YYYY-MM-DD work date
//   notes           — optional free text
//   idempotency_key — deterministic key for duplicate detection
//   payload_json    — full raw payload JSON
//
// PAYLOAD SCHEMA:
//   job_number  string  required   must exist in VW_JOB_CURRENT_STATE
//   hours       number  required   0.25 – 24
//   work_date   string  required   YYYY-MM-DD format
//   notes       string  optional   max 500 chars
//
// PERMISSION REQUIRED: RBAC.ACTIONS.WORK_LOG_SUBMIT
//
// STATE GUARD: job must exist in VW and not be INVOICED (terminal).
// Work logs are accepted for any non-terminal state so designers
// can log retroactively after QC is submitted.
// ============================================================

var WorkLogHandler = (function () {

  // ============================================================
  // SECTION 1: PAYLOAD VALIDATION SCHEMA
  // ============================================================

  var WORK_LOG_SCHEMA = {
    job_number: {
      type:      'string',
      required:  true,
      minLength: 7,
      maxLength: 20,
      pattern:   /^BLC-\d{5}$/,
      label:     'Job Number'
    },
    hours: {
      type:     'number',
      required: true,
      min:      0.25,
      max:      24,
      label:    'Hours'
    },
    work_date: {
      type:      'string',
      required:  true,
      minLength: 10,
      maxLength: 10,
      pattern:   /^\d{4}-\d{2}-\d{2}$/,
      label:     'Work Date (YYYY-MM-DD)'
    },
    notes: {
      type:      'string',
      required:  false,
      maxLength: 500,
      label:     'Notes'
    }
  };

  // ============================================================
  // SECTION 2: IDEMPOTENCY
  // ============================================================

  function buildIdempotencyKey_(queueId) {
    return Identifiers.buildIdempotencyKey('WORK_LOG', queueId);
  }

  function isDuplicate_(idempotencyKey) {
    try {
      var periodId = Identifiers.generateCurrentPeriodId();
      var existing = DAL.readWhere(
        Config.TABLES.FACT_WORK_LOGS,
        { idempotency_key: idempotencyKey },
        { periodId: periodId }
      );
      return existing.length > 0;
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return false;
      throw e;
    }
  }

  // ============================================================
  // SECTION 3: EVENT ROW BUILDER
  // ============================================================

  /**
   * @param {Object} payload         Validated clean payload
   * @param {Object} actor           Resolved RBAC actor
   * @param {string} periodId
   * @param {string} idempotencyKey
   * @param {string} rawPayloadJson
   * @returns {Object}
   */
  function buildEvent_(payload, actor, periodId, idempotencyKey, rawPayloadJson) {
    return {
      event_id:        Identifiers.generateId(),
      job_number:      payload.job_number,
      period_id:       periodId,
      event_type:      Constants.EVENT_TYPES.WORK_LOG_SUBMITTED,
      timestamp:       new Date().toISOString(),
      actor_code:      actor.personCode || '',
      actor_role:      actor.role       || '',
      hours:           payload.hours,
      work_date:       payload.work_date,
      notes:           payload.notes        || '',
      idempotency_key: idempotencyKey,
      payload_json:    rawPayloadJson       || ''
    };
  }

  // ============================================================
  // SECTION 4: HANDLE
  //
  // Flow:
  //   1. Parse payload_json
  //   2. Validate payload
  //   3. Enforce WORK_LOG_SUBMIT permission
  //   4. Verify job exists in VW and is not terminal
  //   5. Idempotency check
  //   6. Ensure FACT_WORK_LOGS partition
  //   7. Write WORK_LOG_SUBMITTED event
  //   8. Log success
  // ============================================================

  /**
   * @param {Object} queueItem
   * @param {Object} actor
   * @returns {string}  event_id of the written log entry
   * @throws  {Error}
   */
  function handle(queueItem, actor) {
    var queueId = queueItem.queue_id || '(unknown)';

    Logger.info('WORK_LOG_START', {
      module:   'WorkLogHandler',
      message:  'Starting work log handler',
      queue_id: queueId
    });

    // ── Step 1: Parse ───────────────────────────────────────
    var rawPayload = queueItem.payload_json || '{}';
    var payload;
    try {
      payload = JSON.parse(rawPayload);
    } catch (e) {
      throw new Error('WorkLogHandler: invalid JSON in payload_json for queue_id "' + queueId + '": ' + e.message);
    }

    // ── Step 2: Validate ────────────────────────────────────
    var cleanPayload = ValidationEngine.validate(
      WORK_LOG_SCHEMA,
      payload,
      { module: 'WorkLogHandler', actor: actor }
    );

    var jobNumber = cleanPayload.job_number;

    // ── Step 3: Permission ──────────────────────────────────
    RBAC.enforcePermission(actor, RBAC.ACTIONS.WORK_LOG_SUBMIT);

    // ── Step 4: Job existence + terminal guard ──────────────
    var view = StateMachine.getJobView(jobNumber);
    if (!view) {
      throw new Error('WorkLogHandler: job "' + jobNumber + '" not found in VW_JOB_CURRENT_STATE.');
    }
    if (StateMachine.isTerminal(view.current_state)) {
      throw new Error(
        'WorkLogHandler: job "' + jobNumber + '" is in terminal state "' +
        view.current_state + '" — work logs cannot be submitted after invoicing.'
      );
    }

    Logger.info('WORK_LOG_JOB_OK', {
      module:        'WorkLogHandler',
      message:       'Job found, state is active',
      job_number:    jobNumber,
      current_state: view.current_state,
      hours:         cleanPayload.hours,
      work_date:     cleanPayload.work_date
    });

    // ── Step 5: Idempotency ─────────────────────────────────
    var idempotencyKey = buildIdempotencyKey_(queueId);
    if (isDuplicate_(idempotencyKey)) {
      Logger.warn('WORK_LOG_DUPLICATE', {
        module:          'WorkLogHandler',
        message:         'Duplicate work log — skipping',
        queue_id:        queueId,
        job_number:      jobNumber,
        idempotency_key: idempotencyKey
      });
      return 'DUPLICATE';
    }

    // ── Step 6: Ensure FACT_WORK_LOGS partition ─────────────
    var periodId = Identifiers.generateCurrentPeriodId();
    DAL.ensurePartition(Config.TABLES.FACT_WORK_LOGS, periodId, 'WorkLogHandler');

    // ── Step 7: Write WORK_LOG_SUBMITTED ────────────────────
    var eventRow = buildEvent_(cleanPayload, actor, periodId, idempotencyKey, rawPayload);
    DAL.appendRow(
      Config.TABLES.FACT_WORK_LOGS,
      eventRow,
      { callerModule: 'WorkLogHandler', periodId: periodId }
    );

    // ── Step 8: Log success ─────────────────────────────────
    Logger.info('WORK_LOG_SUBMITTED', {
      module:     'WorkLogHandler',
      message:    'Work log submitted successfully',
      target_id:  eventRow.event_id,
      queue_id:   queueId,
      job_number: jobNumber,
      hours:      cleanPayload.hours,
      work_date:  cleanPayload.work_date,
      actor_code: actor.personCode
    });

    return eventRow.event_id;
  }

  // ── Self-registration ───────────────────────────────────────
  (function register_() {
    try {
      QueueProcessor.registerHandler(Config.FORM_TYPES.WORK_LOG, handle);
    } catch (e) {
      console.log('[WorkLogHandler REGISTRATION FAILED] ' + e.message);
    }
  }());

  return {
    handle:          handle,
    WORK_LOG_SCHEMA: WORK_LOG_SCHEMA
  };

}());
