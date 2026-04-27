// ============================================================
// JobStartHandlerTest.gs — BLC Nexus Setup / Tests
// src/setup/JobStartHandlerTest.gs
//
// LOAD ORDER: Setup tier — loads after all T0–T7 files.
//
// HOW TO RUN (Apps Script editor):
//   runJobStartTests()  — all 5 tests, summary at end
//
// Individual tests:
//   testJobStartHandler_happyPath()
//   testJobStartHandler_rbacDenial()
//   testJobStartHandler_invalidPayload()
//   testJobStartHandler_wrongState()
//   testJobStartHandler_duplicate()
//
// Test actors:
//   DESIGNER (JOB_START allowed)  : designer@blclotus.com  (TH_DESIGNER_EMAIL)
//   Unknown  (no RBAC entry)      : nobody@notinrbac.com   (TH_UNKNOWN_EMAIL)
//
// Starting state for all tests: ALLOCATED (via thSetupAllocatedJob_())
//   wrongState uses thSetupIntakeReceivedJob_() — job not yet allocated
// ============================================================

// assertH_() and printResultsH_() are defined in TestHarness.gs (shared harness).

// ============================================================
// TEST 1 — Happy Path
// ALLOCATED → JOB_START → IN_PROGRESS
// Verifies: FACT_JOB_EVENTS row, VW state, allocated_to preserved
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobStartHandler_happyPath() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    // ── Setup: create job pre-allocated to DS1 ───────────────
    var jobNumber = thSetupAllocatedJob_('start-happy');
    assertH_(results, counters, 'Setup: ALLOCATED job created', !!jobNumber,
      'jobNumber=' + jobNumber);
    if (!jobNumber) { results.push('  SKIP: setup failed'); return counters; }

    DAL._resetApiCallCount();

    // ── Submit JOB_START as designer ────────────────────────
    var startResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_START,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload:        { job_number: jobNumber, notes: 'JobStartHandlerTest happyPath' },
      source:         'TEST'
    });
    assertH_(results, counters, 'IntakeService returns ok=true',
      startResult.ok === true, JSON.stringify(startResult));

    processQueueFresh_();

    // ── VW state ────────────────────────────────────────────
    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW state = IN_PROGRESS',
      vw && vw.current_state === Config.STATES.IN_PROGRESS,
      vw ? vw.current_state : 'null');
    assertH_(results, counters, 'VW allocated_to still DS1',
      vw && String(vw.allocated_to || '') === TH_DESIGNER_CODE,
      vw ? String(vw.allocated_to) : 'null');

    // ── FACT_JOB_EVENTS ─────────────────────────────────────
    var events = DAL.readWhere(
      Config.TABLES.FACT_JOB_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'JobStartHandlerTest' }
    );
    var startedEvent = null;
    for (var i = 0; i < events.length; i++) {
      if (events[i].event_type === Constants.EVENT_TYPES.JOB_STARTED) {
        startedEvent = events[i]; break;
      }
    }
    assertH_(results, counters, 'FACT_JOB_EVENTS has JOB_STARTED row', !!startedEvent,
      'events: ' + events.map(function(e) { return e.event_type; }).join(','));
    assertH_(results, counters, 'JOB_STARTED event has correct client_code',
      startedEvent && startedEvent.client_code === TH_CLIENT_CODE,
      startedEvent ? startedEvent.client_code : 'null');
    assertH_(results, counters, 'JOB_STARTED event has idempotency_key',
      startedEvent && !!startedEvent.idempotency_key,
      startedEvent ? startedEvent.idempotency_key : 'null');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobStartHandler_happyPath', results, counters);
  return counters;
}

