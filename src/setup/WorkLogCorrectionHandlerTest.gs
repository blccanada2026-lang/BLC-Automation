// ============================================================
// WorkLogCorrectionHandlerTest.gs — BLC Nexus Setup / Tests
// src/setup/WorkLogCorrectionHandlerTest.gs
//
// LOAD ORDER: Setup tier — loads after all T0–T7 files.
//
// HOW TO RUN (Apps Script editor):
//   runWorkLogCorrectionTests()  — all 10 tests, summary at end
//
// Individual tests:
//   testWLC_amendOwnAsDesigner_pass
//   testWLC_amendOtherAsDesigner_reject
//   testWLC_amendTeamMemberAsTeamLead_pass
//   testWLC_amendNonTeamAsTeamLead_reject
//   testWLC_amendAnyAsPM_pass
//   testWLC_voidPeriodClosedAsDesigner_reject
//   testWLC_voidPeriodClosedAsPM_pass
//   testWLC_reassignAsDesigner_reject
//   testWLC_reassignAsTeamLead_pass
//   testWLC_negativeHoursGuard_reject
//
// Test actors:
//   DESIGNER   : designer@blclotus.com   (TH_DESIGNER_EMAIL, DS1) — supervisor_code SDA
//   TEAM_LEAD  : nairscanada@gmail.com   (NTL) — seeded by seedTestStaff()
//   Team member of NTL : seeded locally by this file — WLC_TEAM_MEMBER_CODE/EMAIL,
//     supervisor_code 'NTL' (Path 2 of RBAC.buildTeamCodes).
//   PM         : manually constructed mock actor (deterministic — does not
//     depend on any live roster row's current role).
//
// Uses direct handle*() calls (WorkLogCorrectionHandler.handleAmend/
// handleVoid/handleReassign), matching the existing rbacDenial/closedState
// pattern in WorkLogHandlerTest.gs — precise error-message assertions on
// reject paths, real FACT_WORK_LOGS writes on pass paths.
//
// Period-closed guard tests exercise Check 2 (job current_state forced to
// INVOICED via DAL.updateWhere — same technique as
// testWorkLogHandler_closedState). Check 1 (payroll-calculated) is not
// separately exercised here — it would require write access to
// FACT_PAYROLL_LEDGER, which is out of scope for this test module; Check 1
// is covered by code review, not a live test.
// ============================================================

// assertH_() and printResultsH_() are defined in TestHarness.gs (shared harness).

var WLC_TEAM_MEMBER_CODE  = 'TLM';
var WLC_TEAM_MEMBER_EMAIL = 'tlmember@blclotus.com';
var WLC_SEED_CEO_EMAIL    = 'raj.nair@bluelotuscanada.ca'; // matches seedTestStaff()'s SEED_CEO_EMAIL

// A dedicated, never-before-used DESIGNER for tests that must succeed with
// NO period lock in effect (tests 1 and 10). DS1 (TH_DESIGNER_CODE) is
// shared across every *HandlerTest.gs file in this repo — if a real
// payroll run has ever calculated DS1's pay for the current period,
// checkPeriodClosed_'s Check 1 would legitimately reject those two tests,
// which would look like a code bug but is actually correct PROD state.
// A code that has never been used cannot appear in FACT_PAYROLL_LEDGER.
var WLC_FRESH_DESIGNER_CODE  = 'WLD';
var WLC_FRESH_DESIGNER_EMAIL = 'wlcdesigner@blclotus.com';

function wlcSeedFreshDesigner_() {
  try {
    StaffOnboarding.onboardStaff(WLC_SEED_CEO_EMAIL, {
      person_code:     WLC_FRESH_DESIGNER_CODE,
      name:            'Test Fresh Designer',
      email:           WLC_FRESH_DESIGNER_EMAIL,
      role:            'DESIGNER',
      pay_currency:    'INR',
      pay_design:      500,
      pay_qc:          400,
      supervisor_code: '',
      pm_code:         'SGO',
      bonus_eligible:  'FALSE',
      effective_from:  '2024-01-01'
    });
  } catch (e) {
    console.log('[WorkLogCorrectionHandlerTest] wlcSeedFreshDesigner_ error: ' + e.message);
  }
}

