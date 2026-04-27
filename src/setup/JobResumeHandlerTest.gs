// ============================================================
// JobResumeHandlerTest.gs — BLC Nexus Setup / Tests
// src/setup/JobResumeHandlerTest.gs
//
// LOAD ORDER: Setup tier — loads after all T0–T7 files.
//
// HOW TO RUN (Apps Script editor):
//   runJobResumeTests()  — all 5 tests, summary at end
//
// Individual tests:
//   testJobResumeHandler_happyPath()
//   testJobResumeHandler_rbacDenial()
//   testJobResumeHandler_invalidPayload()
//   testJobResumeHandler_wrongState()
//   testJobResumeHandler_duplicate()
//
// Test actors:
//   DESIGNER (JOB_RESUME allowed) : designer@blclotus.com  (TH_DESIGNER_EMAIL)
//   Unknown  (no RBAC entry)      : nobody@notinrbac.com   (TH_UNKNOWN_EMAIL)
//
// Starting state for all tests: ON_HOLD (via thSetupOnHoldJob_())
//   thSetupOnHoldJob_() drives: ALLOCATED → IN_PROGRESS → ON_HOLD
//   so view.prev_state = IN_PROGRESS — resume routes back to IN_PROGRESS.
//
//   wrongState uses thSetupInProgressJob_() — current_state = IN_PROGRESS,
//   which is not ON_HOLD, so any JOB_RESUME transition is invalid.
// ============================================================

// assertH_() and printResultsH_() are defined in TestHarness.gs (shared harness).

// ============================================================
// TEST 1 — Happy Path
// ON_HOLD → JOB_RESUME → IN_PROGRESS (prev_state restored, prev_state cleared)
// Verifies: VW state = IN_PROGRESS, prev_state = '', JOB_RESUMED event written
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobResumeHandler_happyPath() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    // thSetupOnHoldJob_() leaves prev_state = IN_PROGRESS in VW
    var jobNumber = thSetupOnHoldJob_('resume-happy');
    assertH_(results, counters, 'Setup: ON_HOLD job created', !!jobNumber,
      'jobNumber=' + jobNumber);
    if (!jobNumber) { results.push('  SKIP: setup failed'); return counters; }

    // Confirm pre-conditions written by JobHoldHandler
    var vwBefore = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'Prerequisite: VW state = ON_HOLD',
      vwBefore && vwBefore.current_state === Config.STATES.ON_HOLD,
      vwBefore ? vwBefore.current_state : 'null');
    assertH_(results, counters, 'Prerequisite: VW prev_state = IN_PROGRESS',
      vwBefore && String(vwBefore.prev_state || '') === Config.STATES.IN_PROGRESS,
      vwBefore ? String(vwBefore.prev_state) : 'null');

    DAL._resetApiCallCount();

    var resumeResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_RESUME,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload:        { job_number: jobNumber, notes: 'JobResumeHandlerTest happyPath' },
      source:         'TEST'
    });
    assertH_(results, counters, 'IntakeService returns ok=true',
      resumeResult.ok === true, JSON.stringify(resumeResult));

    processQueueFresh_();

    // ── VW state: restored + prev_state cleared ──────────────
    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW state = IN_PROGRESS (prev_state restored)',
      vw && vw.current_state === Config.STATES.IN_PROGRESS,
      vw ? vw.current_state : 'null');
    assertH_(results, counters, 'VW prev_state cleared (empty string)',
      vw && String(vw.prev_state || '') === '',
      vw ? String(vw.prev_state) : 'null');

    // ── FACT_JOB_EVENTS ─────────────────────────────────────
    var events = DAL.readWhere(
      Config.TABLES.FACT_JOB_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'JobResumeHandlerTest' }
    );
    var resumedEvent = null;
    for (var i = 0; i < events.length; i++) {
      if (events[i].event_type === Constants.EVENT_TYPES.JOB_RESUMED) {
        resumedEvent = events[i]; break;
      }
    }
    assertH_(results, counters, 'FACT_JOB_EVENTS has JOB_RESUMED row', !!resumedEvent,
      'events: ' + events.map(function(e) { return e.event_type; }).join(','));
    assertH_(results, counters, 'JOB_RESUMED event has correct client_code',
      resumedEvent && resumedEvent.client_code === TH_CLIENT_CODE,
      resumedEvent ? resumedEvent.client_code : 'null');
    assertH_(results, counters, 'JOB_RESUMED event has idempotency_key',
      resumedEvent && !!resumedEvent.idempotency_key,
      resumedEvent ? resumedEvent.idempotency_key : 'null');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobResumeHandler_happyPath', results, counters);
  return counters;
}

