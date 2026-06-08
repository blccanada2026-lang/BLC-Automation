// ============================================================
// QCHandler.gs — BLC Nexus T6 Handlers
// src/06-handlers/QCHandler.gs
//
// LOAD ORDER: T6. Loads after all T0–T5 files.
// DEPENDENCIES: Config (T0), Constants (T0), Identifiers (T0),
//               DAL (T1), RBAC (T2), Logger (T3),
//               ValidationEngine (T4), QueueProcessor (T5),
//               StateMachine (T6)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  Handles FORM_TYPE = 'QC_SUBMIT'                        ║
// ║  Three flows, detected from current job state:          ║
// ║                                                         ║
// ║  Flow A (Designer submits for review):                  ║
// ║    IN_PROGRESS → QC_REVIEW                              ║
// ║    qc_result not provided                               ║
// ║    Event: QC_SUBMITTED                                  ║
// ║                                                         ║
// ║  Flow B (QC reviewer processes result):                 ║
// ║    QC_REVIEW → COMPLETED_BILLABLE  (APPROVED)           ║
// ║    QC_REVIEW → MINOR_FIX           (MINOR_REWORK)       ║
// ║    QC_REVIEW → IN_PROGRESS         (MAJOR_REWORK)       ║
// ║    Events: QC_APPROVED | QC_MINOR_REWORK | QC_MAJOR_REWORK
// ║    MINOR increments minor_rework_count                  ║
// ║    MAJOR increments major_rework_count + rework_cycle   ║
// ║    Notifies designer + supervisor + PM on rework        ║
// ║                                                         ║
// ║  Flow C (Designer marks minor fix sent to client):      ║
// ║    MINOR_FIX → COMPLETED_BILLABLE  (CLIENT_SENT)        ║
// ║    Event: CLIENT_SENT                                   ║
// ║    Notifies supervisor + PM                             ║
// ╚══════════════════════════════════════════════════════════╝
//
// FACT_QC_EVENTS EVENT SCHEMA:
//   event_id, job_number, period_id, event_type, timestamp,
//   actor_code, actor_role, qc_result, rework_notes, notes,
//   idempotency_key, payload_json
//
// PAYLOAD SCHEMA:
//   job_number    string  required
//   qc_result     string  optional  'APPROVED' | 'MINOR_REWORK' | 'MAJOR_REWORK' | 'CLIENT_SENT'
//   notes         string  optional  max 500 chars
//   rework_notes  string  optional  max 500 chars (required if MINOR_REWORK or MAJOR_REWORK)
//
// PERMISSIONS:
//   Flow A: QC_SUBMIT  (designers submit their own jobs)
//   Flow B: QC_APPROVE or QC_REJECT (QC reviewers)
// ============================================================

