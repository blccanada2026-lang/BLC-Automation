// ============================================================
// QCReassignHandler.gs — BLC Nexus T6 Handlers
// src/06-handlers/QCReassignHandler.gs
//
// LOAD ORDER: T6. Loads after all T0–T5 files.
// DEPENDENCIES: Config (T0), Constants (T0), Identifiers (T0),
//               DAL (T1), RBAC (T2), Logger (T3),
//               ValidationEngine (T4), QueueProcessor (T5),
//               StateMachine (T6)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  Handles FORM_TYPE = 'QC_REASSIGN'                      ║
// ║                                                         ║
// ║  Allows TL / PM / CEO to reassign a job that is in      ║
// ║  QC_REVIEW to a different reviewer, unblocking          ║
// ║  bottlenecks when the original reviewer is busy.        ║
// ║                                                         ║
// ║  Job state does not change — only qc_reviewer_code in   ║
// ║  VW_JOB_CURRENT_STATE is updated.                       ║
// ║                                                         ║
// ║  Permission: JOB_ALLOCATE (TL / PM / CEO)               ║
// ╚══════════════════════════════════════════════════════════╝
//
// FACT_QC_EVENTS EVENT SCHEMA (QC_REASSIGNED):
//   event_id, job_number, period_id, event_type, timestamp,
//   actor_code, actor_role, qc_result ('REASSIGNED'),
//   rework_notes (prev reviewer code), notes (new reviewer code),
//   idempotency_key, payload_json
//
// PAYLOAD SCHEMA:
//   job_number          string  required
//   new_reviewer_code   string  required  person_code of new reviewer
//   notes               string  optional  max 200 chars
// ============================================================

var QCReassignHandler = (function () {

  var MODULE = 'QCReassignHandler';

  // ── Schema ─────────────────────────────────────────────────

  var SCHEMA = {
    job_number: {
      type:      'string',
      required:  true,
      maxLength: 30,
      label:     'Job Number'
    },
    new_reviewer_code: {
      type:      'string',
      required:  true,
      minLength: 2,
      maxLength: 20,
      label:     'New Reviewer Code'
    },
    notes: {
      type:      'string',
      required:  false,
      maxLength: 200,
      label:     'Notes'
    }
  };

  // ── Idempotency ─────────────────────────────────────────────

  function isDuplicate_(key, periodId) {
    try {
      var rows = DAL.readWhere(
        Config.TABLES.FACT_QC_EVENTS,
        { idempotency_key: key },
        { periodId: periodId }
      );
      return rows.length > 0;
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return false;
      throw e;
    }
  }

  // ── Notification ────────────────────────────────────────────

  function sendNotification_(job, newReviewerCode, oldReviewerCode, notes) {
    try {
      var roster = DAL.readAll('DIM_STAFF_ROSTER', { callerModule: MODULE });
      var map    = {};
      for (var i = 0; i < roster.length; i++) map[roster[i].person_code] = roster[i];

      var newReviewer = map[newReviewerCode];
      var oldReviewer = oldReviewerCode ? map[oldReviewerCode] : null;
      if (!newReviewer || !newReviewer.email) return;

      var subject = '[BLC QC] Job Reassigned to You — ' + job.job_number;
      var body    = 'Hi ' + (newReviewer.name || newReviewerCode) + ',\n\n'
        + 'Job ' + job.job_number + ' has been reassigned to you for QC review.\n'
        + (notes ? '\nNote from assignor: ' + notes + '\n' : '')
        + '\nPlease review it in the BLC Portal when available.\n\n'
        + 'Blue Lotus Consulting\n— BLC Nexus';

      var cc = [];
      if (oldReviewer && oldReviewer.email && oldReviewer.email !== newReviewer.email) {
        cc.push(oldReviewer.email);
      }

      MailApp.sendEmail({ to: newReviewer.email, cc: cc.join(','), subject: subject, body: body, name: 'BLC Nexus' });
    } catch (e) {
      Logger.warn('QC_REASSIGN_NOTIFY_FAIL', { module: MODULE, error: e.message });
    }
  }

  // ── Handle ──────────────────────────────────────────────────

  function handle(queueItem, actor) {
    RBAC.enforcePermission(actor, RBAC.ACTIONS.JOB_ALLOCATE);

    var rawPayload = queueItem.payload_json || '{}';
    var payload;
    try { payload = JSON.parse(rawPayload); }
    catch (e) { throw new Error(MODULE + ': invalid JSON — ' + e.message); }

    var clean      = ValidationEngine.validate(SCHEMA, payload, { module: MODULE, actor: actor });
    var jobNumber  = clean.job_number;
    var newCode    = clean.new_reviewer_code;

    var view = StateMachine.getJobView(jobNumber);
    if (!view) throw new Error(MODULE + ': job "' + jobNumber + '" not found in VW_JOB_CURRENT_STATE.');

    if (view.current_state !== Config.STATES.QC_REVIEW) {
      throw new Error(MODULE + ': job "' + jobNumber + '" is in state "' + view.current_state
        + '" — QC_REASSIGN is only valid for QC_REVIEW jobs.');
    }

    var periodId       = Identifiers.generateCurrentPeriodId();
    var idempotencyKey = Identifiers.buildIdempotencyKey('QC_REASSIGN', queueItem.queue_id || '');

    if (isDuplicate_(idempotencyKey, periodId)) {
      Logger.warn('QC_REASSIGN_DUPLICATE', { module: MODULE, job_number: jobNumber });
      return 'DUPLICATE';
    }

    DAL.ensurePartition(Config.TABLES.FACT_QC_EVENTS, periodId, MODULE);

    var oldReviewerCode = String(view.qc_reviewer_code || '');

    var eventRow = {
      event_id:        Identifiers.generateId(),
      job_number:      jobNumber,
      period_id:       periodId,
      event_type:      Constants.EVENT_TYPES.QC_REASSIGNED,
      timestamp:       new Date().toISOString(),
      actor_code:      actor.personCode || '',
      actor_role:      actor.role       || '',
      qc_result:       'REASSIGNED',
      rework_notes:    oldReviewerCode,   // previous reviewer — for audit trail
      notes:           newCode,           // new reviewer code
      idempotency_key: idempotencyKey,
      payload_json:    rawPayload
    };

    DAL.appendRow(Config.TABLES.FACT_QC_EVENTS, eventRow, { callerModule: MODULE, periodId: periodId });

    DAL.updateWhere(
      Config.TABLES.VW_JOB_CURRENT_STATE,
      { job_number: jobNumber },
      { qc_reviewer_code: newCode, updated_at: eventRow.timestamp },
      { callerModule: MODULE }
    );

    sendNotification_(view, newCode, oldReviewerCode, clean.notes || '');

    Logger.info('QC_REASSIGNED', {
      module:        MODULE,
      job_number:    jobNumber,
      old_reviewer:  oldReviewerCode,
      new_reviewer:  newCode,
      actor:         actor.personCode
    });

    return jobNumber;
  }

  // ── Registration ────────────────────────────────────────────

  (function register_() {
    try {
      QueueProcessor.registerHandler(Config.FORM_TYPES.QC_REASSIGN, handle);
    } catch (e) {
      console.log('[QCReassignHandler REGISTRATION FAILED] ' + e.message);
    }
  }());

  return { handle: handle };

}());
