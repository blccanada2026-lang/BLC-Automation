// ============================================================
// JobStartHandler.gs — BLC Nexus T6 Handlers
// src/06-handlers/JobStartHandler.gs
//
// LOAD ORDER: T6. Loads after all T0–T5 files.
// DEPENDENCIES: Config (T0), Constants (T0), Identifiers (T0),
//               DAL (T1), RBAC (T2), Logger (T3),
//               ErrorHandler (T3), ValidationEngine (T4),
//               QueueProcessor (T5), StateMachine (T6)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  Handles FORM_TYPE = 'JOB_START'                        ║
// ║  Moves a job from ALLOCATED → IN_PROGRESS.              ║
// ║  Writes a JOB_STARTED event to FACT_JOB_EVENTS and     ║
// ║  updates VW_JOB_CURRENT_STATE.                          ║
// ╚══════════════════════════════════════════════════════════╝
//
// Responsibilities:
//   1. Parse and validate the job start payload
//   2. Look up the job in VW_JOB_CURRENT_STATE
//   3. Validate state transition ALLOCATED → IN_PROGRESS
//   4. Check idempotency — skip if already processed
//   5. Write a JOB_STARTED event to FACT_JOB_EVENTS
//   6. Update VW_JOB_CURRENT_STATE: current_state = IN_PROGRESS
//   7. Log each step with structured context
//   8. Register itself with QueueProcessor at module load time
//
// FACT_JOB_EVENTS EVENT SCHEMA (JOB_STARTED):
//   event_id          — UUID  (Identifiers.generateId())
//   job_number        — from payload
//   period_id         — current period
//   event_type        — 'JOB_STARTED'
//   timestamp         — ISO 8601 string
//   actor_code        — person_code of the designer starting the job
//   actor_role        — role of the actor
//   client_code       — copied from VW_JOB_CURRENT_STATE
//   job_type          — copied from VW_JOB_CURRENT_STATE
//   product_code      — copied from VW_JOB_CURRENT_STATE
//   quantity          — copied from VW_JOB_CURRENT_STATE
//   notes             — optional free text from payload
//   idempotency_key   — deterministic key for duplicate detection
//   payload_json      — full raw payload JSON string
//
// VW_JOB_CURRENT_STATE UPDATES:
//   current_state → IN_PROGRESS
//   allocated_to  → actor.personCode (if not already set)
//   updated_at    → ISO timestamp
//
// PAYLOAD SCHEMA:
//   job_number  string  required   e.g. 'BLC-00042'
//   notes       string  optional   max 500 chars
//   started_at  string  optional   ISO date override
//
// STATE MACHINE:
//   Requires current_state = ALLOCATED (set by JobCreateHandler
//   when allocated_to is supplied, or by a future JobAllocateHandler).
//   Transition: ALLOCATED → IN_PROGRESS
//
// PERMISSION REQUIRED: RBAC.ACTIONS.JOB_START
// ============================================================

