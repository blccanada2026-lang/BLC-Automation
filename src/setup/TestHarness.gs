// ============================================================
// TestHarness.gs — BLC Nexus V3 Test Harness
// src/setup/TestHarness.gs
//
// LOAD ORDER: Setup tier — loads alongside TestRunner.gs.
//             All T0–T7 modules must be loaded first.
//
// PURPOSE: Shared constants, assertion helpers, and job-state
//          setup utilities used by all V3 per-handler test files.
//          Relies on helpers already in TestRunner.gs global scope:
//            clearStalePendingItems_()
//            processQueueFresh_()
//            getLatestJobNumber_()
//            seedTestStaff()
//
// HOW TO RUN:
//   runV3HandlerTests()  — all 7 handler suites, aggregate summary
// ============================================================

// ── Suite-wide constants ──────────────────────────────────────
var TH_PERIOD_ID      = '2026-04';
var TH_CEO_EMAIL      = 'ceo@blclotus.com';
var TH_PM_EMAIL       = 'sarty@blclotus.com';
var TH_DESIGNER_EMAIL = 'designer@blclotus.com';
var TH_QC_EMAIL       = 'qc@blclotus.com';
var TH_UNKNOWN_EMAIL  = 'nobody@notinrbac.com';
var TH_DESIGNER_CODE  = 'DS1';
var TH_QC_CODE        = 'QC1';
var TH_CLIENT_CODE    = 'NORSPAN';
var TH_PRODUCT_CODE   = 'Alpine-iCommand';

// ── Assertion helper ──────────────────────────────────────────

/**
 * Records one PASS or FAIL assertion.
 * All V3 handler test files use this instead of duplicating assert_.
 *
 * @param {string[]} results   Accumulator — one line per assertion
 * @param {{passed:number,failed:number}} counters
 * @param {string}  label      Short description shown in output
 * @param {boolean} condition  true = PASS
 * @param {string=} detail     Appended to failure line only
 */
function assertH_(results, counters, label, condition, detail) {
  if (condition) {
    results.push('  PASS: ' + label);
    counters.passed++;
  } else {
    results.push('  FAIL: ' + label + (detail ? ' — ' + detail : ''));
    counters.failed++;
  }
}

// ── Print helper ──────────────────────────────────────────────

/**
 * Prints all PASS/FAIL lines for one test function.
 *
 * @param {string}   testName
 * @param {string[]} results
 * @param {{passed:number,failed:number}} counters
 */
function printResultsH_(testName, results, counters) {
  console.log('');
  console.log('── ' + testName + ' ──');
  for (var i = 0; i < results.length; i++) { console.log(results[i]); }
  console.log('  result: ' + counters.passed + ' passed, ' + counters.failed + ' failed');
}

// ── Job-state setup helpers ───────────────────────────────────
//
// Each helper drives a job to a known starting state via
// IntakeService, verifies state via StateMachine.getJobView(),
// and returns job_number or null on failure.
//
// They chain — each calls the previous — so thSetupOnHoldJob_()
// exercises the full ALLOCATED→IN_PROGRESS→ON_HOLD path without
// duplicating logic.

/**
 * Creates an unallocated job → INTAKE_RECEIVED.
 * Starting state for JobCreateHandler and JobAssignHandler tests.
 *
 * @param {string=} tag  Short label appended to notes for traceability
 * @returns {string|null}
 */
function thSetupIntakeReceivedJob_(tag) {
  clearStalePendingItems_();
  var r = IntakeService.processSubmission({
    formType:       Config.FORM_TYPES.JOB_CREATE,
    submitterEmail: TH_PM_EMAIL,
    payload: {
      client_code:  TH_CLIENT_CODE,
      job_type:     'DESIGN',
      product_code: TH_PRODUCT_CODE,
      quantity:     1,
      notes:        'th-setup' + (tag ? ':' + tag : '')
    },
    source: 'TEST'
  });
  if (!r.ok) { console.log('  [th] JOB_CREATE failed'); return null; }
  processQueueFresh_();

  var jn = getLatestJobNumber_();
  if (!jn) { console.log('  [th] No job_number after JOB_CREATE'); return null; }

  var vw = StateMachine.getJobView(jn);
  if (!vw || vw.current_state !== Config.STATES.INTAKE_RECEIVED) {
    console.log('  [th] Expected INTAKE_RECEIVED, got: ' + (vw ? vw.current_state : 'null'));
    return null;
  }
  return jn;
}

/**
 * Creates a job pre-allocated to DS1 → ALLOCATED.
 * Uses JOB_CREATE with allocated_to in the payload (one queue item).
 * Starting state for JobStartHandler, JobHoldHandler, WorkLogHandler,
 * and QCHandler tests.
 *
 * @param {string=} tag
 * @returns {string|null}
 */