var WLC_PM_ACTOR = {
  email:            'testpm@blclotus.com',
  personCode:       'TPM',
  role:             'PM',
  displayName:      'Test PM',
  isActive:         true,
  canAccessBilling: true,
  _rbacResolved:    true
};

// Rotating date generator — offset from WorkLogHandlerTest.gs's TW_WORK_DATE
// (2024 slot) and TW_WORK_DATE_CAP (2025 slot) to avoid any cross-file date
// collision for the shared DS1 actor. Base year 2027, 10 fixed offsets —
// one distinct date per test in this file, stable within a single run.
function wlcDate_(offsetDays) {
  var base = Date.UTC(2027, 0, 1) + (Math.floor(Date.now() / 1000) % 200) * 86400000;
  var d    = new Date(base + offsetDays * 86400000);
  var y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, dy = d.getUTCDate();
  return y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (dy < 10 ? '0' : '') + dy;
}

/** Best-effort — seeds a DESIGNER supervised by NTL (Path 2 team membership). */
function wlcSeedTeamMember_() {
  try {
    StaffOnboarding.onboardStaff(WLC_SEED_CEO_EMAIL, {
      person_code:     WLC_TEAM_MEMBER_CODE,
      name:            'Test Team Member',
      email:           WLC_TEAM_MEMBER_EMAIL,
      role:            'DESIGNER',
      pay_currency:    'INR',
      pay_design:      500,
      pay_qc:          400,
      supervisor_code: 'NTL',
      pm_code:         'SGO',
      bonus_eligible:  'FALSE',
      effective_from:  '2024-01-01'
    });
  } catch (e) {
    console.log('[WorkLogCorrectionHandlerTest] wlcSeedTeamMember_ error: ' + e.message);
  }
}

function wlcFakeQueueItem_(payloadObj) {
  return {
    queue_id:     'TEST-WLC-' + Identifiers.generateId(),
    payload_json: JSON.stringify(payloadObj)
  };
}

/** Submits an original WORK_LOG_SUBMITTED entry via the real queue flow. */
function wlcSubmitOriginal_(actorEmail, jobNumber, hours, workDate) {
  IntakeService.processSubmission({
    formType:       Config.FORM_TYPES.WORK_LOG,
    submitterEmail: actorEmail,
    payload: {
      job_number: jobNumber,
      hours:      hours,
      work_date:  workDate,
      notes:      'WorkLogCorrectionHandlerTest fixture'
    },
    source: 'TEST'
  });
  processQueueFresh_();
}

/** Reads net FACT_WORK_LOGS rows of a given event_type for actor+job, across a bounded set of periods. */
function wlcReadEvents_(actorCode, jobNumber, eventType) {
  var current = Identifiers.generateCurrentPeriodId();
  var y = parseInt(current.substr(0, 4), 10), m = parseInt(current.substr(5, 2), 10);
  var found = [];
  // Scan current period plus a wide window backward — test dates are in 2027,
  // well past "current" in this repo's simulated timeline, so also scan forward.
  var periods = [];
  for (var off = -2; off <= 2; off++) {
    var yy = y, mm = m + off;
    while (mm < 1)  { mm += 12; yy--; }
    while (mm > 12) { mm -= 12; yy++; }
    periods.push(yy + '-' + (mm < 10 ? '0' : '') + mm);
  }
  periods.push('2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08');
  for (var i = 0; i < periods.length; i++) {
    try {
      var rows = DAL.readWhere(
        Config.TABLES.FACT_WORK_LOGS,
        { actor_code: actorCode, job_number: jobNumber, event_type: eventType },
        { periodId: periods[i], callerModule: 'WorkLogCorrectionHandlerTest' }
      );
      found = found.concat(rows);
    } catch (e) { /* SHEET_NOT_FOUND — skip */ }
  }
  return found;
}

