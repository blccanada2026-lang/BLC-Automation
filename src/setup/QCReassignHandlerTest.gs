// ============================================================
// QCReassignHandlerTest.gs — BLC Nexus Setup / Tests
// src/setup/QCReassignHandlerTest.gs
//
// LOAD ORDER: Setup tier — loads after all T0–T6 files.
//
// HOW TO RUN (Apps Script editor):
//   runQCReassignTests()  — all 4 tests, summary at end
//
// Individual tests:
//   testQCReassignHandler_happyPath()
//   testQCReassignHandler_rbacDenial()
//   testQCReassignHandler_wrongState()
//   testQCReassignHandler_missingReviewerCode()
//
// Test actors:
//   PM  (JOB_ALLOCATE allowed) : sarty@blclotus.com      (TH_PM_EMAIL)
//   QC  (JOB_ALLOCATE denied)  : qc@blclotus.com         (TH_QC_EMAIL)
//   DESIGNER (denied)          : designer@blclotus.com   (TH_DESIGNER_EMAIL)
//   Unknown  (no RBAC entry)   : nobody@notinrbac.com    (TH_UNKNOWN_EMAIL)
//
// Starting state: QC_REVIEW (via thSetupQCReviewJob_())
//
// NOTE — direct-call pattern:
//   QCReassignHandler.handle(queueItem, actor) is called directly
//   (not via IntakeService queue), following the same approach as
//   the duplicate-replay test in QCHandlerTest.gs.  A fake queue
//   item is constructed with payload_json set to the JSON-encoded
//   payload, and the actor is resolved via RBAC.resolveActor().
//
// NOTE — RBAC action:
//   QCReassignHandler enforces RBAC.ACTIONS.JOB_ALLOCATE.
//   DESIGNER and QC_REVIEWER roles do not have this permission.
//   TH_PM_EMAIL (PM role) does, as does TH_CEO_EMAIL.
// ============================================================

// assertH_() and printResultsH_() are defined in TestHarness.gs.

// ── Internal helper ────────────────────────────────────────────

/**
 * Builds a minimal fake queue item suitable for calling
 * QCReassignHandler.handle() directly.
 *
 * @param {string} jobNumber
 * @param {string} newReviewerCode
 * @param {string=} notes
 * @returns {Object}
 */
function buildReassignQueueItem_(jobNumber, newReviewerCode, notes) {
  var payload = { job_number: jobNumber, new_reviewer_code: newReviewerCode };
  if (notes) payload.notes = notes;
  return {
    queue_id:     'FAKE-QR-' + jobNumber + '-' + Date.now(),
    form_type:    Config.FORM_TYPES.QC_REASSIGN,
    payload_json: JSON.stringify(payload)
  };
}

// ============================================================
// TEST 1 — Happy Path
// PM reassigns a QC_REVIEW job to a new reviewer.
// Verifies: VW qc_reviewer_code updated, state still QC_REVIEW,
// QC_REASSIGNED event written to FACT_QC_EVENTS.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testQCReassignHandler_happyPath() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupQCReviewJob_('reassign-happy');
    assertH_(results, counters, 'Setup: job in QC_REVIEW', !!jobNumber,
      'jobNumber=' + jobNumber);
    if (!jobNumber) { results.push('  SKIP: setup failed'); return counters; }

    DAL._resetApiCallCount();

    // ── Act: PM calls QCReassignHandler directly ───────────────
    var pmActor    = RBAC.resolveActor(TH_PM_EMAIL);
    var queueItem  = buildReassignQueueItem_(jobNumber, TH_QC_CODE, 'test reassign');
    var result     = QCReassignHandler.handle(queueItem, pmActor);

    assertH_(results, counters, 'handle() returns the job_number',
      result === jobNumber, 'returned: ' + result);

    // ── Assert: VW qc_reviewer_code updated ───────────────────
    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW qc_reviewer_code = TH_QC_CODE',
      vw && String(vw.qc_reviewer_code || '') === TH_QC_CODE,
      vw ? String(vw.qc_reviewer_code) : 'null');

    // ── Assert: state must NOT change ─────────────────────────
    assertH_(results, counters, 'VW current_state still = QC_REVIEW',
      vw && vw.current_state === Config.STATES.QC_REVIEW,
      vw ? vw.current_state : 'null');

    // ── Assert: FACT_QC_EVENTS has QC_REASSIGNED row ───────────
    var events = DAL.readWhere(
      Config.TABLES.FACT_QC_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'QCReassignHandlerTest' }
    );
    var reassignEvent = null;
    for (var i = 0; i < events.length; i++) {
      if (events[i].event_type === Constants.EVENT_TYPES.QC_REASSIGNED) {
        reassignEvent = events[i]; break;
      }
    }
    assertH_(results, counters, 'FACT_QC_EVENTS has QC_REASSIGNED row', !!reassignEvent,
      'event_types found: ' + events.map(function(e) { return e.event_type; }).join(','));
    assertH_(results, counters, 'QC_REASSIGNED notes field = new reviewer code (TH_QC_CODE)',
      reassignEvent && String(reassignEvent.notes || '') === TH_QC_CODE,
      reassignEvent ? String(reassignEvent.notes) : 'null');
    assertH_(results, counters, 'QC_REASSIGNED has idempotency_key',
      reassignEvent && !!reassignEvent.idempotency_key,
      reassignEvent ? reassignEvent.idempotency_key : 'null');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testQCReassignHandler_happyPath', results, counters);
  return counters;
}

