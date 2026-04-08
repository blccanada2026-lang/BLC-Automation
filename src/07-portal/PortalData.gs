// ============================================================
// PortalData.gs — BLC Nexus T7 Portal
// src/07-portal/PortalData.gs
//
// LOAD ORDER: T7 — loads before Portal.gs (alphabetical: Data < Portal).
// DEPENDENCIES: Config (T0), Identifiers (T0), DAL (T1), RBAC (T2), Logger (T3)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  Data layer for the BLC Job Portal.                     ║
// ║                                                         ║
// ║  getViewData(email) — resolves actor, loads jobs, stats ║
// ║  writeQueueItem(formType, payloadJson, email) — queues  ║
// ╚══════════════════════════════════════════════════════════╝
//
// SCOPE RULES:
//   DESIGNER / QC   → SELF: only jobs where allocated_to = email
//   TEAM_LEAD       → TEAM: all jobs (simplified — no team graph yet)
//   PM / CEO / ADMIN → ALL: all jobs in VW_JOB_CURRENT_STATE
//   CLIENT          → blocked at portal_getViewData() level
//
// NOTE: For DESIGNER scope, filtering is done in-process after a
//   full read of VW_JOB_CURRENT_STATE. When VW row counts grow,
//   DAL.readWhere with { allocated_to: email } is the right upgrade.
// ============================================================

