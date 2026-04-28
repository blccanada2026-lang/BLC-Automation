// ============================================================
// WorkLogHandlerTest.gs — BLC Nexus Setup / Tests
// src/setup/WorkLogHandlerTest.gs
//
// LOAD ORDER: Setup tier — loads after all T0–T7 files.
//
// HOW TO RUN (Apps Script editor):
//   runWorkLogTests()  — all 5 tests, summary at end
//
// Individual tests:
//   testWorkLogHandler_happyPath()
//   testWorkLogHandler_rbacDenial()
//   testWorkLogHandler_invalidPayload()
//   testWorkLogHandler_wrongState()
//   testWorkLogHandler_duplicate()
//
// Test actors:
//   DESIGNER (WORK_LOG_SUBMIT allowed) : designer@blclotus.com  (TH_DESIGNER_EMAIL)
//   Unknown  (no RBAC entry)           : nobody@notinrbac.com   (TH_UNKNOWN_EMAIL)
//
// Starting state: IN_PROGRESS (via thSetupInProgressJob_())
//
// NOTE — wrongState design:
//   WorkLogHandler rejects only terminal states (INVOICED).
//   ALLOCATED is non-terminal so it would be ACCEPTED, not rejected —
//   thSetupAllocatedJob_() cannot produce a wrongState failure here.
//   Instead, wrongState submits a syntactically valid job number
//   (BLC-99999) that does not exist in VW_JOB_CURRENT_STATE.
//   This exercises the real Step 4 guard: job-not-found throws,
//   queue item stays non-COMPLETED, no FACT_WORK_LOGS row written.
//
// NOTE — state invariant:
//   WorkLogHandler writes to FACT_WORK_LOGS only — it does NOT
//   update VW_JOB_CURRENT_STATE. VW current_state must remain
//   IN_PROGRESS before and after every successful log submission.
// ============================================================

// assertH_() and printResultsH_() are defined in TestHarness.gs (shared harness).

// Work date used across all tests — a mid-month date in the test period.
var TW_WORK_DATE = '2026-04-15';

// ============================================================
// TEST 1 — Happy Path
// IN_PROGRESS job → WORK_LOG submitted → FACT_WORK_LOGS row written
// VW current_state must remain IN_PROGRESS (no state change)
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testWorkLogHandler_happyPath() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupInProgressJob_('wl-happy');
    assertH_(results, counters, 'Setup: IN_PROGRESS job created', !!jobNumber,
      'jobNumber=' + jobNumber);
    if (!jobNumber) { results.push('  SKIP: setup failed'); return counters; }

    DAL._resetApiCallCount();

    var logResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.WORK_LOG,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload: {
        job_number: jobNumber,
        hours:      3.5,
        work_date:  TW_WORK_DATE,
        notes:      'WorkLogHandlerTest happyPath'
      },
      source: 'TEST'
    });
    assertH_(results, counters, 'IntakeService returns ok=true',
      logResult.ok === true, JSON.stringify(logResult));

    processQueueFresh_();

    // ── VW state must be unchanged ───────────────────────────
    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW current_state still IN_PROGRESS (no state change)',
      vw && vw.current_state === Config.STATES.IN_PROGRESS,
      vw ? vw.current_state : 'null');

    // ── FACT_WORK_LOGS row ───────────────────────────────────
    var logs = DAL.readWhere(
      Config.TABLES.FACT_WORK_LOGS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'WorkLogHandlerTest' }
    );
    var logEvent = null;
    for (var i = 0; i < logs.length; i++) {
      if (logs[i].event_type === Constants.EVENT_TYPES.WORK_LOG_SUBMITTED) {
        logEvent = logs[i]; break;
      }
    }
    assertH_(results, counters, 'FACT_WORK_LOGS has WORK_LOG_SUBMITTED row', !!logEvent,
      'rows found: ' + logs.length);
    assertH_(results, counters, 'WORK_LOG_SUBMITTED hours = 3.5',
      logEvent && Number(logEvent.hours) === 3.5,
      logEvent ? String(logEvent.hours) : 'null');
    assertH_(results, counters, 'WORK_LOG_SUBMITTED work_date correct',
      logEvent && logEvent.work_date === TW_WORK_DATE,
      logEvent ? logEvent.work_date : 'null');
    assertH_(results, counters, 'WORK_LOG_SUBMITTED actor_code = DS1',
      logEvent && logEvent.actor_code === TH_DESIGNER_CODE,
      logEvent ? logEvent.actor_code : 'null');
    assertH_(results, counters, 'WORK_LOG_SUBMITTED has idempotency_key',
      logEvent && !!logEvent.idempotency_key,
      logEvent ? logEvent.idempotency_key : 'null');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testWorkLogHandler_happyPath', results, counters);
  return counters;
}

