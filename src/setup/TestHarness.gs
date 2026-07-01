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
//   runV3HandlerTests()  — all 10 handler suites, aggregate summary
// ============================================================

// ── Suite-wide constants ──────────────────────────────────────
var TH_PERIOD_ID      = Identifiers.generateCurrentPeriodId();
var TH_CEO_EMAIL      = 'sarthakaespl@gmail.com';  // SGO (PM) — highest PROD role available
var TH_PM_EMAIL       = 'sarthakaespl@gmail.com';
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
    submitterEmail: TH_PM_EMAIL,
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

/**
 * Creates, allocates, starts, and submits a job for QC review → QC_REVIEW.
 * Chains on thSetupInProgressJob_() then drives Flow A.
 * Starting state for QCHandler Flow B tests and QCReassignHandler tests.
 *
 * @param {string=} tag
 * @returns {string|null}
 */
function thSetupQCReviewJob_(tag) {
  var jn = thSetupInProgressJob_(tag);
  if (!jn) return null;

  var r = IntakeService.processSubmission({
    formType:       Config.FORM_TYPES.QC_SUBMIT,
    submitterEmail: TH_DESIGNER_EMAIL,
    payload:        { job_number: jn, notes: 'th-setup qc-review' + (tag ? ':' + tag : '') },
    source:         'TEST'
  });
  if (!r.ok) { console.log('  [th] QC_SUBMIT (Flow A) failed'); return null; }
  processQueueFresh_();

  var vw = StateMachine.getJobView(jn);
  if (!vw || vw.current_state !== Config.STATES.QC_REVIEW) {
    console.log('  [th] Expected QC_REVIEW, got: ' + (vw ? vw.current_state : 'null'));
    return null;
  }
  return jn;
}

/**
 * Creates a job and drives it to MINOR_FIX state.
 * Chains on thSetupQCReviewJob_() then submits MINOR_REWORK from the QC actor.
 * Starting state for QCHandler Flow C (CLIENT_SENT) tests.
 *
 * @param {string=} tag
 * @returns {string|null}
 */
function thSetupMinorFixJob_(tag) {
  var jn = thSetupQCReviewJob_(tag);
  if (!jn) return null;

  var r = IntakeService.processSubmission({
    formType:       Config.FORM_TYPES.QC_SUBMIT,
    submitterEmail: TH_QC_EMAIL,
    payload: {
      job_number:   jn,
      qc_result:    'MINOR_REWORK',
      rework_notes: 'th-setup minor-fix' + (tag ? ':' + tag : ''),
      notes:        'setup helper — drive to MINOR_FIX'
    },
    source: 'TEST'
  });
  if (!r.ok) { console.log('  [th] QC_SUBMIT (MINOR_REWORK) failed'); return null; }
  processQueueFresh_();

  var vw = StateMachine.getJobView(jn);
  if (!vw || vw.current_state !== Config.STATES.MINOR_FIX) {
    console.log('  [th] Expected MINOR_FIX, got: ' + (vw ? vw.current_state : 'null'));
    return null;
  }
  return jn;
}

// ── Aggregate V3 runners ──────────────────────────────────────
//
// Execution plan for 6-minute Apps Script accounts (7 calls total):
//
//   runV3Tests_1to3()       — suites 1–3  (~4.5 min, confirmed)
//   runV3Tests_4to5()       — suites 4–5  (~4 min, estimated)
//   runWorkLogTests()       — suite  6    (~1 min)
//   runQCHandlerTests()     — suite  7    (~5.5 min, borderline — run solo)
//   runJobUpdateTests()     — suite  8    (~3 min)
//   runQCHandlerFlowTests() — suite  9    (~2 min)
//   runQCReassignTests()    — suite  10   (~5.5 min, borderline — run solo)
//
// runV3HandlerTests() runs all 10 — only reliable on 30-min Workspace accounts.

/**
 * Suites 1–3: JobCreate, JobAssign, JobStart.
 * Confirmed ~4.5 min on a 6-minute account.
 */
function runV3Tests_1to3() {
  runSuiteGroup_('1–3', [
    { name: '1 — JobCreateHandler',  fn: runJobCreateTests  },
    { name: '2 — JobAssignHandler',  fn: runJobAssignTests  },
    { name: '3 — JobStartHandler',   fn: runJobStartTests   }
  ]);
}

/**
 * Suites 4–5: JobHold, JobResume.
 * Estimated ~4 min on a 6-minute account.
 */
function runV3Tests_4to5() {
  runSuiteGroup_('4–5', [
    { name: '4 — JobHoldHandler',    fn: runJobHoldTests    },
    { name: '5 — JobResumeHandler',  fn: runJobResumeTests  }
  ]);
}

/**
 * Shared runner used by both half-suite functions and runV3HandlerTests.
 * Seeds staff once, runs all suites in the list, prints a summary table.
 *
 * @param {string}  label   e.g. '1–5' or '6–10' — shown in the header
 * @param {Array}   suites  Array of { name, fn }
 */
function runSuiteGroup_(label, suites) {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  BLC NEXUS — V3 HANDLER TESTS (suites ' + label + ')' +
              Array(Math.max(0, 14 - label.length) + 1).join(' ') + '║');
  console.log('║  Period: ' + TH_PERIOD_ID + '                                       ║');
  console.log('╚══════════════════════════════════════════════════════╝');

  seedTestStaff();

  var totalPassed = 0;
  var totalFailed = 0;
  var rows = [];

  for (var i = 0; i < suites.length; i++) {
    var s = suites[i];
    console.log('\nRunning: ' + s.name);
    var c = { passed: 0, failed: 0 };
    try {
      var result = s.fn();
      if (result && typeof result.passed === 'number') {
        c = result;
      } else {
        console.log('  WARN: suite returned no counters');
        c.failed++;
      }
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
  console.log('║  SUMMARY (suites ' + label + ')' +
              Array(Math.max(0, 34 - label.length) + 1).join(' ') + '║');
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
    console.log('  ✅  ALL TESTS PASSED');
  } else {
    console.log('  ❌  ' + totalFailed + ' failure(s) — fix before commit');
  }
  console.log('╚══════════════════════════════════════════════════════╝');
}

/**
 * Runs all 10 V3 handler test suites and prints a combined summary.
 * Each suite runner (runJobCreateTests, runJobStartTests, etc.) is
 * defined in its own *HandlerTest.gs file and returns {passed, failed}.
 * NOTE: likely times out on 6-minute accounts — use runV3Tests_1to5()
 * and runV3Tests_6to10() instead.
 */
function runV3HandlerTests() {
  runSuiteGroup_('1–10', [
    { name: '1 — JobCreateHandler',      fn: runJobCreateTests       },
    { name: '2 — JobAssignHandler',      fn: runJobAssignTests       },
    { name: '3 — JobStartHandler',       fn: runJobStartTests        },
    { name: '4 — JobHoldHandler',        fn: runJobHoldTests         },
    { name: '5 — JobResumeHandler',      fn: runJobResumeTests       },
    { name: '6 — WorkLogHandler',        fn: runWorkLogTests         },
    { name: '7 — QCHandler',             fn: runQCHandlerTests       },
    { name: '8 — JobUpdateHandler',      fn: runJobUpdateTests       },
    { name: '9 — QCHandler Flow B/C',    fn: runQCHandlerFlowTests   },
    { name: '10 — QCReassignHandler',    fn: runQCReassignTests      }
  ]);
}