function thSetupAllocatedJob_(tag) {
  clearStalePendingItems_();
  var r = IntakeService.processSubmission({
    formType:       Config.FORM_TYPES.JOB_CREATE,
    submitterEmail: TH_PM_EMAIL,
    payload: {
      client_code:  TH_CLIENT_CODE,
      job_type:     'DESIGN',
      product_code: TH_PRODUCT_CODE,
      quantity:     1,
      allocated_to: TH_DESIGNER_EMAIL,
      notes:        'th-setup' + (tag ? ':' + tag : '')
    },
    source: 'TEST'
  });
  if (!r.ok) { console.log('  [th] JOB_CREATE (allocated) failed'); return null; }
  processQueueFresh_();

  var jn = getLatestJobNumber_();
  if (!jn) { console.log('  [th] No job_number after JOB_CREATE'); return null; }

  var vw = StateMachine.getJobView(jn);
  if (!vw || vw.current_state !== Config.STATES.ALLOCATED) {
    console.log('  [th] Expected ALLOCATED, got: ' + (vw ? vw.current_state : 'null'));
    return null;
  }
  return jn;
}

/**
 * Creates, allocates, and starts a job → IN_PROGRESS.
 * Starting state for JobHoldHandler, WorkLogHandler, and QCHandler tests.
 *
 * @param {string=} tag
 * @returns {string|null}
 */
function thSetupInProgressJob_(tag) {
  var jn = thSetupAllocatedJob_(tag);
  if (!jn) return null;

  var r = IntakeService.processSubmission({
    formType:       Config.FORM_TYPES.JOB_START,
    submitterEmail: TH_DESIGNER_EMAIL,
    payload:        { job_number: jn },
    source:         'TEST'
  });
  if (!r.ok) { console.log('  [th] JOB_START failed'); return null; }
  processQueueFresh_();

  var vw = StateMachine.getJobView(jn);
  if (!vw || vw.current_state !== Config.STATES.IN_PROGRESS) {
    console.log('  [th] Expected IN_PROGRESS, got: ' + (vw ? vw.current_state : 'null'));
    return null;
  }
  return jn;
}

/**
 * Creates, allocates, starts, and holds a job → ON_HOLD.
 * Starting state for JobResumeHandler tests.
 *
 * @param {string=} tag
 * @returns {string|null}
 */
function thSetupOnHoldJob_(tag) {
  var jn = thSetupInProgressJob_(tag);
  if (!jn) return null;

  var r = IntakeService.processSubmission({
    formType:       Config.FORM_TYPES.JOB_HOLD,
    submitterEmail: TH_DESIGNER_EMAIL,
    payload:        { job_number: jn, reason: 'th-setup hold' },
    source:         'TEST'
  });
  if (!r.ok) { console.log('  [th] JOB_HOLD failed'); return null; }
  processQueueFresh_();

  var vw = StateMachine.getJobView(jn);
  if (!vw || vw.current_state !== Config.STATES.ON_HOLD) {
    console.log('  [th] Expected ON_HOLD, got: ' + (vw ? vw.current_state : 'null'));
    return null;
  }
  return jn;
}

// ── Aggregate V3 runner ───────────────────────────────────────

/**
 * Runs all 7 V3 handler test suites and prints a combined summary.
 * Each suite runner (runJobCreateTests, runJobStartTests, etc.) is
 * defined in its own *HandlerTest.gs file and returns {passed, failed}.
 */
function runV3HandlerTests() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  BLC NEXUS — V3 HANDLER TEST SUITE                  ║');
  console.log('║  Period: ' + TH_PERIOD_ID + '                                       ║');
  console.log('╚══════════════════════════════════════════════════════╝');

  seedTestStaff();  // ensures DS1 / QC1 exist before any test runs

  var suites = [
    { name: '1 — JobCreateHandler',  fn: runJobCreateTests  },
    { name: '2 — JobAssignHandler',  fn: runJobAssignTests  },
    { name: '3 — JobStartHandler',   fn: runJobStartTests   },
    { name: '4 — JobHoldHandler',    fn: runJobHoldTests    },
    { name: '5 — JobResumeHandler',  fn: runJobResumeTests  },
    { name: '6 — WorkLogHandler',    fn: runWorkLogTests    },
    { name: '7 — QCHandler',         fn: runQCHandlerTests  }
  ];

  var totalPassed = 0;
  var totalFailed = 0;
  var rows = [];

  for (var i = 0; i < suites.length; i++) {
    var s = suites[i];
    console.log('\nRunning: ' + s.name);
    var c = { passed: 0, failed: 0 };
    try {
      c = s.fn();
    } catch (e) {
      console.log('  UNHANDLED EXCEPTION: ' + e.message);
      c.failed++;
    }
    totalPassed += c.passed;
    totalFailed += c.failed;
    rows.push({ name: s.name, passed: c.passed, failed: c.failed });
  }

  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  SUMMARY                                             ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  for (var j = 0; j < rows.length; j++) {
    var row = rows[j];
    var status = row.failed === 0 ? 'PASS' : 'FAIL';
    console.log('  ' + status + '  ' + row.name +
                ' (' + row.passed + '/' + (row.passed + row.failed) + ')');
  }
  console.log('  ────────────────────────────────────────────────────');
  console.log('  TOTAL  ' + totalPassed + ' passed, ' + totalFailed + ' failed');
  if (totalFailed === 0) {
    console.log('  ✅  ALL V3 HANDLER TESTS PASSED — ready to commit');
  } else {
    console.log('  ❌  ' + totalFailed + ' failure(s) — fix before commit');
  }
  console.log('╚══════════════════════════════════════════════════════╝');
}
