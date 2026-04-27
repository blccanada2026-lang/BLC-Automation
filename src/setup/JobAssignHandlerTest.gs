// ============================================================
// JobAssignHandlerTest.gs — BLC Nexus Setup / Tests
// src/setup/JobAssignHandlerTest.gs
//
// LOAD ORDER: Setup tier — loads after all T0–T7 files.
//
// HOW TO RUN (Apps Script editor):
//   runJobAssignTests()  — all 7 tests, summary at end
//
// Individual tests:
//   testJobAssignHandler_happyPath()
//   testJobAssignHandler_rbacDenial()
//   testJobAssignHandler_invalidDesigner()
//   testJobAssignHandler_wrongState()
//   testJobAssignHandler_duplicate()
//   testJobStartHandler_happyPath()
//   testPortalData_getActiveDesigners()
//
// Test actors (from RBAC / DIM_STAFF_ROSTER):
//   PM (assign-permitted) : sarty@blclotus.com  (SUITE_PM_EMAIL)
//   DESIGNER (no assign)  : designer@blclotus.com  (SUITE_DESIGNER)
//   CEO                   : ceo@blclotus.com  (SUITE_CEO_EMAIL)
//
// Test person_code for assignment target: DS1 (designer@blclotus.com)
//   Must exist in DIM_STAFF_ROSTER as active=TRUE.
//   Run seedTestStaff() from TestRunner.gs if DS1 is missing.
// ============================================================

// assertH_() and printResultsH_() are defined in TestHarness.gs (shared harness).

// ── Constants ─────────────────────────────────────────────
var T_PERIOD_ID     = '2026-04';
var T_PM_EMAIL      = 'sarty@blclotus.com';      // PM — JOB_ALLOCATE allowed
var T_DESIGNER_EMAIL = 'designer@blclotus.com';  // DS1 — no JOB_ALLOCATE
var T_CEO_EMAIL      = 'ceo@blclotus.com';
var T_DESIGNER_CODE  = 'DS1';                    // valid active designer
var T_BAD_DESIGNER   = 'TEST-GHOST-99';          // does not exist in DIM_STAFF_ROSTER

// Base payload for creating an INTAKE_RECEIVED job (no allocated_to)
var T_CREATE_UNALLOCATED = {
  client_code:  'NORSPAN',
  job_type:     'DESIGN',
  product_code: 'Alpine-iCommand',
  quantity:     1,
  notes:        'JobAssignHandlerTest — ' + new Date().toISOString()
};

// ============================================================
// TEST 1 — Happy Path
// INTAKE_RECEIVED → JOB_ALLOCATE → ALLOCATED
// Verifies: FACT_JOB_EVENTS row, VW state, allocated_to
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobAssignHandler_happyPath() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    clearStalePendingItems_();
    DAL._resetApiCallCount();

    // ── Step 1: Create unallocated job (INTAKE_RECEIVED) ────
    var createResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_CREATE,
      submitterEmail: T_PM_EMAIL,
      payload:        T_CREATE_UNALLOCATED,
      source:         'TEST'
    });
    assertH_(results, counters, 'JOB_CREATE intake ok', createResult.ok === true,
             JSON.stringify(createResult));
    processQueueFresh_();

    var jobNumber = getLatestJobNumber_();
    assertH_(results, counters, 'Job number exists after create', !!jobNumber,
             'jobNumber=' + jobNumber);
    if (!jobNumber) { results.push('  SKIP: no job_number'); return counters; }

    var vwAfterCreate = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW state = INTAKE_RECEIVED after unallocated create',
      vwAfterCreate && vwAfterCreate.current_state === Config.STATES.INTAKE_RECEIVED,
      vwAfterCreate ? vwAfterCreate.current_state : 'null');

    // ── Step 2: Assign to DS1 ───────────────────────────────
    var assignResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_ALLOCATE,
      submitterEmail: T_PM_EMAIL,
      payload:        { job_number: jobNumber, designer_code: T_DESIGNER_CODE, notes: 'Test assign' },
      source:         'TEST'
    });
    assertH_(results, counters, 'JOB_ALLOCATE intake returns ok=true',
      assignResult.ok === true, JSON.stringify(assignResult));
    processQueueFresh_();

    // ── Verify VW ───────────────────────────────────────────
    var vwAfterAssign = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW state = ALLOCATED after assign',
      vwAfterAssign && vwAfterAssign.current_state === Config.STATES.ALLOCATED,
      vwAfterAssign ? vwAfterAssign.current_state : 'null');
    assertH_(results, counters, 'VW allocated_to = DS1 after assign',
      vwAfterAssign && String(vwAfterAssign.allocated_to || '') === T_DESIGNER_CODE,
      vwAfterAssign ? String(vwAfterAssign.allocated_to) : 'null');

    // ── Verify FACT_JOB_EVENTS ──────────────────────────────
    var events = DAL.readWhere(
      Config.TABLES.FACT_JOB_EVENTS,
      { job_number: jobNumber },
      { periodId: T_PERIOD_ID, callerModule: 'JobAssignHandlerTest' }
    );
    var allocEvent = null;
    for (var i = 0; i < events.length; i++) {
      if (events[i].event_type === Constants.EVENT_TYPES.JOB_ALLOCATED) {
        allocEvent = events[i]; break;
      }
    }
    assertH_(results, counters, 'FACT_JOB_EVENTS has JOB_ALLOCATED row', !!allocEvent,
      'events found: ' + events.map(function(e) { return e.event_type; }).join(','));
    assertH_(results, counters, 'JOB_ALLOCATED event has correct client_code',
      allocEvent && allocEvent.client_code === T_CREATE_UNALLOCATED.client_code,
      allocEvent ? allocEvent.client_code : 'null');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobAssignHandler_happyPath', results, counters);
  return counters;
}

