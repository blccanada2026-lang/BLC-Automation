// ============================================================
// QCHandlerTest.gs — BLC Nexus Setup / Tests
// src/setup/QCHandlerTest.gs
//
// LOAD ORDER: Setup tier — loads after all T0–T7 files.
//
// HOW TO RUN (Apps Script editor):
//   runQCHandlerTests()  — all 5 tests, summary at end
//
// Individual tests:
//   testQCHandler_happyPath()
//   testQCHandler_rbacDenial()
//   testQCHandler_invalidPayload()
//   testQCHandler_wrongState()
//   testQCHandler_duplicate()
//
// Test actors:
//   DESIGNER (QC_SUBMIT allowed)  : designer@blclotus.com  (TH_DESIGNER_EMAIL)
//   Unknown  (no RBAC entry)      : nobody@notinrbac.com   (TH_UNKNOWN_EMAIL)
//
// Starting state: IN_PROGRESS (via thSetupInProgressJob_())
//
// NOTE — two-flow routing:
//   Flow A: IN_PROGRESS + no qc_result  → QC_REVIEW   (designer submits)
//   Flow B: QC_REVIEW   + qc_result     → COMPLETED_BILLABLE / IN_PROGRESS
//   An ALLOCATED job with no qc_result hits neither branch → handler
//   throws "unrecognised combination". This is the wrongState scenario.
//
// NOTE — duplicate test pattern:
//   After Flow A completes, state becomes QC_REVIEW. A second call
//   using the SAME queue item (no qc_result) no longer matches
//   Flow A (needs IN_PROGRESS) nor Flow B (needs qc_result), so the
//   router throws before idempotency is reached. The test asserts
//   that either the throw happened OR 'DUPLICATE' was returned —
//   both prove no second FACT_QC_EVENTS row was written.
// ============================================================

// assertH_() and printResultsH_() are defined in TestHarness.gs (shared harness).

// ============================================================
// TEST 1 — Happy Path  (Flow A)
// IN_PROGRESS + no qc_result → QC_REVIEW
// Event QC_SUBMITTED written to FACT_QC_EVENTS
// VW current_state = QC_REVIEW, prev_state = IN_PROGRESS
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testQCHandler_happyPath() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupInProgressJob_('qc-happy');
    assertH_(results, counters, 'Setup: IN_PROGRESS job created', !!jobNumber,
      'jobNumber=' + jobNumber);
    if (!jobNumber) { results.push('  SKIP: setup failed'); return counters; }

    DAL._resetApiCallCount();

    var submitResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.QC_SUBMIT,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload: {
        job_number: jobNumber,
        notes:      'QCHandlerTest happyPath'
      },
      source: 'TEST'
    });
    assertH_(results, counters, 'IntakeService returns ok=true',
      submitResult.ok === true, JSON.stringify(submitResult));

    processQueueFresh_();

    // ── VW state transition ──────────────────────────────────
    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW current_state = QC_REVIEW',
      vw && vw.current_state === Config.STATES.QC_REVIEW,
      vw ? vw.current_state : 'null');
    assertH_(results, counters, 'VW prev_state = IN_PROGRESS',
      vw && vw.prev_state === Config.STATES.IN_PROGRESS,
      vw ? vw.prev_state : 'null');

    // ── FACT_QC_EVENTS row ───────────────────────────────────
    var events = DAL.readWhere(
      Config.TABLES.FACT_QC_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'QCHandlerTest' }
    );
    var qcEvent = null;
    for (var i = 0; i < events.length; i++) {
      if (events[i].event_type === Constants.EVENT_TYPES.QC_SUBMITTED) {
        qcEvent = events[i]; break;
      }
    }
    assertH_(results, counters, 'FACT_QC_EVENTS has QC_SUBMITTED row', !!qcEvent,
      'rows found: ' + events.length);
    assertH_(results, counters, 'QC_SUBMITTED actor_code = DS1',
      qcEvent && qcEvent.actor_code === TH_DESIGNER_CODE,
      qcEvent ? qcEvent.actor_code : 'null');
    assertH_(results, counters, 'QC_SUBMITTED has idempotency_key',
      qcEvent && !!qcEvent.idempotency_key,
      qcEvent ? qcEvent.idempotency_key : 'null');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testQCHandler_happyPath', results, counters);
  return counters;
}