// ============================================================
// TEST 2 — RBAC Denial
// Unknown actor (TH_UNKNOWN_EMAIL) has no RBAC entry — handler rejects
// VW state must remain IN_PROGRESS, no FACT_WORK_LOGS row written
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testWorkLogHandler_rbacDenial() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupInProgressJob_('wl-rbac');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testWorkLogHandler_rbacDenial', results, counters);
      return counters;
    }

    DAL._resetApiCallCount();

    var logResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.WORK_LOG,
      submitterEmail: TH_UNKNOWN_EMAIL,
      payload: {
        job_number: jobNumber,
        hours:      2.0,
        work_date:  TW_WORK_DATE
      },
      source: 'TEST'
    });
    processQueueFresh_();

    var queueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: logResult.queueId },
      { callerModule: 'WorkLogHandlerTest' }
    );
    var queueItem = queueItems.length > 0 ? queueItems[0] : null;
    assertH_(results, counters, 'Queue item exists', !!queueItem,
      'queueId=' + logResult.queueId);
    assertH_(results, counters, 'Queue item not completed (RBAC denial)',
      queueItem && queueItem.status !== 'COMPLETED',
      queueItem ? queueItem.status : 'null');
    assertH_(results, counters, 'Queue item error_message has retry metadata',
      queueItem && (String(queueItem.error_message || '').indexOf('attempt') !== -1 ||
                    String(queueItem.error_message || '').indexOf('exception') !== -1),
      queueItem ? String(queueItem.error_message) : 'no error_message');

    // VW must be unchanged
    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW state unchanged (still IN_PROGRESS)',
      vw && vw.current_state === Config.STATES.IN_PROGRESS,
      vw ? vw.current_state : 'null');

    // No FACT_WORK_LOGS row must have been written for this job
    var logs = DAL.readWhere(
      Config.TABLES.FACT_WORK_LOGS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'WorkLogHandlerTest' }
    );
    assertH_(results, counters, 'No FACT_WORK_LOGS row written after RBAC denial',
      logs.length === 0, 'rows found: ' + logs.length);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testWorkLogHandler_rbacDenial', results, counters);
  return counters;
}

// ============================================================
// TEST 3 — Invalid Payload
// hours field absent → ValidationEngine rejects before any state check
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testWorkLogHandler_invalidPayload() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupInProgressJob_('wl-invalid');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testWorkLogHandler_invalidPayload', results, counters);
      return counters;
    }

    DAL._resetApiCallCount();

    // hours intentionally omitted (required field)
    var logResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.WORK_LOG,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload: {
        job_number: jobNumber,
        work_date:  TW_WORK_DATE,
        notes:      'missing hours field'
      },
      source: 'TEST'
    });
    processQueueFresh_();

    var queueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: logResult.queueId },
      { callerModule: 'WorkLogHandlerTest' }
    );
    var queueItem = queueItems.length > 0 ? queueItems[0] : null;
    assertH_(results, counters, 'Queue item exists', !!queueItem,
      'queueId=' + logResult.queueId);
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

    // No FACT_WORK_LOGS row written
    var logs = DAL.readWhere(
      Config.TABLES.FACT_WORK_LOGS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'WorkLogHandlerTest' }
    );
    assertH_(results, counters, 'No FACT_WORK_LOGS row written after validation failure',
      logs.length === 0, 'rows found: ' + logs.length);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testWorkLogHandler_invalidPayload', results, counters);
  return counters;
}

// ============================================================
// TEST 4 — Wrong State (job not found)
// Payload is schema-valid but job_number does not exist in
// VW_JOB_CURRENT_STATE — handler throws at Step 4 job-existence
// guard. ALLOCATED is non-terminal and would be accepted, so
// this test uses a ghost job number instead (see file header).
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testWorkLogHandler_wrongState() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    clearStalePendingItems_();
    DAL._resetApiCallCount();

    // BLC-99999 matches the schema pattern but has no VW row
    var ghostJobNumber = 'BLC-99999';

    var logResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.WORK_LOG,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload: {
        job_number: ghostJobNumber,
        hours:      1.0,
        work_date:  TW_WORK_DATE,
        notes:      'wrong state — ghost job'
      },
      source: 'TEST'
    });
    processQueueFresh_();

    var queueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: logResult.queueId },
      { callerModule: 'WorkLogHandlerTest' }
    );
    var queueItem = queueItems.length > 0 ? queueItems[0] : null;
    assertH_(results, counters, 'Queue item exists', !!queueItem,
      'queueId=' + logResult.queueId);
    assertH_(results, counters, 'Queue item not completed (job not found in VW)',
      queueItem && queueItem.status !== 'COMPLETED',
      queueItem ? queueItem.status : 'null');
    assertH_(results, counters, 'Queue item error_message has retry metadata',
      queueItem && (String(queueItem.error_message || '').indexOf('attempt') !== -1 ||
                    String(queueItem.error_message || '').indexOf('exception') !== -1),
      queueItem ? String(queueItem.error_message) : 'no error_message');

    // Confirm ghost job has no VW entry and no FACT_WORK_LOGS row
    var ghostView = StateMachine.getJobView(ghostJobNumber);
    assertH_(results, counters, 'Ghost job has no VW entry',
      !ghostView, ghostView ? ghostView.current_state : 'correctly null');

    var logs = DAL.readWhere(
      Config.TABLES.FACT_WORK_LOGS,
      { job_number: ghostJobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'WorkLogHandlerTest' }
    );
    assertH_(results, counters, 'No FACT_WORK_LOGS row written for ghost job',
      logs.length === 0, 'rows found: ' + logs.length);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testWorkLogHandler_wrongState', results, counters);
  return counters;
}