// ============================================================
// TEST 2 — RBAC Denial
// DESIGNER (no JOB_ALLOCATE permission) cannot assign
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobAssignHandler_rbacDenial() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    clearStalePendingItems_();
    DAL._resetApiCallCount();

    // Create a job in INTAKE_RECEIVED state
    var createResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_CREATE,
      submitterEmail: T_PM_EMAIL,
      payload:        T_CREATE_UNALLOCATED,
      source:         'TEST'
    });
    if (!createResult.ok) {
      results.push('  SKIP: setup JOB_CREATE failed');
      counters.failed++;
      printResultsH_('testJobAssignHandler_rbacDenial', results, counters);
      return counters;
    }
    processQueueFresh_();

    var jobNumber = getLatestJobNumber_();
    if (!jobNumber) {
      results.push('  SKIP: no job_number after create');
      counters.failed++;
      printResultsH_('testJobAssignHandler_rbacDenial', results, counters);
      return counters;
    }

    // Attempt assign as DESIGNER (should be denied)
    var assignResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_ALLOCATE,
      submitterEmail: T_DESIGNER_EMAIL,
      payload:        { job_number: jobNumber, designer_code: T_DESIGNER_CODE },
      source:         'TEST'
    });
    processQueueFresh_();

    // Queue item should be FAILED due to RBAC
    var queueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: assignResult.queueId },
      { callerModule: 'JobAssignHandlerTest' }
    );
    var queueItem = queueItems.length > 0 ? queueItems[0] : null;
    assertH_(results, counters, 'Queue item exists', !!queueItem, 'queueId=' + assignResult.queueId);
    assertH_(results, counters, 'Queue item not completed (RBAC denial queued for retry)',
      queueItem && queueItem.status !== 'COMPLETED',
      queueItem ? queueItem.status : 'null');
    assertH_(results, counters, 'Queue item error_message has retry metadata',
      queueItem && (String(queueItem.error_message || '').indexOf('attempt') !== -1 ||
                    String(queueItem.error_message || '').indexOf('exception') !== -1),
      queueItem ? String(queueItem.error_message) : 'no error_message');

    // VW state must still be INTAKE_RECEIVED
    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW state unchanged (still INTAKE_RECEIVED)',
      vw && vw.current_state === Config.STATES.INTAKE_RECEIVED,
      vw ? vw.current_state : 'null');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobAssignHandler_rbacDenial', results, counters);
  return counters;
}