// ============================================================
// TEST 2 — RBAC Denial
// Unknown actor has no RBAC entry — Flow A RBAC guard throws
// Queue item stays non-COMPLETED, no FACT_QC_EVENTS row written
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testQCHandler_rbacDenial() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupInProgressJob_('qc-rbac');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testQCHandler_rbacDenial', results, counters);
      return counters;
    }

    DAL._resetApiCallCount();

    var submitResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.QC_SUBMIT,
      submitterEmail: TH_UNKNOWN_EMAIL,
      payload: {
        job_number: jobNumber,
        notes:      'rbac denial test'
      },
      source: 'TEST'
    });
    processQueueFresh_();

    var queueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: submitResult.queueId },
      { callerModule: 'QCHandlerTest' }
    );
    var queueItem = queueItems.length > 0 ? queueItems[0] : null;
    assertH_(results, counters, 'Queue item exists', !!queueItem,
      'queueId=' + submitResult.queueId);
    assertH_(results, counters, 'Queue item not completed (RBAC denial)',
      queueItem && queueItem.status !== 'COMPLETED',
      queueItem ? queueItem.status : 'null');
    assertH_(results, counters, 'Queue item error_message has retry metadata',
      queueItem && (String(queueItem.error_message || '').indexOf('attempt') !== -1 ||
                    String(queueItem.error_message || '').indexOf('exception') !== -1),
      queueItem ? String(queueItem.error_message) : 'no error_message');

    // VW must still be IN_PROGRESS
    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW state unchanged (still IN_PROGRESS)',
      vw && vw.current_state === Config.STATES.IN_PROGRESS,
      vw ? vw.current_state : 'null');

    // No FACT_QC_EVENTS row
    var events = DAL.readWhere(
      Config.TABLES.FACT_QC_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'QCHandlerTest' }
    );
    assertH_(results, counters, 'No FACT_QC_EVENTS row written after RBAC denial',
      events.length === 0, 'rows found: ' + events.length);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testQCHandler_rbacDenial', results, counters);
  return counters;
}

// ============================================================
// TEST 3 — Invalid Payload
// job_number absent → ValidationEngine rejects before routing
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testQCHandler_invalidPayload() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupInProgressJob_('qc-invalid');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testQCHandler_invalidPayload', results, counters);
      return counters;
    }

    DAL._resetApiCallCount();

    // job_number intentionally omitted (required field)
    var submitResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.QC_SUBMIT,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload: {
        notes: 'missing job_number'
      },
      source: 'TEST'
    });
    processQueueFresh_();

    var queueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: submitResult.queueId },
      { callerModule: 'QCHandlerTest' }
    );
    var queueItem = queueItems.length > 0 ? queueItems[0] : null;
    assertH_(results, counters, 'Queue item exists', !!queueItem,
      'queueId=' + submitResult.queueId);
    assertH_(results, counters, 'Queue item not completed (validation failure)',
      queueItem && queueItem.status !== 'COMPLETED',
      queueItem ? queueItem.status : 'null');
    assertH_(results, counters, 'Queue item error_message has retry metadata',
      queueItem && (String(queueItem.error_message || '').indexOf('attempt') !== -1 ||
                    String(queueItem.error_message || '').indexOf('exception') !== -1),
      queueItem ? String(queueItem.error_message) : 'no error_message');

    // Setup job VW must be undisturbed
    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'Setup job VW state unchanged (still IN_PROGRESS)',
      vw && vw.current_state === Config.STATES.IN_PROGRESS,
      vw ? vw.current_state : 'null');

    // No FACT_QC_EVENTS row written
    var events = DAL.readWhere(
      Config.TABLES.FACT_QC_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'QCHandlerTest' }
    );
    assertH_(results, counters, 'No FACT_QC_EVENTS row written after validation failure',
      events.length === 0, 'rows found: ' + events.length);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testQCHandler_invalidPayload', results, counters);
  return counters;
}

// ============================================================
// TEST 4 — Wrong State
// ALLOCATED + no qc_result matches neither Flow A (needs IN_PROGRESS)
// nor Flow B (needs qc_result) → handler throws "unrecognised
// combination". Queue item stays non-COMPLETED, no FACT_QC_EVENTS row.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testQCHandler_wrongState() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupAllocatedJob_('qc-wrong');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testQCHandler_wrongState', results, counters);
      return counters;
    }

    DAL._resetApiCallCount();

    var submitResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.QC_SUBMIT,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload: {
        job_number: jobNumber,
        notes:      'wrong state — ALLOCATED'
      },
      source: 'TEST'
    });
    processQueueFresh_();

    var queueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: submitResult.queueId },
      { callerModule: 'QCHandlerTest' }
    );
    var queueItem = queueItems.length > 0 ? queueItems[0] : null;
    assertH_(results, counters, 'Queue item exists', !!queueItem,
      'queueId=' + submitResult.queueId);
    assertH_(results, counters, 'Queue item not completed (unrecognised state combination)',
      queueItem && queueItem.status !== 'COMPLETED',
      queueItem ? queueItem.status : 'null');
    assertH_(results, counters, 'Queue item error_message has retry metadata',
      queueItem && (String(queueItem.error_message || '').indexOf('attempt') !== -1 ||
                    String(queueItem.error_message || '').indexOf('exception') !== -1),
      queueItem ? String(queueItem.error_message) : 'no error_message');

    // VW must still be ALLOCATED
    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW state unchanged (still ALLOCATED)',
      vw && vw.current_state === Config.STATES.ALLOCATED,
      vw ? vw.current_state : 'null');

    // No FACT_QC_EVENTS row
    var events = DAL.readWhere(
      Config.TABLES.FACT_QC_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'QCHandlerTest' }
    );
    assertH_(results, counters, 'No FACT_QC_EVENTS row written after wrong-state rejection',
      events.length === 0, 'rows found: ' + events.length);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testQCHandler_wrongState', results, counters);
  return counters;
}