// ============================================================
// TEST 1 — Amend own entry as DESIGNER — pass
// ============================================================

function testWLC_amendOwnAsDesigner_pass() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var jobNumber = thSetupInProgressJob_('wlc-amend-own');
    if (!jobNumber) { results.push('  SKIP: setup failed'); counters.failed++; printResultsH_('testWLC_amendOwnAsDesigner_pass', results, counters); return counters; }

    var workDate = wlcDate_(1);
    wlcSubmitOriginal_(WLC_FRESH_DESIGNER_EMAIL, jobNumber, 5, workDate);

    var designerActor = RBAC.resolveActor(WLC_FRESH_DESIGNER_EMAIL);
    var payload = {
      actor_code: WLC_FRESH_DESIGNER_CODE, job_number: jobNumber, work_date: workDate,
      original_hours: 5, new_hours: 6, reason: 'Test: designer corrects own hours'
    };

    var eventId = null, threw = false, errMsg = '';
    try {
      eventId = WorkLogCorrectionHandler.handleAmend(wlcFakeQueueItem_(payload), designerActor);
    } catch (e) { threw = true; errMsg = e.message; }

    assertH_(results, counters, 'No exception amending own entry as DESIGNER', !threw, errMsg);
    assertH_(results, counters, 'Returned an event_id', !!eventId, String(eventId));

    var amendRows = wlcReadEvents_(WLC_FRESH_DESIGNER_CODE, jobNumber, Constants.EVENT_TYPES.WORK_LOG_AMENDED);
    assertH_(results, counters, 'Exactly 1 WORK_LOG_AMENDED row written', amendRows.length === 1, 'count=' + amendRows.length);
    assertH_(results, counters, 'Amendment delta hours = 1', amendRows.length === 1 && Number(amendRows[0].hours) === 1,
      amendRows.length === 1 ? String(amendRows[0].hours) : 'n/a');
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  printResultsH_('testWLC_amendOwnAsDesigner_pass', results, counters);
  return counters;
}

// ============================================================
// TEST 2 — Amend other's entry as DESIGNER — reject
// Scope check throws before any entry lookup — no fixture entry needed.
// ============================================================

function testWLC_amendOtherAsDesigner_reject() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var jobNumber = thSetupInProgressJob_('wlc-amend-other');
    if (!jobNumber) { results.push('  SKIP: setup failed'); counters.failed++; printResultsH_('testWLC_amendOtherAsDesigner_reject', results, counters); return counters; }

    var designerActor = RBAC.resolveActor(TH_DESIGNER_EMAIL);
    var payload = {
      actor_code: 'SOMEONE_ELSE', job_number: jobNumber, work_date: wlcDate_(2),
      original_hours: 5, new_hours: 6, reason: 'Test: designer attempts to amend another actor\'s entry'
    };

    var threw = false, errMsg = '';
    try {
      WorkLogCorrectionHandler.handleAmend(wlcFakeQueueItem_(payload), designerActor);
    } catch (e) { threw = true; errMsg = e.message; }

    assertH_(results, counters, 'handleAmend throws for DESIGNER amending another actor\'s entry', threw);
    assertH_(results, counters, 'Error message references own-entries-only scope',
      errMsg.indexOf('own entries') !== -1, errMsg);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  printResultsH_('testWLC_amendOtherAsDesigner_reject', results, counters);
  return counters;
}

// ============================================================
// TEST 3 — Amend team member entry as TEAM_LEAD — pass
// ============================================================