// ============================================================
// TEST 2 — RBAC Denial
// Unknown actor (TH_UNKNOWN_EMAIL) has no RBAC entry — handler rejects
// VW state must remain ALLOCATED
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobStartHandler_rbacDenial() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupAllocatedJob_('start-rbac');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testJobStartHandler_rbacDenial', results, counters);
      return counters;
    }

    DAL._resetApiCallCount();

    var startResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_START,
      submitterEmail: TH_UNKNOWN_EMAIL,
      payload:        { job_number: jobNumber },
      source:         'TEST'
    });
    processQueueFresh_();

    var queueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: startResult.queueId },
      { callerModule: 'JobStartHandlerTest' }
    );
    var queueItem = queueItems.length > 0 ? queueItems[0] : null;
    assertH_(results, counters, 'Queue item exists', !!queueItem,
      'queueId=' + startResult.queueId);
    assertH_(results, counters, 'Queue item not completed (RBAC denial)',
      queueItem && queueItem.status !== 'COMPLETED',
      queueItem ? queueItem.status : 'null');
    assertH_(results, counters, 'Queue item error_message has retry metadata',
      queueItem && (String(queueItem.error_message || '').indexOf('attempt') !== -1 ||
                    String(queueItem.error_message || '').indexOf('exception') !== -1),
      queueItem ? String(queueItem.error_message) : 'no error_message');

    // VW state must still be ALLOCATED
    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW state unchanged (still ALLOCATED)',
      vw && vw.current_state === Config.STATES.ALLOCATED,
      vw ? vw.current_state : 'null');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobStartHandler_rbacDenial', results, counters);
  return counters;
}

// ============================================================
// TEST 3 — Invalid Payload
// job_number absent → ValidationEngine rejects before state check
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobStartHandler_invalidPayload() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupAllocatedJob_('start-invalid');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testJobStartHandler_invalidPayload', results, counters);
      return counters;
    }

    DAL._resetApiCallCount();

    // job_number intentionally omitted (required field)
    var startResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_START,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload:        { notes: 'missing job_number' },
      source:         'TEST'
    });
    processQueueFresh_();

    var queueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: startResult.queueId },
      { callerModule: 'JobStartHandlerTest' }
    );
    var queueItem = queueItems.length > 0 ? queueItems[0] : null;
    assertH_(results, counters, 'Queue item exists', !!queueItem,
      'queueId=' + startResult.queueId);
    assertH_(results, counters, 'Queue item not completed (validation failure)',
      queueItem && queueItem.status !== 'COMPLETED',
      queueItem ? queueItem.status : 'null');
    assertH_(results, counters, 'Queue item error_message has retry metadata',
      queueItem && (String(queueItem.error_message || '').indexOf('attempt') !== -1 ||
                    String(queueItem.error_message || '').indexOf('exception') !== -1),
      queueItem ? String(queueItem.error_message) : 'no error_message');

    // Setup job must still be ALLOCATED — payload error must not disturb other jobs
    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'Setup job VW state unchanged (still ALLOCATED)',
      vw && vw.current_state === Config.STATES.ALLOCATED,
      vw ? vw.current_state : 'null');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobStartHandler_invalidPayload', results, counters);
  return counters;
}

// ============================================================
// TEST 4 — Wrong State
// Job in INTAKE_RECEIVED (not yet allocated) — INTAKE_RECEIVED→IN_PROGRESS
// is an invalid transition — StateMachine rejects
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobStartHandler_wrongState() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    // Deliberately use an INTAKE_RECEIVED job (no allocated_to)
    var jobNumber = thSetupIntakeReceivedJob_('start-wrongstate');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testJobStartHandler_wrongState', results, counters);
      return counters;
    }

    var vwBefore = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'Prerequisite: VW state = INTAKE_RECEIVED before test',
      vwBefore && vwBefore.current_state === Config.STATES.INTAKE_RECEIVED,
      vwBefore ? vwBefore.current_state : 'null');

    DAL._resetApiCallCount();

    // Attempt JOB_START on an INTAKE_RECEIVED job — invalid transition
    var startResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_START,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload:        { job_number: jobNumber },
      source:         'TEST'
    });
    processQueueFresh_();

    var queueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: startResult.queueId },
      { callerModule: 'JobStartHandlerTest' }
    );
    var queueItem = queueItems.length > 0 ? queueItems[0] : null;
    assertH_(results, counters, 'Queue item not completed (invalid state transition)',
      queueItem && queueItem.status !== 'COMPLETED',
      queueItem ? queueItem.status : 'null');
    assertH_(results, counters, 'Queue item error_message has retry metadata',
      queueItem && (String(queueItem.error_message || '').indexOf('attempt') !== -1 ||
                    String(queueItem.error_message || '').indexOf('exception') !== -1),
      queueItem ? String(queueItem.error_message) : 'no error_message');

    // VW state must still be INTAKE_RECEIVED — no partial write
    var vwAfter = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW state unchanged (still INTAKE_RECEIVED)',
      vwAfter && vwAfter.current_state === Config.STATES.INTAKE_RECEIVED,
      vwAfter ? vwAfter.current_state : 'null');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobStartHandler_wrongState', results, counters);
  return counters;
}

