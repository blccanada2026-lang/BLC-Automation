// ============================================================
// JobAssignHandler.gs — BLC Nexus T6 Handlers
// src/06-handlers/JobAssignHandler.gs
//
// LOAD ORDER: T6. Loads after all T0–T5 files.
// DEPENDENCIES: Config (T0), Constants (T0), Identifiers (T0),
//               DAL (T1), RBAC (T2), Logger (T3),
//               ErrorHandler (T3), ValidationEngine (T4),
//               QueueProcessor (T5), StateMachine (T6)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  Handles FORM_TYPE = 'JOB_ALLOCATE'                     ║
// ║  Moves a job from INTAKE_RECEIVED → ALLOCATED.          ║
// ║  Writes a JOB_ALLOCATED event to FACT_JOB_EVENTS and    ║
// ║  updates VW_JOB_CURRENT_STATE.                          ║
// ╚══════════════════════════════════════════════════════════╝
//
// PAYLOAD SCHEMA:
//   job_number     string  required   e.g. 'BLC-00042'
//   designer_code  string  required   person_code of the assigned designer
//   notes          string  optional   max 500 chars
//
// STATE MACHINE:
//   Requires current_state = INTAKE_RECEIVED.
//   Transition: INTAKE_RECEIVED → ALLOCATED
//
// PERMISSION REQUIRED: RBAC.ACTIONS.JOB_ALLOCATE (CEO, PM, TEAM_LEAD)
// ============================================================