function testWLC_amendTeamMemberAsTeamLead_pass() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    wlcSeedTeamMember_();
    var jobNumber = thSetupInProgressJob_('wlc-amend-team');
    if (!jobNumber) { results.push('  SKIP: setup failed'); counters.failed++; printResultsH_('testWLC_amendTeamMemberAsTeamLead_pass', results, counters); return counters; }

    var workDate = wlcDate_(3);
    wlcSubmitOriginal_(WLC_TEAM_MEMBER_EMAIL, jobNumber, 5, workDate);

    var tlActor = RBAC.resolveActor('nairscanada@gmail.com');
    assertH_(results, counters, 'TL actor resolved as TEAM_LEAD', tlActor.role === 'TEAM_LEAD', tlActor.role);

    var payload = {
      actor_code: WLC_TEAM_MEMBER_CODE, job_number: jobNumber, work_date: workDate,
      original_hours: 5, new_hours: 7, reason: 'Test: TL corrects team member entry'
    };

    var eventId = null, threw = false, errMsg = '';
    try {
      eventId = WorkLogCorrectionHandler.handleAmend(wlcFakeQueueItem_(payload), tlActor);
    } catch (e) { threw = true; errMsg = e.message; }

    assertH_(results, counters, 'No exception — TL amends team member entry', !threw, errMsg);
    assertH_(results, counters, 'Returned an event_id', !!eventId, String(eventId));

    var amendRows = wlcReadEvents_(WLC_TEAM_MEMBER_CODE, jobNumber, Constants.EVENT_TYPES.WORK_LOG_AMENDED);
    assertH_(results, counters, 'Exactly 1 WORK_LOG_AMENDED row written', amendRows.length === 1, 'count=' + amendRows.length);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  printResultsH_('testWLC_amendTeamMemberAsTeamLead_pass', results, counters);
  return counters;
}

// ============================================================
// TEST 4 — Amend non-team entry as TEAM_LEAD — reject
// DS1's supervisor_code is 'SDA', not 'NTL' — DS1 is not on NTL's team.
// ============================================================

function testWLC_amendNonTeamAsTeamLead_reject() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var jobNumber = thSetupInProgressJob_('wlc-amend-nonteam');
    if (!jobNumber) { results.push('  SKIP: setup failed'); counters.failed++; printResultsH_('testWLC_amendNonTeamAsTeamLead_reject', results, counters); return counters; }

    var tlActor = RBAC.resolveActor('nairscanada@gmail.com');
    var payload = {
      actor_code: TH_DESIGNER_CODE, job_number: jobNumber, work_date: wlcDate_(4),
      original_hours: 5, new_hours: 6, reason: 'Test: TL attempts to amend a non-team designer\'s entry'
    };

    var threw = false, errMsg = '';
    try {
      WorkLogCorrectionHandler.handleAmend(wlcFakeQueueItem_(payload), tlActor);
    } catch (e) { threw = true; errMsg = e.message; }

    assertH_(results, counters, 'handleAmend throws for TL amending a non-team entry', threw);
    assertH_(results, counters, 'Error message references team scope', errMsg.indexOf('team') !== -1, errMsg);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  printResultsH_('testWLC_amendNonTeamAsTeamLead_reject', results, counters);
  return counters;
}

// ============================================================
// TEST 5 — Amend any entry as PM — pass
// ============================================================

function testWLC_amendAnyAsPM_pass() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var jobNumber = thSetupInProgressJob_('wlc-amend-pm');
    if (!jobNumber) { results.push('  SKIP: setup failed'); counters.failed++; printResultsH_('testWLC_amendAnyAsPM_pass', results, counters); return counters; }

    var workDate = wlcDate_(5);
    wlcSubmitOriginal_(TH_DESIGNER_EMAIL, jobNumber, 5, workDate);

    var payload = {
      actor_code: TH_DESIGNER_CODE, job_number: jobNumber, work_date: workDate,
      original_hours: 5, new_hours: 8, reason: 'Test: PM corrects any designer\'s entry'
    };

    var eventId = null, threw = false, errMsg = '';
    try {
      eventId = WorkLogCorrectionHandler.handleAmend(wlcFakeQueueItem_(payload), WLC_PM_ACTOR);
    } catch (e) { threw = true; errMsg = e.message; }

    assertH_(results, counters, 'No exception — PM amends any entry', !threw, errMsg);
    assertH_(results, counters, 'Returned an event_id', !!eventId, String(eventId));

    var amendRows = wlcReadEvents_(TH_DESIGNER_CODE, jobNumber, Constants.EVENT_TYPES.WORK_LOG_AMENDED);
    assertH_(results, counters, 'At least 1 WORK_LOG_AMENDED row written', amendRows.length >= 1, 'count=' + amendRows.length);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  printResultsH_('testWLC_amendAnyAsPM_pass', results, counters);
  return counters;
}

