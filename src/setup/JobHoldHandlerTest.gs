// ============================================================
// JobHoldHandlerTest.gs — BLC Nexus Setup / Tests
// src/setup/JobHoldHandlerTest.gs
//
// LOAD ORDER: Setup tier — loads after all T0–T7 files.
//
// HOW TO RUN (Apps Script editor):
//   runJobHoldTests()  — all 5 tests, summary at end
//
// Individual tests:
//   testJobHoldHandler_happyPath()
//   testJobHoldHandler_rbacDenial()
//   testJobHoldHandler_invalidPayload()
//   testJobHoldHandler_wrongState()
//   testJobHoldHandler_duplicate()
//
// Test actors:
//   DESIGNER (JOB_HOLD allowed) : designer@blclotus.com  (TH_DESIGNER_EMAIL)
//   Unknown  (no RBAC entry)    : nobody@notinrbac.com   (TH_UNKNOWN_EMAIL)
//
// Starting state for all tests: IN_PROGRESS (via thSetupInProgressJob_())
//   wrongState uses thSetupIntakeReceivedJob_() — INTAKE_RECEIVED→ON_HOLD invalid
// ============================================================

// assertH_() and printResultsH_() are defined in TestHarness.gs (shared harness).

// ============================================================
// TEST 1 — Happy Path
// IN_PROGRESS → JOB_HOLD → ON_HOLD
// Verifies: FACT_JOB_EVENTS row, VW state, prev_state recorded
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobHoldHandler_happyPath() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupInProgressJob_('hold-happy');
    assertH_(results, counters, 'Setup: IN_PROGRESS job created', !!jobNumber,
      'jobNumber=' + jobNumber);
    if (!jobNumber) { results.push('  SKIP: setup failed'); return counters; }

    DAL._resetApiCallCount();

    var holdResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_HOLD,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload:        { job_number: jobNumber, notes: 'JobHoldHandlerTest happyPath' },
      source:         'TEST'
    });
    assertH_(results, counters, 'IntakeService returns ok=true',
      holdResult.ok === true, JSON.stringify(holdResult));

    processQueueFresh_();

    // ── VW state ────────────────────────────────────────────
    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW state = ON_HOLD',
      vw && vw.current_state === Config.STATES.ON_HOLD,
      vw ? vw.current_state : 'null');
    assertH_(results, counters, 'VW prev_state = IN_PROGRESS',
      vw && String(vw.prev_state || '') === Config.STATES.IN_PROGRESS,
      vw ? String(vw.prev_state) : 'null');

    // ── FACT_JOB_EVENTS ─────────────────────────────────────
    var events = DAL.readWhere(
      Config.TABLES.FACT_JOB_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'JobHoldHandlerTest' }
    );
    var heldEvent = null;
    for (var i = 0; i < events.length; i++) {
      if (events[i].event_type === Constants.EVENT_TYPES.JOB_HELD) {
        heldEvent = events[i]; break;
      }
    }
    assertH_(results, counters, 'FACT_JOB_EVENTS has JOB_HELD row', !!heldEvent,
      'events: ' + events.map(function(e) { return e.event_type; }).join(','));
    assertH_(results, counters, 'JOB_HELD event has correct client_code',
      heldEvent && heldEvent.client_code === TH_CLIENT_CODE,
      heldEvent ? heldEvent.client_code : 'null');
    assertH_(results, counters, 'JOB_HELD event has idempotency_key',
      heldEvent && !!heldEvent.idempotency_key,
      heldEvent ? heldEvent.idempotency_key : 'null');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobHoldHandler_happyPath', results, counters);
  return counters;
}

// ============================================================
// TEST 2 — RBAC Denial
// Unknown actor (TH_UNKNOWN_EMAIL) has no RBAC entry — handler rejects
// VW state must remain IN_PROGRESS
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobHoldHandler_rbacDenial() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupInProgressJob_('hold-rbac');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testJobHoldHandler_rbacDenial', results, counters);
      return counters;
    }

    DAL._resetApiCallCount();

    var holdResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_HOLD,
      submitterEmail: TH_UNKNOWN_EMAIL,
      payload:        { job_number: jobNumber, notes: 'rbac denial test' },
      source:         'TEST'
    });
    processQueueFresh_();

    var queueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: holdResult.queueId },
      { callerModule: 'JobHoldHandlerTest' }
    );
    var queueItem = queueItems.length > 0 ? queueItems[0] : null;
    assertH_(results, counters, 'Queue item exists', !!queueItem,
      'queueId=' + holdResult.queueId);
    assertH_(results, counters, 'Queue item not completed (RBAC denial)',
      queueItem && queueItem.status !== 'COMPLETED',
      queueItem ? queueItem.status : 'null');
    assertH_(results, counters, 'Queue item error_message has retry metadata',
      queueItem && (String(queueItem.error_message || '').indexOf('attempt') !== -1 ||
                    String(queueItem.error_message || '').indexOf('exception') !== -1),
      queueItem ? String(queueItem.error_message) : 'no error_message');

    // VW state must still be IN_PROGRESS
    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW state unchanged (still IN_PROGRESS)',
      vw && vw.current_state === Config.STATES.IN_PROGRESS,
      vw ? vw.current_state : 'null');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobHoldHandler_rbacDenial', results, counters);
  return counters;
}

