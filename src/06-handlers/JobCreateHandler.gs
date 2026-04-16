// ============================================================
// JobCreateHandler.gs — BLC Nexus T6 Handlers
// src/06-handlers/JobCreateHandler.gs
//
// LOAD ORDER: T6. Loads after all T0–T5 files.
// DEPENDENCIES: Config (T0), Constants (T0), Identifiers (T0),
//               DAL (T1), RBAC (T2), Logger (T3),
//               ErrorHandler (T3), HealthMonitor (T3),
//               ValidationEngine (T4), QueueProcessor (T5)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  Handles FORM_TYPE = 'JOB_CREATE'                       ║
// ║  Creates the first event for a new job in               ║
// ║  FACT_JOB_EVENTS and assigns a BLC-NNNNN job number.   ║
// ║                                                         ║
// ║  PERMISSION REQUIRED: RBAC.ACTIONS.JOB_CREATE           ║
// ╚══════════════════════════════════════════════════════════╝
//
// Responsibilities:
//   1. Parse and validate the job creation payload
//   2. Check idempotency — skip if this queue item was already processed
//   3. Allocate the next sequential job number from DIM_SEQUENCE_COUNTERS
//   4. Write a JOB_CREATED event to FACT_JOB_EVENTS
//   5. Log each step with structured context
//   6. Register itself with QueueProcessor at module load time
//
// FACT_JOB_EVENTS EVENT SCHEMA (JOB_CREATED):
//   event_id          — UUID  (Identifiers.generateId())
//   job_number        — BLC-NNNNN  (Identifiers.generateJobId(seq))
//   period_id         — YYYY-MM  (current period at time of creation)
//   event_type        — 'JOB_CREATED'  (Constants.EVENT_TYPES.JOB_CREATED)
//   timestamp         — ISO 8601 string
//   actor_code        — personCode of the submitting user
//   actor_role        — role of the submitting user
//   client_code       — client identifier from payload
//   job_type          — type of design work from payload
//   product_code      — product/template identifier (optional)
//   quantity          — number of units
//   notes             — optional free text
//   idempotency_key   — deterministic key for duplicate detection
//   payload_json      — full raw payload JSON string
//
// DIM_SEQUENCE_COUNTERS ROW (counter_name = 'JOB_NUMBER'):
//   counter_name      — 'JOB_NUMBER'
//   current_value     — last-used sequence integer (incremented on each job)
//   updated_at        — ISO timestamp of last increment
//
// IDEMPOTENCY:
//   Key = 'JOB_CREATE_{QUEUE_ID}' (uppercased).
//   Built deterministically from the queue item's queue_id.
//   If FACT_JOB_EVENTS already contains a row with this key,
//   the item is a duplicate — log and return without writing.
//
// PAYLOAD SCHEMA (from form / STG_PROCESSING_QUEUE.payload_json):
//   client_code   string  required   min 2 chars
//   job_type      string  required   allowed values from payload
//   product_code  string  optional
//   quantity      number  required   1–99999
//   notes         string  optional   max 500 chars
//   submitted_at  string  optional   ISO date string
//
// DO NOT:
//   - Call SpreadsheetApp directly
//   - Write to FACT_JOB_EVENTS outside this handler
//   - Increment DIM_SEQUENCE_COUNTERS outside this handler
// ============================================================