// ============================================================
// TEST 6 — Void with period closed as DESIGNER — reject
// Job forced to INVOICED (Check 2 of the period-closed guard).
// ============================================================

function testWLC_voidPeriodClosedAsDesigner_reject() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var jobNumber = thSetupInProgressJob_('wlc-void-closed-designer');
    if (!jobNumber) { results.push('  SKIP: setup failed'); counters.failed++; printResultsH_('testWLC_voidPeriodClosedAsDesigner_reject', results, counters); return counters; }

    var workDate = wlcDate_(6);
    wlcSubmitOriginal_(TH_DESIGNER_EMAIL, jobNumber, 4, workDate);

    DAL.updateWhere(
      Config.TABLES.VW_JOB_CURRENT_STATE,
      { job_number: jobNumber },
      { current_state: 'INVOICED' },
      { callerModule: 'WorkLogCorrectionHandlerTest' }
    );
    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'Job forced to INVOICED', vw && vw.current_state === 'INVOICED', vw ? vw.current_state : 'null');

    var designerActor = RBAC.resolveActor(TH_DESIGNER_EMAIL);
    var payload = {
      actor_code: TH_DESIGNER_CODE, job_number: jobNumber, work_date: workDate,
      hours: 4, reason: 'Test: designer attempts void on a closed job'
    };

    var threw = false, errMsg = '';
    try {
      WorkLogCorrectionHandler.handleVoid(wlcFakeQueueItem_(payload), designerActor);
    } catch (e) { threw = true; errMsg = e.message; }

    assertH_(results, counters, 'handleVoid throws for DESIGNER on closed job', threw);
    assertH_(results, counters, 'Error message names the job lock', errMsg.indexOf('locked') !== -1, errMsg);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  printResultsH_('testWLC_voidPeriodClosedAsDesigner_reject', results, counters);
  return counters;
}

// ============================================================
// TEST 7 — Void with period closed as PM — pass (override)
// ============================================================

function testWLC_voidPeriodClosedAsPM_pass() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var jobNumber = thSetupInProgressJob_('wlc-void-closed-pm');
    if (!jobNumber) { results.push('  SKIP: setup failed'); counters.failed++; printResultsH_('testWLC_voidPeriodClosedAsPM_pass', results, counters); return counters; }

    var workDate = wlcDate_(7);
    wlcSubmitOriginal_(TH_DESIGNER_EMAIL, jobNumber, 4, workDate);

    DAL.updateWhere(
      Config.TABLES.VW_JOB_CURRENT_STATE,
      { job_number: jobNumber },
      { current_state: 'INVOICED' },
      { callerModule: 'WorkLogCorrectionHandlerTest' }
    );

    var payload = {
      actor_code: TH_DESIGNER_CODE, job_number: jobNumber, work_date: workDate,
      hours: 4, reason: 'Test: PM overrides period lock to void'
    };

    var eventId = null, threw = false, errMsg = '';
    try {
      eventId = WorkLogCorrectionHandler.handleVoid(wlcFakeQueueItem_(payload), WLC_PM_ACTOR);
    } catch (e) { threw = true; errMsg = e.message; }

    assertH_(results, counters, 'No exception — PM overrides period lock', !threw, errMsg);
    assertH_(results, counters, 'Returned an event_id', !!eventId, String(eventId));

    var voidRows = wlcReadEvents_(TH_DESIGNER_CODE, jobNumber, Constants.EVENT_TYPES.WORK_LOG_VOIDED);
    assertH_(results, counters, 'At least 1 WORK_LOG_VOIDED row written', voidRows.length >= 1, 'count=' + voidRows.length);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  printResultsH_('testWLC_voidPeriodClosedAsPM_pass', results, counters);
  return counters;
}