// ============================================================
// TEST 5 — Duplicate Queue Replay
// Start job via queue, then directly call handle() with the
// same queue item — second call must return 'DUPLICATE' and
// write no additional JOB_STARTED event.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobStartHandler_duplicate() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupAllocatedJob_('start-dupe');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testJobStartHandler_duplicate', results, counters);
      return counters;
    }

    DAL._resetApiCallCount();

    // ── Step 1: Successful first start ──────────────────────
    var firstResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_START,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload:        { job_number: jobNumber, notes: 'JobStartHandlerTest duplicate' },
      source:         'TEST'
    });
    processQueueFresh_();

    var vwAfterFirst = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'First start: VW state = IN_PROGRESS',
      vwAfterFirst && vwAfterFirst.current_state === Config.STATES.IN_PROGRESS,
      vwAfterFirst ? vwAfterFirst.current_state : 'null');

    // ── Step 2: Count JOB_STARTED events before replay ──────
    var eventsBefore = DAL.readWhere(
      Config.TABLES.FACT_JOB_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'JobStartHandlerTest' }
    );
    var startedCountBefore = 0;
    for (var i = 0; i < eventsBefore.length; i++) {
      if (eventsBefore[i].event_type === Constants.EVENT_TYPES.JOB_STARTED) startedCountBefore++;
    }
    assertH_(results, counters, 'Exactly 1 JOB_STARTED event after first start',
      startedCountBefore === 1, 'count=' + startedCountBefore);

    // ── Step 3: Directly re-call handle() with same queue item
    var firstQueueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: firstResult.queueId },
      { callerModule: 'JobStartHandlerTest' }
    );
    if (firstQueueItems.length === 0) {
      results.push('  SKIP: cannot find original queue item for duplicate test');
      counters.failed++;
      printResultsH_('testJobStartHandler_duplicate', results, counters);
      return counters;
    }

    var fakeActor  = RBAC.resolveActor(TH_DESIGNER_EMAIL);
    var dupeReturn = JobStartHandler.handle(firstQueueItems[0], fakeActor);

    assertH_(results, counters, 'Direct re-handle() returns DUPLICATE',
      dupeReturn === 'DUPLICATE', 'returned: ' + dupeReturn);

    // ── Step 4: Event count must still be 1 ─────────────────
    var eventsAfter = DAL.readWhere(
      Config.TABLES.FACT_JOB_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'JobStartHandlerTest' }
    );
    var startedCountAfter = 0;
    for (var j = 0; j < eventsAfter.length; j++) {
      if (eventsAfter[j].event_type === Constants.EVENT_TYPES.JOB_STARTED) startedCountAfter++;
    }
    assertH_(results, counters, 'Still exactly 1 JOB_STARTED event after duplicate replay',
      startedCountAfter === 1, 'count=' + startedCountAfter);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobStartHandler_duplicate', results, counters);
  return counters;
}

// ============================================================
// RUNNER — executes all 5 tests and prints combined summary
// ============================================================

/**
 * Run all JobStart tests and return aggregate counters.
 * Called by runV3HandlerTests() in TestHarness.gs.
 *
 * @returns {{ passed: number, failed: number }}
 */
function runJobStartTests() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  JOB START HANDLER TEST SUITE');
  console.log('═══════════════════════════════════════════════════════');

  seedTestStaff();

  var suiteCounters = { passed: 0, failed: 0 };
  var tests = [
    testJobStartHandler_happyPath,
    testJobStartHandler_rbacDenial,
    testJobStartHandler_invalidPayload,
    testJobStartHandler_wrongState,
    testJobStartHandler_duplicate
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
