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

    // ── 5. Check paystub confirmation status ─────────────────
    var paystubPending = checkPaystubPending_(actor);

    // ── 6. Serialise and return ───────────────────────────────
    return JSON.stringify({
      actor: {
        email:       actor.email,
        personCode:  actor.personCode,
        role:        actor.role,
        displayName: actor.displayName,
        scope:       actor.scope
      },
      jobs:            jobs,
      stats:           stats,
      perms:           perms,
      staffNameMap:    buildStaffNameMap_(),
      paystub_pending: paystubPending
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
  /**
   * Returns a set of person_codes who share any account with the given TL
   * via REF_ACCOUNT_DESIGNER_MAP (Option B — account-scoped visibility).
   * Returns: { personCode: true, ... }
   */
  function buildTeamCodes_(tlPersonCode) {
    var set = {};
    var mapRows;
    try {
      mapRows = DAL.readAll(Config.TABLES.REF_ACCOUNT_DESIGNER_MAP, { callerModule: 'PortalData' });
    } catch (e) {
      return set;
    }
    if (!mapRows || mapRows.length === 0) return set;

    var tlAccounts = {};
    for (var i = 0; i < mapRows.length; i++) {
      var dc = String(mapRows[i].designer_code || '').trim();
      if (dc === tlPersonCode) {
        tlAccounts[String(mapRows[i].client_code || '').trim()] = true;
      }
    }

    for (var j = 0; j < mapRows.length; j++) {
      var cc   = String(mapRows[j].client_code   || '').trim();
      var code = String(mapRows[j].designer_code || '').trim();
      if (tlAccounts[cc] && code) set[code] = true;
    }

    return set;
  }

  function buildStaffNameMap_() {
    var map = {};
    try {
      var rows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'PortalData' });
      for (var i = 0; i < rows.length; i++) {
        var code = String(rows[i].person_code || '').trim().toUpperCase();
        if (code) map[code] = String(rows[i].name || '').trim();
      }
    } catch (e) { /* fail open */ }
    return map;
  }

  function loadJobs_(actor) {
    var allRows;
    try {
      allRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: 'PortalData' });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return [];
      throw e;
    }

    if (!allRows || allRows.length === 0) return [];

    var staffNames = buildStaffNameMap_();
    for (var n = 0; n < allRows.length; n++) {
      var code = String(allRows[n].allocated_to || '').trim().toUpperCase();
      allRows[n].assigned_name = staffNames[code] || allRows[n].allocated_to || '';
    }

    // Scope filter
    var role = actor.role;
    if (role === 'DESIGNER') {
      // SELF scope — only jobs allocated to this designer
      var selfCode  = (actor.personCode || '').toLowerCase();
      var selfEmail = (actor.email      || '').toLowerCase();
      allRows = allRows.filter(function (row) {
        var at = String(row.allocated_to || '').toLowerCase();
        return at === selfCode || at === selfEmail;
      });
    } else if (role === 'QC' || role === 'QC_REVIEWER') {
      // QC scope — own design jobs (allocated_to) OR jobs assigned to them as QC reviewer
      // QC_REVIEW jobs have allocated_to = designer; qc_reviewer_code = this actor
      var qcCode  = (actor.personCode || '').trim();
      var qcEmail = (actor.email      || '').toLowerCase();
      allRows = allRows.filter(function (row) {
        var at       = String(row.allocated_to    || '').toLowerCase();
        var reviewer = String(row.qc_reviewer_code || '').trim();
        return at === qcCode.toLowerCase() || at === qcEmail || reviewer === qcCode;
      });
    } else if (role === 'TEAM_LEAD') {
      // TEAM scope — jobs allocated to this TL themselves OR their direct reports.
      // TL's own person_code must be included — they also design.
      var teamCodes = buildTeamCodes_(actor.personCode);
      if (actor.personCode) teamCodes[actor.personCode.trim()] = true;
      if (actor.email)      teamCodes[actor.email.toLowerCase().trim()] = true;
      allRows = allRows.filter(function (row) {
        var at = String(row.allocated_to || '').trim();
        return teamCodes[at] === true || teamCodes[at.toLowerCase()] === true;
      });
    }
    // PM, CEO, ADMIN, SYSTEM → ALL scope, no filter

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
  // SECTION 3b: buildStaffNameMap_
  // ============================================================

  /** Returns { personCode: displayName, email: displayName } for all staff. Fails silently. */
  function buildStaffNameMap_() {
    var map = {};
    try {
      var rows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'PortalData' });
      for (var i = 0; i < rows.length; i++) {
        var code  = String(rows[i].person_code || '').trim();
        var email = String(rows[i].email       || '').toLowerCase().trim();
        var name  = String(rows[i].name        || code);
        if (code)  map[code]  = name;
        if (email) map[email] = name;
      }
    } catch (e) { /* non-fatal — caller falls back to person_code */ }
    return map;
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
      canAssign:         RBAC.hasPermission(actor, RBAC.ACTIONS.JOB_ALLOCATE),
      canStart:          RBAC.hasPermission(actor, RBAC.ACTIONS.JOB_START),
      canViewAll:        actor.scope === RBAC.SCOPES.ALL || actor.scope === RBAC.SCOPES.TEAM,
      isQcReviewer:      RBAC.hasPermission(actor, RBAC.ACTIONS.QC_APPROVE),
      isDesigner:        role === 'DESIGNER' || role === 'TEAM_LEAD' || role === 'QC' || role === 'QC_REVIEWER',
      isLeader:          role === 'CEO' || role === 'PM' || role === 'TEAM_LEAD',
      canRunPayroll:     role === 'CEO',
      canApprovePayroll: role === 'CEO',
      canManageStaff:    role === 'CEO' || role === 'ADMIN'
    };
  }

  // ============================================================
  // SECTION 4b: checkPaystubPending_
  // ============================================================

  /**
   * Returns true if the actor has a PENDING_CONFIRMATION payroll record
   * for the current period. Fails silently — a missing table returns false.
   *
   * @param {Object} actor
   * @returns {boolean}
   */
  function checkPaystubPending_(actor) {
    try {
      var periodId = Identifiers.generateCurrentPeriodId();
      var rows = DAL.readAll(Config.TABLES.FACT_PAYROLL_LEDGER, {
        callerModule: 'PortalData',
        periodId:     periodId
      });
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (String(r.person_code || '').trim()  === actor.personCode &&
            String(r.event_type  || '').trim()  === 'PAYROLL_CALCULATED' &&
            String(r.status      || '').trim()  === 'PENDING_CONFIRMATION' &&
            String(r.period_id   || '').trim()  === periodId) {
          return true;
        }
      }
    } catch (e) { /* FACT_PAYROLL_LEDGER may not exist yet */ }
    return false;
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

    // ── 1. Load staff name map — ACTIVE staff only ───────────
    var staffNameMap = {};
    try {
      var staffRows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'PortalData' });
      for (var s = 0; s < staffRows.length; s++) {
        var sr       = staffRows[s];
        var isActive = sr.active === true || String(sr.active || '').toUpperCase() === 'TRUE';
        if (!isActive) continue; // exclude inactive, departed, and test actors
        var code = String(sr.person_code || '').trim();
        if (code) staffNameMap[code] = String(sr.name || code);
      }
    } catch (e) { /* table may not exist yet */ }

    // ── 2. Aggregate hours from FACT_WORK_LOGS ────────────────
    // Only track ACTIVE roster codes — filters out DS1, UNKNOWN, and stray codes.
    // BTD/SNA MIGRATED rows are explicitly skipped (superseded by BIT/SVN amendments).
    // Negative amendment hours (reversals) are intentional and must reduce totals.
    var SUPERSEDED_CODES = { 'BTD': true, 'SNA': true };
    var hoursMap = {};
    try {
      var workLogs = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
        callerModule: 'PortalData',
        periodId:     periodId
      });
      for (var w = 0; w < workLogs.length; w++) {
        var wrow  = workLogs[w];
        var wcode = String(wrow.actor_code || '').trim();
        if (!wcode || !staffNameMap[wcode]) continue; // not on active roster
        if (SUPERSEDED_CODES[wcode] && wrow.event_type === 'WORK_LOG_MIGRATED') continue;
        var wrole = String(wrow.actor_role || '').toUpperCase();
        var whrs  = parseFloat(wrow.hours) || 0;
        if (!hoursMap[wcode]) hoursMap[wcode] = { design: 0, qc: 0 };
        if (wrole === 'QC') hoursMap[wcode].qc += whrs;
        else                hoursMap[wcode].design += whrs;
      }
    } catch (e) { /* no work logs yet */ }

    var teamHours = [];
    var hoursCodes = Object.keys(hoursMap);
    for (var h = 0; h < hoursCodes.length; h++) {
      var hcode  = hoursCodes[h];
      var hentry = hoursMap[hcode];
      var design = Math.round(hentry.design * 100) / 100;
      var qc     = Math.round(hentry.qc     * 100) / 100;
      var total  = Math.round((design + qc) * 100) / 100;
      if (total <= 0) continue; // net-zero or reversed entries — hide from display
      teamHours.push({
        person_code:  hcode,
        name:         staffNameMap[hcode],
        design_hours: design,
        qc_hours:     qc,
        total_hours:  total
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
          status:           String(mrow.status || 'NOT_RUN'),
          annual_bonus_inr: 0  // placeholder — will be populated from FACT_QUARTERLY_BONUS
        });
      }
    } catch (e) { /* MART may be empty */ }

    // ── 4. Annual bonus from FACT_QUARTERLY_BONUS ─────────────
    var annualBonusMap = {};
    try {
      var annualPid  = 'ANNUAL-' + periodId.substring(0, 4);  // e.g. 'ANNUAL-2026'
      var bonusRows  = DAL.readAll(Config.TABLES.FACT_QUARTERLY_BONUS, { callerModule: 'PortalData' });
      for (var b = 0; b < bonusRows.length; b++) {
        var br = bonusRows[b];
        if (String(br.event_type        || '') !== 'ANNUAL_BONUS')  continue;
        if (String(br.quarter_period_id || '') !== annualPid)       continue;
        var bcode = String(br.person_code || '').trim();
        if (bcode) annualBonusMap[bcode] = parseFloat(br.bonus_inr) || 0;
      }
    } catch (e) { /* FACT_QUARTERLY_BONUS may be empty */ }

    // Populate annual_bonus_inr in payrollStatus
    for (var p = 0; p < payrollStatus.length; p++) {
      payrollStatus[p].annual_bonus_inr = annualBonusMap[payrollStatus[p].person_code] || 0;
    }

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
  function getMyRatees(raterEmail, quarterPeriodId, raterCode, raterToken) {
    var actor;
    if (raterEmail) {
      actor = RBAC.resolveActor(raterEmail);
    } else {
      requireValidRatingToken_(raterCode, quarterPeriodId, raterToken);
      actor = resolveActorByCode_(raterCode);
    }
    RBAC.enforcePermission(actor, RBAC.ACTIONS.RATE_STAFF);

    var allStaff;
    try {
      allStaff = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'PortalData' });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return JSON.stringify([]);
      throw e;
    }

    var today  = new Date().toISOString().substring(0, 10);
    var ratees = [];
    var seen   = {};
    for (var i = 0; i < allStaff.length; i++) {
      var s = allStaff[i];

      // Skip inactive: check explicit active flag first, then effective_to
      if (s.active === false || String(s.active).toUpperCase().trim() === 'FALSE') continue;
      var effectiveTo = s.effective_to;
      if (effectiveTo instanceof Date) {
        var ety = effectiveTo.getFullYear();
        var etm = String(effectiveTo.getMonth() + 1); if (etm.length < 2) etm = '0' + etm;
        var etd = String(effectiveTo.getDate());       if (etd.length < 2) etd = '0' + etd;
        effectiveTo = ety + '-' + etm + '-' + etd;
      } else {
        effectiveTo = String(effectiveTo || '').trim().substring(0, 10);
      }
      if (effectiveTo && effectiveTo < today) continue;

      var role    = String(s.role || '').toUpperCase().trim();
      var include = false;

      if (actor.role === 'TEAM_LEAD' && String(s.supervisor_code || '').trim() === actor.personCode) {
        include = true; // any direct report regardless of role (TLs can supervise other TLs)
      } else if (actor.role === 'PM' && String(s.pm_code || '').trim() === actor.personCode) {
        include = (role === 'DESIGNER'); // PM rates designers only; TLs rated by CEO
      } else if (actor.role === 'CEO') {
        include = (role === 'TEAM_LEAD' || role === 'PM');
      }

      if (include) {
        var pCode = String(s.person_code || '');
        if (pCode && !seen[pCode]) {
          seen[pCode] = true;
          ratees.push({ person_code: pCode, name: String(s.name || ''), role: role });
        }
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
  function submitRating(raterEmail, payloadJson, raterCode, raterToken) {
    var payload;
    try {
      payload = JSON.parse(payloadJson);
    } catch (e) {
      throw new Error('PortalData.submitRating: invalid JSON payload.');
    }

    // Identity: session email if present; otherwise the raterCode from
    // the emailed link, which MUST carry a valid HMAC token. A bare
    // raterCode is client-supplied and is never trusted on its own.
    var actor;
    if (raterEmail) {
      actor = RBAC.resolveActor(raterEmail);
    } else {
      requireValidRatingToken_(raterCode, String(payload.quarter_period_id || '').trim(), raterToken);
      actor = resolveActorByCode_(raterCode);
    }
    RBAC.enforcePermission(actor, RBAC.ACTIONS.RATE_STAFF);

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

    var idempotencyKey = 'PERF_RATING|' + actor.personCode + '|' + rateeCode + '|' + qPid + '|' + Identifiers.generateId();
    IdempotencyEngine.checkAndMark(idempotencyKey);

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
  // HELPER: resolveActorByCode_
  // Used when Session.getActiveUser().getEmail() returns '' (e.g. TL/PM
  // following an emailed link without GAS OAuth session). Reads the
  // DIM_STAFF_ROSTER row for the person_code, extracts their email, and
  // delegates to RBAC.resolveActor() so all permission checks are normal.
  // ============================================================

  /**
   * Computes the HMAC-SHA256 rating-link token for a rater + period.
   * Secret lives in Script Properties (RATING_LINK_SECRET) — generate
   * once with runGenerateRatingSecret().
   *
   * @param {string} raterCode  person_code of the rater
   * @param {string} periodId   e.g. '2026-Q2'
   * @returns {string}  web-safe base64 token
   */
  function ratingToken_(raterCode, periodId) {
    var secret = PropertiesService.getScriptProperties().getProperty('RATING_LINK_SECRET');
    if (!secret) {
      throw new Error('RATING_LINK_SECRET not set. Run runGenerateRatingSecret() once from the Apps Script editor.');
    }
    var msg   = String(raterCode || '') + '|' + String(periodId || '');
    var bytes = Utilities.computeHmacSha256Signature(msg, secret);
    return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
  }

  /**
   * Verifies a rating-link token. Throws on mismatch — rater identity
   * via URL code alone is NOT trusted (it is client-supplied).
   *
   * @param {string} raterCode
   * @param {string} periodId
   * @param {string} token
   */
  function requireValidRatingToken_(raterCode, periodId, token) {
    if (!token) {
      throw new Error('PortalData: rating link token missing. Use the link from your rating request email.');
    }
    if (String(token) !== ratingToken_(raterCode, periodId)) {
      throw new Error('PortalData: invalid rating link token for rater ' + raterCode + '.');
    }
  }

  function resolveActorByCode_(personCode) {
    if (!personCode) throw new Error('PortalData: rater identity missing — no session email and no rater code.');
    var rows;
    try {
      rows = DAL.readWhere(Config.TABLES.DIM_STAFF_ROSTER, { person_code: personCode });
    } catch (e) {
      throw new Error('PortalData: cannot look up rater code ' + personCode + ': ' + e.message);
    }
    if (!rows || rows.length === 0) throw new Error('PortalData: unknown rater code: ' + personCode);
    var row = null;
    for (var i = 0; i < rows.length; i++) {
      var active = rows[i].active;
      if (active === true || String(active).toUpperCase() === 'TRUE') { row = rows[i]; break; }
    }
    if (!row) throw new Error('PortalData: rater ' + personCode + ' is inactive.');
    var email = String(row.email || '').trim();
    if (!email) throw new Error('PortalData: rater ' + personCode + ' has no email in roster.');
    return RBAC.resolveActor(email);
  }

  // ============================================================
  // HELPER: currentQuarterPeriodId_
  // ============================================================

  /** Returns the current quarter period ID, e.g. '2026-Q2'. */
  function currentQuarterPeriodId_() {
    var now   = new Date();
    var month = now.getMonth() + 1;  // 1-12
    var year  = now.getFullYear();
    var q     = month <= 3 ? 'Q1' : month <= 6 ? 'Q2' : month <= 9 ? 'Q3' : 'Q4';
    return year + '-' + q;
  }

  // ============================================================
  // SECTION 9: sendRatingRequests
  //
  // Emails every active TL and PM their personal link to the
  // quarterly ratings portal for the given period.
  // Portal base URL is read from Script Property PORTAL_BASE_URL.
  // CEO only.
  // ============================================================

  /**
   * Sends rating-request emails to all active TLs and PMs.
   * Each email contains a direct link: PORTAL_BASE_URL?page=rate-staff&period=periodId
   *
   * @param {string} actorEmail
   * @param {string} periodId    e.g. '2026-Q1' (pass '' for current quarter)
   * @param {string} [testEmail] If set, all emails are routed here instead of real addresses
   * @returns {{ period_id, emails_sent, recipients: string[] }}
   */
  function sendRatingRequests(actorEmail, periodId, testEmail, dryRun) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN);

    periodId  = periodId  || currentQuarterPeriodId_();
    testEmail = testEmail || null;
    dryRun    = !!dryRun;

    var portalBaseUrl = PropertiesService.getScriptProperties().getProperty('PORTAL_BASE_URL') || '';
    if (!portalBaseUrl) {
      throw new Error('PORTAL_BASE_URL not set. Run setPortalBaseUrl(url) once from the Apps Script editor.');
    }

    var baseRatingUrl = portalBaseUrl + '?page=rate-staff&period=' + encodeURIComponent(periodId);
    var ceoRatingUrl  = baseRatingUrl; // CEO is session-authenticated; no rater param needed

    var allStaff;
    try {
      allStaff = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'PortalData' });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return { period_id: periodId, emails_sent: 0, recipients: [] };
      throw e;
    }

    var today = new Date().toISOString().substring(0, 10);

    // ── Build active staff index ──────────────────────────────
    var staffMap = {}; // person_code → { code, name, role, email, supervisorCode, pmCode }
    for (var i = 0; i < allStaff.length; i++) {
      var s = allStaff[i];
      if (s.active === false || String(s.active).toUpperCase().trim() === 'FALSE') continue;
      var et = s.effective_to;
      if (et instanceof Date) {
        var ey = et.getFullYear(), em = String(et.getMonth()+1), ed = String(et.getDate());
        if (em.length < 2) em = '0'+em; if (ed.length < 2) ed = '0'+ed;
        et = ey+'-'+em+'-'+ed;
      } else { et = String(et||'').trim().substring(0,10); }
      if (et && et < today) continue;

      var code = String(s.person_code || '').trim();
      if (!code) continue;
      staffMap[code] = {
        code:           code,
        name:           String(s.name || code),
        role:           String(s.role || '').toUpperCase().trim(),
        email:          String(s.email || '').trim(),
        supervisorCode: String(s.supervisor_code || '').trim(),
        pmCode:         String(s.pm_code || '').trim()
      };
    }

    // ── Build rater → ratee name list ────────────────────────
    // CEO ratees: all TLs + PMs
    // TL ratees:  anyone where supervisor_code = TL (any role)
    // PM ratees:  DESIGNERs where pm_code = PM
    var raterRatees = {}; // person_code → [name, ...]
    var ceoRateeNames = [];

    for (var code in staffMap) {
      var m = staffMap[code];

      // CEO list
      if (m.role === 'TEAM_LEAD' || m.role === 'PM') {
        ceoRateeNames.push(m.name);
      }

      // TL ratees
      if (m.supervisorCode && staffMap[m.supervisorCode] && staffMap[m.supervisorCode].role === 'TEAM_LEAD') {
        if (!raterRatees[m.supervisorCode]) raterRatees[m.supervisorCode] = [];
        raterRatees[m.supervisorCode].push(m.name);
      }

      // PM ratees (designers only)
      if (m.pmCode && staffMap[m.pmCode] && staffMap[m.pmCode].role === 'PM' && m.role === 'DESIGNER') {
        if (!raterRatees[m.pmCode]) raterRatees[m.pmCode] = [];
        raterRatees[m.pmCode].push(m.name);
      }
    }

    var emailsSent = 0;
    var recipients = [];

    // ── CEO email (1 email, sent to actorEmail) ───────────────
    if (ceoRateeNames.length > 0) {
      var ceoRecipient = testEmail || actorEmail;
      if (!dryRun) MailApp.sendEmail({
        to:      ceoRecipient,
        subject: 'BLC Nexus — Please submit your ' + periodId + ' performance ratings'
                 + (testEmail ? ' [TEST]' : ''),
        htmlBody: [
          '<p>Hi,</p>',
          '<p>Please submit your quarterly performance ratings for <strong>' + periodId + '</strong>.</p>',
          '<p>You are rating: <strong>' + ceoRateeNames.join(', ') + '</strong></p>',
          '<p><a href="' + ceoRatingUrl + '" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:4px;">Submit Ratings</a></p>',
          '<p>If the button above doesn\'t work: ' + ceoRatingUrl + '</p>',
          '<p>Thanks,<br>BLC Nexus</p>'
        ].join('\n')
      });
      recipients.push(ceoRecipient);
      emailsSent++;
    }

    // ── TL + PM emails (1 per rater, lists their ratees) ─────
    for (var raterCode in raterRatees) {
      var rater     = staffMap[raterCode];
      var rateeList = raterRatees[raterCode];
      if (!rater || !rater.email || rateeList.length === 0) continue;

      // Embed rater code so the page can identify the user without a GAS OAuth session
      var raterUrl  = baseRatingUrl + '&rater=' + encodeURIComponent(raterCode) +
                      '&rtoken=' + encodeURIComponent(ratingToken_(raterCode, periodId));
      var recipient = testEmail || rater.email;
      if (!dryRun) MailApp.sendEmail({
        to:      recipient,
        subject: 'BLC Nexus — Please submit your ' + periodId + ' performance ratings'
                 + (testEmail ? ' [TEST — for ' + rater.email + ']' : ''),
        htmlBody: [
          '<p>Hi ' + rater.name + ',</p>',
          '<p>Please submit your quarterly performance ratings for <strong>' + periodId + '</strong>.</p>',
          '<p>You are rating: <strong>' + rateeList.join(', ') + '</strong></p>',
          '<p><a href="' + raterUrl + '" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:4px;">Submit Ratings</a></p>',
          '<p>If the button above doesn\'t work: ' + raterUrl + '</p>',
          '<p>Please submit by end of month.</p>',
          '<p>Thanks,<br>BLC Nexus</p>'
        ].join('\n')
      });
      recipients.push(recipient);
      emailsSent++;
    }

    Logger.info('RATING_REQUESTS_SENT', {
      module: 'PortalData', message: dryRun ? 'Dry run — no emails sent' : 'Rating request emails sent',
      period_id: periodId, emails_sent: emailsSent, actor: actorEmail
    });

    var result = { period_id: periodId, emails_sent: dryRun ? 0 : emailsSent, recipients: recipients };
    if (dryRun) {
      result.dry_run = true;
      result.would_send = [];
      // CEO
      if (ceoRateeNames.length > 0) {
        result.would_send.push({ to: testEmail || actorEmail, label: 'CEO', rates: ceoRateeNames });
      }
      for (var rc in raterRatees) {
        if (staffMap[rc] && raterRatees[rc].length > 0) {
          result.would_send.push({ to: testEmail || staffMap[rc].email, label: staffMap[rc].name + ' (' + staffMap[rc].role + ')', rates: raterRatees[rc] });
        }
      }
    }
    return result;
  }

  // ============================================================
  // SECTION 10: getRatingsGaps + sendRatingReminder
  // ============================================================

  /**
   * Returns the list of raters who have not yet completed their Q ratings.
   * CEO only. Used to populate the Ratings Status panel.
   *
   * @param {string} actorEmail
   * @param {string} quarterPeriodId  e.g. '2026-Q1'
   * @returns {string} JSON array of { rater_code, rater_name, rater_email, pending: [{code,name}] }
   */
  function getRatingsGaps(actorEmail, quarterPeriodId) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.RATE_STAFF);

    var allStaff;
    try {
      allStaff = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'PortalData' });
    } catch (e) {
      return JSON.stringify([]);
    }

    var today = new Date().toISOString().substring(0, 10);
    var staffMap = {};
    for (var i = 0; i < allStaff.length; i++) {
      var s = allStaff[i];
      if (s.active === false || String(s.active).toUpperCase().trim() === 'FALSE') continue;
      var et = s.effective_to;
      if (et instanceof Date) {
        var ey = et.getFullYear(), em = String(et.getMonth()+1), ed = String(et.getDate());
        if (em.length < 2) em = '0'+em; if (ed.length < 2) ed = '0'+ed;
        et = ey+'-'+em+'-'+ed;
      } else { et = String(et||'').trim().substring(0,10); }
      if (et && et < today) continue;
      var code = String(s.person_code || '').trim();
      if (!code || staffMap[code]) continue; // deduplicate
      staffMap[code] = {
        code:           code,
        name:           String(s.name  || code),
        role:           String(s.role  || '').toUpperCase().trim(),
        email:          String(s.email || '').trim(),
        supervisorCode: String(s.supervisor_code || '').trim(),
        pmCode:         String(s.pm_code         || '').trim()
      };
    }

    // Build expected submissions: rater_code → [{ code, name }]
    var expected = {}; // rater_code → [{code, name}]
    for (var code in staffMap) {
      var m = staffMap[code];
      // TL rates their direct reports
      if (m.supervisorCode && staffMap[m.supervisorCode] && staffMap[m.supervisorCode].role === 'TEAM_LEAD') {
        var tl = m.supervisorCode;
        if (!expected[tl]) expected[tl] = [];
        expected[tl].push({ code: code, name: m.name });
      }
      // PM rates their designers
      if (m.pmCode && staffMap[m.pmCode] && staffMap[m.pmCode].role === 'PM' && m.role === 'DESIGNER') {
        var pm = m.pmCode;
        if (!expected[pm]) expected[pm] = [];
        expected[pm].push({ code: code, name: m.name });
      }
      // QC also rated by PM
      if (m.pmCode && staffMap[m.pmCode] && staffMap[m.pmCode].role === 'PM' && m.role === 'QC') {
        var pmq = m.pmCode;
        if (!expected[pmq]) expected[pmq] = [];
        if (!expected[pmq].some(function(x) { return x.code === code; }))
          expected[pmq].push({ code: code, name: m.name });
      }
    }

    // Load submitted ratings for this quarter
    var submitted = {}; // rater_code → { ratee_code: true }
    try {
      var ratingRows = DAL.readAll(Config.TABLES.FACT_PERFORMANCE_RATINGS, { callerModule: 'PortalData' });
      ratingRows.forEach(function(r) {
        if (String(r.period_id || '').trim() !== quarterPeriodId) return;
        var rc = String(r.rater_code || '').trim();
        var re = String(r.ratee_code || '').trim();
        if (!rc || !re) return;
        if (!submitted[rc]) submitted[rc] = {};
        submitted[rc][re] = true;
      });
    } catch (e) { /* proceed with empty submitted */ }

    // Find gaps
    var gaps = [];
    for (var raterCode in expected) {
      var rater   = staffMap[raterCode];
      if (!rater) continue;
      var pending = expected[raterCode].filter(function(ratee) {
        return !submitted[raterCode] || !submitted[raterCode][ratee.code];
      });
      if (pending.length === 0) continue;
      gaps.push({
        rater_code:  raterCode,
        rater_name:  rater.name,
        rater_role:  rater.role,
        rater_email: rater.email,
        pending:     pending
      });
    }
    gaps.sort(function(a, b) { return a.rater_name.localeCompare(b.rater_name); });
    return JSON.stringify(gaps);
  }

  /**
   * Sends a targeted reminder email to a single rater listing their pending ratees.
   * CEO only.
   *
   * @param {string} actorEmail
   * @param {string} quarterPeriodId  e.g. '2026-Q1'
   * @param {string} raterCode        person_code of the rater to remind
   * @param {string} [testEmail]      If set, routes email here instead of rater's real address
   * @returns {string} JSON { ok, sent_to }
   */
  function sendRatingReminder(actorEmail, quarterPeriodId, raterCode, testEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.RATE_STAFF);

    var gapsJson = getRatingsGaps(actorEmail, quarterPeriodId);
    var gaps     = JSON.parse(gapsJson);
    var gap      = null;
    for (var i = 0; i < gaps.length; i++) {
      if (gaps[i].rater_code === raterCode) { gap = gaps[i]; break; }
    }
    if (!gap) return JSON.stringify({ ok: true, sent_to: null, message: 'No pending ratees for ' + raterCode });

    var portalBaseUrl = PropertiesService.getScriptProperties().getProperty('PORTAL_BASE_URL') || '';
    var raterUrl = portalBaseUrl + '?page=rate-staff&period=' + encodeURIComponent(quarterPeriodId)
                 + '&rater=' + encodeURIComponent(raterCode);
    var pendingNames = gap.pending.map(function(r) { return r.name; }).join(', ');
    var recipient    = testEmail || gap.rater_email;

    MailApp.sendEmail({
      to:       recipient,
      subject:  'Reminder: Please submit ' + quarterPeriodId + ' performance ratings — BLC Nexus',
      htmlBody: [
        '<p>Hi ' + gap.rater_name + ',</p>',
        '<p>This is a reminder to submit your quarterly performance ratings for <strong>' + quarterPeriodId + '</strong>.</p>',
        '<p>Still pending: <strong>' + pendingNames + '</strong></p>',
        '<p><a href="' + raterUrl + '" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:4px;">Submit Ratings Now</a></p>',
        '<p>If the button doesn\'t work: ' + raterUrl + '</p>',
        '<p>Thanks,<br>BLC Nexus</p>'
      ].join('\n')
    });

    Logger.info('RATING_REMINDER_SENT', { module: 'PortalData',
      rater: raterCode, period: quarterPeriodId, sent_to: recipient });
    return JSON.stringify({ ok: true, sent_to: recipient });
  }

  // ============================================================
  // SECTION 8: getCEODashboard
  //
  // CEO-only operational dashboard: job summary, load balance,
  // quality/error rates per designer, QC backlog.
  // ============================================================

  /**
   * @param {string} email
   * @returns {string}  JSON: { period_id, job_summary, load_balance, quality_rates, qc_backlog }
   */
  function getCEODashboard(email) {
    var actor = RBAC.resolveActor(email);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN);
    RBAC.enforceFinancialAccess(actor);

    var periodId = Identifiers.generateCurrentPeriodId();
    var today    = new Date();

    // ── 1. Staff name map ─────────────────────────────────────
    var staffNameMap = {};
    try {
      var staffRows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'PortalData' });
      for (var s = 0; s < staffRows.length; s++) {
        var scode = String(staffRows[s].person_code || '').trim();
        if (scode) staffNameMap[scode] = String(staffRows[s].name || scode);
      }
    } catch (e) { /* table may not exist yet */ }

    // ── 2. All active jobs ─────────────────────────────────────
    var allJobs = [];
    try {
      allJobs = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: 'PortalData' });
    } catch (e) { /* empty view */ }

    var ACTIVE_ST = {
      INTAKE_RECEIVED: true, ALLOCATED: true, IN_PROGRESS: true,
      QC_REVIEW: true, MINOR_FIX: true, ON_HOLD: true, CLIENT_RETURN: true
    };

    // ── 3. Job Summary ────────────────────────────────────────
    var byState    = {};
    var totalActive = 0;
    for (var i = 0; i < allJobs.length; i++) {
      var st = String(allJobs[i].current_state || '').trim();
      if (!ACTIVE_ST[st]) continue;
      byState[st] = (byState[st] || 0) + 1;
      totalActive++;
    }

    // ── 4. Active jobs per designer ────────────────────────────
    var activeJobsMap = {};
    for (var j = 0; j < allJobs.length; j++) {
      var jrow  = allJobs[j];
      var jst   = String(jrow.current_state || '').trim();
      if (!ACTIVE_ST[jst]) continue;
      var jcode = String(jrow.allocated_to || '').trim();
      if (!jcode) continue;
      activeJobsMap[jcode] = (activeJobsMap[jcode] || 0) + 1;
    }

    // ── 5. Hours this period ───────────────────────────────────
    var hoursMap = {};
    try {
      var workLogs = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
        callerModule: 'PortalData',
        periodId:     periodId
      });
      for (var w = 0; w < workLogs.length; w++) {
        var wrow  = workLogs[w];
        var wcode = String(wrow.actor_code || '').trim();
        var whrs  = parseFloat(wrow.hours) || 0;
        if (!wcode || whrs <= 0) continue;
        hoursMap[wcode] = (hoursMap[wcode] || 0) + whrs;
      }
    } catch (e) { /* no work logs yet */ }

    // ── 6. Load balance ───────────────────────────────────────
    var designerCodes = {};
    Object.keys(activeJobsMap).forEach(function(c) { designerCodes[c] = true; });
    Object.keys(hoursMap).forEach(function(c) { designerCodes[c] = true; });

    var loadBalance = [];
    Object.keys(designerCodes).forEach(function(code) {
      var jobs   = activeJobsMap[code] || 0;
      var hrs    = Math.round((hoursMap[code] || 0) * 10) / 10;
      var status = jobs === 0 ? 'idle' : jobs >= 9 ? 'busy' : 'ok';
      loadBalance.push({
        person_code:  code,
        name:         staffNameMap[code] || code,
        active_jobs:  jobs,
        hours_period: hrs,
        status:       status
      });
    });
    loadBalance.sort(function(a, b) { return b.active_jobs - a.active_jobs; });

    // ── 7. Quality rates ──────────────────────────────────────
    var qMap = {};
    for (var q = 0; q < allJobs.length; q++) {
      var qrow  = allJobs[q];
      var qcode = String(qrow.allocated_to || '').trim();
      if (!qcode) continue;
      if (!qMap[qcode]) qMap[qcode] = { total_jobs: 0, minor_reworks: 0, major_reworks: 0 };
      qMap[qcode].total_jobs++;
      qMap[qcode].minor_reworks += parseInt(qrow.minor_rework_count, 10) || 0;
      qMap[qcode].major_reworks += parseInt(qrow.major_rework_count, 10) || 0;
    }

    var qualityRates = [];
    Object.keys(qMap).forEach(function(code) {
      var entry      = qMap[code];
      var totalErrors = entry.minor_reworks + entry.major_reworks;
      var passRate   = entry.total_jobs > 0
                       ? Math.round((1 - totalErrors / entry.total_jobs) * 100)
                       : 100;
      qualityRates.push({
        person_code:   code,
        name:          staffNameMap[code] || code,
        total_jobs:    entry.total_jobs,
        minor_reworks: entry.minor_reworks,
        major_reworks: entry.major_reworks,
        pass_rate:     passRate
      });
    });
    qualityRates.sort(function(a, b) { return a.pass_rate - b.pass_rate; });

    // ── 8. QC Backlog ─────────────────────────────────────────
    var qcBacklog = [];
    for (var k = 0; k < allJobs.length; k++) {
      var krow = allJobs[k];
      if (String(krow.current_state || '').trim() !== Config.STATES.QC_REVIEW) continue;
      var updatedAt   = String(krow.updated_at || '').trim();
      var daysWaiting = 0;
      if (updatedAt) {
        var reviewDate = new Date(updatedAt);
        if (!isNaN(reviewDate.getTime())) {
          daysWaiting = Math.floor((today - reviewDate) / (1000 * 60 * 60 * 24));
        }
      }
      var reviewerCode = String(krow.qc_reviewer_code || '').trim();
      qcBacklog.push({
        job_number:    String(krow.job_number   || ''),
        client_code:   String(krow.client_code  || ''),
        designer_name: staffNameMap[String(krow.allocated_to   || '').trim()] || String(krow.allocated_to || '—'),
        reviewer_name: reviewerCode ? (staffNameMap[reviewerCode] || reviewerCode) : '—',
        days_waiting:  daysWaiting
      });
    }
    qcBacklog.sort(function(a, b) { return b.days_waiting - a.days_waiting; });

    return JSON.stringify({
      period_id:     periodId,
      job_summary:   { total_active: totalActive, by_state: byState },
      load_balance:  loadBalance,
      quality_rates: qualityRates,
      qc_backlog:    qcBacklog
    });
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  return {
    getViewData:              getViewData,
    writeQueueItem:           writeQueueItem,
    getLeaderDashboard:       getLeaderDashboard,
    getCEODashboard:          getCEODashboard,
    getMyRatees:              getMyRatees,
    submitRating:             submitRating,
    sendRatingRequests:       sendRatingRequests,
    getViewDataAs:            getViewDataAs,
    getMyRateesAs:            getMyRateesAs,
    getActiveDesigners:       getActiveDesigners,
    getClientList:            getClientList,
    getDesignersForClient:    getDesignersForClient,
    editJob:                  editJob,
    getRatingsGaps:           getRatingsGaps,
    sendRatingReminder:       sendRatingReminder
  };

  // ============================================================
  // SECTION 9: getViewDataAs — CEO preview mode
  // ============================================================

  /**
   * Returns portal view data as if the target person were logged in.
   * CEO only — used to preview what any staff member sees in the portal.
   *
   * @param {string} ceoEmail          The CEO's actual email
   * @param {string} targetPersonCode  person_code of the staff member to preview as
   * @returns {string}  JSON view data with previewMode: true
   */
  function getViewDataAs(ceoEmail, targetPersonCode) {
    var ceoActor = RBAC.resolveActor(ceoEmail);
    RBAC.enforcePermission(ceoActor, RBAC.ACTIONS.PAYROLL_RUN);

    // Find target in DIM_STAFF_ROSTER
    var staffRows;
    try {
      staffRows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'PortalData' });
    } catch (e) {
      throw new Error('getViewDataAs: could not read staff roster.');
    }

    var targetRow = null;
    for (var i = 0; i < staffRows.length; i++) {
      if (String(staffRows[i].person_code || '').trim() === targetPersonCode) {
        targetRow = staffRows[i];
        break;
      }
    }
    if (!targetRow) throw new Error('Person not found: ' + targetPersonCode);

    var targetEmail = String(targetRow.email || '').trim();
    if (!targetEmail) throw new Error('No email for person: ' + targetPersonCode);

    var targetActor = RBAC.resolveActor(targetEmail);
    var jobs        = loadJobs_(targetActor);
    var stats       = buildStats_(jobs);
    var perms       = buildPerms_(targetActor);

    return JSON.stringify({
      actor:             { email: targetActor.email, personCode: targetActor.personCode,
                           role: targetActor.role, displayName: targetActor.displayName,
                           scope: targetActor.scope },
      jobs:              jobs,
      stats:             stats,
      perms:             perms,
      staffNameMap:      buildStaffNameMap_(),
      previewMode:       true,
      previewPersonCode: targetPersonCode
    });
  }

  // ============================================================
  // SECTION 10: getMyRateesAs — CEO preview rating portal
  // ============================================================

  /**
   * Returns the ratees list for any staff member.
   * CEO only — used to preview the rating portal as a specific TL/PM.
   *
   * @param {string} ceoEmail          The CEO's actual email
   * @param {string} targetPersonCode  person_code of the TL/PM to preview as
   * @param {string} quarterPeriodId   e.g. '2026-Q1'
   * @returns {string}  JSON array of ratees
   */
  function getMyRateesAs(ceoEmail, targetPersonCode, quarterPeriodId) {
    var ceoActor = RBAC.resolveActor(ceoEmail);
    RBAC.enforcePermission(ceoActor, RBAC.ACTIONS.PAYROLL_RUN);

    var staffRows;
    try {
      staffRows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'PortalData' });
    } catch (e) {
      throw new Error('getMyRateesAs: could not read staff roster.');
    }

    var targetEmail = null;
    for (var i = 0; i < staffRows.length; i++) {
      if (String(staffRows[i].person_code || '').trim() === targetPersonCode) {
        targetEmail = String(staffRows[i].email || '').trim();
        break;
      }
    }
    if (!targetEmail) throw new Error('Person not found: ' + targetPersonCode);

    return getMyRatees(targetEmail, quarterPeriodId);
  }

  // ============================================================
  // SECTION 10: getActiveDesigners
  // ============================================================

  /**
   * Returns active staff eligible to be assigned jobs (DESIGNER or TEAM_LEAD).
   * Requires JOB_ALLOCATE permission (CEO, PM, TEAM_LEAD).
   *
   * @param {string} email
   * @returns {Object[]}  Array of { personCode, name, role }
   */
  function getActiveDesigners(email) {
    var actor = RBAC.resolveActor(email);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.JOB_ALLOCATE);

    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'PortalData' });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return [];
      throw e;
    }

    var result = [];
    for (var i = 0; i < rows.length; i++) {
      var row  = rows[i];
      var role = String(row.role || '').trim().toUpperCase();
      if (String(row.active || '').toUpperCase() !== 'TRUE') continue;
      if (role !== 'DESIGNER' && role !== 'TEAM_LEAD') continue;
      result.push({
        personCode: String(row.person_code || '').trim(),
        name:       String(row.name || '').trim(),
        role:       role
      });
    }
    return result;
  }

  // ============================================================
  // SECTION 11: getClientList
  // ============================================================

  /**
   * Returns active client names and codes for job creation dropdowns.
   * Uses JOB_CREATE permission so PM and TL can also populate the dropdown.
   *
   * @param {string} email
   * @returns {Object[]}  Array of { client_code, client_name }
   */
  function getClientList(email) {
    var actor = RBAC.resolveActor(email);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.JOB_CREATE);

    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.DIM_CLIENT_MASTER, { callerModule: 'PortalData' });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return [];
      throw e;
    }

    var result = [];
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].active || '').toUpperCase() !== 'TRUE') continue;
      result.push({
        client_code: String(rows[i].client_code || '').toUpperCase().trim(),
        client_name: String(rows[i].client_name || '').trim()
      });
    }
    return result;
  }

  // ============================================================
  // SECTION 12: getDesignersForClient
  // ============================================================

  /**
   * Returns designers assigned to a specific client via REF_ACCOUNT_DESIGNER_MAP.
   * Falls back to all active DESIGNERs if no mapping exists for the client.
   * Requires JOB_ALLOCATE permission (CEO, PM, TEAM_LEAD).
   *
   * @param {string} email
   * @param {string} clientCode
   * @returns {Object[]}  Array of { personCode, name, role }
   */
  // ============================================================
  // SECTION 9: editJob
  //
  // Delegates to JobUpdateHandler.handle() — all logic lives there.
  // ============================================================

  /**
   * Updates target_date, notes, and/or client_job_ref on an existing job.
   *
   * @param {string} email
   * @param {string} jobNumber   e.g. 'BLC-00042'
   * @param {Object} changes     { target_date?, notes?, client_job_ref? }
   * @returns {{ ok: boolean, job_number: string }}
   */
  function editJob(email, jobNumber, changes) {
    return JobUpdateHandler.handle(email, jobNumber, changes);
  }

  function getDesignersForClient(email, clientCode) {
    var actor = RBAC.resolveActor(email);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.JOB_ALLOCATE);

    var mapRows;
    try {
      mapRows = DAL.readAll(Config.TABLES.REF_ACCOUNT_DESIGNER_MAP, { callerModule: 'PortalData' });
    } catch (e) {
      mapRows = [];
    }

    var assignedCodes = {};
    for (var m = 0; m < mapRows.length; m++) {
      if (String(mapRows[m].client_code || '').trim().toUpperCase() === clientCode.toUpperCase()) {
        assignedCodes[String(mapRows[m].designer_code || '').trim().toUpperCase()] = true;
      }
    }

    var rosterRows;
    try {
      rosterRows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'PortalData' });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return [];
      throw e;
    }

    var hasMappings = Object.keys(assignedCodes).length > 0;
    var result = [];
    for (var i = 0; i < rosterRows.length; i++) {
      var row  = rosterRows[i];
      var role = String(row.role || '').trim().toUpperCase();
      if (String(row.active || '').toUpperCase() !== 'TRUE') continue;
      if (role !== 'DESIGNER' && role !== 'TEAM_LEAD' && role !== 'PM') continue;
      var code = String(row.person_code || '').trim().toUpperCase();
      // PMs always appear for every account (overflow coverage) — mapping filter only applies to DESIGNER/TL
      if (role !== 'PM' && hasMappings && !assignedCodes[code]) continue;
      result.push({
        personCode: String(row.person_code || '').trim(),
        name:       String(row.name || '').trim(),
        role:       role
      });
    }
    return result;
  }

}());
