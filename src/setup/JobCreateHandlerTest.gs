// ============================================================
// JobCreateHandlerTest.gs — BLC Nexus Setup / Tests
// src/setup/JobCreateHandlerTest.gs
//
// LOAD ORDER: Setup tier — loads after all T0–T7 files.
//
// HOW TO RUN (Apps Script editor):
//   runJobCreateTests()  — all 5 tests, summary at end
//
// Individual tests:
//   testJobCreateHandler_happyPath()
//   testJobCreateHandler_rbacDenial()
//   testJobCreateHandler_invalidPayload()
//   testJobCreateHandler_wrongState()
//   testJobCreateHandler_duplicate()
//
// Test actors:
//   PM (JOB_CREATE allowed)  : sarty@blclotus.com  (TH_PM_EMAIL)
//   Unknown (no RBAC entry)  : nobody@notinrbac.com (TH_UNKNOWN_EMAIL)
// ============================================================

// assertH_() and printResultsH_() are defined in TestHarness.gs (shared harness).

// ============================================================
// TEST 1 — Happy Path
// PM submits JOB_CREATE → INTAKE_RECEIVED
// Verifies: FACT_JOB_EVENTS row, VW state, job_number allocated
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobCreateHandler_happyPath() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    clearStalePendingItems_();
    DAL._resetApiCallCount();

    var jobNumberBefore = getLatestJobNumber_();

    var createResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_CREATE,
      submitterEmail: TH_PM_EMAIL,
      payload: {
        client_code:  TH_CLIENT_CODE,
        job_type:     'DESIGN',
        product_code: TH_PRODUCT_CODE,
        quantity:     1,
        notes:        'JobCreateHandlerTest happyPath'
      },
      source: 'TEST'
    });
    assertH_(results, counters, 'IntakeService returns ok=true',
      createResult.ok === true, JSON.stringify(createResult));

    processQueueFresh_();

    var jobNumber = getLatestJobNumber_();
    assertH_(results, counters, 'New job_number allocated',
      !!jobNumber && jobNumber !== jobNumberBefore,
      'before=' + jobNumberBefore + ' after=' + jobNumber);
    if (!jobNumber) { results.push('  SKIP: no job_number'); return counters; }

    // ── VW state ────────────────────────────────────────────
    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW state = INTAKE_RECEIVED',
      vw && vw.current_state === Config.STATES.INTAKE_RECEIVED,
      vw ? vw.current_state : 'null');
    assertH_(results, counters, 'VW client_code correct',
      vw && vw.client_code === TH_CLIENT_CODE,
      vw ? vw.client_code : 'null');

    // ── FACT_JOB_EVENTS ─────────────────────────────────────
    var events = DAL.readWhere(
      Config.TABLES.FACT_JOB_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'JobCreateHandlerTest' }
    );
    var createdEvent = null;
    for (var i = 0; i < events.length; i++) {
      if (events[i].event_type === Constants.EVENT_TYPES.JOB_CREATED) {
        createdEvent = events[i]; break;
      }
    }
    assertH_(results, counters, 'FACT_JOB_EVENTS has JOB_CREATED row', !!createdEvent,
      'events: ' + events.map(function(e) { return e.event_type; }).join(','));
    assertH_(results, counters, 'JOB_CREATED event has correct client_code',
      createdEvent && createdEvent.client_code === TH_CLIENT_CODE,
      createdEvent ? createdEvent.client_code : 'null');
    assertH_(results, counters, 'JOB_CREATED event has idempotency_key',
      createdEvent && !!createdEvent.idempotency_key,
      createdEvent ? createdEvent.idempotency_key : 'null');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobCreateHandler_happyPath', results, counters);
  return counters;
}

