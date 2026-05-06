// ============================================================
// JobUpdateHandler.gs — BLC Nexus T6 Handlers
// src/06-handlers/JobUpdateHandler.gs
//
// LOAD ORDER: T6. Loads after all T0–T5 files.
// DEPENDENCIES: Config (T0), Constants (T0), Identifiers (T0),
//               DAL (T1), RBAC (T2), Logger (T3)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  Handles JOB_UPDATED events (direct call, no queue)     ║
// ║  Writes to FACT_JOB_EVENTS (append) and patches         ║
// ║  VW_JOB_CURRENT_STATE. Called by PortalData.editJob.    ║
// ║                                                         ║
// ║  PERMISSION REQUIRED: RBAC.ACTIONS.JOB_CREATE           ║
// ╚══════════════════════════════════════════════════════════╝
// ============================================================

var JobUpdateHandler = (function () {

  // ── Validation helpers ──────────────────────────────────────

  var ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function validateChanges_(changes) {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
      throw new Error('JobUpdateHandler: changes must be a plain object.');
    }
    var ALLOWED = ['target_date', 'notes', 'client_job_ref'];
    var hasOne  = false;
    for (var i = 0; i < ALLOWED.length; i++) {
      if (changes.hasOwnProperty(ALLOWED[i])) { hasOne = true; break; }
    }
    if (!hasOne) throw new Error('JobUpdateHandler: changes must include at least one of target_date, notes, client_job_ref.');

    if (changes.hasOwnProperty('target_date') && changes.target_date) {
      if (!ISO_DATE_RE.test(changes.target_date)) {
        throw new Error('JobUpdateHandler: target_date must be YYYY-MM-DD, got: ' + changes.target_date);
      }
    }
    if (changes.hasOwnProperty('notes') && typeof changes.notes !== 'string') {
      throw new Error('JobUpdateHandler: notes must be a string.');
    }
    if (changes.hasOwnProperty('client_job_ref') && typeof changes.client_job_ref !== 'string') {
      throw new Error('JobUpdateHandler: client_job_ref must be a string.');
    }
  }

  // ── VW row loader ───────────────────────────────────────────

  function loadVwRow_(jobNumber) {
    var rows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: 'JobUpdateHandler' });
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].job_number || '') === jobNumber) return rows[i];
    }
    return null;
  }

  // ── Event row builder ───────────────────────────────────────

  function buildEventRow_(jobNumber, periodId, changes, vwRow, actor, idempotencyKey) {
    return {
      event_id:        Identifiers.generateId(),
      job_number:      jobNumber,
      period_id:       periodId,
      event_type:      Constants.EVENT_TYPES.JOB_UPDATED,
      timestamp:       new Date().toISOString(),
      actor_code:      actor.personCode || '',
      actor_role:      actor.role       || '',
      client_code:     vwRow.client_code   || '',
      job_type:        vwRow.job_type      || '',
      product_code:    vwRow.product_code  || '',
      quantity:        vwRow.quantity      || 0,
      client_job_ref:  changes.hasOwnProperty('client_job_ref') ? (changes.client_job_ref || '') : (vwRow.client_job_ref || ''),
      target_date:     changes.hasOwnProperty('target_date')    ? (changes.target_date    || '') : (vwRow.target_date    || ''),
      notes:           changes.hasOwnProperty('notes')          ? (changes.notes          || '') : (vwRow.notes          || ''),
      idempotency_key: idempotencyKey,
      payload_json:    JSON.stringify(changes)
    };
  }

  // ── Public API ──────────────────────────────────────────────

  /**
   * Updates mutable metadata on an existing job.
   * Appends a JOB_UPDATED event and patches VW_JOB_CURRENT_STATE.
   *
   * @param {string} email      Submitting user email
   * @param {string} jobNumber  e.g. 'BLC-00042'
   * @param {Object} changes    { target_date?, notes?, client_job_ref? }
   * @returns {{ ok: boolean, job_number: string }}
   */
  function handle(email, jobNumber, changes) {
    var actor = RBAC.resolveActor(email);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.JOB_CREATE);

    if (!jobNumber || typeof jobNumber !== 'string') {
      throw new Error('JobUpdateHandler: job_number is required.');
    }

    changes = changes || {};
    validateChanges_(changes);

    var vwRow = loadVwRow_(jobNumber);
    if (!vwRow) throw new Error('JobUpdateHandler: job not found: ' + jobNumber);
    if (vwRow.current_state === 'INVOICED') {
      throw new Error('JobUpdateHandler: INVOICED jobs cannot be edited.');
    }

    var periodId       = Identifiers.generateCurrentPeriodId();
    var idempotencyKey = 'JOB_UPDATE_' + jobNumber + '_' + Identifiers.generateId();

    var eventRow = buildEventRow_(jobNumber, periodId, changes, vwRow, actor, idempotencyKey);
    DAL.appendRow(Config.TABLES.FACT_JOB_EVENTS, eventRow, { callerModule: 'JobUpdateHandler' });

    var vwUpdate = { updated_at: new Date().toISOString() };
    if (changes.hasOwnProperty('target_date'))    vwUpdate.target_date    = changes.target_date    || '';
    if (changes.hasOwnProperty('notes'))          vwUpdate.notes          = changes.notes          || '';
    if (changes.hasOwnProperty('client_job_ref')) vwUpdate.client_job_ref = changes.client_job_ref || '';

    DAL.updateWhere(
      Config.TABLES.VW_JOB_CURRENT_STATE,
      { job_number: jobNumber },
      vwUpdate,
      { callerModule: 'JobUpdateHandler' }
    );

    Logger.info('JOB_UPDATED', {
      module: 'JobUpdateHandler', job_number: jobNumber,
      actor: email, changes: JSON.stringify(changes)
    });

    return { ok: true, job_number: jobNumber };
  }

  return { handle: handle };

})();
