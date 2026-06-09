// ============================================================
// JobUpdateHandlerTest.gs — BLC Nexus Setup / Tests
// src/setup/JobUpdateHandlerTest.gs
//
// LOAD ORDER: Setup tier — loads after all T0–T7 files.
//
// HOW TO RUN (Apps Script editor):
//   runJobUpdateTests()  — all 5 tests, summary at end
//
// Individual tests:
//   testJobUpdateHandler_happyPath()
//   testJobUpdateHandler_rbacDenial()
//   testJobUpdateHandler_invalidChanges()
//   testJobUpdateHandler_invoicedState()
//   testJobUpdateHandler_unknownJob()
//
// NOTE: JobUpdateHandler is called directly (no queue) —
//       failures throw synchronously rather than leaving
//       a FAILED queue item.
// ============================================================

// assertH_() and printResultsH_() are defined in TestHarness.gs.

// ============================================================
// TEST 1 — Happy Path
// PM edits an INTAKE_RECEIVED job — target_date + notes updated.
// Verifies: JOB_UPDATED FACT row, VW fields patched, ok=true.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobUpdateHandler_happyPath() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    DAL._resetApiCallCount();

    var jobNumber = thSetupIntakeReceivedJob_('update-happy');
    assertH_(results, counters, 'Setup: job created at INTAKE_RECEIVED', !!jobNumber,
      'jobNumber=' + jobNumber);
    if (!jobNumber) { printResultsH_('testJobUpdateHandler_happyPath', results, counters); return counters; }

    var changes = { target_date: '2026-08-15', notes: 'Updated by test' };
    var result  = JobUpdateHandler.handle(TH_PM_EMAIL, jobNumber, changes);

    assertH_(results, counters, 'handle() returns ok=true', result && result.ok === true,
      JSON.stringify(result));
    assertH_(results, counters, 'handle() returns correct job_number',
      result && result.job_number === jobNumber,
      result ? result.job_number : 'null');

    // ── VW patched ────────────────────────────────────────────
    // NOTE: VW_JOB_CURRENT_STATE has no 'notes' column — notes live only in
    // FACT_JOB_EVENTS. Only target_date and updated_at are patched in VW.
    var vw = StateMachine.getJobView(jobNumber);
    var vwTargetDateStr = vw && vw.target_date instanceof Date
      ? Utilities.formatDate(vw.target_date, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(vw && vw.target_date || '');
    assertH_(results, counters, 'VW target_date patched',
      vwTargetDateStr === '2026-08-15', vwTargetDateStr);
    assertH_(results, counters, 'VW updated_at set',
      vw && !!vw.updated_at, vw ? vw.updated_at : 'null');

    // ── FACT_JOB_EVENTS row ───────────────────────────────────
    var events = DAL.readWhere(
      Config.TABLES.FACT_JOB_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'JobUpdateHandlerTest' }
    );
    var updatedEvent = null;
    for (var i = 0; i < events.length; i++) {
      if (events[i].event_type === Constants.EVENT_TYPES.JOB_UPDATED) {
        updatedEvent = events[i]; break;
      }
    }
    assertH_(results, counters, 'FACT_JOB_EVENTS has JOB_UPDATED row', !!updatedEvent,
      'events: ' + events.map(function(e) { return e.event_type; }).join(','));
    var eventTargetDateStr = updatedEvent && updatedEvent.target_date instanceof Date
      ? Utilities.formatDate(updatedEvent.target_date, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(updatedEvent && updatedEvent.target_date || '');
    assertH_(results, counters, 'JOB_UPDATED event has correct target_date',
      eventTargetDateStr === '2026-08-15', eventTargetDateStr);
    assertH_(results, counters, 'JOB_UPDATED event has idempotency_key',
      updatedEvent && !!updatedEvent.idempotency_key,
      updatedEvent ? updatedEvent.idempotency_key : 'null');
    assertH_(results, counters, 'JOB_UPDATED event has payload_json',
      updatedEvent && !!updatedEvent.payload_json,
      updatedEvent ? updatedEvent.payload_json : 'null');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobUpdateHandler_happyPath', results, counters);
  return counters;
}

// ============================================================
// TEST 2 — RBAC Denial
// Unknown actor has no RBAC entry — handle() throws immediately.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobUpdateHandler_rbacDenial() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    DAL._resetApiCallCount();

    var jobNumber = thSetupIntakeReceivedJob_('update-rbac');
    assertH_(results, counters, 'Setup: job created', !!jobNumber, 'jobNumber=' + jobNumber);
    if (!jobNumber) { printResultsH_('testJobUpdateHandler_rbacDenial', results, counters); return counters; }

    var threw = false;
    try {
      JobUpdateHandler.handle(TH_UNKNOWN_EMAIL, jobNumber, { notes: 'should not write' });
    } catch (e) {
      threw = true;
    }
    assertH_(results, counters, 'handle() throws for unknown actor', threw, '');

    // VW must remain unchanged (no notes written)
    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW notes not modified after RBAC denial',
      !vw || !vw.notes || vw.notes.indexOf('should not write') === -1,
      vw ? vw.notes : 'null');

    // No JOB_UPDATED event written
    var events = DAL.readWhere(
      Config.TABLES.FACT_JOB_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'JobUpdateHandlerTest' }
    );
    var updatedCount = 0;
    for (var i = 0; i < events.length; i++) {
      if (events[i].event_type === Constants.EVENT_TYPES.JOB_UPDATED) updatedCount++;
    }
    assertH_(results, counters, 'No JOB_UPDATED event written after RBAC denial',
      updatedCount === 0, 'count=' + updatedCount);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobUpdateHandler_rbacDenial', results, counters);
  return counters;
}