// ============================================================
// TEST 3 — Invalid Designer
// designer_code not in DIM_STAFF_ROSTER → handler error
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobAssignHandler_invalidDesigner() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    clearStalePendingItems_();
    DAL._resetApiCallCount();

    var createResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_CREATE,
      submitterEmail: T_PM_EMAIL,
      payload:        T_CREATE_UNALLOCATED,
      source:         'TEST'
    });
    if (!createResult.ok) {
      results.push('  SKIP: setup JOB_CREATE failed');
      counters.failed++;
      printResultsH_('testJobAssignHandler_invalidDesigner', results, counters);
      return counters;
    }
    processQueueFresh_();

    var jobNumber = getLatestJobNumber_();
    if (!jobNumber) {
      results.push('  SKIP: no job_number after create');
      counters.failed++;
      printResultsH_('testJobAssignHandler_invalidDesigner', results, counters);
      return counters;
    }

    var assignResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_ALLOCATE,
      submitterEmail: T_PM_EMAIL,
      payload:        { job_number: jobNumber, designer_code: T_BAD_DESIGNER },
      source:         'TEST'
    });
    processQueueFresh_();

    var queueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: assignResult.queueId },
      { callerModule: 'JobAssignHandlerTest' }
    );
    var queueItem = queueItems.length > 0 ? queueItems[0] : null;
    assertH_(results, counters, 'Queue item exists', !!queueItem);
    assertH_(results, counters, 'Queue item not completed (invalid designer queued for retry)',
      queueItem && queueItem.status !== 'COMPLETED',
      queueItem ? queueItem.status : 'null');
    assertH_(results, counters, 'Queue item error_message has retry metadata',
      queueItem && (String(queueItem.error_message || '').indexOf('attempt') !== -1 ||
                    String(queueItem.error_message || '').indexOf('exception') !== -1),
      queueItem ? String(queueItem.error_message) : 'no error_message');

    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW state unchanged (still INTAKE_RECEIVED)',
      vw && vw.current_state === Config.STATES.INTAKE_RECEIVED,
      vw ? vw.current_state : 'null');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobAssignHandler_invalidDesigner', results, counters);
  return counters;
}

// ============================================================
// TEST 4 — Wrong State
// Job already ALLOCATED → INTAKE_RECEIVED→ALLOCATED transition invalid
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobAssignHandler_wrongState() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    clearStalePendingItems_();
    DAL._resetApiCallCount();

    // Create a job WITH allocated_to — VW will be ALLOCATED
    var allocPayload = {
      client_code:  'NORSPAN',
      job_type:     'DESIGN',
      product_code: 'Alpine-iCommand',
      quantity:     1,
      allocated_to: 'designer@blclotus.com',
      notes:        'JobAssignHandlerTest wrongState — ' + new Date().toISOString()
    };
    var createResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_CREATE,
      submitterEmail: T_PM_EMAIL,
      payload:        allocPayload,
      source:         'TEST'
    });
    if (!createResult.ok) {
      results.push('  SKIP: setup JOB_CREATE failed');
      counters.failed++;
      printResultsH_('testJobAssignHandler_wrongState', results, counters);
      return counters;
    }
    processQueueFresh_();

    var jobNumber = getLatestJobNumber_();
    if (!jobNumber) {
      results.push('  SKIP: no job_number after create');
      counters.failed++;
      printResultsH_('testJobAssignHandler_wrongState', results, counters);
      return counters;
    }

    var vwBefore = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'Prerequisite: VW state = ALLOCATED before test',
      vwBefore && vwBefore.current_state === Config.STATES.ALLOCATED,
      vwBefore ? vwBefore.current_state : 'null');

    // Try to JOB_ALLOCATE a job that is already ALLOCATED
    var assignResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_ALLOCATE,
      submitterEmail: T_PM_EMAIL,
      payload:        { job_number: jobNumber, designer_code: T_DESIGNER_CODE },
      source:         'TEST'
    });
    processQueueFresh_();

    var queueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: assignResult.queueId },
      { callerModule: 'JobAssignHandlerTest' }
    );
    var queueItem = queueItems.length > 0 ? queueItems[0] : null;
    assertH_(results, counters, 'Queue item not completed (invalid transition queued for retry)',
      queueItem && queueItem.status !== 'COMPLETED',
      queueItem ? queueItem.status : 'null');
    assertH_(results, counters, 'Queue item error_message has retry metadata',
      queueItem && (String(queueItem.error_message || '').indexOf('attempt') !== -1 ||
                    String(queueItem.error_message || '').indexOf('exception') !== -1),
      queueItem ? String(queueItem.error_message) : 'no error_message');

    // VW state must still be ALLOCATED (unchanged)
    var vwAfter = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW state unchanged (still ALLOCATED)',
      vwAfter && vwAfter.current_state === Config.STATES.ALLOCATED,
      vwAfter ? vwAfter.current_state : 'null');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobAssignHandler_wrongState', results, counters);
  return counters;
}

