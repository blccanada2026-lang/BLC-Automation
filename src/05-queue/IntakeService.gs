// ============================================================
// IntakeService.gs — BLC Nexus T5 Queue
// src/05-queue/IntakeService.gs
//
// LOAD ORDER: T5, alongside QueueProcessor.gs.
// DEPENDENCIES: Config (T0), Constants (T0), Identifiers (T0),
//               DAL (T1), Logger (T3), ErrorHandler (T3),
//               ValidationEngine (T4)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  Front door of the system. Every form submission enters  ║
// ║  here and is written to STG_PROCESSING_QUEUE for async  ║
// ║  processing by QueueProcessor.                          ║
// ╚══════════════════════════════════════════════════════════╝
//
// Responsibilities:
//   1. Parse Google Form responses into structured payloads
//   2. Write raw submission to STG_RAW_INTAKE (audit trail)
//   3. Write structured item to STG_PROCESSING_QUEUE
//   4. Return intake_id for confirmation
//   5. Never lose a submission — STG_RAW_INTAKE is written first
//
// TRIGGER SETUP (run once via Triggers.gs):
//   The onFormSubmit function must be bound to a Google Form
//   onSubmit trigger. Each form used by BLC should have its
//   own trigger pointing to IntakeService.onFormSubmit.
//
// GOOGLE FORM QUESTION NAMING CONVENTION:
//   Form question titles must match the payload field names
//   expected by the target handler's validation schema.
//   Every BLC form must include a field named exactly:
//     form_type  →  value must match Config.FORM_TYPES
//                   e.g. 'JOB_CREATE', 'WORK_LOG', 'QC_SUBMIT'
//
//   Example JOB_CREATE form questions:
//     form_type    → 'JOB_CREATE'   (hidden/dropdown)
//     client_code  → 'NORSPAN'
//     job_type     → 'DESIGN'
//     product_code → 'Alpine-iCommand'
//     quantity     → 5
//     notes        → 'Rush order'
//
// PROGRAMMATIC INTAKE (testing / manual re-queue):
//   IntakeService.processSubmission({
//     formType:       'JOB_CREATE',
//     submitterEmail: 'raj@blc.ca',
//     payload:        { client_code: 'NORSPAN', job_type: 'DESIGN', quantity: 3 },
//     submissionId:   'manual-001'   // optional — generated if omitted
//   });
//
// DO NOT:
//   - Call SpreadsheetApp directly
//   - Resolve RBAC here — that happens in QueueProcessor
//   - Execute handlers here — this is intake only, not processing
// ============================================================