var JobCreateHandler = (function () {

  // ============================================================
  // SECTION 1: PAYLOAD VALIDATION SCHEMA
  //
  // Applied to the parsed payload_json from the queue item.
  // Only validated fields are written to the event row (clean object).
  // job_type allowedValues intentionally kept open — clients may use
  // custom types defined in DIM_PRODUCT_RATES. Enum enforcement
  // happens at the billing layer, not intake.
  // ============================================================

  var JOB_CREATE_SCHEMA = {
    client_code: {
      type:      'string',
      required:  true,
      minLength: 2,
      maxLength: 20,
      label:     'Client Code'
    },
    job_type: {
      type:      'string',
      required:  true,
      minLength: 1,
      maxLength: 50,
      label:     'Job Type'
    },
    product_code: {
      type:      'string',
      required:  false,
      maxLength: 30,
      label:     'Product Code'
    },
    quantity: {
      type:     'number',
      required: true,
      min:      1,
      max:      99999,
      label:    'Quantity'
    },
    notes: {
      type:      'string',
      required:  false,
      maxLength: 500,
      label:     'Notes'
    },
    // Optional: designer email to allocate the job to at creation time.
    // If provided, initial VW state = ALLOCATED; otherwise INTAKE_RECEIVED.
    allocated_to: {
      type:      'string',
      required:  false,
      maxLength: 100,
      label:     'Allocated To'
    },
    submitted_at: {
      type:     'string',
      required: false,
      label:    'Submitted At'
    },
    // Client's own reference number — stored for cross-referencing.
    // Set by SheetAdapter when intake originates from a client sheet (e.g. SBS 'Job #').
    client_job_ref: {
      type:      'string',
      required:  false,
      maxLength: 50,
      label:     'Client Job Ref'
    },
    // Client-requested completion date (ISO YYYY-MM-DD).
    // Informational only — does not affect state machine or billing.
    target_date: {
      type:      'string',
      required:  false,
      maxLength: 20,
      label:     'Target Date'
    }
  };

  // ============================================================
  // SECTION 2: IDEMPOTENCY CHECK
  //
  // Queries the current period's FACT_JOB_EVENTS partition for
  // an existing row with the same idempotency_key.
  //
  // We check the current period only. If a duplicate spans a period
  // boundary (extremely rare — a re-processed item from last month),
  // it will not be caught here, but the job_number sequence ensures
  // the new row is still unique. For cross-period idempotency,
  // IdempotencyEngine.gs (future T3 module) handles that case.
  //
  // Returns true if a duplicate is found.
  // ============================================================

  /**
   * Builds the idempotency key for a job creation queue item.
   * Deterministic: same queue_id always produces the same key.
   *
   * @param {string} queueId
   * @returns {string}  e.g. 'JOB_CREATE_QITM-A3F9C812D047'
   */
  function buildIdempotencyKey_(queueId) {
    return Identifiers.buildIdempotencyKey('JOB_CREATE', queueId);
  }

  /**
   * Returns true if a JOB_CREATED event already exists for this queue item.
   * Checks the current period's FACT_JOB_EVENTS partition only.
   *
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
      // If the partition doesn't exist yet (first job this period) →
      // DAL throws SHEET_NOT_FOUND. Treat as no duplicate.
      if (e.code === 'SHEET_NOT_FOUND') return false;
      // Any other error — re-throw so the handler catches it
      throw e;
    }
  }

  // ============================================================
  // SECTION 3: SEQUENCE COUNTER
  //
  // Reads the current JOB_NUMBER counter from DIM_SEQUENCE_COUNTERS,
  // increments it, writes the new value back, and returns the
  // new sequence integer for job number generation.
  //
  // DIM_SEQUENCE_COUNTERS columns:
  //   counter_name   — 'JOB_NUMBER'
  //   current_value  — integer, last-used sequence
  //   updated_at     — ISO timestamp
  //
  // Race condition safety: QueueProcessor holds LockService.getScriptLock()
  // for the entire batch run, so only one handler executes at a time.
  // This read-modify-write is serialised by the outer lock.
  // ============================================================

  /**
   * Reads, increments, and writes back the JOB_NUMBER sequence counter.
   * Returns the new (next) sequence integer to use for job number generation.
   *
   * @returns {number}  Next sequence integer (e.g. 42)
   * @throws  {Error}   If counter row is missing or write fails
   */
  function getNextJobSequence_() {
    var rows = DAL.readWhere(
      Config.TABLES.DIM_SEQUENCE_COUNTERS,
      { counter_name: 'JOB_NUMBER' }
    );

    if (!rows || rows.length === 0) {
      throw new Error(
        'JobCreateHandler: DIM_SEQUENCE_COUNTERS row for "JOB_NUMBER" not found. ' +
        'Run SetupScript to initialise the counter before processing job creation requests.'
      );
    }

    var current = parseInt(rows[0].current_value, 10);
    if (isNaN(current) || current < 0) {
      throw new Error(
        'JobCreateHandler: DIM_SEQUENCE_COUNTERS "JOB_NUMBER" current_value is invalid: ' +
        rows[0].current_value
      );
    }

    var next = current + 1;

    DAL.updateWhere(
      Config.TABLES.DIM_SEQUENCE_COUNTERS,
      { counter_name: 'JOB_NUMBER' },
      {
        current_value: next,
        updated_at:    new Date().toISOString()
      },
      { callerModule: 'JobCreateHandler' }
    );

    return next;
  }

  // ============================================================
  // SECTION 4: EVENT ROW BUILDER
  //
  // Constructs the FACT_JOB_EVENTS row for a JOB_CREATED event.
  // All fields explicitly set — no undefined values reach DAL.
  // ============================================================

  /**
   * Builds the FACT_JOB_EVENTS row for a JOB_CREATED event.
   *
   * @param {string} jobNumber       e.g. 'BLC-00042'
   * @param {string} periodId        e.g. '2026-04'
   * @param {Object} payload         Validated, clean payload object
   * @param {Object} actor           RBAC actor from resolveActor()
   * @param {string} idempotencyKey  Pre-built idempotency key
   * @param {string} rawPayloadJson  Original payload_json string (for audit)
   * @returns {Object}  Row ready for DAL.appendRow
   */
  function buildEvent_(jobNumber, periodId, payload, actor, idempotencyKey, rawPayloadJson) {
    return {
      event_id:         Identifiers.generateId(),
      job_number:       jobNumber,
      period_id:        periodId,
      event_type:       Constants.EVENT_TYPES.JOB_CREATED,
      timestamp:        new Date().toISOString(),
      actor_code:       actor.personCode || '',
      actor_role:       actor.role       || '',
      client_code:      payload.client_code    || '',
      job_type:         payload.job_type        || '',
      product_code:     payload.product_code    || '',
      quantity:         payload.quantity        || 0,
      client_job_ref:   payload.client_job_ref  || '',
      target_date:      payload.target_date     || '',
      notes:            payload.notes           || '',
      idempotency_key:  idempotencyKey,
      payload_json:     rawPayloadJson          || ''
    };
  }

  // ============================================================
  // SECTION 5: HANDLE — MAIN HANDLER FUNCTION
  //
  // Entry point called by QueueProcessor.processQueue().
  // Receives the full queue item row and the resolved RBAC actor.
  //
  // Flow:
  //   1. Parse payload_json
  //   2. Validate payload against JOB_CREATE_SCHEMA
  //   3. Build idempotency key and check for duplicate
  //   4. Allocate next job sequence number
  //   5. Ensure FACT_JOB_EVENTS partition exists for current period
  //   6. Write JOB_CREATED event to FACT_JOB_EVENTS
  //   7. Log success
  //
  // Throws on any unrecoverable failure — QueueProcessor.wrap()
  // catches the throw and marks the item FAILED or DEAD_LETTER.
  // ============================================================

  /**
   * Handles a JOB_CREATE queue item.
   * Called by QueueProcessor — do not call directly.
   *
   * @param {Object} queueItem  Row from STG_PROCESSING_QUEUE
   * @param {Object} actor      Resolved RBAC actor
   * @returns {string}          Created job_number (e.g. 'BLC-00042')
   * @throws  {Error}           On validation failure or write error
   */
  function handle(queueItem, actor) {
    var queueId = queueItem.queue_id || '(unknown)';

    Logger.info('JOB_CREATE_START', {
      module:   'JobCreateHandler',
      message:  'Starting job creation',
      queue_id: queueId
    });

    // ── Step 0: RBAC check ──────────────────────────────────
    RBAC.enforcePermission(actor, RBAC.ACTIONS.JOB_CREATE);

    // ── Step 1: Parse payload_json ──────────────────────────
    var rawPayload = queueItem.payload_json || '{}';
    var payload    = null;

    try {
      payload = JSON.parse(rawPayload);
    } catch (e) {
      throw new Error(
        'JobCreateHandler: payload_json is not valid JSON for queue_id "' +
        queueId + '": ' + e.message
      );
    }

    if (!payload || typeof payload !== 'object') {
      throw new Error(
        'JobCreateHandler: payload_json parsed to a non-object for queue_id "' + queueId + '".'
      );
    }

    // ── Step 2: Validate payload ────────────────────────────
    // ValidationEngine.validate() throws ValidationError on failure.
    // QueueProcessor.wrap() will catch it and mark the item FAILED.
    var cleanPayload = ValidationEngine.validate(
      JOB_CREATE_SCHEMA,
      payload,
      {
        module: 'JobCreateHandler',
        actor:  actor
      }
    );

    Logger.info('JOB_CREATE_VALIDATED', {
      module:      'JobCreateHandler',
      message:     'Payload validated successfully',
      queue_id:    queueId,
      client_code: cleanPayload.client_code,
      job_type:    cleanPayload.job_type,
      quantity:    cleanPayload.quantity
    });

    // ── Step 3: Idempotency check ───────────────────────────
    var idempotencyKey = buildIdempotencyKey_(queueId);

    if (isDuplicate_(idempotencyKey)) {
      Logger.warn('JOB_CREATE_DUPLICATE', {
        module:          'JobCreateHandler',
        message:         'Duplicate job creation request detected — skipping',
        queue_id:        queueId,
        idempotency_key: idempotencyKey
      });
      // Return a sentinel value — QueueProcessor treats non-throw as success
      // The item will be marked COMPLETED (correct: it was already handled)
      return 'DUPLICATE';
    }

    // ── Step 4: Allocate next job sequence number ───────────
    var sequence  = getNextJobSequence_();
    var jobNumber = Identifiers.generateJobId(sequence);

    Logger.info('JOB_NUMBER_ALLOCATED', {
      module:     'JobCreateHandler',
      message:    'Job number allocated',
      queue_id:   queueId,
      job_number: jobNumber,
      sequence:   sequence
    });

    // ── Step 5: Ensure FACT_JOB_EVENTS partition exists ────
    var periodId = Identifiers.generateCurrentPeriodId();

    try {
      DAL.ensurePartition(
        Config.TABLES.FACT_JOB_EVENTS,
        periodId,
        'JobCreateHandler'
      );
    } catch (e) {
      // ensurePartition throws if JobCreateHandler isn't in WRITE_PERMISSIONS
      // for FACT_JOB_EVENTS — already configured in DAL.gs, so this is a
      // safety net only
      throw new Error(
        'JobCreateHandler: could not ensure FACT_JOB_EVENTS partition for ' +
        periodId + ': ' + e.message
      );
    }

    // ── Step 6: Write JOB_CREATED event ────────────────────
    var eventRow = buildEvent_(
      jobNumber,
      periodId,
      cleanPayload,
      actor,
      idempotencyKey,
      rawPayload
    );

    DAL.appendRow(
      Config.TABLES.FACT_JOB_EVENTS,
      eventRow,
      {
        callerModule: 'JobCreateHandler',
        periodId:     periodId
      }
    );

    // ── Step 7: Write initial VW_JOB_CURRENT_STATE row ─────
    // State = ALLOCATED if allocated_to was provided, else INTAKE_RECEIVED.
    // This row enables JobStartHandler (and other handlers) to find the job
    // and validate state transitions without scanning FACT_JOB_EVENTS.
    var initialState = cleanPayload.allocated_to
      ? Config.STATES.ALLOCATED
      : Config.STATES.INTAKE_RECEIVED;

    var viewRow = {
      job_number:          jobNumber,
      client_code:         cleanPayload.client_code       || '',
      job_type:            cleanPayload.job_type          || '',
      product_code:        cleanPayload.product_code      || '',
      quantity:            cleanPayload.quantity          || 0,
      current_state:       initialState,
      prev_state:          '',
      allocated_to:        cleanPayload.allocated_to      || '',
      period_id:           periodId,
      created_at:          eventRow.timestamp,
      updated_at:          eventRow.timestamp,
      rework_cycle:        0,
      client_return_count: 0
    };

    DAL.appendRow(
      Config.TABLES.VW_JOB_CURRENT_STATE,
      viewRow,
      { callerModule: 'JobCreateHandler' }
    );

    // ── Step 8: Log success ─────────────────────────────────
    Logger.info('JOB_CREATED', {
      module:      'JobCreateHandler',
      message:     'Job created successfully',
      target_id:   jobNumber,
      queue_id:    queueId,
      job_number:  jobNumber,
      client_code: cleanPayload.client_code,
      job_type:    cleanPayload.job_type,
      quantity:    cleanPayload.quantity,
      period_id:   periodId,
      event_id:    eventRow.event_id
    });

    return jobNumber;
  }

  // ============================================================
  // SECTION 6: SELF-REGISTRATION WITH QueueProcessor
  //
  // Runs immediately when this file is parsed by the GAS runtime.
  // By the time any trigger fires, QueueProcessor already has this
  // handler registered for 'JOB_CREATE' form_type items.
  //
  // Load order dependency: QueueProcessor.gs must be parsed before
  // this file. The T5 prefix in the directory name ensures this.
  // ============================================================

  (function register_() {
    try {
      QueueProcessor.registerHandler(Config.FORM_TYPES.JOB_CREATE, handle);
    } catch (e) {
      // Registration failure is critical — log to console since Logger
      // may not be fully ready at parse time in all GAS contexts
      console.log(
        '[JobCreateHandler REGISTRATION FAILED] ' + e.message +
        ' — JOB_CREATE items will not be processed.'
      );
    }
  }());

  // ============================================================
  // PUBLIC API
  // ============================================================
  return {

    /**
     * Main handler function. Exposed publicly so it can be called
     * directly in tests without going through QueueProcessor.
     *
     * @type {function(Object, Object): string}
     */
    handle: handle,

    /**
     * The validation schema — exported for test harness and
     * other handlers that process the same payload shape.
     */
    JOB_CREATE_SCHEMA: JOB_CREATE_SCHEMA

  };

}());