// ============================================================
// TEST 8 — Reassign as DESIGNER — reject
// Matrix DESIGNER.WORK_LOG_REASSIGN=false — RBAC.enforcePermission()
// itself throws at Step 1, before any entry lookup.
// ============================================================

function testWLC_reassignAsDesigner_reject() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var job1 = thSetupInProgressJob_('wlc-reassign-designer-1');
    var job2 = thSetupInProgressJob_('wlc-reassign-designer-2');
    if (!job1 || !job2) { results.push('  SKIP: setup failed'); counters.failed++; printResultsH_('testWLC_reassignAsDesigner_reject', results, counters); return counters; }

    var designerActor = RBAC.resolveActor(TH_DESIGNER_EMAIL);
    var payload = {
      actor_code: TH_DESIGNER_CODE, job_number: job1, work_date: wlcDate_(8),
      hours: 3, new_job_number: job2, reason: 'Test: designer attempts reassign'
    };

    var threw = false, errMsg = '';
    try {
      WorkLogCorrectionHandler.handleReassign(wlcFakeQueueItem_(payload), designerActor);
    } catch (e) { threw = true; errMsg = e.message; }

    assertH_(results, counters, 'handleReassign throws for DESIGNER', threw);
    assertH_(results, counters, 'Error is PERMISSION_DENIED (RBAC matrix blocks reassign for DESIGNER)',
      errMsg.indexOf('PERMISSION_DENIED') !== -1, errMsg);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  printResultsH_('testWLC_reassignAsDesigner_reject', results, counters);
  return counters;
}

// ============================================================
// TEST 9 — Reassign as TEAM_LEAD — pass
// ============================================================

function testWLC_reassignAsTeamLead_pass() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    wlcSeedTeamMember_();
    var job1 = thSetupInProgressJob_('wlc-reassign-tl-1');
    var job2 = thSetupInProgressJob_('wlc-reassign-tl-2');
    if (!job1 || !job2) { results.push('  SKIP: setup failed'); counters.failed++; printResultsH_('testWLC_reassignAsTeamLead_pass', results, counters); return counters; }

    var workDate = wlcDate_(9);
    wlcSubmitOriginal_(WLC_TEAM_MEMBER_EMAIL, job1, 3, workDate);

    var tlActor = RBAC.resolveActor('nairscanada@gmail.com');
    var payload = {
      actor_code: WLC_TEAM_MEMBER_CODE, job_number: job1, work_date: workDate,
      hours: 3, new_job_number: job2, reason: 'Test: TL reassigns team member hours to a different job'
    };

    var result = null, threw = false, errMsg = '';
    try {
      result = WorkLogCorrectionHandler.handleReassign(wlcFakeQueueItem_(payload), tlActor);
    } catch (e) { threw = true; errMsg = e.message; }

    assertH_(results, counters, 'No exception — TL reassigns team member hours', !threw, errMsg);
    assertH_(results, counters, 'Returned both void and new event_ids',
      !!(result && result.voidEventId && result.newEventId), JSON.stringify(result));

    var voidRows = wlcReadEvents_(WLC_TEAM_MEMBER_CODE, job1, Constants.EVENT_TYPES.WORK_LOG_VOIDED);
    var newRows  = wlcReadEvents_(WLC_TEAM_MEMBER_CODE, job2, Constants.EVENT_TYPES.WORK_LOG_SUBMITTED);
    assertH_(results, counters, 'Original job has a WORK_LOG_VOIDED row', voidRows.length >= 1, 'count=' + voidRows.length);
    assertH_(results, counters, 'New job has a WORK_LOG_SUBMITTED row', newRows.length >= 1, 'count=' + newRows.length);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  printResultsH_('testWLC_reassignAsTeamLead_pass', results, counters);
  return counters;
}