// ============================================================
// TEST 3 — Invalid Payload
// job_number absent → ValidationEngine rejects before state check
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobHoldHandler_invalidPayload() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupInProgressJob_('hold-invalid');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testJobHoldHandler_invalidPayload', results, counters);
      return counters;
    }

    DAL._resetApiCallCount();

    // job_number intentionally omitted (required field)
    var holdResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_HOLD,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload:        { notes: 'missing job_number' },
      source:         'TEST'
    });
    processQueueFresh_();

    var queueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: holdResult.queueId },
      { callerModule: 'JobHoldHandlerTest' }
    );
    var queueItem = queueItems.length > 0 ? queueItems[0] : null;
    assertH_(results, counters, 'Queue item exists', !!queueItem,
      'queueId=' + holdResult.queueId);
    assertH_(results, counters, 'Queue item not completed (validation failure)',
      queueItem && queueItem.status !== 'COMPLETED',
      queueItem ? queueItem.status : 'null');
    assertH_(results, counters, 'Queue item error_message has retry metadata',
      queueItem && (String(queueItem.error_message || '').indexOf('attempt') !== -1 ||
                    String(queueItem.error_message || '').indexOf('exception') !== -1),
      queueItem ? String(queueItem.error_message) : 'no error_message');

    // Setup job must still be IN_PROGRESS
    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'Setup job VW state unchanged (still IN_PROGRESS)',
      vw && vw.current_state === Config.STATES.IN_PROGRESS,
      vw ? vw.current_state : 'null');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobHoldHandler_invalidPayload', results, counters);
  return counters;
}

// ============================================================
// TEST 4 — Wrong State
// Job in INTAKE_RECEIVED — neither ALLOCATED nor IN_PROGRESS,
// so INTAKE_RECEIVED→ON_HOLD is an invalid transition
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobHoldHandler_wrongState() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupIntakeReceivedJob_('hold-wrongstate');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testJobHoldHandler_wrongState', results, counters);
      return counters;
    }

    var vwBefore = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'Prerequisite: VW state = INTAKE_RECEIVED before test',
      vwBefore && vwBefore.current_state === Config.STATES.INTAKE_RECEIVED,
      vwBefore ? vwBefore.current_state : 'null');

    DAL._resetApiCallCount();

    var holdResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_HOLD,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload:        { job_number: jobNumber, notes: 'wrong state test' },
      source:         'TEST'
    });
    processQueueFresh_();

    var queueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: holdResult.queueId },
      { callerModule: 'JobHoldHandlerTest' }
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

  printResultsH_('testJobHoldHandler_wrongState', results, counters);
  return counters;
}

// ============================================================
// TEST 5 — Duplicate Queue Replay
// Hold job via queue, then directly call handle() with the
// same queue item — second call must return 'DUPLICATE' and
// write no additional JOB_HELD event.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobHoldHandler_duplicate() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupInProgressJob_('hold-dupe');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testJobHoldHandler_duplicate', results, counters);
      return counters;
    }

    DAL._resetApiCallCount();

    // ── Step 1: Successful first hold ───────────────────────
    var firstResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_HOLD,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload:        { job_number: jobNumber, notes: 'JobHoldHandlerTest duplicate' },
      source:         'TEST'
    });
    processQueueFresh_();

    var vwAfterFirst = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'First hold: VW state = ON_HOLD',
      vwAfterFirst && vwAfterFirst.current_state === Config.STATES.ON_HOLD,
      vwAfterFirst ? vwAfterFirst.current_state : 'null');

    // ── Step 2: Count JOB_HELD events before replay ─────────
    var eventsBefore = DAL.readWhere(
      Config.TABLES.FACT_JOB_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'JobHoldHandlerTest' }
    );
    var heldCountBefore = 0;
    for (var i = 0; i < eventsBefore.length; i++) {
      if (eventsBefore[i].event_type === Constants.EVENT_TYPES.JOB_HELD) heldCountBefore++;
    }
    assertH_(results, counters, 'Exactly 1 JOB_HELD event after first hold',
      heldCountBefore === 1, 'count=' + heldCountBefore);

    // ── Step 3: Directly re-call handle() with same queue item
    var firstQueueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: firstResult.queueId },
      { callerModule: 'JobHoldHandlerTest' }
    );
    if (firstQueueItems.length === 0) {
      results.push('  SKIP: cannot find original queue item for duplicate test');
      counters.failed++;
      printResultsH_('testJobHoldHandler_duplicate', results, counters);
      return counters;
    }

    var fakeActor  = RBAC.resolveActor(TH_DESIGNER_EMAIL);
    var dupeReturn = JobHoldHandler.handle(firstQueueItems[0], fakeActor);

    assertH_(results, counters, 'Direct re-handle() returns DUPLICATE',
      dupeReturn === 'DUPLICATE', 'returned: ' + dupeReturn);

    // ── Step 4: Event count must still be 1 ─────────────────
    var eventsAfter = DAL.readWhere(
      Config.TABLES.FACT_JOB_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'JobHoldHandlerTest' }
    );
    var heldCountAfter = 0;
    for (var j = 0; j < eventsAfter.length; j++) {
      if (eventsAfter[j].event_type === Constants.EVENT_TYPES.JOB_HELD) heldCountAfter++;
    }
    assertH_(results, counters, 'Still exactly 1 JOB_HELD event after duplicate replay',
      heldCountAfter === 1, 'count=' + heldCountAfter);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobHoldHandler_duplicate', results, counters);
  return counters;
}

// ============================================================
// RUNNER — executes all 5 tests and prints combined summary
// ============================================================

/**
 * Run all JobHold tests and return aggregate counters.
 * Called by runV3HandlerTests() in TestHarness.gs.
 *
 * @returns {{ passed: number, failed: number }}
 */
function runJobHoldTests() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  JOB HOLD HANDLER TEST SUITE');
  console.log('═══════════════════════════════════════════════════════');

  seedTestStaff();

  var suiteCounters = { passed: 0, failed: 0 };
  var tests = [
    testJobHoldHandler_happyPath,
    testJobHoldHandler_rbacDenial,
    testJobHoldHandler_invalidPayload,
    testJobHoldHandler_wrongState,
    testJobHoldHandler_duplicate
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