var IntakeService = (function () {

  // ============================================================
  // SECTION 1: FORM RESPONSE PARSER
  //
  // Converts a Google Forms FormResponse object into a plain
  // { key: value } payload object. The question title is used
  // as the key — form questions must be named to match the
  // handler's expected payload fields (see header convention).
  //
  // Handles all GAS form response item types:
  //   TEXT, PARAGRAPH_TEXT → string value
  //   MULTIPLE_CHOICE, LIST, DROPDOWN → string value
  //   CHECKBOX → comma-joined string of selected values
  //   SCALE, GRID → string representation
  //   DATE, DATETIME → ISO string
  // ============================================================

  /**
   * Parses a GAS FormResponse into a plain payload object.
   * Question title → key, response value → value.
   *
   * @param {FormResponse} formResponse  GAS FormResponse object
   * @returns {Object}  e.g. { form_type: 'JOB_CREATE', client_code: 'NORSPAN', ... }
   */
  function parseFormResponse_(formResponse) {
    var payload   = {};
    var responses = formResponse.getItemResponses();

    for (var i = 0; i < responses.length; i++) {
      var itemResponse = responses[i];
      var title        = itemResponse.getItem().getTitle();
      var rawValue     = itemResponse.getResponse();

      // Normalise key: trim whitespace only — form designers own naming
      var key = title ? title.trim() : ('field_' + i);

      // Normalise value
      var value;
      if (Array.isArray(rawValue)) {
        // Checkbox responses return an array (or array of arrays for grid)
        if (rawValue.length > 0 && Array.isArray(rawValue[0])) {
          // Grid response: [[row1col1, row1col2], ...]
          value = JSON.stringify(rawValue);
        } else {
          value = rawValue.join(', ');
        }
      } else if (rawValue instanceof Date) {
        value = rawValue.toISOString();
      } else {
        value = (rawValue !== null && rawValue !== undefined) ? String(rawValue) : '';
      }

      payload[key] = value;
    }

    // Also capture the submission timestamp and respondent email
    // if available — these augment the payload for audit purposes
    try {
      var ts = formResponse.getTimestamp();
      if (ts) payload.submitted_at = ts.toISOString();
    } catch (ignored) {}

    try {
      var email = formResponse.getRespondentEmail();
      if (email) payload.respondent_email = email;
    } catch (ignored) {}

    return payload;
  }

  // ============================================================
  // SECTION 2: STG_RAW_INTAKE WRITER
  //
  // Writes the raw submission record immediately on intake,
  // before any validation or queue write. This ensures no
  // submission is ever lost — even if queue write fails,
  // the raw record exists for manual recovery.
  // ============================================================

  /**
   * Writes a raw intake record to STG_RAW_INTAKE.
   * Returns the intake_id for cross-referencing.
   *
   * @param {string} formType       e.g. 'JOB_CREATE'
   * @param {string} submitterEmail
   * @param {string} rawJson        JSON.stringify of the raw payload
   * @param {string} source         'GOOGLE_FORM' | 'MANUAL' | 'API'
   * @returns {string}  intake_id
   */
  function writeRawIntake_(formType, submitterEmail, rawJson, source) {
    var intakeId = Identifiers.generatePrefixedId('INTK');
    var now      = new Date().toISOString();

    DAL.appendRow(
      Config.TABLES.STG_RAW_INTAKE,
      {
        intake_id:       intakeId,
        timestamp:       now,
        source:          source      || 'GOOGLE_FORM',
        form_type:       formType    || 'UNKNOWN',
        submitter_email: submitterEmail || '',
        raw_json:        rawJson     || '{}',
        status:          Constants.INTAKE_STATUSES.PENDING,
        processed_at:    ''
      },
      { callerModule: 'IntakeService' }
    );

    return intakeId;
  }

  // ============================================================
  // SECTION 3: STG_PROCESSING_QUEUE WRITER
  //
  // Writes the structured queue item that QueueProcessor picks up.
  // Payload is re-serialised from the validated clean object
  // so the queue always contains well-formed JSON.
  // ============================================================

  /**
   * Writes a queue item to STG_PROCESSING_QUEUE.
   * Returns the queue_id.
   *
   * @param {string} formType
   * @param {string} submitterEmail
   * @param {string} payloadJson   JSON string of the payload
   * @param {string} intakeId      Cross-reference to STG_RAW_INTAKE
   * @returns {string}  queue_id
   */
  function writeQueueItem_(formType, submitterEmail, payloadJson, intakeId) {
    var queueId = Identifiers.generatePrefixedId('QITM');
    var now     = new Date().toISOString();

    DAL.appendRow(
      Config.TABLES.STG_PROCESSING_QUEUE,
      {
        queue_id:        queueId,
        form_type:       formType        || 'UNKNOWN',
        submitter_email: submitterEmail  || '',
        status:          Constants.QUEUE_STATUSES.PENDING,
        attempt_count:   0,
        payload_json:    payloadJson     || '{}',
        error_message:   '',
        created_at:      now,
        updated_at:      now
      },
      { callerModule: 'IntakeService' }
    );

    // Flush ensures the queue write is committed to the Sheets server before
    // any immediate processQueue() call can read it in the same execution context.
    SpreadsheetApp.flush();

    return queueId;
  }

  // ============================================================
  // SECTION 4: CORE INTAKE PROCESSOR
  //
  // Shared logic called by both onFormSubmit() and
  // processSubmission(). Validates structure, writes both
  // tables, and returns a receipt object.
  // ============================================================

  /**
   * Processes a parsed payload through the full intake pipeline.
   * Writes STG_RAW_INTAKE first (fail-safe), then STG_PROCESSING_QUEUE.
   *
   * @param {string} formType
   * @param {string} submitterEmail
   * @param {Object} payload        Parsed payload object
   * @param {string} source         'GOOGLE_FORM' | 'MANUAL' | 'API'
   * @returns {{ ok: boolean, intakeId: string, queueId: string, formType: string }}
   */
  function intake_(formType, submitterEmail, payload, source) {
    var rawJson  = '';
    var intakeId = '';
    var queueId  = '';

    // Serialise payload for storage
    try {
      rawJson = JSON.stringify(payload);
    } catch (e) {
      rawJson = '{"_parseError":"payload could not be serialised"}';
    }

    // ── Step 1: Write raw intake (safety net — always first) ──
    try {
      intakeId = writeRawIntake_(formType, submitterEmail, rawJson, source);
      Logger.info('INTAKE_RAW_WRITTEN', {
        module:          'IntakeService',
        message:         'Raw intake record written',
        target_id:       intakeId,
        form_type:       formType,
        submitter_email: submitterEmail
      });
    } catch (e) {
      ErrorHandler.handle(e, {
        module:    'IntakeService',
        errorCode: 'INTAKE_RAW_WRITE_FAILED',
        severity:  Constants.SEVERITIES.CRITICAL,
        form_type: formType,
        email:     submitterEmail
      });
      // Cannot proceed without a raw intake record
      return { ok: false, intakeId: '', queueId: '', formType: formType };
    }

    // ── Step 2: Validate form_type is known ───────────────────
    var knownFormTypes = [];
    for (var k in Config.FORM_TYPES) {
      if (Config.FORM_TYPES.hasOwnProperty(k)) knownFormTypes.push(Config.FORM_TYPES[k]);
    }

    if (knownFormTypes.indexOf(formType) === -1) {
      var unknownMsg = 'Unknown form_type: "' + formType + '". ' +
                       'Valid types: ' + knownFormTypes.join(', ');
      Logger.error('INTAKE_UNKNOWN_FORM_TYPE', {
        module:    'IntakeService',
        message:   unknownMsg,
        intake_id: intakeId,
        form_type: formType
      });
      // Mark raw intake as failed
      try {
        DAL.updateWhere(
          Config.TABLES.STG_RAW_INTAKE,
          { intake_id: intakeId },
          { status: Constants.INTAKE_STATUSES.FAILED, processed_at: new Date().toISOString() },
          { callerModule: 'IntakeService' }
        );
      } catch (ignored) {}
      return { ok: false, intakeId: intakeId, queueId: '', formType: formType };
    }

    // ── Step 3: Write to processing queue ─────────────────────
    try {
      queueId = writeQueueItem_(formType, submitterEmail, rawJson, intakeId);
    } catch (e) {
      ErrorHandler.handle(e, {
        module:    'IntakeService',
        errorCode: 'INTAKE_QUEUE_WRITE_FAILED',
        severity:  Constants.SEVERITIES.ERROR,
        intake_id: intakeId,
        form_type: formType
      });
      // Mark raw intake as failed
      try {
        DAL.updateWhere(
          Config.TABLES.STG_RAW_INTAKE,
          { intake_id: intakeId },
          { status: Constants.INTAKE_STATUSES.FAILED, processed_at: new Date().toISOString() },
          { callerModule: 'IntakeService' }
        );
      } catch (ignored) {}
      return { ok: false, intakeId: intakeId, queueId: '', formType: formType };
    }

    // ── Step 4: Mark raw intake as queued ─────────────────────
    try {
      DAL.updateWhere(
        Config.TABLES.STG_RAW_INTAKE,
        { intake_id: intakeId },
        { status: Constants.INTAKE_STATUSES.QUEUED, processed_at: new Date().toISOString() },
        { callerModule: 'IntakeService' }
      );
    } catch (ignored) {}  // Non-fatal — queue item exists regardless

    Logger.info('INTAKE_QUEUED', {
      module:    'IntakeService',
      message:   'Submission queued for processing',
      target_id: queueId,
      intake_id: intakeId,
      queue_id:  queueId,
      form_type: formType
    });

    return { ok: true, intakeId: intakeId, queueId: queueId, formType: formType };
  }

  // ============================================================
  // SECTION 5: onFormSubmit — GOOGLE FORMS TRIGGER HANDLER
  //
  // Bound to a Google Form's onSubmit trigger via Triggers.gs.
  // GAS passes an event object with a `response` property.
  //
  // The form MUST include a question titled exactly "form_type"
  // whose value matches a Config.FORM_TYPES constant.
  // The submitter email is taken from the form response if
  // "Collect email addresses" is enabled, otherwise falls back
  // to Session.getActiveUser().getEmail().
  // ============================================================

  /**
   * Google Forms onSubmit trigger handler.
   * Bind this to each BLC Google Form via Triggers.gs.
   *
   * @param {Object} e  GAS form submit event object
   *   e.response — FormResponse
   *   e.source   — Form
   */
  function onFormSubmit(e) {
    HealthMonitor.startExecution('IntakeService');

    try {
      if (!e || !e.response) {
        Logger.error('INTAKE_NO_RESPONSE', {
          module:  'IntakeService',
          message: 'onFormSubmit called with no event response object'
        });
        return;
      }

      // Parse the form response into a payload object
      var payload = parseFormResponse_(e.response);

      // Extract routing key — form must include a 'form_type' question
      var formType = (payload.form_type || '').toString().trim().toUpperCase();
      if (!formType) {
        Logger.error('INTAKE_MISSING_FORM_TYPE', {
          module:  'IntakeService',
          message: 'Form response has no "form_type" field. ' +
                   'Add a question titled "form_type" to the form.'
        });
        return;
      }

      // Remove form_type from payload (it's routing metadata, not business data)
      delete payload.form_type;

      // Resolve submitter email
      var submitterEmail = '';
      try {
        submitterEmail = e.response.getRespondentEmail() || '';
      } catch (ignored) {}
      if (!submitterEmail) {
        try {
          submitterEmail = Session.getActiveUser().getEmail() || '';
        } catch (ignored) {}
      }

      intake_(formType, submitterEmail, payload, 'GOOGLE_FORM');

    } catch (err) {
      ErrorHandler.handle(err, {
        module:    'IntakeService',
        errorCode: 'INTAKE_UNHANDLED_ERROR',
        severity:  Constants.SEVERITIES.CRITICAL
      });
    } finally {
      HealthMonitor.endExecution();
    }
  }

  // ============================================================
  // SECTION 6: processSubmission — PROGRAMMATIC ENTRY POINT
  //
  // For manual intake, re-queuing, API submissions, and tests.
  // Does not parse a FormResponse — accepts a plain payload object
  // directly. All fields must be provided by the caller.
  // ============================================================

  /**
   * Programmatically submits a payload for processing.
   * Use for testing, manual re-queue, or non-form intake sources.
   *
   * @param {Object} options
   * @param {string} options.formType        Config.FORM_TYPES value
   * @param {string} options.submitterEmail  Email of the actor
   * @param {Object} options.payload         Plain object — handler's expected fields
   * @param {string} [options.source]        'MANUAL' | 'API' | 'REQUEUE' (default 'MANUAL')
   *
   * @returns {{ ok: boolean, intakeId: string, queueId: string, formType: string }}
   *
   * @example
   *   var result = IntakeService.processSubmission({
   *     formType:       'JOB_CREATE',
   *     submitterEmail: 'raj@blc.ca',
   *     payload: {
   *       client_code: 'NORSPAN',
   *       job_type:    'DESIGN',
   *       quantity:    3
   *     }
   *   });
   *   if (result.ok) {
   *     Logger.log('Queued as: ' + result.queueId);
   *   }
   */
  function processSubmission(options) {
    options = options || {};

    try {
      ValidationEngine.validateRequired(options, ['formType', 'submitterEmail', 'payload'], {
        module: 'IntakeService'
      });
    } catch (e) {
      ErrorHandler.handle(e, {
        module:    'IntakeService',
        errorCode: 'INTAKE_INVALID_OPTIONS',
        severity:  Constants.SEVERITIES.ERROR
      });
      return { ok: false, intakeId: '', queueId: '', formType: options.formType || '' };
    }

    var formType = options.formType.toString().trim().toUpperCase();
    var source   = options.source || 'MANUAL';

    return intake_(formType, options.submitterEmail, options.payload, source);
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  return {

    /**
     * Google Forms onSubmit trigger handler.
     * Bind to each BLC form via Triggers.gs.
     * @type {function(Object): void}
     */
    onFormSubmit: onFormSubmit,

    /**
     * Programmatic submission entry point.
     * Use for testing, manual re-queue, and non-form sources.
     * @type {function(Object): { ok: boolean, intakeId: string, queueId: string, formType: string }}
     */
    processSubmission: processSubmission

  };

}());

// ============================================================
// TOP-LEVEL TRIGGER WRAPPER
//
// GAS trigger functions must be top-level (not inside an object).
// This wrapper calls IntakeService.onFormSubmit and is the
// actual function registered as the form's onSubmit trigger.
// ============================================================

/**
 * Google Forms onSubmit trigger entry point.
 * Register THIS function as the form trigger in Triggers.gs —
 * not IntakeService.onFormSubmit directly.
 *
 * @param {Object} e  GAS form submit event
 */
function onIntakeFormSubmit(e) {
  IntakeService.onFormSubmit(e);
}