// ============================================================
// TEST 5 — Duplicate Queue Replay
// Submit work log via queue, then directly call handle() with
// the same queue item — second call must return 'DUPLICATE' and
// write no additional FACT_WORK_LOGS row.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testWorkLogHandler_duplicate() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupInProgressJob_('wl-dupe');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testWorkLogHandler_duplicate', results, counters);
      return counters;
    }

    DAL._resetApiCallCount();

    // ── Step 1: Successful first log submission ──────────────
    var firstResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.WORK_LOG,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload: {
        job_number: jobNumber,
        hours:      4.0,
        work_date:  TW_WORK_DATE,
        notes:      'WorkLogHandlerTest duplicate'
      },
      source: 'TEST'
    });
    processQueueFresh_();

    var logsAfterFirst = DAL.readWhere(
      Config.TABLES.FACT_WORK_LOGS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'WorkLogHandlerTest' }
    );
    var logCountBefore = 0;
    for (var i = 0; i < logsAfterFirst.length; i++) {
      if (logsAfterFirst[i].event_type === Constants.EVENT_TYPES.WORK_LOG_SUBMITTED) logCountBefore++;
    }
    assertH_(results, counters, 'Exactly 1 WORK_LOG_SUBMITTED row after first submission',
      logCountBefore === 1, 'count=' + logCountBefore);

    var vwAfterFirst = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW state still IN_PROGRESS after first log',
      vwAfterFirst && vwAfterFirst.current_state === Config.STATES.IN_PROGRESS,
      vwAfterFirst ? vwAfterFirst.current_state : 'null');

    // ── Step 2: Directly re-call handle() with same queue item
    var firstQueueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: firstResult.queueId },
      { callerModule: 'WorkLogHandlerTest' }
    );
    if (firstQueueItems.length === 0) {
      results.push('  SKIP: cannot find original queue item for duplicate test');
      counters.failed++;
      printResultsH_('testWorkLogHandler_duplicate', results, counters);
      return counters;
    }

    var fakeActor  = RBAC.resolveActor(TH_DESIGNER_EMAIL);
    var dupeReturn = WorkLogHandler.handle(firstQueueItems[0], fakeActor);

    assertH_(results, counters, 'Direct re-handle() returns DUPLICATE',
      dupeReturn === 'DUPLICATE', 'returned: ' + dupeReturn);

    // ── Step 3: Row count must still be 1 ───────────────────
    var logsAfterDupe = DAL.readWhere(
      Config.TABLES.FACT_WORK_LOGS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'WorkLogHandlerTest' }
    );
    var logCountAfter = 0;
    for (var j = 0; j < logsAfterDupe.length; j++) {
      if (logsAfterDupe[j].event_type === Constants.EVENT_TYPES.WORK_LOG_SUBMITTED) logCountAfter++;
    }
    assertH_(results, counters, 'Still exactly 1 WORK_LOG_SUBMITTED row after duplicate replay',
      logCountAfter === 1, 'count=' + logCountAfter);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testWorkLogHandler_duplicate', results, counters);
  return counters;
}

// ============================================================
// RUNNER — executes all 5 tests and prints combined summary
// ============================================================

/**
 * Run all WorkLog tests and return aggregate counters.
 * Called by runV3HandlerTests() in TestHarness.gs.
 *
 * @returns {{ passed: number, failed: number }}
 */
function runWorkLogTests() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  WORK LOG HANDLER TEST SUITE');
  console.log('═══════════════════════════════════════════════════════');

  seedTestStaff();

  var suiteCounters = { passed: 0, failed: 0 };
  var tests = [
    testWorkLogHandler_happyPath,
    testWorkLogHandler_rbacDenial,
    testWorkLogHandler_invalidPayload,
    testWorkLogHandler_wrongState,
    testWorkLogHandler_duplicate
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