// ============================================================
// TEST 2 — RBAC Denial
// Unknown actor (TH_UNKNOWN_EMAIL) has no RBAC entry — handler rejects
// VW state must remain ON_HOLD and prev_state must not be cleared
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobResumeHandler_rbacDenial() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupOnHoldJob_('resume-rbac');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testJobResumeHandler_rbacDenial', results, counters);
      return counters;
    }

    DAL._resetApiCallCount();

    var resumeResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_RESUME,
      submitterEmail: TH_UNKNOWN_EMAIL,
      payload:        { job_number: jobNumber },
      source:         'TEST'
    });
    processQueueFresh_();

    var queueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: resumeResult.queueId },
      { callerModule: 'JobResumeHandlerTest' }
    );
    var queueItem = queueItems.length > 0 ? queueItems[0] : null;
    assertH_(results, counters, 'Queue item exists', !!queueItem,
      'queueId=' + resumeResult.queueId);
    assertH_(results, counters, 'Queue item not completed (RBAC denial)',
      queueItem && queueItem.status !== 'COMPLETED',
      queueItem ? queueItem.status : 'null');
    assertH_(results, counters, 'Queue item error_message has retry metadata',
      queueItem && (String(queueItem.error_message || '').indexOf('attempt') !== -1 ||
                    String(queueItem.error_message || '').indexOf('exception') !== -1),
      queueItem ? String(queueItem.error_message) : 'no error_message');

    // VW must stay ON_HOLD — prev_state must also be untouched
    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW state unchanged (still ON_HOLD)',
      vw && vw.current_state === Config.STATES.ON_HOLD,
      vw ? vw.current_state : 'null');
    assertH_(results, counters, 'VW prev_state still IN_PROGRESS (not cleared)',
      vw && String(vw.prev_state || '') === Config.STATES.IN_PROGRESS,
      vw ? String(vw.prev_state) : 'null');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobResumeHandler_rbacDenial', results, counters);
  return counters;
}

// ============================================================
// TEST 3 — Invalid Payload
// job_number absent → ValidationEngine rejects before state check
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobResumeHandler_invalidPayload() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupOnHoldJob_('resume-invalid');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testJobResumeHandler_invalidPayload', results, counters);
      return counters;
    }

    DAL._resetApiCallCount();

    // job_number intentionally omitted (required field)
    var resumeResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_RESUME,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload:        { notes: 'missing job_number' },
      source:         'TEST'
    });
    processQueueFresh_();

    var queueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: resumeResult.queueId },
      { callerModule: 'JobResumeHandlerTest' }
    );
    var queueItem = queueItems.length > 0 ? queueItems[0] : null;
    assertH_(results, counters, 'Queue item exists', !!queueItem,
      'queueId=' + resumeResult.queueId);
    assertH_(results, counters, 'Queue item not completed (validation failure)',
      queueItem && queueItem.status !== 'COMPLETED',
      queueItem ? queueItem.status : 'null');
    assertH_(results, counters, 'Queue item error_message has retry metadata',
      queueItem && (String(queueItem.error_message || '').indexOf('attempt') !== -1 ||
                    String(queueItem.error_message || '').indexOf('exception') !== -1),
      queueItem ? String(queueItem.error_message) : 'no error_message');

    // Setup job must still be ON_HOLD with prev_state intact
    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'Setup job VW state unchanged (still ON_HOLD)',
      vw && vw.current_state === Config.STATES.ON_HOLD,
      vw ? vw.current_state : 'null');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobResumeHandler_invalidPayload', results, counters);
  return counters;
}

// ============================================================
// TEST 4 — Wrong State
// Job is IN_PROGRESS — not ON_HOLD, so JOB_RESUME is an
// invalid transition regardless of prev_state routing
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobResumeHandler_wrongState() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    // Job is IN_PROGRESS — never been put on hold
    var jobNumber = thSetupInProgressJob_('resume-wrongstate');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testJobResumeHandler_wrongState', results, counters);
      return counters;
    }

    var vwBefore = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'Prerequisite: VW state = IN_PROGRESS before test',
      vwBefore && vwBefore.current_state === Config.STATES.IN_PROGRESS,
      vwBefore ? vwBefore.current_state : 'null');

    DAL._resetApiCallCount();

    // Attempt JOB_RESUME on an IN_PROGRESS job — invalid, only ON_HOLD can be resumed
    var resumeResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_RESUME,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload:        { job_number: jobNumber },
      source:         'TEST'
    });
    processQueueFresh_();

    var queueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: resumeResult.queueId },
      { callerModule: 'JobResumeHandlerTest' }
    );
    var queueItem = queueItems.length > 0 ? queueItems[0] : null;
    assertH_(results, counters, 'Queue item not completed (invalid state transition)',
      queueItem && queueItem.status !== 'COMPLETED',
      queueItem ? queueItem.status : 'null');
    assertH_(results, counters, 'Queue item error_message has retry metadata',
      queueItem && (String(queueItem.error_message || '').indexOf('attempt') !== -1 ||
                    String(queueItem.error_message || '').indexOf('exception') !== -1),
      queueItem ? String(queueItem.error_message) : 'no error_message');

    // VW must stay IN_PROGRESS — no partial write, prev_state not disturbed
    var vwAfter = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW state unchanged (still IN_PROGRESS)',
      vwAfter && vwAfter.current_state === Config.STATES.IN_PROGRESS,
      vwAfter ? vwAfter.current_state : 'null');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobResumeHandler_wrongState', results, counters);
  return counters;
}