// ============================================================
// TEST 5 — Duplicate Queue Replay
// Submit identical JOB_ALLOCATE twice — second must return DUPLICATE
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobAssignHandler_duplicate() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    clearStalePendingItems_();
    DAL._resetApiCallCount();

    // Create INTAKE_RECEIVED job
    var createResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_CREATE,
      submitterEmail: T_PM_EMAIL,
      payload:        T_CREATE_UNALLOCATED,
      source:         'TEST'
    });
    if (!createResult.ok) {
      results.push('  SKIP: setup JOB_CREATE failed');
      counters.failed++;
      printResultsH_('testJobAssignHandler_duplicate', results, counters);
      return counters;
    }
    processQueueFresh_();

    var jobNumber = getLatestJobNumber_();
    if (!jobNumber) {
      results.push('  SKIP: no job_number after create');
      counters.failed++;
      printResultsH_('testJobAssignHandler_duplicate', results, counters);
      return counters;
    }

    // First assign — should succeed
    var firstResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_ALLOCATE,
      submitterEmail: T_PM_EMAIL,
      payload:        { job_number: jobNumber, designer_code: T_DESIGNER_CODE },
      source:         'TEST'
    });
    processQueueFresh_();

    var vwAfterFirst = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'First assign: VW state = ALLOCATED',
      vwAfterFirst && vwAfterFirst.current_state === Config.STATES.ALLOCATED,
      vwAfterFirst ? vwAfterFirst.current_state : 'null');

    // Count JOB_ALLOCATED events before second call
    var eventsBefore = DAL.readWhere(
      Config.TABLES.FACT_JOB_EVENTS,
      { job_number: jobNumber },
      { periodId: T_PERIOD_ID, callerModule: 'JobAssignHandlerTest' }
    );
    var allocCountBefore = 0;
    for (var i = 0; i < eventsBefore.length; i++) {
      if (eventsBefore[i].event_type === Constants.EVENT_TYPES.JOB_ALLOCATED) allocCountBefore++;
    }
    assertH_(results, counters, 'Exactly 1 JOB_ALLOCATED event after first assign',
      allocCountBefore === 1, 'count=' + allocCountBefore);

    // Simulate a duplicate: directly call handle() with the same queue_id
    // This mirrors a retried queue item with an identical idempotency key.
    var firstQueueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: firstResult.queueId },
      { callerModule: 'JobAssignHandlerTest' }
    );
    if (firstQueueItems.length === 0) {
      results.push('  SKIP: cannot find original queue item for duplicate test');
      counters.failed++;
      printResultsH_('testJobAssignHandler_duplicate', results, counters);
      return counters;
    }

    var fakeActor = RBAC.resolveActor(T_PM_EMAIL);
    var dupeReturn = JobAssignHandler.handle(firstQueueItems[0], fakeActor);

    assertH_(results, counters, 'Direct re-handle() returns DUPLICATE',
      dupeReturn === 'DUPLICATE', 'returned: ' + dupeReturn);

    // FACT event count must still be 1 — no duplicate row written
    var eventsAfter = DAL.readWhere(
      Config.TABLES.FACT_JOB_EVENTS,
      { job_number: jobNumber },
      { periodId: T_PERIOD_ID, callerModule: 'JobAssignHandlerTest' }
    );
    var allocCountAfter = 0;
    for (var j = 0; j < eventsAfter.length; j++) {
      if (eventsAfter[j].event_type === Constants.EVENT_TYPES.JOB_ALLOCATED) allocCountAfter++;
    }
    assertH_(results, counters, 'Still exactly 1 JOB_ALLOCATED event after duplicate replay',
      allocCountAfter === 1, 'count=' + allocCountAfter);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobAssignHandler_duplicate', results, counters);
  return counters;
}

