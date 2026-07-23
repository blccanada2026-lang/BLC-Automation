// ============================================================
// WorkLogHandler.gs — BLC Nexus T6 Handlers
// src/06-handlers/WorkLogHandler.gs
//
// LOAD ORDER: T6. Loads after all T0–T5 files.
// DEPENDENCIES: Config (T0), Constants (T0), Identifiers (T0),
//               DAL (T1), RBAC (T2), Logger (T3),
//               ValidationEngine (T4), QueueProcessor (T5),
//               StateMachine (T6), WorkLogExclusion (T6)
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
// STATE GUARD: job must exist in VW and not be in a closed state.
// Closed states: INVOICED (terminal), VOIDED, CANCELLED.
// Work logs are accepted for any other state so designers can log
// retroactively after QC is submitted.
// ============================================================

var WorkLogHandler = (function () {

  // ============================================================
  // SECTION 1: PAYLOAD VALIDATION SCHEMA
  // ============================================================

  var WORK_LOG_SCHEMA = {
    job_number: {
      type:      'string',
      required:  true,
      maxLength: 200,
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
  // SECTION 1b: JOB NUMBER NORMALIZATION
  //
  // Portal work-log submissions have occasionally carried a
  // client/lot description suffix on job_number (e.g.
  // "2605-6039-A Mary's Landing Lot 9-16 OWF" instead of
  // "2605-6039-A"). Since VW_JOB_CURRENT_STATE never has a row
  // for the full descriptive string, those rows became orphans in
  // FACT_WORK_LOGS with no matching VW projection. Stripping the
  // suffix before the Step 4 existence check and before the write
  // keeps both aligned.
  // ============================================================

  /**
   * Strips a job_number down to the token before the first space
   * or underscore. No space/underscore present → returned unchanged.
   * @param {string} jobNumber
   * @returns {string}
   */
  function normalizeJobNumber_(jobNumber) {
    var s   = String(jobNumber || '').trim();
    var idx = s.search(/[ _]/);
    return idx === -1 ? s : s.substring(0, idx);
  }

  // ============================================================
  // SECTION 2: DUPLICATE DETECTION
  // ============================================================

  function buildIdempotencyKey_(queueId) {
    return Identifiers.buildIdempotencyKey('WORK_LOG', queueId);
  }

  // 2a — Queue-level idempotency (same queue_id redelivered)
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

  // 2b — Normalise work_date value to 'YYYY-MM-DD' for comparison
  function normWorkDate_(raw) {
    if (!raw) return '';
    if (raw instanceof Date) {
      if (isNaN(raw.getTime())) return '';
      var y = raw.getFullYear(), mo = raw.getMonth() + 1, d = raw.getDate();
      return y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (d < 10 ? '0' : '') + d;
    }
    var s   = String(raw).trim();
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
    var p = new Date(s);
    if (!isNaN(p.getTime())) {
      var py = p.getFullYear(), pm = p.getMonth() + 1, pd = p.getDate();
      return py + '-' + (pm < 10 ? '0' : '') + pm + '-' + (pd < 10 ? '0' : '') + pd;
    }
    return s;
  }

  // 2c — Read all FACT_WORK_LOGS rows for an actor in the current period
  function getActorPeriodLogs_(actorCode, periodId) {
    try {
      return DAL.readWhere(
        Config.TABLES.FACT_WORK_LOGS,
        { actor_code: actorCode },
        { periodId: periodId, callerModule: 'WorkLogHandler' }
      );
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return [];
      throw e;
    }
  }

  // 2d — Content-based duplicate: true if a WORK_LOG_SUBMITTED row already
  // exists with exact match on job_number + work_date + hours.
  // NOTE: if a prior submission was voided via WorkLogDedupFixer the original
  // WORK_LOG_SUBMITTED row still exists (FACT tables are append-only).
  // A legitimate resubmit after a void will be blocked and requires
  // staff to clear via the DAL audit trail.
  function isContentDuplicate_(actorLogs, jobNumber, workDate, hours) {
    for (var i = 0; i < actorLogs.length; i++) {
      var r = actorLogs[i];
      if (String(r.event_type || '') !== Constants.EVENT_TYPES.WORK_LOG_SUBMITTED) continue;
      if (String(r.job_number  || '').trim() !== jobNumber)    continue;
      if (parseFloat(r.hours)               !== hours)         continue;
      if (normWorkDate_(r.work_date)         !== workDate)      continue;
      return true;
    }
    return false;
  }

  // 2e — Net hours already logged by this actor on work_date in the current
  // period (excludes migration rows; includes void events so duplicates
  // already voided reduce the running total).
  function getDailyNetHours_(actorLogs, workDate) {
    var total = 0;
    for (var i = 0; i < actorLogs.length; i++) {
      var r = actorLogs[i];
      if (isMigratedWorkLog(r)) continue;
      if (normWorkDate_(r.work_date) !== workDate) continue;
      total += parseFloat(r.hours) || 0;
    }
    return Math.max(0, Math.round(total * 100) / 100);
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
  // Flow (R3: RBAC is the unconditional first statement — before
  // Logger.info, before JSON.parse, before anything else):
  //   1. Enforce WORK_LOG_SUBMIT permission
  //   2. Parse payload_json
  //   3. Validate payload
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
    // ── Step 1: Permission (R3 — the unconditional first statement,
    // before Logger.info, before JSON.parse, before anything else) ──
    RBAC.enforcePermission(actor, RBAC.ACTIONS.WORK_LOG_SUBMIT);

    var queueId = queueItem.queue_id || '(unknown)';

    Logger.info('WORK_LOG_START', {
      module:   'WorkLogHandler',
      message:  'Starting work log handler',
      queue_id: queueId
    });

    // ── Step 2: Parse ───────────────────────────────────────
    var rawPayload = queueItem.payload_json || '{}';
    var payload;
    try {
      payload = JSON.parse(rawPayload);
    } catch (e) {
      throw new Error('WorkLogHandler: invalid JSON in payload_json for queue_id "' + queueId + '": ' + e.message);
    }

    // ── Step 3: Validate ────────────────────────────────────
    var cleanPayload = ValidationEngine.validate(
      WORK_LOG_SCHEMA,
      payload,
      { module: 'WorkLogHandler', actor: actor }
    );

    var jobNumber = cleanPayload.job_number;

    // ── Step 3b: Normalize job_number before any lookup or write ──
    // Must run before Step 4 so the VW existence check and the
    // FACT_WORK_LOGS write both use the same, correct job_number.
    var normalizedJobNumber = normalizeJobNumber_(jobNumber);
    if (normalizedJobNumber !== jobNumber) {
      Logger.warn('WORK_LOG_JOB_NUMBER_NORMALIZED', {
        module:     'WorkLogHandler',
        message:    'job_number normalized before FACT_WORK_LOGS write',
        queue_id:   queueId,
        original:   jobNumber,
        normalized: normalizedJobNumber
      });
      jobNumber              = normalizedJobNumber;
      cleanPayload.job_number = normalizedJobNumber;
    }

    // ── Step 4: Job existence + closed-state guard ─────────
    var view = StateMachine.getJobView(jobNumber);
    if (!view) {
      throw new Error('WorkLogHandler: job "' + jobNumber + '" not found in VW_JOB_CURRENT_STATE.');
    }
    // Explicit set covers VOIDED/CANCELLED (not in Config.STATES transitions).
    // isTerminal fallback catches any future terminal state added to Config.
    var WL_CLOSED_STATES_ = { INVOICED: true, VOIDED: true, CANCELLED: true };
    if (WL_CLOSED_STATES_[view.current_state] || StateMachine.isTerminal(view.current_state)) {
      throw new Error(
        'Cannot log hours — job ' + jobNumber + ' is in ' + view.current_state + ' state.'
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

    // ── Step 5b: Cross-period idempotency (Rule A5 support) ──
    // The FACT scan above only covers the current period partition.
    // IdempotencyEngine persists keys in ScriptProperties, catching
    // retries that cross a period boundary or hit a different partition.
    if (!IdempotencyEngine.checkAndMark(idempotencyKey)) {
      Logger.warn('WORK_LOG_DUPLICATE_XPERIOD', {
        module:          'WorkLogHandler',
        message:         'Duplicate work log (cross-period idempotency) — skipping',
        queue_id:        queueId,
        job_number:      jobNumber,
        idempotency_key: idempotencyKey
      });
      return 'DUPLICATE';
    }

    // ── Step 5c: Content-based duplicate guard ──────────────
    var periodId  = Identifiers.generateCurrentPeriodId();
    var actorCode = String(actor.personCode || '');
    var actorLogs = getActorPeriodLogs_(actorCode, periodId);

    if (isContentDuplicate_(actorLogs, jobNumber, cleanPayload.work_date, cleanPayload.hours)) {
      Logger.warn('WORK_LOG_CONTENT_DUPLICATE', {
        module:     'WorkLogHandler',
        message:    'Content-based duplicate — skipping',
        actor_code: actorCode,
        job_number: jobNumber,
        work_date:  cleanPayload.work_date,
        hours:      cleanPayload.hours
      });
      return 'DUPLICATE_WORK_LOG';
    }

    // ── Step 5d: Daily hours cap ────────────────────────────
    var DAILY_HOURS_CAP = 16;
    var dailyTotal = getDailyNetHours_(actorLogs, cleanPayload.work_date);
    if (dailyTotal + cleanPayload.hours > DAILY_HOURS_CAP) {
      throw new Error(
        'Daily total would exceed 16 hours. Please verify. ' +
        '(Already logged: ' + dailyTotal + 'h, Submitting: ' + cleanPayload.hours + 'h)'
      );
    }

    // ── Step 6: Ensure FACT_WORK_LOGS partition ─────────────
    DAL.ensurePartition(Config.TABLES.FACT_WORK_LOGS, periodId, 'WorkLogHandler');

    // ── Step 7: Write WORK_LOG_SUBMITTED ────────────────────
    // On failure, release the idempotency mark so the queue retry
    // is NOT skipped (otherwise a transient write failure would
    // silently drop the work log).
    var eventRow = buildEvent_(cleanPayload, actor, periodId, idempotencyKey, rawPayload);
    try {
      DAL.appendRow(
        Config.TABLES.FACT_WORK_LOGS,
        eventRow,
        { callerModule: 'WorkLogHandler', periodId: periodId }
      );
    } catch (e) {
      IdempotencyEngine.clear(idempotencyKey);
      throw e;
    }

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