// ============================================================
// TEST 2 — RBAC Denial
// Unknown actor (TH_UNKNOWN_EMAIL) has no RBAC entry — handler rejects
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobCreateHandler_rbacDenial() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    clearStalePendingItems_();
    DAL._resetApiCallCount();

    var jobNumberBefore = getLatestJobNumber_();

    var createResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_CREATE,
      submitterEmail: TH_UNKNOWN_EMAIL,
      payload: {
        client_code:  TH_CLIENT_CODE,
        job_type:     'DESIGN',
        product_code: TH_PRODUCT_CODE,
        quantity:     1
      },
      source: 'TEST'
    });
    processQueueFresh_();

    // Queue item must NOT be COMPLETED — RBAC throws, item stays FAILED/retrying
    var queueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: createResult.queueId },
      { callerModule: 'JobCreateHandlerTest' }
    );
    var queueItem = queueItems.length > 0 ? queueItems[0] : null;
    assertH_(results, counters, 'Queue item exists', !!queueItem,
      'queueId=' + createResult.queueId);
    assertH_(results, counters, 'Queue item not completed (RBAC denial)',
      queueItem && queueItem.status !== 'COMPLETED',
      queueItem ? queueItem.status : 'null');
    assertH_(results, counters, 'Queue item error_message has retry metadata',
      queueItem && (String(queueItem.error_message || '').indexOf('attempt') !== -1 ||
                    String(queueItem.error_message || '').indexOf('exception') !== -1),
      queueItem ? String(queueItem.error_message) : 'no error_message');

    // No new job number must have been allocated
    var jobNumberAfter = getLatestJobNumber_();
    assertH_(results, counters, 'No new job_number allocated after RBAC denial',
      jobNumberAfter === jobNumberBefore,
      'before=' + jobNumberBefore + ' after=' + jobNumberAfter);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobCreateHandler_rbacDenial', results, counters);
  return counters;
}

// ============================================================
// TEST 3 — Invalid Payload
// Required field client_code absent → ValidationEngine rejects
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobCreateHandler_invalidPayload() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    clearStalePendingItems_();
    DAL._resetApiCallCount();

    var jobNumberBefore = getLatestJobNumber_();

    // client_code intentionally omitted (required field)
    var createResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_CREATE,
      submitterEmail: TH_PM_EMAIL,
      payload: {
        job_type:     'DESIGN',
        product_code: TH_PRODUCT_CODE,
        quantity:     2
      },
      source: 'TEST'
    });
    processQueueFresh_();

    var queueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: createResult.queueId },
      { callerModule: 'JobCreateHandlerTest' }
    );
    var queueItem = queueItems.length > 0 ? queueItems[0] : null;
    assertH_(results, counters, 'Queue item exists', !!queueItem,
      'queueId=' + createResult.queueId);
    assertH_(results, counters, 'Queue item not completed (validation failure)',
      queueItem && queueItem.status !== 'COMPLETED',
      queueItem ? queueItem.status : 'null');
    assertH_(results, counters, 'Queue item error_message has retry metadata',
      queueItem && (String(queueItem.error_message || '').indexOf('attempt') !== -1 ||
                    String(queueItem.error_message || '').indexOf('exception') !== -1),
      queueItem ? String(queueItem.error_message) : 'no error_message');

    // No new job number must have been allocated
    var jobNumberAfter = getLatestJobNumber_();
    assertH_(results, counters, 'No new job_number allocated after validation failure',
      jobNumberAfter === jobNumberBefore,
      'before=' + jobNumberBefore + ' after=' + jobNumberAfter);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobCreateHandler_invalidPayload', results, counters);
  return counters;
}

// ============================================================
// TEST 4 — Wrong State (schema boundary violation)
// JOB_CREATE has no prior-state constraint — this test covers
// the closest equivalent: quantity=0 is structurally valid JSON
// but violates the schema min:1 rule, mirroring a state guard
// rejection in other handlers.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobCreateHandler_wrongState() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    clearStalePendingItems_();
    DAL._resetApiCallCount();

    var jobNumberBefore = getLatestJobNumber_();

    // quantity: 0 passes JSON parsing and type check but fails min:1
    var createResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_CREATE,
      submitterEmail: TH_PM_EMAIL,
      payload: {
        client_code:  TH_CLIENT_CODE,
        job_type:     'DESIGN',
        product_code: TH_PRODUCT_CODE,
        quantity:     0
      },
      source: 'TEST'
    });
    processQueueFresh_();

    var queueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: createResult.queueId },
      { callerModule: 'JobCreateHandlerTest' }
    );
    var queueItem = queueItems.length > 0 ? queueItems[0] : null;
    assertH_(results, counters, 'Queue item exists', !!queueItem,
      'queueId=' + createResult.queueId);
    assertH_(results, counters, 'Queue item not completed (quantity below min)',
      queueItem && queueItem.status !== 'COMPLETED',
      queueItem ? queueItem.status : 'null');
    assertH_(results, counters, 'Queue item error_message has retry metadata',
      queueItem && (String(queueItem.error_message || '').indexOf('attempt') !== -1 ||
                    String(queueItem.error_message || '').indexOf('exception') !== -1),
      queueItem ? String(queueItem.error_message) : 'no error_message');

    // No new job number must have been allocated
    var jobNumberAfter = getLatestJobNumber_();
    assertH_(results, counters, 'No new job_number allocated after schema boundary rejection',
      jobNumberAfter === jobNumberBefore,
      'before=' + jobNumberBefore + ' after=' + jobNumberAfter);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobCreateHandler_wrongState', results, counters);
  return counters;
}