// ============================================================
// TEST 2 — RBAC Denial
// Designer does not have JOB_ALLOCATE permission.
// handle() must throw. No QC_REASSIGNED event written,
// VW qc_reviewer_code and current_state unchanged.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testQCReassignHandler_rbacDenial() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupQCReviewJob_('reassign-rbac');
    assertH_(results, counters, 'Setup: job in QC_REVIEW', !!jobNumber,
      'jobNumber=' + jobNumber);
    if (!jobNumber) { results.push('  SKIP: setup failed'); return counters; }

    DAL._resetApiCallCount();

    // ── Act: designer tries to reassign (JOB_ALLOCATE denied) ──
    var designerActor = RBAC.resolveActor(TH_DESIGNER_EMAIL);
    var queueItem     = buildReassignQueueItem_(jobNumber, TH_QC_CODE, 'rbac denial test');

    var threw = false;
    try {
      QCReassignHandler.handle(queueItem, designerActor);
    } catch (e) {
      threw = true;
    }
    assertH_(results, counters, 'handle() throws for designer actor (no JOB_ALLOCATE)',
      threw, '');

    // ── Assert: VW state unchanged ────────────────────────────
    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW current_state still = QC_REVIEW',
      vw && vw.current_state === Config.STATES.QC_REVIEW,
      vw ? vw.current_state : 'null');

    // ── Assert: no QC_REASSIGNED event written ─────────────────
    var events = DAL.readWhere(
      Config.TABLES.FACT_QC_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'QCReassignHandlerTest' }
    );
    var reassignCount = 0;
    for (var i = 0; i < events.length; i++) {
      if (events[i].event_type === Constants.EVENT_TYPES.QC_REASSIGNED) reassignCount++;
    }
    assertH_(results, counters, 'No QC_REASSIGNED event written after RBAC denial',
      reassignCount === 0, 'count=' + reassignCount);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testQCReassignHandler_rbacDenial', results, counters);
  return counters;
}

// ============================================================
// TEST 3 — Wrong State
// Job is in IN_PROGRESS (not QC_REVIEW).
// handle() must throw before any write.
// No QC_REASSIGNED event written.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testQCReassignHandler_wrongState() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    // Setup a job in IN_PROGRESS — NOT QC_REVIEW
    var jobNumber = thSetupInProgressJob_('reassign-wrong');
    assertH_(results, counters, 'Setup: job in IN_PROGRESS', !!jobNumber,
      'jobNumber=' + jobNumber);
    if (!jobNumber) { results.push('  SKIP: setup failed'); return counters; }

    // Confirm the starting state is IN_PROGRESS (guard on setup correctness)
    var vwBefore = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'Setup confirmed: current_state = IN_PROGRESS',
      vwBefore && vwBefore.current_state === Config.STATES.IN_PROGRESS,
      vwBefore ? vwBefore.current_state : 'null');

    DAL._resetApiCallCount();

    // ── Act: PM tries to reassign an IN_PROGRESS job ───────────
    var pmActor   = RBAC.resolveActor(TH_PM_EMAIL);
    var queueItem = buildReassignQueueItem_(jobNumber, TH_QC_CODE, 'wrong state test');

    var threw = false;
    try {
      QCReassignHandler.handle(queueItem, pmActor);
    } catch (e) {
      threw = true;
    }
    assertH_(results, counters, 'handle() throws when job is not in QC_REVIEW', threw, '');

    // ── Assert: state unchanged ────────────────────────────────
    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW current_state still = IN_PROGRESS',
      vw && vw.current_state === Config.STATES.IN_PROGRESS,
      vw ? vw.current_state : 'null');

    // ── Assert: no QC_REASSIGNED event written ─────────────────
    var events = DAL.readWhere(
      Config.TABLES.FACT_QC_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'QCReassignHandlerTest' }
    );
    var reassignCount = 0;
    for (var i = 0; i < events.length; i++) {
      if (events[i].event_type === Constants.EVENT_TYPES.QC_REASSIGNED) reassignCount++;
    }
    assertH_(results, counters, 'No QC_REASSIGNED event written for wrong-state job',
      reassignCount === 0, 'count=' + reassignCount);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testQCReassignHandler_wrongState', results, counters);
  return counters;
}