// ============================================================
// TEST 10 — Correction that would create negative total hours — reject
// A second void of the same original entry (found again, since FACT
// tables are append-only) drives net hours below zero.
// ============================================================

function testWLC_negativeHoursGuard_reject() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var jobNumber = thSetupInProgressJob_('wlc-negative-hours');
    if (!jobNumber) { results.push('  SKIP: setup failed'); counters.failed++; printResultsH_('testWLC_negativeHoursGuard_reject', results, counters); return counters; }

    var workDate = wlcDate_(10);
    wlcSubmitOriginal_(WLC_FRESH_DESIGNER_EMAIL, jobNumber, 3, workDate);

    var designerActor = RBAC.resolveActor(WLC_FRESH_DESIGNER_EMAIL);
    var payload = {
      actor_code: WLC_FRESH_DESIGNER_CODE, job_number: jobNumber, work_date: workDate,
      hours: 3, reason: 'Test: first void — brings net to zero'
    };

    var firstThrew = false;
    try {
      WorkLogCorrectionHandler.handleVoid(wlcFakeQueueItem_(payload), designerActor);
    } catch (e) { firstThrew = true; }
    assertH_(results, counters, 'First void succeeds (net hours -> 0)', !firstThrew);

    var secondThrew = false, errMsg = '';
    try {
      WorkLogCorrectionHandler.handleVoid(wlcFakeQueueItem_(payload), designerActor);
    } catch (e) { secondThrew = true; errMsg = e.message; }

    assertH_(results, counters, 'Second void of the same entry throws (would go negative)', secondThrew);
    assertH_(results, counters, 'Error message references negative/below zero',
      errMsg.indexOf('below zero') !== -1, errMsg);

    var voidRows = wlcReadEvents_(WLC_FRESH_DESIGNER_CODE, jobNumber, Constants.EVENT_TYPES.WORK_LOG_VOIDED);
    assertH_(results, counters, 'Exactly 1 WORK_LOG_VOIDED row written (second attempt blocked)',
      voidRows.length === 1, 'count=' + voidRows.length);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  printResultsH_('testWLC_negativeHoursGuard_reject', results, counters);
  return counters;
}

// ============================================================
// RUNNER — executes all 10 tests and prints combined summary
// ============================================================

/**
 * Run all WorkLogCorrectionHandler tests and return aggregate counters.
 * @returns {{ passed: number, failed: number }}
 */
function runWorkLogCorrectionTests() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  WORK LOG CORRECTION HANDLER TEST SUITE (10 tests)');
  console.log('═══════════════════════════════════════════════════════');

  seedTestStaff();
  wlcSeedTeamMember_();
  wlcSeedFreshDesigner_();

  var suiteCounters = { passed: 0, failed: 0 };
  var tests = [
    testWLC_amendOwnAsDesigner_pass,
    testWLC_amendOtherAsDesigner_reject,
    testWLC_amendTeamMemberAsTeamLead_pass,
    testWLC_amendNonTeamAsTeamLead_reject,
    testWLC_amendAnyAsPM_pass,
    testWLC_voidPeriodClosedAsDesigner_reject,
    testWLC_voidPeriodClosedAsPM_pass,
    testWLC_reassignAsDesigner_reject,
    testWLC_reassignAsTeamLead_pass,
    testWLC_negativeHoursGuard_reject
  ];

  for (var i = 0; i < tests.length; i++) {
    DAL._resetApiCallCount();
    var c = tests[i]();
    suiteCounters.passed += c.passed;
    suiteCounters.failed += c.failed;
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  SUITE TOTAL — passed: ' + suiteCounters.passed +
              '  failed: ' + suiteCounters.failed);
  if (suiteCounters.failed === 0) {
    console.log('  ✅  ALL TESTS PASSED — ready to commit');
  } else {
    console.log('  ❌  ' + suiteCounters.failed + ' test(s) failed — fix before commit');
  }
  console.log('═══════════════════════════════════════════════════════');

  return suiteCounters;
}