var JobStartHandler = (function () {

  // ============================================================
  // SECTION 1: PAYLOAD VALIDATION SCHEMA
  // ============================================================

  var JOB_START_SCHEMA = {
    job_number: {
      type:      'string',
      required:  true,
      minLength: 7,
      maxLength: 20,
      label:     'Job Number'
    },
    notes: {
      type:      'string',
      required:  false,
      maxLength: 500,
      label:     'Notes'
    },
    started_at: {
      type:     'string',
      required: false,
      label:    'Started At'
    }
  };

  // ============================================================
  // SECTION 2: IDEMPOTENCY CHECK
  //
  // Key = 'JOB_START_{QUEUE_ID}' — scoped to the queue item,
  // not the job number. This prevents double-processing a retried
  // queue item while still allowing a job to be stopped and
  // restarted (which would have different queue_ids).
  // ============================================================

  /**
   * @param {string} queueId
   * @returns {string}
   */
  function buildIdempotencyKey_(queueId) {
    return Identifiers.buildIdempotencyKey('JOB_START', queueId);
  }

  /**
   * Returns true if a JOB_STARTED event already exists for this queue item.
   * @param {string} idempotencyKey
   * @returns {boolean}
   */
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

  // ============================================================
  // SECTION 3: EVENT ROW BUILDER
  //
  // Copies client_code / job_type / product_code / quantity from
  // the VW row so the FACT row is self-contained — no JOIN needed
  // to audit a JOB_STARTED event.
  // ============================================================

  /**
   * Builds the FACT_JOB_EVENTS row for a JOB_STARTED event.
   *
   * @param {Object} payload         Validated clean payload
   * @param {Object} view            VW_JOB_CURRENT_STATE row for the job
   * @param {Object} actor           Resolved RBAC actor
   * @param {string} periodId        e.g. '2026-04'
   * @param {string} idempotencyKey
   * @param {string} rawPayloadJson
   * @returns {Object}
   */
  function buildEvent_(payload, view, actor, periodId, idempotencyKey, rawPayloadJson) {
    return {
      event_id:        Identifiers.generateId(),
      job_number:      payload.job_number,
      period_id:       periodId,
      event_type:      Constants.EVENT_TYPES.JOB_STARTED,
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

  // ============================================================
  // SECTION 4: HANDLE — MAIN HANDLER FUNCTION
  //
  // Flow:
  //   1. Parse payload_json
  //   2. Validate payload against JOB_START_SCHEMA
  //   3. Enforce JOB_START permission on actor
  //   4. Look up job in VW_JOB_CURRENT_STATE
  //   5. Assert ALLOCATED → IN_PROGRESS transition
  //   6. Idempotency check
  //   7. Ensure FACT_JOB_EVENTS partition
  //   8. Write JOB_STARTED event to FACT_JOB_EVENTS
  //   9. Update VW_JOB_CURRENT_STATE
  //  10. Log success
  // ============================================================

  /**
   * Handles a JOB_START queue item.
   * Called by QueueProcessor — do not call directly.
   *
   * @param {Object} queueItem  Row from STG_PROCESSING_QUEUE
   * @param {Object} actor      Resolved RBAC actor
   * @returns {string}          job_number (e.g. 'BLC-00042')
   * @throws  {Error}           On validation, permission, or state failure
   */
  function handle(queueItem, actor) {
    var queueId = queueItem.queue_id || '(unknown)';

    Logger.info('JOB_START_START', {
      module:   'JobStartHandler',
      message:  'Starting job start handler',
      queue_id: queueId
    });

    // ── Step 1: Parse payload_json ──────────────────────────
    var rawPayload = queueItem.payload_json || '{}';
    var payload    = null;

    try {
      payload = JSON.parse(rawPayload);
    } catch (e) {
      throw new Error(
        'JobStartHandler: payload_json is not valid JSON for queue_id "' +
        queueId + '": ' + e.message
      );
    }

    // ── Step 2: Validate payload ────────────────────────────
    var cleanPayload = ValidationEngine.validate(
      JOB_START_SCHEMA,
      payload,
      { module: 'JobStartHandler', actor: actor }
    );

    var jobNumber = cleanPayload.job_number;

    Logger.info('JOB_START_VALIDATED', {
      module:     'JobStartHandler',
      message:    'Payload validated',
      queue_id:   queueId,
      job_number: jobNumber
    });

    // ── Step 3: Enforce JOB_START permission ────────────────
    RBAC.enforcePermission(actor, RBAC.ACTIONS.JOB_START);

    // ── Step 4: Look up job in VW_JOB_CURRENT_STATE ─────────
    var view = StateMachine.getJobView(jobNumber);

    if (!view) {
      throw new Error(
        'JobStartHandler: job "' + jobNumber + '" not found in VW_JOB_CURRENT_STATE. ' +
        'The job may not have been created yet, or the view was not populated by JobCreateHandler.'
      );
    }

    Logger.info('JOB_START_JOB_FOUND', {
      module:        'JobStartHandler',
      message:       'Job found in view',
      job_number:    jobNumber,
      current_state: view.current_state
    });

    // ── Step 5: Assert ALLOCATED → IN_PROGRESS ──────────────
    // Throws INVALID_TRANSITION if the job is not in ALLOCATED state.
    StateMachine.assertTransition(
      view.current_state,
      Config.STATES.IN_PROGRESS,
      { jobNumber: jobNumber }
    );

    // ── Step 6: Idempotency check ───────────────────────────
    var idempotencyKey = buildIdempotencyKey_(queueId);

    if (isDuplicate_(idempotencyKey)) {
      Logger.warn('JOB_START_DUPLICATE', {
        module:          'JobStartHandler',
        message:         'Duplicate JOB_START request detected — skipping',
        queue_id:        queueId,
        job_number:      jobNumber,
        idempotency_key: idempotencyKey
      });
      return 'DUPLICATE';
    }

    // ── Step 7: Ensure FACT_JOB_EVENTS partition ───────────
    var periodId = Identifiers.generateCurrentPeriodId();

    DAL.ensurePartition(
      Config.TABLES.FACT_JOB_EVENTS,
      periodId,
      'JobStartHandler'
    );

    // ── Step 8: Write JOB_STARTED event to FACT_JOB_EVENTS ─
    var eventRow = buildEvent_(
      cleanPayload,
      view,
      actor,
      periodId,
      idempotencyKey,
      rawPayload
    );

    DAL.appendRow(
      Config.TABLES.FACT_JOB_EVENTS,
      eventRow,
      {
        callerModule: 'JobStartHandler',
        periodId:     periodId
      }
    );

    // ── Step 9: Update VW_JOB_CURRENT_STATE ────────────────
    // allocated_to: keep existing value unless actor provides a better one
    var newAllocatedTo = view.allocated_to || actor.personCode || '';

    DAL.updateWhere(
      Config.TABLES.VW_JOB_CURRENT_STATE,
      { job_number: jobNumber },
      {
        current_state: Config.STATES.IN_PROGRESS,
        allocated_to:  newAllocatedTo,
        updated_at:    eventRow.timestamp
      },
      { callerModule: 'JobStartHandler' }
    );

    // ── Step 10: Log success ────────────────────────────────
    Logger.info('JOB_STARTED', {
      module:      'JobStartHandler',
      message:     'Job started successfully',
      target_id:   jobNumber,
      queue_id:    queueId,
      job_number:  jobNumber,
      period_id:   periodId,
      event_id:    eventRow.event_id,
      actor_code:  actor.personCode
    });

    return jobNumber;
  }

  // ============================================================
  // SECTION 5: SELF-REGISTRATION WITH QueueProcessor
  // ============================================================

  (function register_() {
    try {
      QueueProcessor.registerHandler(Config.FORM_TYPES.JOB_START, handle);
    } catch (e) {
      console.log(
        '[JobStartHandler REGISTRATION FAILED] ' + e.message +
        ' — JOB_START items will not be processed.'
      );
    }
  }());

  // ============================================================
  // PUBLIC API
  // ============================================================
  return {

    /**
     * Main handler function — exposed for direct test calls.
     * @type {function(Object, Object): string}
     */
    handle: handle,

    /**
     * The validation schema.
     */
    JOB_START_SCHEMA: JOB_START_SCHEMA

  };

}());