// ============================================================
// TEST 4 — Missing new_reviewer_code
// Payload with blank/null new_reviewer_code → ValidationEngine
// rejects before any FACT write. handle() throws.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testQCReassignHandler_missingReviewerCode() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupQCReviewJob_('reassign-missing-code');
    assertH_(results, counters, 'Setup: job in QC_REVIEW', !!jobNumber,
      'jobNumber=' + jobNumber);
    if (!jobNumber) { results.push('  SKIP: setup failed'); return counters; }

    DAL._resetApiCallCount();

    var pmActor = RBAC.resolveActor(TH_PM_EMAIL);

    // ── Sub-test A: new_reviewer_code is null ─────────────────
    var threwNull = false;
    try {
      var queueItemNull = {
        queue_id:     'FAKE-QR-NULL-' + jobNumber,
        form_type:    Config.FORM_TYPES.QC_REASSIGN,
        payload_json: JSON.stringify({ job_number: jobNumber, new_reviewer_code: null })
      };
      QCReassignHandler.handle(queueItemNull, pmActor);
    } catch (e) {
      threwNull = true;
    }
    assertH_(results, counters, 'handle() throws when new_reviewer_code = null',
      threwNull, '');

    // ── Sub-test B: new_reviewer_code is empty string ─────────
    var threwEmpty = false;
    try {
      var queueItemEmpty = {
        queue_id:     'FAKE-QR-EMPTY-' + jobNumber,
        form_type:    Config.FORM_TYPES.QC_REASSIGN,
        payload_json: JSON.stringify({ job_number: jobNumber, new_reviewer_code: '' })
      };
      QCReassignHandler.handle(queueItemEmpty, pmActor);
    } catch (e) {
      threwEmpty = true;
    }
    assertH_(results, counters, 'handle() throws when new_reviewer_code is empty string',
      threwEmpty, '');

    // ── Sub-test C: new_reviewer_code absent from payload ─────
    var threwAbsent = false;
    try {
      var queueItemAbsent = {
        queue_id:     'FAKE-QR-ABSENT-' + jobNumber,
        form_type:    Config.FORM_TYPES.QC_REASSIGN,
        payload_json: JSON.stringify({ job_number: jobNumber })
      };
      QCReassignHandler.handle(queueItemAbsent, pmActor);
    } catch (e) {
      threwAbsent = true;
    }
    assertH_(results, counters, 'handle() throws when new_reviewer_code absent from payload',
      threwAbsent, '');

    // ── Assert: no QC_REASSIGNED event written for any sub-test
    var events = DAL.readWhere(
      Config.TABLES.FACT_QC_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'QCReassignHandlerTest' }
    );
    var reassignCount = 0;
    for (var i = 0; i < events.length; i++) {
      if (events[i].event_type === Constants.EVENT_TYPES.QC_REASSIGNED) reassignCount++;
    }
    assertH_(results, counters, 'No QC_REASSIGNED event written after missing reviewer code',
      reassignCount === 0, 'count=' + reassignCount);

    // ── Assert: VW state unchanged ────────────────────────────
    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW current_state still = QC_REVIEW',
      vw && vw.current_state === Config.STATES.QC_REVIEW,
      vw ? vw.current_state : 'null');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testQCReassignHandler_missingReviewerCode', results, counters);
  return counters;
}

// ============================================================
// RUNNER — suite 10: QCReassignHandler tests
// ============================================================

/**
 * Run all QCReassignHandler tests and return aggregate counters.
 * Registered as suite 10 in runV3HandlerTests() in TestHarness.gs.
 *
 * @returns {{ passed: number, failed: number }}
 */
function runQCReassignTests() {
  if (!Config.isDev()) {
    throw new Error('Test suite cannot run in PROD. Switch to DEV environment.');
  }
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  QC REASSIGN HANDLER TEST SUITE');
  console.log('═══════════════════════════════════════════════════════');

  seedTestStaff();

  var suiteCounters = { passed: 0, failed: 0 };
  var tests = [
    testQCReassignHandler_happyPath,
    testQCReassignHandler_rbacDenial,
    testQCReassignHandler_wrongState,
    testQCReassignHandler_missingReviewerCode
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

  thCleanupTestArtifacts_();
  return suiteCounters;
}
