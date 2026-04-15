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
  /**
   * Returns a set of person_codes who are direct reports of the given TL.
   * Reads DIM_STAFF_ROSTER and filters by supervisor_code = tlPersonCode.
   * Returns: { personCode: true, ... }
   */
  function buildTeamCodes_(tlPersonCode) {
    var set = {};
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'PortalData' });
    } catch (e) {
      return set; // fail open — return empty set, jobs table will be empty
    }
    for (var i = 0; i < rows.length; i++) {
      var supCode = String(rows[i].supervisor_code || '').trim();
      var pCode   = String(rows[i].person_code     || '').trim();
      if (supCode === tlPersonCode && pCode) {
        set[pCode] = true;
      }
    }
    return set;
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

    // Scope filter
    var role = actor.role;
    if (role === 'DESIGNER' || role === 'QC') {
      // SELF scope — only jobs assigned to this person
      // allocated_to stores person_code (e.g. 'PRS') — match against personCode first,
      // fall back to email for legacy rows that stored email instead
      var selfCode  = (actor.personCode || '').toLowerCase();
      var selfEmail = (actor.email      || '').toLowerCase();
      allRows = allRows.filter(function (row) {
        var at = String(row.allocated_to || '').toLowerCase();
        return at === selfCode || at === selfEmail;
      });
    } else if (role === 'TEAM_LEAD') {
      // TEAM scope — only jobs allocated to this TL's direct reports
      // (staff where supervisor_code = TL's person_code)
      var teamCodes = buildTeamCodes_(actor.personCode);
      allRows = allRows.filter(function (row) {
        var at = String(row.allocated_to || '').trim();
        return teamCodes[at] === true;
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

    var today  = new Date().toISOString().substring(0, 10);
    var ratees = [];
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

    var ratingUrl = portalBaseUrl + '?page=rate-staff&period=' + encodeURIComponent(periodId);

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
          '<p><a href="' + ratingUrl + '" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:4px;">Submit Ratings</a></p>',
          '<p>If the button above doesn\'t work: ' + ratingUrl + '</p>',
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

      var recipient = testEmail || rater.email;
      if (!dryRun) MailApp.sendEmail({
        to:      recipient,
        subject: 'BLC Nexus — Please submit your ' + periodId + ' performance ratings'
                 + (testEmail ? ' [TEST — for ' + rater.email + ']' : ''),
        htmlBody: [
          '<p>Hi ' + rater.name + ',</p>',
          '<p>Please submit your quarterly performance ratings for <strong>' + periodId + '</strong>.</p>',
          '<p>You are rating: <strong>' + rateeList.join(', ') + '</strong></p>',
          '<p><a href="' + ratingUrl + '" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:4px;">Submit Ratings</a></p>',
          '<p>If the button above doesn\'t work: ' + ratingUrl + '</p>',
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
  // PUBLIC API
  // ============================================================
  return {
    getViewData:          getViewData,
    writeQueueItem:       writeQueueItem,
    getLeaderDashboard:   getLeaderDashboard,
    getMyRatees:          getMyRatees,
    submitRating:         submitRating,
    sendRatingRequests:   sendRatingRequests,
    getViewDataAs:        getViewDataAs,
    getMyRateesAs:        getMyRateesAs
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

}());