// ============================================================
// TEST 6 — JobStart Regression
// ALLOCATED job → JOB_START → IN_PROGRESS (existing handler, no regression)
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobStartHandler_happyPath() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    clearStalePendingItems_();
    DAL._resetApiCallCount();

    // Create job pre-allocated to DS1
    var allocPayload = {
      client_code:  'NORSPAN',
      job_type:     'DESIGN',
      product_code: 'Alpine-iCommand',
      quantity:     1,
      allocated_to: 'designer@blclotus.com',
      notes:        'JobStartHandler regression — ' + new Date().toISOString()
    };
    var createResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_CREATE,
      submitterEmail: T_PM_EMAIL,
      payload:        allocPayload,
      source:         'TEST'
    });
    assertH_(results, counters, 'JOB_CREATE intake ok', createResult.ok === true);
    processQueueFresh_();

    var jobNumber = getLatestJobNumber_();
    assertH_(results, counters, 'Job number exists', !!jobNumber, 'jobNumber=' + jobNumber);
    if (!jobNumber) { results.push('  SKIP: no job_number'); return counters; }

    var vwAlloc = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW state = ALLOCATED before start',
      vwAlloc && vwAlloc.current_state === Config.STATES.ALLOCATED,
      vwAlloc ? vwAlloc.current_state : 'null');

    // Start job as designer
    var startResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_START,
      submitterEmail: T_DESIGNER_EMAIL,
      payload:        { job_number: jobNumber, notes: 'Regression test' },
      source:         'TEST'
    });
    assertH_(results, counters, 'JOB_START intake ok', startResult.ok === true);
    processQueueFresh_();

    var vwStarted = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW state = IN_PROGRESS after start',
      vwStarted && vwStarted.current_state === Config.STATES.IN_PROGRESS,
      vwStarted ? vwStarted.current_state : 'null');

    var events = DAL.readWhere(
      Config.TABLES.FACT_JOB_EVENTS,
      { job_number: jobNumber },
      { periodId: T_PERIOD_ID, callerModule: 'JobAssignHandlerTest' }
    );
    var hasStarted = false;
    for (var i = 0; i < events.length; i++) {
      if (events[i].event_type === Constants.EVENT_TYPES.JOB_STARTED) { hasStarted = true; break; }
    }
    assertH_(results, counters, 'FACT_JOB_EVENTS has JOB_STARTED row', hasStarted,
      'events: ' + events.map(function(e) { return e.event_type; }).join(','));

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobStartHandler_happyPath', results, counters);
  return counters;
}

// ============================================================
// TEST 7 — PortalData.getActiveDesigners
// Returns only active DESIGNER / TEAM_LEAD rows
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testPortalData_getActiveDesigners() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    // PM has JOB_ALLOCATE permission — call should succeed
    var list = PortalData.getActiveDesigners(T_PM_EMAIL);

    assertH_(results, counters, 'Returns an array', Array.isArray(list),
      'type=' + typeof list);
    assertH_(results, counters, 'Array has at least one entry (DS1 must exist)',
      list.length >= 1, 'length=' + list.length);

    // Every entry must have required fields
    var allHaveFields = true;
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (!d.personCode || !d.name || !d.role) { allHaveFields = false; break; }
    }
    assertH_(results, counters, 'Every entry has personCode + name + role', allHaveFields,
      'entries: ' + JSON.stringify(list));

    // Only DESIGNER or TEAM_LEAD roles allowed
    var onlyAllowedRoles = true;
    for (var j = 0; j < list.length; j++) {
      var r = String(list[j].role || '').toUpperCase();
      if (r !== 'DESIGNER' && r !== 'TEAM_LEAD') { onlyAllowedRoles = false; break; }
    }
    assertH_(results, counters, 'All entries have role DESIGNER or TEAM_LEAD', onlyAllowedRoles,
      'roles: ' + list.map(function(d) { return d.role; }).join(','));

    // DS1 must appear in the list
    var hasDs1 = false;
    for (var k = 0; k < list.length; k++) {
      if (list[k].personCode === T_DESIGNER_CODE) { hasDs1 = true; break; }
    }
    assertH_(results, counters, 'DS1 (active DESIGNER) is in the result', hasDs1,
      'personCodes: ' + list.map(function(d) { return d.personCode; }).join(','));

    // RBAC denial: DESIGNER email has no JOB_ALLOCATE permission
    var denied = false;
    try {
      PortalData.getActiveDesigners(T_DESIGNER_EMAIL);
    } catch (e) {
      denied = true;
    }
    assertH_(results, counters, 'RBAC: DESIGNER email throws on getActiveDesigners', denied);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testPortalData_getActiveDesigners', results, counters);
  return counters;
}

// ============================================================
// RUNNER — executes all 7 tests and prints combined summary
// ============================================================

/**
 * Run all Assign + Start tests and print a combined PASS/FAIL summary.
 * Entry point: run this from the Apps Script editor.
 */
function runJobAssignTests() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  JOB ASSIGN + START TEST SUITE');
  console.log('═══════════════════════════════════════════════════════');

  // Ensure test staff exist before running
  seedTestStaff();

  var suiteCounters = { passed: 0, failed: 0 };
  var tests = [
    testJobAssignHandler_happyPath,
    testJobAssignHandler_rbacDenial,
    testJobAssignHandler_invalidDesigner,
    testJobAssignHandler_wrongState,
    testJobAssignHandler_duplicate,
    testJobStartHandler_happyPath,
    testPortalData_getActiveDesigners
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
}

// printResultsH_() is defined in TestHarness.gs (shared harness).