// ============================================================
// TEST 5 — Duplicate Queue Replay
// Submit identical JOB_CREATE once via queue, then directly
// call handle() with the same queue item — second call must
// return 'DUPLICATE' and write no additional FACT row.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobCreateHandler_duplicate() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    clearStalePendingItems_();
    DAL._resetApiCallCount();

    // ── Step 1: Successful first create ─────────────────────
    var firstResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_CREATE,
      submitterEmail: TH_PM_EMAIL,
      payload: {
        client_code:  TH_CLIENT_CODE,
        job_type:     'DESIGN',
        product_code: TH_PRODUCT_CODE,
        quantity:     1,
        notes:        'JobCreateHandlerTest duplicate'
      },
      source: 'TEST'
    });
    processQueueFresh_();

    var jobNumber = getLatestJobNumber_();
    assertH_(results, counters, 'First create: job_number allocated', !!jobNumber,
      'jobNumber=' + jobNumber);
    if (!jobNumber) { results.push('  SKIP: no job_number'); return counters; }

    var vwAfterFirst = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'First create: VW state = INTAKE_RECEIVED',
      vwAfterFirst && vwAfterFirst.current_state === Config.STATES.INTAKE_RECEIVED,
      vwAfterFirst ? vwAfterFirst.current_state : 'null');

    // ── Step 2: Count JOB_CREATED events before replay ──────
    var eventsBefore = DAL.readWhere(
      Config.TABLES.FACT_JOB_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'JobCreateHandlerTest' }
    );
    var createdCountBefore = 0;
    for (var i = 0; i < eventsBefore.length; i++) {
      if (eventsBefore[i].event_type === Constants.EVENT_TYPES.JOB_CREATED) createdCountBefore++;
    }
    assertH_(results, counters, 'Exactly 1 JOB_CREATED event after first create',
      createdCountBefore === 1, 'count=' + createdCountBefore);

    // ── Step 3: Directly re-call handle() with same queue item
    var firstQueueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: firstResult.queueId },
      { callerModule: 'JobCreateHandlerTest' }
    );
    if (firstQueueItems.length === 0) {
      results.push('  SKIP: cannot find original queue item for duplicate test');
      counters.failed++;
      printResultsH_('testJobCreateHandler_duplicate', results, counters);
      return counters;
    }

    var fakeActor  = RBAC.resolveActor(TH_PM_EMAIL);
    var dupeReturn = JobCreateHandler.handle(firstQueueItems[0], fakeActor);

    assertH_(results, counters, 'Direct re-handle() returns DUPLICATE',
      dupeReturn === 'DUPLICATE', 'returned: ' + dupeReturn);

    // ── Step 4: Event count must still be 1 ─────────────────
    var eventsAfter = DAL.readWhere(
      Config.TABLES.FACT_JOB_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'JobCreateHandlerTest' }
    );
    var createdCountAfter = 0;
    for (var j = 0; j < eventsAfter.length; j++) {
      if (eventsAfter[j].event_type === Constants.EVENT_TYPES.JOB_CREATED) createdCountAfter++;
    }
    assertH_(results, counters, 'Still exactly 1 JOB_CREATED event after duplicate replay',
      createdCountAfter === 1, 'count=' + createdCountAfter);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobCreateHandler_duplicate', results, counters);
  return counters;
}

// ============================================================
// RUNNER — executes all 5 tests and prints combined summary
// ============================================================

/**
 * Run all JobCreate tests and return aggregate counters.
 * Called by runV3HandlerTests() in TestHarness.gs.
 *
 * @returns {{ passed: number, failed: number }}
 */
function runJobCreateTests() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  JOB CREATE HANDLER TEST SUITE');
  console.log('═══════════════════════════════════════════════════════');

  seedTestStaff();

  var suiteCounters = { passed: 0, failed: 0 };
  var tests = [
    testJobCreateHandler_happyPath,
    testJobCreateHandler_rbacDenial,
    testJobCreateHandler_invalidPayload,
    testJobCreateHandler_wrongState,
    testJobCreateHandler_duplicate
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