// ============================================================
// TEST 5 — Duplicate Queue Replay
// Submit Flow A via queue → QC_REVIEW transition + 1 QC_SUBMITTED row.
// Then directly call handle() with the same queue item.
// State is now QC_REVIEW and qc_result is absent → routing throw
// (idempotency key is gated inside flow helpers, after routing).
// Assert: second call threw at routing OR returned 'DUPLICATE' —
// either proves no second FACT_QC_EVENTS row was written.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testQCHandler_duplicate() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupInProgressJob_('qc-dupe');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testQCHandler_duplicate', results, counters);
      return counters;
    }

    DAL._resetApiCallCount();

    // ── Step 1: Successful Flow A submission ─────────────────
    var firstResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.QC_SUBMIT,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload: {
        job_number: jobNumber,
        notes:      'QCHandlerTest duplicate'
      },
      source: 'TEST'
    });
    processQueueFresh_();

    var eventsAfterFirst = DAL.readWhere(
      Config.TABLES.FACT_QC_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'QCHandlerTest' }
    );
    var eventCountBefore = 0;
    for (var i = 0; i < eventsAfterFirst.length; i++) {
      if (eventsAfterFirst[i].event_type === Constants.EVENT_TYPES.QC_SUBMITTED) eventCountBefore++;
    }
    assertH_(results, counters, 'Exactly 1 QC_SUBMITTED row after first submission',
      eventCountBefore === 1, 'count=' + eventCountBefore);

    var vwAfterFirst = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW state = QC_REVIEW after first submission',
      vwAfterFirst && vwAfterFirst.current_state === Config.STATES.QC_REVIEW,
      vwAfterFirst ? vwAfterFirst.current_state : 'null');

    // ── Step 2: Directly re-call handle() with same queue item
    var firstQueueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: firstResult.queueId },
      { callerModule: 'QCHandlerTest' }
    );
    if (firstQueueItems.length === 0) {
      results.push('  SKIP: cannot find original queue item for duplicate test');
      counters.failed++;
      printResultsH_('testQCHandler_duplicate', results, counters);
      return counters;
    }

    var fakeActor   = RBAC.resolveActor(TH_DESIGNER_EMAIL);
    var secondThrew = false;
    var secondReturn;
    try {
      secondReturn = QCHandler.handle(firstQueueItems[0], fakeActor);
    } catch (routingError) {
      secondThrew = true;
    }

    assertH_(results, counters,
      'Second handle() threw at routing or returned DUPLICATE (no second write)',
      secondThrew || secondReturn === 'DUPLICATE',
      secondThrew ? 'correctly threw at routing guard' : 'returned: ' + secondReturn);

    // ── Step 3: Row count must still be 1 ───────────────────
    var eventsAfterDupe = DAL.readWhere(
      Config.TABLES.FACT_QC_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'QCHandlerTest' }
    );
    var eventCountAfter = 0;
    for (var j = 0; j < eventsAfterDupe.length; j++) {
      if (eventsAfterDupe[j].event_type === Constants.EVENT_TYPES.QC_SUBMITTED) eventCountAfter++;
    }
    assertH_(results, counters, 'Still exactly 1 QC_SUBMITTED row after duplicate replay',
      eventCountAfter === 1, 'count=' + eventCountAfter);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testQCHandler_duplicate', results, counters);
  return counters;
}

// ============================================================
// RUNNER — executes all 5 tests and prints combined summary
// ============================================================

/**
 * Run all QC Handler tests and return aggregate counters.
 * Called by runV3HandlerTests() in TestHarness.gs.
 *
 * @returns {{ passed: number, failed: number }}
 */
function runQCHandlerTests() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  QC HANDLER TEST SUITE');
  console.log('═══════════════════════════════════════════════════════');

  seedTestStaff();

  var suiteCounters = { passed: 0, failed: 0 };
  var tests = [
    testQCHandler_happyPath,
    testQCHandler_rbacDenial,
    testQCHandler_invalidPayload,
    testQCHandler_wrongState,
    testQCHandler_duplicate
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