// ============================================================
// TEST 3 — Invalid Changes
// Changes object with no recognised fields → throws.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobUpdateHandler_invalidChanges() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    DAL._resetApiCallCount();

    var jobNumber = thSetupIntakeReceivedJob_('update-invalid');
    assertH_(results, counters, 'Setup: job created', !!jobNumber, 'jobNumber=' + jobNumber);
    if (!jobNumber) { printResultsH_('testJobUpdateHandler_invalidChanges', results, counters); return counters; }

    // Empty changes object — no valid field present
    var threwEmpty = false;
    try {
      JobUpdateHandler.handle(TH_PM_EMAIL, jobNumber, {});
    } catch (e) {
      threwEmpty = true;
    }
    assertH_(results, counters, 'handle() throws for empty changes', threwEmpty, '');

    // Invalid target_date format
    var threwDate = false;
    try {
      JobUpdateHandler.handle(TH_PM_EMAIL, jobNumber, { target_date: '15-08-2026' });
    } catch (e) {
      threwDate = true;
    }
    assertH_(results, counters, 'handle() throws for bad target_date format', threwDate, '');

    // No JOB_UPDATED event written
    var events = DAL.readWhere(
      Config.TABLES.FACT_JOB_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'JobUpdateHandlerTest' }
    );
    var updatedCount = 0;
    for (var i = 0; i < events.length; i++) {
      if (events[i].event_type === Constants.EVENT_TYPES.JOB_UPDATED) updatedCount++;
    }
    assertH_(results, counters, 'No JOB_UPDATED event written after invalid changes',
      updatedCount === 0, 'count=' + updatedCount);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobUpdateHandler_invalidChanges', results, counters);
  return counters;
}

// ============================================================
// TEST 4 — INVOICED State Guard
// INVOICED jobs are immutable — handle() must throw.
// Strategy: create a job, write a JOB_INVOICED event directly
// to FACT, patch VW current_state to INVOICED, then attempt edit.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobUpdateHandler_invoicedState() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    DAL._resetApiCallCount();

    var jobNumber = thSetupIntakeReceivedJob_('update-invoiced');
    assertH_(results, counters, 'Setup: job created', !!jobNumber, 'jobNumber=' + jobNumber);
    if (!jobNumber) { printResultsH_('testJobUpdateHandler_invoicedState', results, counters); return counters; }

    // Force VW current_state to INVOICED so the guard triggers.
    // EventReplayEngine is used as callerModule since test files are not in
    // the WRITE_PERMISSIONS list for VW_JOB_CURRENT_STATE.
    DAL.updateWhere(
      Config.TABLES.VW_JOB_CURRENT_STATE,
      { job_number: jobNumber },
      { current_state: 'INVOICED' },
      { callerModule: 'EventReplayEngine' }
    );

    var threw = false;
    try {
      JobUpdateHandler.handle(TH_PM_EMAIL, jobNumber, { notes: 'should be blocked' });
    } catch (e) {
      threw = true;
    }
    assertH_(results, counters, 'handle() throws for INVOICED job', threw, '');

    // No JOB_UPDATED event written
    var events = DAL.readWhere(
      Config.TABLES.FACT_JOB_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'JobUpdateHandlerTest' }
    );
    var updatedCount = 0;
    for (var i = 0; i < events.length; i++) {
      if (events[i].event_type === Constants.EVENT_TYPES.JOB_UPDATED) updatedCount++;
    }
    assertH_(results, counters, 'No JOB_UPDATED event written for INVOICED job',
      updatedCount === 0, 'count=' + updatedCount);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobUpdateHandler_invoicedState', results, counters);
  return counters;
}

// ============================================================
// TEST 5 — Unknown Job
// handle() with a job_number that does not exist in VW → throws.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testJobUpdateHandler_unknownJob() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    DAL._resetApiCallCount();

    var threw = false;
    try {
      JobUpdateHandler.handle(TH_PM_EMAIL, 'BLC-NONEXISTENT-99999', { notes: 'ghost job' });
    } catch (e) {
      threw = true;
    }
    assertH_(results, counters, 'handle() throws for non-existent job_number', threw, '');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testJobUpdateHandler_unknownJob', results, counters);
  return counters;
}

// ============================================================
// RUNNER — executes all 5 tests and prints combined summary
// ============================================================

/**
 * Run all JobUpdate tests and return aggregate counters.
 * Called by runV3HandlerTests() in TestHarness.gs.
 *
 * @returns {{ passed: number, failed: number }}
 */
function runJobUpdateTests() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  JOB UPDATE HANDLER TEST SUITE');
  console.log('═══════════════════════════════════════════════════════');

  seedTestStaff();

  var suiteCounters = { passed: 0, failed: 0 };
  var tests = [
    testJobUpdateHandler_happyPath,
    testJobUpdateHandler_rbacDenial,
    testJobUpdateHandler_invalidChanges,
    testJobUpdateHandler_invoicedState,
    testJobUpdateHandler_unknownJob
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