var PortalData = (function () {

  // ============================================================
  // SECTION 1: getViewData
  // ============================================================

  /**
   * Resolves the current user's actor, loads their job list, computes
   * stats, and serialises the whole payload to a JSON string.
   *
   * Called by Portal.gs:portal_getViewData().
   *
   * @param {string} email  Active user email from Session.getActiveUser()
   * @returns {string}  JSON-encoded view data object
   */
  function getViewData(email) {
    // ── 1. Resolve actor ─────────────────────────────────────
    var actor;
    try {
      actor = RBAC.resolveActor(email);
    } catch (e) {
      // Unknown user — return a denied payload; the HTML renders an
      // "access denied" page. We never throw here so the page still loads.
      return JSON.stringify({
        actor:  { email: email || '', role: 'UNKNOWN', displayName: 'Unknown User', personCode: '' },
        jobs:   [],
        stats:  { total: 0, byState: {} },
        perms:  { canCreateJob: false, canViewAll: false, isQcReviewer: false, isDesigner: false }
      });
    }

    // ── 2. Load jobs (scope-filtered) ────────────────────────
    var jobs = loadJobs_(actor);

    // ── 3. Compute stats ─────────────────────────────────────
    var stats = buildStats_(jobs);

    // ── 4. Build permission flags for the UI ─────────────────
    var perms = buildPerms_(actor);

    // ── 5. Serialise and return ───────────────────────────────
    return JSON.stringify({
      actor: {
        email:       actor.email,
        personCode:  actor.personCode,
        role:        actor.role,
        displayName: actor.displayName,
        scope:       actor.scope
      },
      jobs:  jobs,
      stats: stats,
      perms: perms
    });
  }

  // ============================================================
  // SECTION 2: loadJobs_
  // ============================================================

  /**
   * Reads VW_JOB_CURRENT_STATE and applies scope filtering.
   *
   * @param {Object} actor  Resolved RBAC actor
   * @returns {Object[]}  Array of job view rows (plain objects)
   */
  function loadJobs_(actor) {
    var allRows;
    try {
      allRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: 'PortalData' });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return [];
      throw e;
    }

    if (!allRows || allRows.length === 0) return [];

    // Scope filter
    var role = actor.role;
    if (role === 'DESIGNER' || role === 'QC') {
      // SELF scope — only jobs assigned to this person
      allRows = allRows.filter(function (row) {
        return String(row.allocated_to || '').toLowerCase() === actor.email.toLowerCase();
      });
    }
    // TEAM_LEAD, PM, CEO, ADMIN, SYSTEM → ALL scope, no filter

    // Sort: active jobs first (IN_PROGRESS, QC_REVIEW, ON_HOLD),
    // then terminal states (COMPLETED_BILLABLE, INVOICED)
    var activeOrder = {
      IN_PROGRESS:        0,
      QC_REVIEW:          1,
      ON_HOLD:            2,
      CLIENT_RETURN:      3,
      ALLOCATED:          4,
      INTAKE_RECEIVED:    5,
      COMPLETED_BILLABLE: 6,
      INVOICED:           7
    };
    allRows.sort(function (a, b) {
      var rankA = activeOrder.hasOwnProperty(a.current_state) ? activeOrder[a.current_state] : 99;
      var rankB = activeOrder.hasOwnProperty(b.current_state) ? activeOrder[b.current_state] : 99;
      if (rankA !== rankB) return rankA - rankB;
      // Secondary sort: most recently updated first
      return (b.updated_at || '') > (a.updated_at || '') ? 1 : -1;
    });

    return allRows;
  }

  // ============================================================
  // SECTION 3: buildStats_
  // ============================================================

  /**
   * Computes aggregate counts from the job list.
   *
   * @param {Object[]} jobs
   * @returns {{ total: number, byState: Object }}
   */
  function buildStats_(jobs) {
    var byState = {};
    for (var i = 0; i < jobs.length; i++) {
      var state = jobs[i].current_state || 'UNKNOWN';
      byState[state] = (byState[state] || 0) + 1;
    }
    return { total: jobs.length, byState: byState };
  }

  // ============================================================
  // SECTION 4: buildPerms_
  // ============================================================

  /**
   * Returns UI permission flags derived from the actor's role.
   * These drive which buttons/forms are rendered on the client.
   * They are advisory only — the server re-checks permissions
   * on every portal_submitAction() call via RBAC.enforcePermission().
   *
   * @param {Object} actor
   * @returns {{ canCreateJob, canViewAll, isQcReviewer, isDesigner }}
   */
  function buildPerms_(actor) {
    var role = actor.role || '';
    return {
      canCreateJob:      RBAC.hasPermission(actor, RBAC.ACTIONS.JOB_CREATE),
      canViewAll:        actor.scope === RBAC.SCOPES.ALL || actor.scope === RBAC.SCOPES.TEAM,
      isQcReviewer:      RBAC.hasPermission(actor, RBAC.ACTIONS.QC_APPROVE),
      isDesigner:        role === 'DESIGNER' || role === 'TEAM_LEAD',
      isLeader:          role === 'CEO' || role === 'PM' || role === 'TEAM_LEAD',
      canRunPayroll:     role === 'CEO',
      canApprovePayroll: role === 'CEO',
      canManageStaff:    role === 'CEO' || role === 'ADMIN'
    };
  }

  // ============================================================
  // SECTION 5: writeQueueItem
  // ============================================================

  /**
   * Builds and appends a queue item to STG_PROCESSING_QUEUE.
   * This is the portal's intake path — equivalent to a form submission.
   *
   * @param {string} formType    Config.FORM_TYPES value
   * @param {string} payloadJson JSON string of the action payload
   * @param {string} email       Submitter email (from Session)
   * @returns {string}  The new queue_id
   */
  function writeQueueItem(formType, payloadJson, email) {
    var queueId = Identifiers.generateId();

    var queueRow = {
      queue_id:        queueId,
      form_type:       formType,
      submitter_email: email,
      submitted_at:    new Date().toISOString(),
      status:          'PENDING',
      payload_json:    payloadJson,
      retry_count:     0,
      error_message:   ''
    };

    DAL.appendRow(
      Config.TABLES.STG_PROCESSING_QUEUE,
      queueRow,
      { callerModule: 'PortalData' }
    );

    Logger.info('PORTAL_QUEUE_ITEM_WRITTEN', {
      module:    'PortalData',
      message:   'Queue item written from portal',
      queue_id:  queueId,
      form_type: formType,
      actor:     email
    });

    return queueId;
  }

  // ============================================================
  // SECTION 6: getLeaderDashboard
  //
  // Returns team hours (from FACT_WORK_LOGS) and payroll status
  // (from MART_PAYROLL_SUMMARY) for the current period.
  // Requires CEO / PM / TEAM_LEAD role.
  // ============================================================

  /**
   * @param {string} email
   * @returns {string}  JSON: { period_id, team_hours[], payroll_status[] }
   */
  function getLeaderDashboard(email) {
    var actor = RBAC.resolveActor(email);
    var role  = actor.role || '';
    if (role !== 'CEO' && role !== 'PM' && role !== 'TEAM_LEAD' && role !== 'ADMIN') {
      throw new Error('Leader dashboard requires CEO, PM, or TEAM_LEAD role.');
    }

    var periodId = Identifiers.generateCurrentPeriodId();

    // ── 1. Load staff name map ────────────────────────────────
    var staffNameMap = {};
    try {
      var staffRows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'PortalData' });
      for (var s = 0; s < staffRows.length; s++) {
        var code = String(staffRows[s].person_code || '').trim();
        if (code) staffNameMap[code] = String(staffRows[s].name || code);
      }
    } catch (e) { /* table may not exist yet */ }

    // ── 2. Aggregate hours from FACT_WORK_LOGS ────────────────
    var hoursMap = {};
    try {
      var workLogs = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
        callerModule: 'PortalData',
        periodId:     periodId
      });
      for (var w = 0; w < workLogs.length; w++) {
        var wrow  = workLogs[w];
        var wcode = String(wrow.actor_code || '').trim();
        var wrole = String(wrow.actor_role || '').toUpperCase();
        var whrs  = parseFloat(wrow.hours) || 0;
        if (!wcode || whrs <= 0) continue;
        if (!hoursMap[wcode]) hoursMap[wcode] = { design: 0, qc: 0 };
        if (wrole === 'QC') hoursMap[wcode].qc += whrs;
        else                hoursMap[wcode].design += whrs;
      }
    } catch (e) { /* no work logs yet */ }

    var teamHours = [];
    var hoursCodes = Object.keys(hoursMap);
    for (var h = 0; h < hoursCodes.length; h++) {
      var hcode   = hoursCodes[h];
      var hentry  = hoursMap[hcode];
      var design  = Math.round(hentry.design * 100) / 100;
      var qc      = Math.round(hentry.qc     * 100) / 100;
      teamHours.push({
        person_code:  hcode,
        name:         staffNameMap[hcode] || hcode,
        design_hours: design,
        qc_hours:     qc,
        total_hours:  Math.round((design + qc) * 100) / 100
      });
    }
    teamHours.sort(function(a, b) { return b.total_hours - a.total_hours; });

    // ── 3. Payroll status from MART_PAYROLL_SUMMARY ───────────
    var payrollStatus = [];
    try {
      var martRows = DAL.readAll(Config.TABLES.MART_PAYROLL_SUMMARY, { callerModule: 'PortalData' });
      for (var m = 0; m < martRows.length; m++) {
        var mrow = martRows[m];
        if (String(mrow.period_id || '') !== periodId) continue;
        var mcode = String(mrow.person_code || '');
        payrollStatus.push({
          person_code:      mcode,
          name:             staffNameMap[mcode] || mcode,
          design_pay:       parseFloat(mrow.design_pay)       || 0,
          qc_pay:           parseFloat(mrow.qc_pay)           || 0,
          supervisor_bonus: parseFloat(mrow.supervisor_bonus) || 0,
          total_pay:        parseFloat(mrow.total_pay)        || 0,
          status:           String(mrow.status || 'NOT_RUN')
        });
      }
    } catch (e) { /* MART may be empty */ }

    return JSON.stringify({
      period_id:      periodId,
      team_hours:     teamHours,
      payroll_status: payrollStatus
    });
  }

  // ============================================================
  // SECTION 7: getMyRatees
  //
  // Returns the list of staff this rater should rate this quarter.
  // TEAM_LEAD -> designers where supervisor_code = rater's person_code
  // PM        -> designers where pm_code = rater's person_code
  // CEO       -> all active TEAM_LEAD and PM staff
  // ============================================================

  /**
   * Returns the list of staff this rater should rate this quarter.
   * TEAM_LEAD -> designers where supervisor_code = rater's person_code
   * PM        -> designers where pm_code = rater's person_code
   * CEO       -> all active TEAM_LEAD and PM staff
   *
   * @param {string} raterEmail
   * @param {string} quarterPeriodId  e.g. '2026-Q1'
   * @returns {string}  JSON array of { person_code, name, role }
   */
  function getMyRatees(raterEmail, quarterPeriodId) {
    var actor = RBAC.resolveActor(raterEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.RATE_STAFF);

    var allStaff;
    try {
      allStaff = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'PortalData' });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return JSON.stringify([]);
      throw e;
    }

    var ratees = [];
    for (var i = 0; i < allStaff.length; i++) {
      var s      = allStaff[i];
      var active = String(s.active || '').toUpperCase();
      if (active !== 'TRUE' && active !== 'YES' && active !== '1') continue;

      var role    = String(s.role || '').toUpperCase().trim();
      var include = false;

      if (actor.role === 'TEAM_LEAD' && String(s.supervisor_code || '').trim() === actor.personCode) {
        include = (role === 'DESIGNER');
      } else if (actor.role === 'PM' && String(s.pm_code || '').trim() === actor.personCode) {
        include = (role === 'DESIGNER');
      } else if (actor.role === 'CEO') {
        include = (role === 'TEAM_LEAD' || role === 'PM');
      }

      if (include) {
        ratees.push({
          person_code: String(s.person_code || ''),
          name:        String(s.name        || ''),
          role:        role
        });
      }
    }
    return JSON.stringify(ratees);
  }

  // ============================================================
  // SECTION 8: submitRating
  //
  // Validates and writes a performance rating to FACT_PERFORMANCE_RATINGS.
  // Each score is 1-5. avg_score_normalized = (avg_raw - 1) / 4 -> 0.0-1.0.
  // Last write wins per rater/ratee/period (rater can revise their rating).
  // ============================================================

  /**
   * Validates and writes a performance rating to FACT_PERFORMANCE_RATINGS.
   * payload: { ratee_code, score_quality, score_sop, score_communication,
   *            score_initiative, quarter_period_id }
   * Each score is 1-5. avg_score_normalized = (avg_raw - 1) / 4 -> 0.0-1.0.
   * Last write wins per rater/ratee/period (rater can revise their rating).
   *
   * @param {string} raterEmail
   * @param {string} payloadJson
   * @returns {string}  JSON: { ok: true }
   */
  function submitRating(raterEmail, payloadJson) {
    var actor = RBAC.resolveActor(raterEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.RATE_STAFF);

    var payload;
    try {
      payload = JSON.parse(payloadJson);
    } catch (e) {
      throw new Error('PortalData.submitRating: invalid JSON payload.');
    }

    var rateeCode = String(payload.ratee_code          || '').trim();
    var qPid      = String(payload.quarter_period_id   || '').trim();
    var sq        = parseInt(payload.score_quality      || 0, 10);
    var ss        = parseInt(payload.score_sop          || 0, 10);
    var sc        = parseInt(payload.score_communication || 0, 10);
    var si        = parseInt(payload.score_initiative   || 0, 10);

    if (!rateeCode) throw new Error('PortalData.submitRating: ratee_code is required.');
    if (!qPid)      throw new Error('PortalData.submitRating: quarter_period_id is required.');

    var scores = [sq, ss, sc, si];
    for (var v = 0; v < scores.length; v++) {
      if (scores[v] < 1 || scores[v] > 5) {
        throw new Error('PortalData.submitRating: all scores must be 1-5.');
      }
    }

    var avgRaw        = (sq + ss + sc + si) / 4;
    var avgNormalized = Math.round(((avgRaw - 1) / 4) * 10000) / 10000;

    var idempotencyKey = 'PERF_RATING|' + actor.personCode + '|' + rateeCode + '|' + qPid;

    DAL.ensurePartition(Config.TABLES.FACT_PERFORMANCE_RATINGS, qPid, 'PortalData');

    DAL.appendRow(Config.TABLES.FACT_PERFORMANCE_RATINGS, {
      rating_id:            Identifiers.generateId(),
      period_id:            qPid,
      ratee_code:           rateeCode,
      rater_code:           actor.personCode,
      rater_role:           actor.role,
      score_quality:        sq,
      score_sop:            ss,
      score_communication:  sc,
      score_initiative:     si,
      avg_score_normalized: avgNormalized,
      submitted_at:         new Date().toISOString(),
      idempotency_key:      idempotencyKey
    }, { callerModule: 'PortalData', periodId: qPid });

    Logger.info('QB_RATING_SUBMITTED', { module: 'PortalData',
      message: 'Performance rating submitted',
      rater: actor.personCode, ratee: rateeCode, period: qPid, avg: avgNormalized });

    return JSON.stringify({ ok: true });
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  return {
    getViewData:         getViewData,
    writeQueueItem:      writeQueueItem,
    getLeaderDashboard:  getLeaderDashboard,
    getMyRatees:         getMyRatees,
    submitRating:        submitRating
  };

}());