var QCHandler = (function () {

  // ============================================================
  // SECTION 1: PAYLOAD SCHEMA
  // ============================================================

  var QC_SUBMIT_SCHEMA = {
    job_number: {
      type:      'string',
      required:  true,
      minLength: 7,
      maxLength: 20,
      pattern:   /^BLC-\d{5}$/,
      label:     'Job Number'
    },
    qc_result: {
      type:          'string',
      required:      false,
      allowedValues: ['APPROVED', 'MINOR_REWORK', 'MAJOR_REWORK', 'CLIENT_SENT'],
      label:         'QC Result'
    },
    notes: {
      type:      'string',
      required:  false,
      maxLength: 500,
      label:     'Notes'
    },
    rework_notes: {
      type:      'string',
      required:  false,
      maxLength: 500,
      label:     'Rework Notes'
    }
  };

  // ============================================================
  // SECTION 2: IDEMPOTENCY
  // ============================================================

  function buildIdempotencyKey_(queueId) {
    return Identifiers.buildIdempotencyKey('QC_SUBMIT', queueId);
  }

  function isDuplicate_(idempotencyKey) {
    try {
      var periodId = Identifiers.generateCurrentPeriodId();
      var existing = DAL.readWhere(
        Config.TABLES.FACT_QC_EVENTS,
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
   * @param {string} eventType   Constants.EVENT_TYPES value
   * @param {Object} payload     Validated payload
   * @param {Object} actor
   * @param {string} periodId
   * @param {string} idempotencyKey
   * @param {string} rawPayloadJson
   * @returns {Object}
   */
  function buildQCEvent_(eventType, payload, actor, periodId, idempotencyKey, rawPayloadJson) {
    return {
      event_id:        Identifiers.generateId(),
      job_number:      payload.job_number,
      period_id:       periodId,
      event_type:      eventType,
      timestamp:       new Date().toISOString(),
      actor_code:      actor.personCode       || '',
      actor_role:      actor.role             || '',
      qc_result:       payload.qc_result      || '',
      rework_notes:    payload.rework_notes   || '',
      notes:           payload.notes          || '',
      idempotency_key: idempotencyKey,
      payload_json:    rawPayloadJson         || ''
    };
  }

  // ============================================================
  // SECTION 4: FLOW HELPERS
  // ============================================================

  /**
   * Flow A: Designer submits job for QC review.
   * Transition: IN_PROGRESS → QC_REVIEW
   */
  function handleFlowA_(cleanPayload, view, actor, queueId, rawPayload) {
    var jobNumber = cleanPayload.job_number;

    RBAC.enforcePermission(actor, RBAC.ACTIONS.QC_SUBMIT);
    StateMachine.assertTransition(view.current_state, Config.STATES.QC_REVIEW, { jobNumber: jobNumber });

    var idempotencyKey = buildIdempotencyKey_(queueId);
    if (isDuplicate_(idempotencyKey)) {
      Logger.warn('QC_SUBMIT_DUPLICATE', { module: 'QCHandler', message: 'Duplicate QC submit — skipping', job_number: jobNumber });
      return 'DUPLICATE';
    }

    var periodId = Identifiers.generateCurrentPeriodId();
    DAL.ensurePartition(Config.TABLES.FACT_QC_EVENTS, periodId, 'QCHandler');

    var eventRow = buildQCEvent_(
      Constants.EVENT_TYPES.QC_SUBMITTED,
      cleanPayload, actor, periodId, idempotencyKey, rawPayload
    );
    DAL.appendRow(Config.TABLES.FACT_QC_EVENTS, eventRow, { callerModule: 'QCHandler', periodId: periodId });

    DAL.updateWhere(
      Config.TABLES.VW_JOB_CURRENT_STATE,
      { job_number: jobNumber },
      { current_state: Config.STATES.QC_REVIEW, prev_state: view.current_state, updated_at: eventRow.timestamp },
      { callerModule: 'QCHandler' }
    );

    Logger.info('QC_SUBMITTED', {
      module:     'QCHandler',
      message:    'Job submitted for QC review',
      target_id:  jobNumber,
      queue_id:   queueId,
      job_number: jobNumber,
      event_id:   eventRow.event_id
    });

    return jobNumber;
  }

  /**
   * Flow B: QC reviewer processes the result.
   * APPROVED:      QC_REVIEW → COMPLETED_BILLABLE
   * MINOR_REWORK:  QC_REVIEW → MINOR_FIX (designer fixes + sends direct to client)
   * MAJOR_REWORK:  QC_REVIEW → IN_PROGRESS (designer revises + re-submits to QC)
   */
  function handleFlowB_(cleanPayload, view, actor, queueId, rawPayload) {
    var jobNumber = cleanPayload.job_number;
    var qcResult  = cleanPayload.qc_result;

    if ((qcResult === 'MINOR_REWORK' || qcResult === 'MAJOR_REWORK') && !cleanPayload.rework_notes) {
      throw new Error('QCHandler: rework_notes is required when qc_result = "' + qcResult + '".');
    }

    RBAC.enforcePermission(actor, RBAC.ACTIONS.QC_APPROVE);

    var targetState, eventType;
    if (qcResult === 'APPROVED') {
      targetState = Config.STATES.COMPLETED_BILLABLE;
      eventType   = Constants.EVENT_TYPES.QC_APPROVED;
    } else if (qcResult === 'MINOR_REWORK') {
      targetState = Config.STATES.MINOR_FIX;
      eventType   = Constants.EVENT_TYPES.QC_MINOR_REWORK;
    } else {
      targetState = Config.STATES.IN_PROGRESS;
      eventType   = Constants.EVENT_TYPES.QC_MAJOR_REWORK;
    }

    StateMachine.assertTransition(view.current_state, targetState, { jobNumber: jobNumber });

    var idempotencyKey = buildIdempotencyKey_(queueId);
    if (isDuplicate_(idempotencyKey)) {
      Logger.warn('QC_REVIEW_DUPLICATE', { module: 'QCHandler', message: 'Duplicate QC review — skipping', job_number: jobNumber });
      return 'DUPLICATE';
    }

    var periodId = Identifiers.generateCurrentPeriodId();
    DAL.ensurePartition(Config.TABLES.FACT_QC_EVENTS, periodId, 'QCHandler');

    var eventRow = buildQCEvent_(eventType, cleanPayload, actor, periodId, idempotencyKey, rawPayload);
    DAL.appendRow(Config.TABLES.FACT_QC_EVENTS, eventRow, { callerModule: 'QCHandler', periodId: periodId });

    var vwUpdates = {
      current_state: targetState,
      prev_state:    view.current_state,
      updated_at:    eventRow.timestamp
    };
    if (qcResult === 'MINOR_REWORK') {
      vwUpdates.minor_rework_count = (parseInt(view.minor_rework_count || 0, 10) + 1);
    } else if (qcResult === 'MAJOR_REWORK') {
      vwUpdates.major_rework_count = (parseInt(view.major_rework_count || 0, 10) + 1);
      vwUpdates.rework_cycle       = (parseInt(view.rework_cycle       || 0, 10) + 1);
    }

    DAL.updateWhere(
      Config.TABLES.VW_JOB_CURRENT_STATE,
      { job_number: jobNumber },
      vwUpdates,
      { callerModule: 'QCHandler' }
    );

    // Notify designer + supervisor + PM on any rework
    if (qcResult === 'MINOR_REWORK' || qcResult === 'MAJOR_REWORK') {
      sendReworkNotification_(view, qcResult, cleanPayload.rework_notes || '', actor);
    }

    Logger.info(eventType, {
      module:      'QCHandler',
      message:     'QC review processed',
      target_id:   jobNumber,
      queue_id:    queueId,
      job_number:  jobNumber,
      qc_result:   qcResult,
      to_state:    targetState,
      event_id:    eventRow.event_id
    });

    return jobNumber;
  }

  /**
   * Flow C: Designer marks a minor-fix job as sent to client.
   * MINOR_FIX → COMPLETED_BILLABLE
   */
  function handleFlowC_(cleanPayload, view, actor, queueId, rawPayload) {
    var jobNumber = cleanPayload.job_number;

    RBAC.enforcePermission(actor, RBAC.ACTIONS.QC_SUBMIT);
    StateMachine.assertTransition(view.current_state, Config.STATES.COMPLETED_BILLABLE, { jobNumber: jobNumber });

    var idempotencyKey = buildIdempotencyKey_(queueId);
    if (isDuplicate_(idempotencyKey)) {
      Logger.warn('CLIENT_SENT_DUPLICATE', { module: 'QCHandler', message: 'Duplicate CLIENT_SENT — skipping', job_number: jobNumber });
      return 'DUPLICATE';
    }

    var periodId = Identifiers.generateCurrentPeriodId();
    DAL.ensurePartition(Config.TABLES.FACT_QC_EVENTS, periodId, 'QCHandler');

    var eventRow = buildQCEvent_(Constants.EVENT_TYPES.CLIENT_SENT, cleanPayload, actor, periodId, idempotencyKey, rawPayload);
    DAL.appendRow(Config.TABLES.FACT_QC_EVENTS, eventRow, { callerModule: 'QCHandler', periodId: periodId });

    DAL.updateWhere(
      Config.TABLES.VW_JOB_CURRENT_STATE,
      { job_number: jobNumber },
      { current_state: Config.STATES.COMPLETED_BILLABLE, prev_state: view.current_state, updated_at: eventRow.timestamp },
      { callerModule: 'QCHandler' }
    );

    sendClientSentNotification_(view, actor);

    Logger.info('CLIENT_SENT', {
      module:     'QCHandler',
      message:    'Designer marked job sent to client after minor fix',
      target_id:  jobNumber,
      queue_id:   queueId,
      job_number: jobNumber,
      event_id:   eventRow.event_id
    });

    return jobNumber;
  }

  // ── Notifications ─────────────────────────────────────────

  function lookupRoster_() {
    try {
      var rows = DAL.readAll('DIM_STAFF_ROSTER', { callerModule: 'QCHandler' });
      var map  = {};
      for (var i = 0; i < rows.length; i++) map[rows[i].person_code] = rows[i];
      return map;
    } catch (e) { return {}; }
  }

  function sendReworkNotification_(view, reworkType, reworkNotes, reviewerActor) {
    try {
      var roster     = lookupRoster_();
      var designer   = roster[String(view.allocated_to || '')];
      if (!designer || !designer.email) return;

      var supervisor = designer.supervisor_code ? roster[designer.supervisor_code] : null;
      var pm         = designer.pm_code         ? roster[designer.pm_code]         : null;

      var isMinor  = reworkType === 'MINOR_REWORK';
      var severity = isMinor ? 'Minor Error' : 'Major Error';
      var action   = isMinor
        ? 'Please fix the issue and mark the job as "Sent to Client" in the portal.'
        : 'Please revise the job and re-submit for QC review.';

      var subject = '[BLC QC] ' + severity + ' — ' + view.job_number;
      var body = 'Hi ' + (designer.name || designer.person_code) + ',\n\n'
        + 'Your job ' + view.job_number + ' was reviewed and returned with a ' + severity + '.\n\n'
        + 'Notes from reviewer:\n' + reworkNotes + '\n\n'
        + action + '\n\n'
        + 'Blue Lotus Consulting\n— BLC Nexus';

      var ccEmails = [];
      if (supervisor && supervisor.email) ccEmails.push(supervisor.email);
      if (pm && pm.email && ccEmails.indexOf(pm.email) === -1) ccEmails.push(pm.email);

      MailApp.sendEmail({ to: designer.email, cc: ccEmails.join(','), subject: subject, body: body, name: 'BLC Nexus' });
    } catch (e) {
      Logger.warn('QC_REWORK_NOTIFY_FAIL', { module: 'QCHandler', error: e.message });
    }
  }

  function sendClientSentNotification_(view, designerActor) {
    try {
      var roster   = lookupRoster_();
      var designer = roster[String(view.allocated_to || '')];
      if (!designer) return;

      var supervisor = designer.supervisor_code ? roster[designer.supervisor_code] : null;
      var pm         = designer.pm_code         ? roster[designer.pm_code]         : null;

      var toEmails = [];
      if (supervisor && supervisor.email) toEmails.push(supervisor.email);
      if (pm && pm.email && toEmails.indexOf(pm.email) === -1) toEmails.push(pm.email);
      if (toEmails.length === 0) return;

      var subject = '[BLC] Job Sent to Client — ' + view.job_number;
      var body = 'Hi,\n\n'
        + (designer.name || designer.person_code) + ' has fixed the minor error on job '
        + view.job_number + ' and marked it as sent directly to the client.\n\n'
        + 'The job is now marked as Completed Billable.\n\n'
        + 'Blue Lotus Consulting\n— BLC Nexus';

      MailApp.sendEmail({ to: toEmails.join(','), subject: subject, body: body, name: 'BLC Nexus' });
    } catch (e) {
      Logger.warn('CLIENT_SENT_NOTIFY_FAIL', { module: 'QCHandler', error: e.message });
    }
  }

  // ============================================================
  // SECTION 5: HANDLE — MAIN DISPATCHER
  // ============================================================

  /**
   * @param {Object} queueItem
   * @param {Object} actor
   * @returns {string}
   */
  function handle(queueItem, actor) {
    var queueId = queueItem.queue_id || '(unknown)';

    Logger.info('QC_SUBMIT_START', {
      module:   'QCHandler',
      message:  'Starting QC handler',
      queue_id: queueId
    });

    // ── Parse + Validate ────────────────────────────────────
    var rawPayload = queueItem.payload_json || '{}';
    var payload;
    try {
      payload = JSON.parse(rawPayload);
    } catch (e) {
      throw new Error('QCHandler: invalid JSON in payload_json: ' + e.message);
    }

    var cleanPayload = ValidationEngine.validate(
      QC_SUBMIT_SCHEMA, payload, { module: 'QCHandler', actor: actor }
    );
    var jobNumber = cleanPayload.job_number;

    // ── Look up job ─────────────────────────────────────────
    var view = StateMachine.getJobView(jobNumber);
    if (!view) {
      throw new Error('QCHandler: job "' + jobNumber + '" not found in VW_JOB_CURRENT_STATE.');
    }

    Logger.info('QC_JOB_FOUND', {
      module:        'QCHandler',
      message:       'Job found',
      job_number:    jobNumber,
      current_state: view.current_state,
      qc_result:     cleanPayload.qc_result || '(none — submit for review)'
    });

    // ── Route to correct flow ───────────────────────────────
    if (view.current_state === Config.STATES.IN_PROGRESS && !cleanPayload.qc_result) {
      return handleFlowA_(cleanPayload, view, actor, queueId, rawPayload);
    }

    if (view.current_state === Config.STATES.QC_REVIEW && cleanPayload.qc_result) {
      return handleFlowB_(cleanPayload, view, actor, queueId, rawPayload);
    }

    if (view.current_state === Config.STATES.MINOR_FIX && cleanPayload.qc_result === 'CLIENT_SENT') {
      return handleFlowC_(cleanPayload, view, actor, queueId, rawPayload);
    }

    throw new Error(
      'QCHandler: cannot process QC_SUBMIT for job "' + jobNumber +
      '" in state "' + view.current_state + '" with qc_result="' + (cleanPayload.qc_result || '') + '". ' +
      'Flow A: IN_PROGRESS + no qc_result. ' +
      'Flow B: QC_REVIEW + qc_result (APPROVED|MINOR_REWORK|MAJOR_REWORK). ' +
      'Flow C: MINOR_FIX + CLIENT_SENT.'
    );
  }

  // ── Self-registration ───────────────────────────────────────
  (function register_() {
    try {
      QueueProcessor.registerHandler(Config.FORM_TYPES.QC_SUBMIT, handle);
    } catch (e) {
      console.log('[QCHandler REGISTRATION FAILED] ' + e.message);
    }
  }());

  return {
    handle:           handle,
    QC_SUBMIT_SCHEMA: QC_SUBMIT_SCHEMA
  };

}());
