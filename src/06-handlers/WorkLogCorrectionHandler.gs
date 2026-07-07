// ============================================================
// WorkLogCorrectionHandler.gs — BLC Nexus T6 Handlers
// src/06-handlers/WorkLogCorrectionHandler.gs
//
// LOAD ORDER: T6. Loads after all T0–T5 files (same tier as
// WorkLogHandler.gs — alphabetically after it).
// DEPENDENCIES: Config (T0), Constants (T0), Identifiers (T0),
//               DAL (T1), RBAC (T2), Logger (T3),
//               IdempotencyEngine (T3), ValidationEngine (T4),
//               QueueProcessor (T5), StateMachine (T6)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  Handles FORM_TYPE = 'WORK_LOG_AMEND' | 'WORK_LOG_VOID'  ║
// ║                    | 'WORK_LOG_REASSIGN'                 ║
// ║  Corrects existing FACT_WORK_LOGS entries via new         ║
// ║  amendment events (Rule A5 — FACT tables are append-only, ║
// ║  corrections are new events, never UPDATE/DELETE).        ║
// ╚══════════════════════════════════════════════════════════╝
//
// RBAC HIERARCHY (per CTO spec, 2026-07-07):
//   DESIGNER      — own entries only, open periods only
//   QC_REVIEWER   — own entries only, open periods only (same as DESIGNER)
//   TEAM_LEAD     — own + team members' entries, open periods only
//   PM            — any entry, any period (overrides period lock)
//   CEO / ADMIN   — any entry, any period (overrides period lock)
//   QC            — no correction authority
//   SYSTEM        — no correction authority (deliberate break from the
//                   "SYSTEM: true for all" invariant documented in
//                   RBAC.gs — flagged to CTO, implemented as specified)
//   CLIENT        — no correction authority
//
// QC vs QC_REVIEWER: RBAC.gs's PERMISSION_MATRIX['QC'] row must say
// true for WORK_LOG_AMEND/VOID (so the QC_REVIEWER alias — which
// canonicalizes to 'QC' — passes RBAC.enforcePermission()). This
// handler then reads the RAW actor.role string (pre-alias-resolution)
// to reject actual 'QC' actors and allow only 'QC_REVIEWER'. See the
// comment on checkCorrectionScope_ below.
//
// PERIOD-CLOSED GUARD (per CTO spec — both checked, payroll first):
//   Check 1: FACT_PAYROLL_LEDGER has a PAYROLL_CALCULATED event for
//            this actor_code + period_id → payroll-closed.
//   Check 2: The job's VW_JOB_CURRENT_STATE.current_state is
//            INVOICED, VOIDED, or CANCELLED → job-closed.
//   If either is true: only PM/CEO/ADMIN (RBAC.SCOPES.ALL) may
//   proceed. Everyone else is rejected with a message naming which
//   lock applies.
//
// NEGATIVE-HOURS GUARD: the proposed correction must not drive the
// net logged hours for (job_number, actor_code) within the entry's
// period below zero. Net = sum of hours across WORK_LOG_SUBMITTED +
// WORK_LOG_AMENDED (stores the delta) + WORK_LOG_VOIDED (stores a
// negative value) for that job+actor+period — same netting idiom as
// WorkLogHandler's getDailyNetHours_, scoped to job+actor+period
// instead of actor+date.
//
// NOTE ON amendment_of: FACT_WORK_LOGS' header (SetupScript.gs) does
// NOT have an amendment_of column — DAL silently drops unknown
// fields on write. Like WorkLogPeriodFixer.gs, the reference back to
// the original event is embedded in the notes field, not a real FK
// column.
// ============================================================