// ============================================================
// TEST 5 — Duplicate Queue Replay
// Resume job via queue, then directly call handle() with the
// same queue item — second call must return 'DUPLICATE' and
// write no additional JOB_RESUMED event.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobResumeHandler_duplicate() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupOnHoldJob_('resume-dupe');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testJobResumeHandler_duplicate', results, counters);
      return counters;
    }

    DAL._resetApiCallCount();

    // ── Step 1: Successful first resume ─────────────────────
    var firstResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_RESUME,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload:        { job_number: jobNumber, notes: 'JobResumeHandlerTest duplicate' },
      source:         'TEST'
    });
    processQueueFresh_();

    var vwAfterFirst = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'First resume: VW state = IN_PROGRESS',
      vwAfterFirst && vwAfterFirst.current_state === Config.STATES.IN_PROGRESS,
      vwAfterFirst ? vwAfterFirst.current_state : 'null');
    assertH_(results, counters, 'First resume: VW prev_state cleared',
      vwAfterFirst && String(vwAfterFirst.prev_state || '') === '',
      vwAfterFirst ? String(vwAfterFirst.prev_state) : 'null');

    // ── Step 2: Count JOB_RESUMED events before replay ──────
    var eventsBefore = DAL.readWhere(
      Config.TABLES.FACT_JOB_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'JobResumeHandlerTest' }
    );
    var resumedCountBefore = 0;
    for (var i = 0; i < eventsBefore.length; i++) {
      if (eventsBefore[i].event_type === Constants.EVENT_TYPES.JOB_RESUMED) resumedCountBefore++;
    }
    assertH_(results, counters, 'Exactly 1 JOB_RESUMED event after first resume',
      resumedCountBefore === 1, 'count=' + resumedCountBefore);

    // ── Step 3: Directly re-call handle() with same queue item
    var firstQueueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: firstResult.queueId },
      { callerModule: 'JobResumeHandlerTest' }
    );
    if (firstQueueItems.length === 0) {
      results.push('  SKIP: cannot find original queue item for duplicate test');
      counters.failed++;
      printResultsH_('testJobResumeHandler_duplicate', results, counters);
      return counters;
    }

    var fakeActor  = RBAC.resolveActor(TH_DESIGNER_EMAIL);
    var dupeReturn = JobResumeHandler.handle(firstQueueItems[0], fakeActor);

    assertH_(results, counters, 'Direct re-handle() returns DUPLICATE',
      dupeReturn === 'DUPLICATE', 'returned: ' + dupeReturn);

    // ── Step 4: Event count must still be 1 ─────────────────
    var eventsAfter = DAL.readWhere(
      Config.TABLES.FACT_JOB_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'JobResumeHandlerTest' }
    );
    var resumedCountAfter = 0;
    for (var j = 0; j < eventsAfter.length; j++) {
      if (eventsAfter[j].event_type === Constants.EVENT_TYPES.JOB_RESUMED) resumedCountAfter++;
    }
    assertH_(results, counters, 'Still exactly 1 JOB_RESUMED event after duplicate replay',
      resumedCountAfter === 1, 'count=' + resumedCountAfter);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobResumeHandler_duplicate', results, counters);
  return counters;
}

// ============================================================
// RUNNER — executes all 5 tests and prints combined summary
// ============================================================

/**
 * Run all JobResume tests and return aggregate counters.
 * Called by runV3HandlerTests() in TestHarness.gs.
 *
 * @returns {{ passed: number, failed: number }}
 */
function runJobResumeTests() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  JOB RESUME HANDLER TEST SUITE');
  console.log('═══════════════════════════════════════════════════════');

  seedTestStaff();

  var suiteCounters = { passed: 0, failed: 0 };
  var tests = [
    testJobResumeHandler_happyPath,
    testJobResumeHandler_rbacDenial,
    testJobResumeHandler_invalidPayload,
    testJobResumeHandler_wrongState,
    testJobResumeHandler_duplicate
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