var JobAssignHandler = (function () {

  // ============================================================
  // SECTION 1: PAYLOAD VALIDATION SCHEMA
  // ============================================================

  var JOB_ALLOCATE_SCHEMA = {
    job_number: {
      type:      'string',
      required:  true,
      minLength: 7,
      maxLength: 20,
      label:     'Job Number'
    },
    designer_code: {
      type:      'string',
      required:  true,
      minLength: 1,
      maxLength: 20,
      label:     'Designer Code'
    },
    notes: {
      type:      'string',
      required:  false,
      maxLength: 500,
      label:     'Notes'
    }
  };

  // ============================================================
  // SECTION 2: IDEMPOTENCY CHECK
  // ============================================================

  /** @param {string} queueId @returns {string} */
  function buildIdempotencyKey_(queueId) {
    return Identifiers.buildIdempotencyKey('JOB_ALLOCATE', queueId);
  }

  /** @param {string} idempotencyKey @returns {boolean} */
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
  // SECTION 3: DESIGNER VALIDATION
  // ============================================================

  /**
   * Asserts that the designer_code resolves to an active staff member.
   * Throws if not found or inactive.
   * @param {string} designerCode
   */
  function assertDesignerActive_(designerCode) {
    var rows;
    try {
      rows = DAL.readWhere(
        Config.TABLES.DIM_STAFF_ROSTER,
        { person_code: designerCode },
        { callerModule: 'JobAssignHandler' }
      );
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') {
        throw new Error('JobAssignHandler: DIM_STAFF_ROSTER not found. Cannot verify designer "' + designerCode + '".');
      }
      throw e;
    }

    if (rows.length === 0) {
      throw new Error('JobAssignHandler: designer "' + designerCode + '" not found in DIM_STAFF_ROSTER.');
    }

    var row = rows[0];
    if (String(row.active || '').toUpperCase() !== 'TRUE') {
      throw new Error('JobAssignHandler: designer "' + designerCode + '" is not active.');
    }
  }

  // ============================================================
  // SECTION 4: EVENT ROW BUILDER
  // ============================================================

  /**
   * @param {Object} payload         Validated clean payload
   * @param {Object} view            VW_JOB_CURRENT_STATE row
   * @param {Object} actor           Resolved RBAC actor
   * @param {string} periodId
   * @param {string} idempotencyKey
   * @param {string} rawPayloadJson
   * @returns {Object}
   */
  function buildEvent_(payload, view, actor, periodId, idempotencyKey, rawPayloadJson) {
    return {
      event_id:        Identifiers.generateId(),
      job_number:      payload.job_number,
      period_id:       periodId,
      event_type:      Constants.EVENT_TYPES.JOB_ALLOCATED,
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
  // SECTION 5: HANDLE — MAIN HANDLER FUNCTION
  //
  // Flow:
  //   1. Parse payload_json
  //   2. Validate payload against JOB_ALLOCATE_SCHEMA
  //   3. Enforce JOB_ALLOCATE permission on actor
  //   4. Look up job in VW_JOB_CURRENT_STATE
  //   5. Assert INTAKE_RECEIVED → ALLOCATED transition
  //   6. Validate designer is active
  //   7. Idempotency check
  //   8. Ensure FACT_JOB_EVENTS partition
  //   9. Write JOB_ALLOCATED event to FACT_JOB_EVENTS
  //  10. Update VW_JOB_CURRENT_STATE
  //  11. Log success
  // ============================================================

  /**
   * Handles a JOB_ALLOCATE queue item.
   * Called by QueueProcessor — do not call directly.
   *
   * @param {Object} queueItem  Row from STG_PROCESSING_QUEUE
   * @param {Object} actor      Resolved RBAC actor
   * @returns {string}          job_number on success, 'DUPLICATE' if already processed
   * @throws  {Error}           On validation, permission, or state failure
   */
  function handle(queueItem, actor) {
    var queueId = queueItem.queue_id || '(unknown)';

    // ── Step 1: Enforce JOB_ALLOCATE permission ─────────────
    RBAC.enforcePermission(actor, RBAC.ACTIONS.JOB_ALLOCATE);

    Logger.info('JOB_ASSIGN_START', {
      module:   'JobAssignHandler',
      message:  'Starting job assign handler',
      queue_id: queueId
    });

    // ── Step 2: Parse payload_json ──────────────────────────
    var rawPayload = queueItem.payload_json || '{}';
    var payload    = null;

    try {
      payload = JSON.parse(rawPayload);
    } catch (e) {
      throw new Error(
        'JobAssignHandler: payload_json is not valid JSON for queue_id "' +
        queueId + '": ' + e.message
      );
    }

    // ── Step 3: Validate payload ────────────────────────────
    var cleanPayload = ValidationEngine.validate(
      JOB_ALLOCATE_SCHEMA,
      payload,
      { module: 'JobAssignHandler', actor: actor }
    );

    var jobNumber    = cleanPayload.job_number;
    var designerCode = cleanPayload.designer_code;

    Logger.info('JOB_ASSIGN_VALIDATED', {
      module:        'JobAssignHandler',
      message:       'Payload validated',
      queue_id:      queueId,
      job_number:    jobNumber,
      designer_code: designerCode
    });

    // ── Step 4: Idempotency check (before any state reads) ──
    var idempotencyKey = buildIdempotencyKey_(queueId);

    if (isDuplicate_(idempotencyKey)) {
      Logger.warn('JOB_ASSIGN_DUPLICATE', {
        module:          'JobAssignHandler',
        message:         'Duplicate JOB_ALLOCATE request detected — skipping',
        queue_id:        queueId,
        idempotency_key: idempotencyKey
      });
      return 'DUPLICATE';
    }

    // ── Step 5: Look up job in VW_JOB_CURRENT_STATE ─────────
    var view = StateMachine.getJobView(jobNumber);

    if (!view) {
      throw new Error(
        'JobAssignHandler: job "' + jobNumber + '" not found in VW_JOB_CURRENT_STATE.'
      );
    }

    Logger.info('JOB_ASSIGN_JOB_FOUND', {
      module:        'JobAssignHandler',
      message:       'Job found in view',
      job_number:    jobNumber,
      current_state: view.current_state
    });

    // ── Step 6: Assert INTAKE_RECEIVED → ALLOCATED ──────────
    StateMachine.assertTransition(
      view.current_state,
      Config.STATES.ALLOCATED,
      { jobNumber: jobNumber }
    );

    // ── Step 7: Validate designer is active ─────────────────
    assertDesignerActive_(designerCode);

    // ── Step 8: Ensure FACT_JOB_EVENTS partition ───────────
    var periodId = Identifiers.generateCurrentPeriodId();

    DAL.ensurePartition(
      Config.TABLES.FACT_JOB_EVENTS,
      periodId,
      'JobAssignHandler'
    );

    // ── Step 9: Write JOB_ALLOCATED event ──────────────────
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
        callerModule: 'JobAssignHandler',
        periodId:     periodId
      }
    );

    // ── Step 10: Update VW_JOB_CURRENT_STATE ────────────────
    DAL.updateWhere(
      Config.TABLES.VW_JOB_CURRENT_STATE,
      { job_number: jobNumber },
      {
        current_state: Config.STATES.ALLOCATED,
        allocated_to:  designerCode,
        updated_at:    eventRow.timestamp
      },
      { callerModule: 'JobAssignHandler' }
    );

    // ── Step 11: Log success ────────────────────────────────
    Logger.info('JOB_ASSIGNED', {
      module:        'JobAssignHandler',
      message:       'Job assigned successfully',
      target_id:     jobNumber,
      queue_id:      queueId,
      job_number:    jobNumber,
      designer_code: designerCode,
      period_id:     periodId,
      event_id:      eventRow.event_id,
      actor_code:    actor.personCode
    });

    return jobNumber;
  }

  // ============================================================
  // SECTION 6: SELF-REGISTRATION WITH QueueProcessor
  // ============================================================

  (function register_() {
    try {
      QueueProcessor.registerHandler(Config.FORM_TYPES.JOB_ALLOCATE, handle);
    } catch (e) {
      Logger.warn('HANDLER_REGISTRATION_FAILED', {
        module:  'JobAssignHandler',
        message: e.message
      });
    }
  }());

  // ============================================================
  // PUBLIC API
  // ============================================================
  return {
    /** @type {function(Object, Object): string} */
    handle: handle,
    /** @type {Object} */
    JOB_ALLOCATE_SCHEMA: JOB_ALLOCATE_SCHEMA
  };

}());