var WorkLogCorrectionHandler = (function () {

  var MODULE = 'WorkLogCorrectionHandler';

  // ============================================================
  // SECTION 1: PAYLOAD VALIDATION SCHEMAS
  // ============================================================

  var REASON_FIELD = {
    type:      'string',
    required:  true,
    minLength: 3,
    maxLength: 500,
    label:     'Reason'
  };

  var WORK_DATE_FIELD = {
    type:      'string',
    required:  true,
    minLength: 10,
    maxLength: 10,
    pattern:   /^\d{4}-\d{2}-\d{2}$/,
    label:     'Work Date (YYYY-MM-DD)'
  };

  var AMEND_SCHEMA = {
    actor_code:     { type: 'string', required: true, maxLength: 30,  label: 'Actor Code' },
    job_number:     { type: 'string', required: true, maxLength: 200, label: 'Job Number' },
    work_date:      WORK_DATE_FIELD,
    original_hours: { type: 'number', required: true, min: 0.25, max: 24, label: 'Original Hours' },
    new_hours:      { type: 'number', required: true, min: 0,    max: 24, label: 'New Hours' },
    reason:         REASON_FIELD
  };

  var VOID_SCHEMA = {
    actor_code: { type: 'string', required: true, maxLength: 30,  label: 'Actor Code' },
    job_number: { type: 'string', required: true, maxLength: 200, label: 'Job Number' },
    work_date:  WORK_DATE_FIELD,
    hours:      { type: 'number', required: true, min: 0.25, max: 24, label: 'Hours' },
    reason:     REASON_FIELD
  };

  var REASSIGN_SCHEMA = {
    actor_code:     { type: 'string', required: true, maxLength: 30,  label: 'Actor Code' },
    job_number:     { type: 'string', required: true, maxLength: 200, label: 'Job Number' },
    work_date:      WORK_DATE_FIELD,
    hours:          { type: 'number', required: true, min: 0.25, max: 24, label: 'Hours' },
    new_job_number: { type: 'string', required: true, maxLength: 200, label: 'New Job Number' },
    reason:         REASON_FIELD
  };

  // ============================================================
  // SECTION 2: SHARED HELPERS
  // ============================================================

  // Normalises a person/actor code for comparison. DAL.readWhere does an
  // exact string match — FACT_WORK_LOGS.actor_code has historically been
  // stored with inconsistent casing (same root cause as the ABR bug fixed
  // in PortalData.getMyHours: "actor_code comparison made case-insensitive").
  // Every actor_code/person_code comparison in this file reads broadly
  // (drops the code from the DAL condition) and filters manually via this
  // normaliser on both sides, instead of trusting readWhere's exact match.
  function normCode_(raw) {
    return String(raw || '').trim().toUpperCase();
  }

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

  /**
   * WorkLogHandler stamps period_id from the SUBMISSION-time period
   * (Identifiers.generateCurrentPeriodId()), not from work_date — the
   * header comment on WorkLogHandler.gs explicitly allows retroactive
   * logging ("designers can log retroactively after QC is submitted").
   * So an entry with work_date in June may live in the July partition.
   * A correction only knows work_date, not the original submission
   * period — build the list of candidate partitions to scan: every
   * month from work_date's own month through the current period
   * (submission can never predate the work itself). Capped at 36
   * months as a runaway-input safety bound.
   */
  function candidatePeriodIds_(workDate) {
    var m = String(workDate || '').match(/^(\d{4})-(\d{2})/);
    var current = Identifiers.generateCurrentPeriodId();
    if (!m) return [current];

    var y = parseInt(m[1], 10), mo = parseInt(m[2], 10);
    var cm = current.match(/^(\d{4})-(\d{2})/);
    var cy = parseInt(cm[1], 10), cmo = parseInt(cm[2], 10);

    var periods = [];
    while ((y < cy || (y === cy && mo <= cmo)) && periods.length < 36) {
      periods.push(y + '-' + (mo < 10 ? '0' : '') + mo);
      mo++;
      if (mo > 12) { mo = 1; y++; }
    }
    if (periods.length === 0) periods.push(current); // work_date is in the future — fall back
    return periods;
  }

  /**
   * Locates the single WORK_LOG_SUBMITTED row matching actor+job+date(+hours),
   * scanning candidate partitions (see candidatePeriodIds_). Throws if zero
   * or more than one match is found — corrections must target an
   * unambiguous original entry.
   *
   * @returns {{ row: Object, periodId: string }}  the matched row and the
   *   partition it actually lives in (NOT necessarily work_date's own month)
   */
  function findOriginalEntry_(actorCode, jobNumber, workDate, expectedHours) {
    var normDate   = normWorkDate_(workDate);
    var normActor  = normCode_(actorCode);
    var candidates = candidatePeriodIds_(workDate);
    var matches    = []; // { row, periodId }

    for (var c = 0; c < candidates.length; c++) {
      var pid  = candidates[c];
      var rows;
      try {
        // actor_code deliberately NOT in the DAL condition — readWhere is an
        // exact match and stored casing is inconsistent (see normCode_).
        rows = DAL.readWhere(
          Config.TABLES.FACT_WORK_LOGS,
          { job_number: jobNumber },
          { periodId: pid, callerModule: MODULE }
        );
      } catch (e) {
        if (e.code === 'SHEET_NOT_FOUND') continue;
        throw e;
      }

      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (normCode_(r.actor_code) !== normActor) continue;
        if (String(r.event_type || '') !== Constants.EVENT_TYPES.WORK_LOG_SUBMITTED) continue;
        if (normWorkDate_(r.work_date) !== normDate) continue;
        if (expectedHours != null && parseFloat(r.hours) !== expectedHours) continue;
        matches.push({ row: r, periodId: pid });
      }
    }

    if (matches.length === 0) {
      throw new Error(
        'WorkLogCorrectionHandler: no matching WORK_LOG_SUBMITTED entry found for ' +
        'actor_code=' + actorCode + ' job_number=' + jobNumber + ' work_date=' + workDate +
        (expectedHours != null ? ' hours=' + expectedHours : '') + '.'
      );
    }
    if (matches.length > 1) {
      throw new Error(
        'WorkLogCorrectionHandler: ambiguous — ' + matches.length + ' matching entries found for ' +
        'actor_code=' + actorCode + ' job_number=' + jobNumber + ' work_date=' + workDate + '.'
      );
    }
    return matches[0];
  }

  /**
   * Net hours currently logged by actorCode against jobNumber within
   * periodId — sums WORK_LOG_SUBMITTED (positive), WORK_LOG_AMENDED
   * (stores the delta), and WORK_LOG_VOIDED (stores a negative value).
   */
  function netJobHours_(actorCode, jobNumber, periodId) {
    var normActor = normCode_(actorCode);
    var rows;
    try {
      // actor_code deliberately NOT in the DAL condition — see normCode_.
      rows = DAL.readWhere(
        Config.TABLES.FACT_WORK_LOGS,
        { job_number: jobNumber },
        { periodId: periodId, callerModule: MODULE }
      );
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return 0;
      throw e;
    }

    var NETTED = {};
    NETTED[Constants.EVENT_TYPES.WORK_LOG_SUBMITTED] = true;
    NETTED[Constants.EVENT_TYPES.WORK_LOG_AMENDED]   = true;
    NETTED[Constants.EVENT_TYPES.WORK_LOG_VOIDED]    = true;

    var total = 0;
    for (var i = 0; i < rows.length; i++) {
      if (normCode_(rows[i].actor_code) !== normActor) continue;
      if (!NETTED[String(rows[i].event_type || '')]) continue;
      total += parseFloat(rows[i].hours) || 0;
    }
    return Math.round(total * 100) / 100;
  }

  /**
   * Check 1 (payroll) then Check 2 (job state) — payroll first, per spec.
   * @returns {{ closed: boolean, reason: string, message: string }}
   */
  function checkPeriodClosed_(actorCode, periodId, jobNumber) {
    var normActor = normCode_(actorCode);
    // ── Check 1: payroll already calculated for this actor+period ──
    try {
      // person_code deliberately NOT in the DAL condition — see normCode_.
      var payrollRows = DAL.readWhere(
        Config.TABLES.FACT_PAYROLL_LEDGER,
        { event_type: 'PAYROLL_CALCULATED' },
        { periodId: periodId, callerModule: MODULE }
      );
      payrollRows = payrollRows.filter(function(r) { return normCode_(r.person_code) === normActor; });
      if (payrollRows.length > 0) {
        return {
          closed:  true,
          reason:  'PAYROLL_CLOSED',
          message: 'Payroll has already been calculated for ' + actorCode +
                    ' in period ' + periodId + ' — period is locked.'
        };
      }
    } catch (e) {
      if (e.code !== 'SHEET_NOT_FOUND') throw e;
    }

    // ── Check 2: job itself is closed ───────────────────────────────
    var view = StateMachine.getJobView(jobNumber);
    var JOB_CLOSED_STATES_ = { INVOICED: true, VOIDED: true, CANCELLED: true };
    if (view && (JOB_CLOSED_STATES_[view.current_state] || StateMachine.isTerminal(view.current_state))) {
      return {
        closed:  true,
        reason:  'JOB_CLOSED',
        message: 'Job ' + jobNumber + ' is in ' + view.current_state + ' state — job is locked.'
      };
    }

    return { closed: false, reason: null, message: null };
  }

  /**
   * Row-level scope check — who may correct WHOSE entry.
   *
   * Raw actor.role (pre-alias-resolution) special case: 'QC' has no
   * correction authority at all, even though RBAC.PERMISSION_MATRIX['QC']
   * (the canonical row both 'QC' and 'QC_REVIEWER' resolve to) must say
   * true so 'QC_REVIEWER' can pass RBAC.enforcePermission(). This
   * function is what actually enforces the QC vs QC_REVIEWER split.
   *
   * @throws {Error}  if the actor is not allowed to correct targetActorCode's entry
   * @returns {boolean}  true if the actor has ALL-scope (may override period lock)
   */
  function checkCorrectionScope_(actor, targetActorCode) {
    if (actor.role === 'QC') {
      throw new Error(
        'WorkLogCorrectionHandler: role "QC" has no correction authority. ' +
        '(QC_REVIEWER may correct their own entries; plain QC may not.)'
      );
    }

    var scope  = RBAC.getScopeForRole(actor.role);
    var target = String(targetActorCode || '').trim().toUpperCase();
    var self   = String(actor.personCode || '').trim().toUpperCase();

    if (scope === RBAC.SCOPES.ALL) return true; // PM, CEO, ADMIN — any entry, overrides period lock

    if (scope === RBAC.SCOPES.TEAM) { // TEAM_LEAD — allowed, but does NOT override period lock
      if (target === self) return false; // TL correcting own entry
      var team = RBAC.buildTeamCodes(actor.personCode);
      if (team[target] === true) return false;
      throw new Error(
        'WorkLogCorrectionHandler: "' + (actor.displayName || actor.email) + '" may only correct ' +
        'their own or their team\'s entries. actor_code "' + targetActorCode + '" is not on their team.'
      );
    }

    // SELF scope — DESIGNER, QC_REVIEWER (canonical QC, raw role != 'QC') — no override
    if (target === self) return false;
    throw new Error(
      'WorkLogCorrectionHandler: "' + (actor.displayName || actor.email) + '" may only correct ' +
      'their own entries. actor_code "' + targetActorCode + '" belongs to someone else.'
    );
  }

  /**
   * Combines the period-closed guard with the ALL-scope override.
   * @throws {Error} if the period is closed and the actor does not have ALL scope
   */
  function enforcePeriodNotClosed_(actor, hasAllScope, actorCode, periodId, jobNumber) {
    var status = checkPeriodClosed_(actorCode, periodId, jobNumber);
    if (!status.closed) return;
    if (hasAllScope) {
      Logger.warn('WORK_LOG_CORRECTION_LOCK_OVERRIDDEN', {
        module: MODULE, actor: actor.personCode, reason: status.reason,
        actor_code: actorCode, period_id: periodId, job_number: jobNumber
      });
      return; // PM/CEO/ADMIN override
    }
    throw new Error('WorkLogCorrectionHandler: ' + status.message);
  }

  // ============================================================
  // SECTION 3: WORK_LOG_AMEND
  // ============================================================

  /**
   * @param {Object} queueItem
   * @param {Object} actor
   * @returns {string}  event_id of the WORK_LOG_AMENDED event
   */
  function handleAmend(queueItem, actor) {
    // ── Step 1: Permission (R3 — the unconditional first statement) ──
    RBAC.enforcePermission(actor, RBAC.ACTIONS.WORK_LOG_AMEND);

    var queueId = queueItem.queue_id || '(unknown)';

    // ── Step 2: Parse ────────────────────────────────────────────
    var rawPayload = queueItem.payload_json || '{}';
    var payload;
    try {
      payload = JSON.parse(rawPayload);
    } catch (e) {
      throw new Error('WorkLogCorrectionHandler: invalid JSON in payload_json for queue_id "' + queueId + '": ' + e.message);
    }

    // ── Step 3: Validate ─────────────────────────────────────────
    var p = ValidationEngine.validate(AMEND_SCHEMA, payload, { module: MODULE, actor: actor });

    // ── Step 4: Row-level scope check ───────────────────────────
    var hasAllScope = checkCorrectionScope_(actor, p.actor_code);

    // ── Step 5: Locate the original entry (discovers its real partition —
    // may differ from work_date's own month; see candidatePeriodIds_) ────
    var found     = findOriginalEntry_(p.actor_code, p.job_number, p.work_date, p.original_hours);
    var original  = found.row;
    var periodId  = found.periodId;

    // ── Step 6: Period-closed guard ─────────────────────────────
    enforcePeriodNotClosed_(actor, hasAllScope, p.actor_code, periodId, p.job_number);

    // ── Step 7: Negative-hours guard ────────────────────────────
    var delta      = p.new_hours - p.original_hours;
    var currentNet = netJobHours_(p.actor_code, p.job_number, periodId);
    if (currentNet + delta < 0) {
      throw new Error(
        'WorkLogCorrectionHandler: amendment would drive net hours for job ' + p.job_number +
        ' / actor ' + p.actor_code + ' below zero (current net: ' + currentNet + 'h, delta: ' + delta + 'h).'
      );
    }

    // ── Step 8: Idempotency ──────────────────────────────────────
    var idempotencyKey = 'WL_AMEND_' + queueId;
    if (!IdempotencyEngine.checkAndMark(idempotencyKey)) {
      Logger.warn('WORK_LOG_AMEND_DUPLICATE', { module: MODULE, queue_id: queueId });
      return 'DUPLICATE';
    }

    // ── Step 9: Write WORK_LOG_AMENDED ──────────────────────────
    DAL.ensurePartition(Config.TABLES.FACT_WORK_LOGS, periodId, MODULE);

    var eventRow = {
      event_id:        Identifiers.generateId(),
      job_number:       p.job_number,
      period_id:        periodId,
      event_type:       Constants.EVENT_TYPES.WORK_LOG_AMENDED,
      timestamp:        new Date().toISOString(),
      actor_code:       p.actor_code,          // whose entry this amendment corrects
      actor_role:       actor.role,            // who performed the correction is in notes
      hours:            delta,
      work_date:        p.work_date,
      notes:            'Amendment of event_id ' + original.event_id + '. ' +
                         p.original_hours + 'h -> ' + p.new_hours + 'h. ' +
                         'Corrected by ' + (actor.displayName || actor.email) + ' (' + actor.role + '). ' +
                         'Reason: ' + p.reason,
      idempotency_key:  idempotencyKey,
      payload_json:     rawPayload
    };

    try {
      DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, eventRow, { callerModule: MODULE, periodId: periodId });
    } catch (e) {
      IdempotencyEngine.clear(idempotencyKey);
      throw e;
    }

    Logger.info('WORK_LOG_AMENDED', {
      module: MODULE, target_id: eventRow.event_id, queue_id: queueId,
      job_number: p.job_number, actor_code: p.actor_code, delta: delta,
      corrected_by: actor.personCode
    });

    return eventRow.event_id;
  }

  // ============================================================
  // SECTION 4: WORK_LOG_VOID
  // ============================================================

  /**
   * @param {Object} queueItem
   * @param {Object} actor
   * @returns {string}  event_id of the WORK_LOG_VOIDED event
   */
  function handleVoid(queueItem, actor) {
    // ── Step 1: Permission (R3 — the unconditional first statement) ──
    RBAC.enforcePermission(actor, RBAC.ACTIONS.WORK_LOG_VOID);

    var queueId = queueItem.queue_id || '(unknown)';

    // ── Step 2: Parse ────────────────────────────────────────────
    var rawPayload = queueItem.payload_json || '{}';
    var payload;
    try {
      payload = JSON.parse(rawPayload);
    } catch (e) {
      throw new Error('WorkLogCorrectionHandler: invalid JSON in payload_json for queue_id "' + queueId + '": ' + e.message);
    }

    // ── Step 3: Validate ─────────────────────────────────────────
    var p = ValidationEngine.validate(VOID_SCHEMA, payload, { module: MODULE, actor: actor });

    // ── Step 4: Row-level scope check ───────────────────────────
    var hasAllScope = checkCorrectionScope_(actor, p.actor_code);

    // ── Step 5: Locate the original entry (discovers its real partition) ──
    var found     = findOriginalEntry_(p.actor_code, p.job_number, p.work_date, p.hours);
    var original  = found.row;
    var periodId  = found.periodId;

    // ── Step 6: Period-closed guard ─────────────────────────────
    enforcePeriodNotClosed_(actor, hasAllScope, p.actor_code, periodId, p.job_number);

    // ── Step 7: Negative-hours guard ────────────────────────────
    var currentNet = netJobHours_(p.actor_code, p.job_number, periodId);
    if (currentNet - p.hours < 0) {
      throw new Error(
        'WorkLogCorrectionHandler: void would drive net hours for job ' + p.job_number +
        ' / actor ' + p.actor_code + ' below zero (current net: ' + currentNet + 'h, voiding: ' + p.hours + 'h).'
      );
    }

    // ── Step 8: Idempotency ──────────────────────────────────────
    var idempotencyKey = 'WL_VOID_' + queueId;
    if (!IdempotencyEngine.checkAndMark(idempotencyKey)) {
      Logger.warn('WORK_LOG_VOID_DUPLICATE', { module: MODULE, queue_id: queueId });
      return 'DUPLICATE';
    }

    // ── Step 9: Write WORK_LOG_VOIDED ───────────────────────────
    DAL.ensurePartition(Config.TABLES.FACT_WORK_LOGS, periodId, MODULE);

    var eventRow = {
      event_id:        Identifiers.generateId(),
      job_number:       p.job_number,
      period_id:        periodId,
      event_type:       Constants.EVENT_TYPES.WORK_LOG_VOIDED,
      timestamp:        new Date().toISOString(),
      actor_code:       p.actor_code,
      actor_role:       actor.role,
      hours:            -p.hours,
      work_date:        p.work_date,
      notes:            'Void of event_id ' + original.event_id + '. ' +
                         '-' + p.hours + 'h. ' +
                         'Voided by ' + (actor.displayName || actor.email) + ' (' + actor.role + '). ' +
                         'Reason: ' + p.reason,
      idempotency_key:  idempotencyKey,
      payload_json:     rawPayload
    };

    try {
      DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, eventRow, { callerModule: MODULE, periodId: periodId });
    } catch (e) {
      IdempotencyEngine.clear(idempotencyKey);
      throw e;
    }

    Logger.info('WORK_LOG_VOIDED', {
      module: MODULE, target_id: eventRow.event_id, queue_id: queueId,
      job_number: p.job_number, actor_code: p.actor_code, hours: -p.hours,
      voided_by: actor.personCode
    });

    return eventRow.event_id;
  }

  // ============================================================
  // SECTION 5: WORK_LOG_REASSIGN
  // ============================================================

  /**
   * Voids the original entry and creates a new WORK_LOG_SUBMITTED
   * against new_job_number. TEAM_LEAD, PM, CEO, ADMIN only.
   * Both writes share one idempotency key — a retry cannot void
   * twice or double-create the new entry.
   *
   * @param {Object} queueItem
   * @param {Object} actor
   * @returns {{ voidEventId: string, newEventId: string }}
   */
  function handleReassign(queueItem, actor) {
    // ── Step 1: Permission (R3 — the unconditional first statement) ──
    RBAC.enforcePermission(actor, RBAC.ACTIONS.WORK_LOG_REASSIGN);

    var queueId = queueItem.queue_id || '(unknown)';

    // ── Step 2: Parse ────────────────────────────────────────────
    var rawPayload = queueItem.payload_json || '{}';
    var payload;
    try {
      payload = JSON.parse(rawPayload);
    } catch (e) {
      throw new Error('WorkLogCorrectionHandler: invalid JSON in payload_json for queue_id "' + queueId + '": ' + e.message);
    }

    // ── Step 3: Validate ─────────────────────────────────────────
    var p = ValidationEngine.validate(REASSIGN_SCHEMA, payload, { module: MODULE, actor: actor });

    // ── Step 4: Row-level scope check ───────────────────────────
    var hasAllScope = checkCorrectionScope_(actor, p.actor_code);

    // ── Step 5: Locate the original entry (discovers its real partition) ──
    var found        = findOriginalEntry_(p.actor_code, p.job_number, p.work_date, p.hours);
    var original     = found.row;
    var periodId      = found.periodId;      // partition of the ORIGINAL entry — the void event goes here
    var newPeriodId   = Identifiers.generateCurrentPeriodId(); // the new entry is a fresh submission, stamped NOW — matches WorkLogHandler's own convention

    // ── Step 6: Period-closed guard (on the ORIGINAL job) ───────
    enforcePeriodNotClosed_(actor, hasAllScope, p.actor_code, periodId, p.job_number);

    // ── Step 7: New job must exist and not be closed ────────────
    var newView = StateMachine.getJobView(p.new_job_number);
    if (!newView) {
      throw new Error('WorkLogCorrectionHandler: new_job_number "' + p.new_job_number + '" not found in VW_JOB_CURRENT_STATE.');
    }
    var JOB_CLOSED_STATES_ = { INVOICED: true, VOIDED: true, CANCELLED: true };
    if ((JOB_CLOSED_STATES_[newView.current_state] || StateMachine.isTerminal(newView.current_state)) && !hasAllScope) {
      throw new Error('WorkLogCorrectionHandler: cannot reassign hours onto job ' + p.new_job_number + ' — it is in ' + newView.current_state + ' state.');
    }

    // ── Step 8: Negative-hours guard (original job only) ───────
    var currentNet = netJobHours_(p.actor_code, p.job_number, periodId);
    if (currentNet - p.hours < 0) {
      throw new Error(
        'WorkLogCorrectionHandler: reassign would drive net hours for job ' + p.job_number +
        ' / actor ' + p.actor_code + ' below zero (current net: ' + currentNet + 'h, reassigning: ' + p.hours + 'h).'
      );
    }

    // ── Step 9: Idempotency — ONE key covers BOTH writes ─────────
    var idempotencyKey = 'WL_REASSIGN_' + queueId;
    if (!IdempotencyEngine.checkAndMark(idempotencyKey)) {
      Logger.warn('WORK_LOG_REASSIGN_DUPLICATE', { module: MODULE, queue_id: queueId });
      return 'DUPLICATE';
    }

    DAL.ensurePartition(Config.TABLES.FACT_WORK_LOGS, periodId, MODULE);
    if (newPeriodId !== periodId) {
      DAL.ensurePartition(Config.TABLES.FACT_WORK_LOGS, newPeriodId, MODULE);
    }

    var reasonNote = 'Reassigned by ' + (actor.displayName || actor.email) + ' (' + actor.role + '). Reason: ' + p.reason;

    var voidRow = {
      event_id:        Identifiers.generateId(),
      job_number:       p.job_number,
      period_id:        periodId,
      event_type:       Constants.EVENT_TYPES.WORK_LOG_VOIDED,
      timestamp:        new Date().toISOString(),
      actor_code:       p.actor_code,
      actor_role:       actor.role,
      hours:            -p.hours,
      work_date:        p.work_date,
      notes:            'Void of event_id ' + original.event_id + ' (reassigned to ' + p.new_job_number + '). ' +
                         '-' + p.hours + 'h. ' + reasonNote,
      idempotency_key:  idempotencyKey + '_VOID',
      payload_json:     rawPayload
    };

    var newRow = {
      event_id:        Identifiers.generateId(),
      job_number:       p.new_job_number,
      period_id:        newPeriodId,
      event_type:       Constants.EVENT_TYPES.WORK_LOG_SUBMITTED,
      timestamp:        new Date().toISOString(),
      actor_code:       p.actor_code,
      actor_role:       actor.role,
      hours:            p.hours,
      work_date:        p.work_date,
      notes:            'Reassigned from job ' + p.job_number + ' (original event_id ' + original.event_id + '). ' + reasonNote,
      idempotency_key:  idempotencyKey + '_NEW',
      payload_json:     rawPayload
    };

    try {
      DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, voidRow, { callerModule: MODULE, periodId: periodId });
      DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, newRow,  { callerModule: MODULE, periodId: newPeriodId });
    } catch (e) {
      IdempotencyEngine.clear(idempotencyKey);
      throw e;
    }

    Logger.info('WORK_LOG_REASSIGNED', {
      module: MODULE, queue_id: queueId, actor_code: p.actor_code,
      from_job: p.job_number, to_job: p.new_job_number, hours: p.hours,
      reassigned_by: actor.personCode
    });

    return { voidEventId: voidRow.event_id, newEventId: newRow.event_id };
  }

  // ── Self-registration ───────────────────────────────────────
  (function register_() {
    try {
      QueueProcessor.registerHandler(Config.FORM_TYPES.WORK_LOG_AMEND,    handleAmend);
      QueueProcessor.registerHandler(Config.FORM_TYPES.WORK_LOG_VOID,     handleVoid);
      QueueProcessor.registerHandler(Config.FORM_TYPES.WORK_LOG_REASSIGN, handleReassign);
    } catch (e) {
      console.log('[WorkLogCorrectionHandler REGISTRATION FAILED] ' + e.message);
    }
  }());

  return {
    handleAmend:      handleAmend,
    handleVoid:       handleVoid,
    handleReassign:   handleReassign,
    AMEND_SCHEMA:     AMEND_SCHEMA,
    VOID_SCHEMA:      VOID_SCHEMA,
    REASSIGN_SCHEMA:  REASSIGN_SCHEMA
  };

}());
