// ============================================================
// SopGateTest.gs — BLC Nexus Setup / Tests
// src/setup/SopGateTest.gs
//
// LOAD ORDER: Setup tier — loads after all T0–T13 files.
//
// HOW TO RUN (Apps Script editor):
//   Run these five batch functions in order. Each fits within the
//   6-minute GAS execution limit. Do not run runSopGateTests_batch5
//   back-to-back with other batches — it uses 3 queue rounds.
//
//   runSopGateTests_batch1()  — Tests 1,6,7 + noProductCode + duplicatePrevented (fast ~45s)
//   runSopGateTests_batch2()  — Tests 2,8    queue rounds (~4 min)
//   runSopGateTests_batch3()  — Tests 3,9    complete+checklist (~4 min)
//   runSopGateTests_batch4()  — Test 5       block+complete (~3 min)
//   runSopGateTests_batch5()  — Test 4       block+incomplete, 3 queues (~5 min)
//
// Individual tests (also callable directly):
//   testSopGate_featureDisabled()
//   testSopGate_warnOnly_incomplete()
//   testSopGate_warnOnly_complete()
//   testSopGate_blockIncomplete()
//   testSopGate_blockComplete()
//   testSopGate_nonPilotClient()
//   testSopGate_noActiveTemplate()
//   testSopGate_noProductCode()
//   testSopGate_duplicateActiveTemplatePrevented()
//   testSopGate_qcHandlerRegression()
//   testSopGate_sopChecklistRegression()
//
// Script Property safety:
//   Every test saves original SOP_* Script Properties in a
//   finally block and restores them after the test, so tests
//   cannot contaminate each other or leave PROD flags flipped.
//
// Feature flags controlled per-test:
//   SOP_ENABLED       — 'true' | anything else (default off)
//   SOP_MODE          — 'WARN_ONLY' | 'BLOCK'
//   SOP_PILOT_CLIENTS — comma-separated client codes
// ============================================================

// ── Local helpers ─────────────────────────────────────────────

/**
 * Saves SOP Script Properties before a test, returns a restore function.
 * Always call the returned restore() in a finally block.
 *
 * @returns {Function} restore — call in finally to put originals back
 */
function sgSaveSopProps_() {
  var props = PropertiesService.getScriptProperties();
  var saved = {
    enabled:      props.getProperty(Config.SOP_FLAGS.ENABLED),
    mode:         props.getProperty(Config.SOP_FLAGS.MODE),
    pilotClients: props.getProperty(Config.SOP_FLAGS.PILOT_CLIENTS)
  };
  return function restore() {
    if (saved.enabled      !== null) { props.setProperty(Config.SOP_FLAGS.ENABLED,       saved.enabled); }
    else                             { props.deleteProperty(Config.SOP_FLAGS.ENABLED); }
    if (saved.mode         !== null) { props.setProperty(Config.SOP_FLAGS.MODE,           saved.mode); }
    else                             { props.deleteProperty(Config.SOP_FLAGS.MODE); }
    if (saved.pilotClients !== null) { props.setProperty(Config.SOP_FLAGS.PILOT_CLIENTS,  saved.pilotClients); }
    else                             { props.deleteProperty(Config.SOP_FLAGS.PILOT_CLIENTS); }
  };
}

/**
 * Sets SOP Script Properties for a test scenario.
 *
 * @param {string}      enabled       'true' | 'false' | ''
 * @param {string}      mode          'WARN_ONLY' | 'BLOCK'
 * @param {string|null} pilotClients  comma-separated or null (delete property)
 */
function sgSetSopProps_(enabled, mode, pilotClients) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty(Config.SOP_FLAGS.ENABLED, enabled);
  props.setProperty(Config.SOP_FLAGS.MODE,    mode);
  if (pilotClients !== null) {
    props.setProperty(Config.SOP_FLAGS.PILOT_CLIENTS, pilotClients);
  } else {
    props.deleteProperty(Config.SOP_FLAGS.PILOT_CLIENTS);
  }
}

/**
 * Builds a minimal VW_JOB_CURRENT_STATE-shaped view for direct
 * evaluate_() and checkForQcSubmit() calls.
 */
function sgFakeView_(jobNumber, clientCode, jobType) {
  return {
    job_number:    jobNumber,
    client_code:   clientCode,
    job_type:      jobType,
    product_code:  TH_PRODUCT_CODE,
    current_state: Config.STATES.IN_PROGRESS
  };
}

/** Minimal DESIGNER actor stub. */
var SG_DESIGNER_ACTOR = {
  email:         TH_DESIGNER_EMAIL,
  personCode:    'DS1',
  role:          'DESIGNER',
  displayName:   'Test Designer',
  scope:         'SELF',
  _rbacResolved: true
};

// ── Test runner ───────────────────────────────────────────────

/**
 * Runs a named set of test functions and prints an aggregate summary.
 * Internal helper used by all batch runners.
 *
 * @param {string}     batchName  Label printed in the summary line.
 * @param {Function[]} tests      Array of test functions to run.
 * @returns {{ passed: number, failed: number }}
 */
function runSopGateBatch_(batchName, tests) {
  if (!Config.isDev()) {
    throw new Error('Test suite cannot run in PROD. Switch to DEV environment.');
  }
  var totalPassed = 0;
  var totalFailed = 0;

  tests.forEach(function (fn) {
    try {
      var c = fn();
      totalPassed += c.passed;
      totalFailed += c.failed;
    } catch (e) {
      console.log('EXCEPTION in ' + fn.name + ': ' + e.message);
      totalFailed++;
    }
  });

  console.log('');
  console.log('SOP GATE TESTS [' + batchName + '] — ' + totalPassed + ' passed, ' + totalFailed + ' failed');

  thCleanupTestArtifacts_();
  return { passed: totalPassed, failed: totalFailed };
}

/**
 * Batch 1 — Fast (direct evaluate_/checkForQcSubmit calls, no queue).
 * Tests: 1 (featureDisabled), 6 (nonPilotClient), 7 (noActiveTemplate),
 *        noProductCode, duplicateActiveTemplatePrevented.
 * Expected runtime: ~45 seconds.
 *
 * @returns {{ passed: number, failed: number }}
 */
function runSopGateTests_batch1() {
  return runSopGateBatch_('batch1: fast', [
    testSopGate_featureDisabled,
    testSopGate_nonPilotClient,
    testSopGate_noActiveTemplate,
    testSopGate_noProductCode,
    testSopGate_duplicateActiveTemplatePrevented
  ]);
}

/**
 * Batch 2 — WARN_ONLY incomplete + QCHandler regression.
 * Tests: 2 (warnOnly_incomplete), 8 (qcHandlerRegression).
 * Each test has one queue round. Expected runtime: ~4 minutes.
 *
 * @returns {{ passed: number, failed: number }}
 */
function runSopGateTests_batch2() {
  return runSopGateBatch_('batch2: warn_only + qc regression', [
    testSopGate_warnOnly_incomplete,
    testSopGate_qcHandlerRegression
  ]);
}

/**
 * Batch 3 — Complete scenarios + SopChecklist regression.
 * Tests: 3 (warnOnly_complete), 9 (sopChecklistRegression).
 * Each test has a checklist queue round. Expected runtime: ~4 minutes.
 *
 * @returns {{ passed: number, failed: number }}
 */
function runSopGateTests_batch3() {
  return runSopGateBatch_('batch3: complete + checklist regression', [
    testSopGate_warnOnly_complete,
    testSopGate_sopChecklistRegression
  ]);
}

/**
 * Batch 4 — BLOCK + complete.
 * Tests: 5 (blockComplete).
 * Two queue rounds (checklist + verify). Expected runtime: ~3 minutes.
 *
 * @returns {{ passed: number, failed: number }}
 */
function runSopGateTests_batch4() {
  return runSopGateBatch_('batch4: block+complete', [
    testSopGate_blockComplete
  ]);
}

/**
 * Batch 5 — BLOCK + incomplete (full integration).
 * Tests: 4 (blockIncomplete).
 * Three queue rounds. Run alone to stay within the 6-minute GAS limit.
 * Expected runtime: ~5 minutes.
 *
 * @returns {{ passed: number, failed: number }}
 */
function runSopGateTests_batch5() {
  return runSopGateBatch_('batch5: block+incomplete', [
    testSopGate_blockIncomplete
  ]);
}


// ============================================================
// TEST: No Product Code
// view.product_code is blank → gateActive=false, reason='NO_PRODUCT_CODE'.
// Must never block QC regardless of mode.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testSopGate_noProductCode() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };
  var restore  = sgSaveSopProps_();

  try {
    sgSetSopProps_('true', 'BLOCK', TH_CLIENT_CODE);

    var view = {
      job_number:    'BLC-SG-NOPC-' + Date.now(),
      client_code:   TH_CLIENT_CODE,
      job_type:      'STRUCT',
      product_code:  '',
      current_state: Config.STATES.IN_PROGRESS
    };

    var result = SopGate.evaluate_(view);
    assertH_(results, counters, 'evaluate_: gateActive=false when product_code is blank',
      result.gateActive === false, 'gateActive=' + result.gateActive);
    assertH_(results, counters, 'evaluate_: reason=NO_PRODUCT_CODE',
      result.reason === 'NO_PRODUCT_CODE', 'reason=' + result.reason);
    assertH_(results, counters, 'evaluate_: complete=true (never blocks)',
      result.complete === true, 'complete=' + result.complete);

    // Must not throw even in BLOCK mode
    var threw = false;
    try {
      SopGate.checkForQcSubmit(view, SG_DESIGNER_ACTOR, 'SG-NOPC-' + Date.now());
    } catch (e) { threw = true; }
    assertH_(results, counters, 'checkForQcSubmit: no throw when product_code is blank', !threw, 'threw unexpectedly');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  } finally {
    restore();
  }

  printResultsH_('testSopGate_noProductCode', results, counters);
  return counters;
}


// ============================================================
// TEST: Duplicate Active Template Prevented
// If DIM_SOP_TEMPLATES has >1 in-date ACTIVE row for the same
// client_code + scope_code, findActiveTemplateForJob must throw
// SOP_DUPLICATE_ACTIVE_TEMPLATE, and evaluate_() must propagate it.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testSopGate_duplicateActiveTemplatePrevented() {
  var results     = [];
  var counters    = { passed: 0, failed: 0 };
  var restore     = sgSaveSopProps_();
  var templateIds = [];
  var uniqueScope = 'DUP-SC-' + Date.now();

  try {
    sgSetSopProps_('true', 'BLOCK', TH_CLIENT_CODE);

    // Create and publish first template with the unique scope
    var r1 = SopAdminEngine.createTemplate(TH_CEO_EMAIL, {
      clientCode: TH_CLIENT_CODE, jobType: 'STRUCT',
      software:   'DUP-SW-A',    scopeCode: uniqueScope
    });
    SopAdminEngine.addItem(TH_CEO_EMAIL, r1.sopTemplateId, {
      item_code: 'DUP-ITEM-A', item_label: 'Dup test A', is_required: 'TRUE'
    });
    SopAdminEngine.publishTemplate(TH_CEO_EMAIL, r1.sopTemplateId);
    templateIds.push(r1.sopTemplateId);

    // Create a second template under a different scope (bypasses the guard),
    // then directly set it ACTIVE with the same unique scope — forcing a
    // duplicate condition that the guard normally prevents.
    var r2 = SopAdminEngine.createTemplate(TH_CEO_EMAIL, {
      clientCode: TH_CLIENT_CODE, jobType: 'STRUCT',
      software:   'DUP-SW-B',    scopeCode: uniqueScope + '-TMP'
    });
    SopAdminEngine.addItem(TH_CEO_EMAIL, r2.sopTemplateId, {
      item_code: 'DUP-ITEM-B', item_label: 'Dup test B', is_required: 'TRUE'
    });
    SopDAL.updateTemplate(r2.sopTemplateId, {
      status:         'ACTIVE',
      scope_code:     uniqueScope,
      effective_from: '2020-01-01',
      effective_to:   ''
    });
    templateIds.push(r2.sopTemplateId);

    // findActiveTemplateForJob must throw SOP_DUPLICATE_ACTIVE_TEMPLATE
    var dalCode = null;
    try {
      SopDAL.findActiveTemplateForJob(TH_CLIENT_CODE, uniqueScope);
    } catch (e) { dalCode = e.code; }
    assertH_(results, counters, 'findActiveTemplateForJob: throws SOP_DUPLICATE_ACTIVE_TEMPLATE',
      dalCode === 'SOP_DUPLICATE_ACTIVE_TEMPLATE', 'code=' + dalCode);

    // evaluate_() must propagate the error
    var view = {
      job_number:    'BLC-SG-DUP-' + Date.now(),
      client_code:   TH_CLIENT_CODE,
      job_type:      'STRUCT',
      product_code:  uniqueScope,
      current_state: Config.STATES.IN_PROGRESS
    };
    var gateCode = null;
    try {
      SopGate.evaluate_(view);
    } catch (e) { gateCode = e.code; }
    assertH_(results, counters, 'evaluate_: propagates SOP_DUPLICATE_ACTIVE_TEMPLATE',
      gateCode === 'SOP_DUPLICATE_ACTIVE_TEMPLATE', 'code=' + gateCode);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  } finally {
    restore();
    // Retire both templates by ID to leave DIM_SOP_TEMPLATES clean
    templateIds.forEach(function (id) {
      try { SopAdminEngine.retireTemplate(TH_CEO_EMAIL, id); } catch (ignore) {}
    });
  }

  printResultsH_('testSopGate_duplicateActiveTemplatePrevented', results, counters);
  return counters;
}


// ============================================================
// TEST 1 — Feature Disabled
// SOP_ENABLED != 'true' → gate skipped, no throw.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testSopGate_featureDisabled() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };
  var restore  = sgSaveSopProps_();

  try {
    sgSetSopProps_('false', 'BLOCK', null);

    var view   = sgFakeView_('BLC-SG-DISABLED-' + Date.now(), TH_CLIENT_CODE, 'STRUCT');
    var result = SopGate.evaluate_(view);

    assertH_(results, counters, 'evaluate_: gateActive=false when disabled',
      result.gateActive === false, 'gateActive=' + result.gateActive);
    assertH_(results, counters, 'evaluate_: reason=FEATURE_DISABLED',
      result.reason === 'FEATURE_DISABLED', 'reason=' + result.reason);

    // checkForQcSubmit must not throw
    var threw = false;
    try {
      SopGate.checkForQcSubmit(view, SG_DESIGNER_ACTOR, 'SG-DISABLED-' + Date.now());
    } catch (e) { threw = true; }
    assertH_(results, counters, 'checkForQcSubmit: no throw when disabled', !threw, 'threw unexpectedly');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  } finally {
    restore();
  }

  printResultsH_('testSopGate_featureDisabled', results, counters);
  return counters;
}


// ============================================================
// TEST 2 — WARN_ONLY + Incomplete
// Feature enabled, WARN_ONLY mode, real job with a seeded
// template but no checklist rows submitted yet.
// Expected: checkForQcSubmit does NOT throw (warn-only),
// evaluate_() returns complete=false and missing items.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testSopGate_warnOnly_incomplete() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };
  var restore  = sgSaveSopProps_();

  try {
    seedTestStaff();
    var jobNumber = thSetupInProgressJob_('sg-warn-inc');
    assertH_(results, counters, 'Setup: IN_PROGRESS job created', !!jobNumber, 'null');
    if (!jobNumber) {
      printResultsH_('testSopGate_warnOnly_incomplete', results, counters);
      return counters;
    }

    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW row exists', !!vw, 'null');
    if (!vw) {
      printResultsH_('testSopGate_warnOnly_incomplete', results, counters);
      return counters;
    }

    // Seed an active SOP template for this job's client+type
    schSeedActiveSopTemplate_(vw.client_code, vw.job_type, 'SGW-' + Date.now());

    sgSetSopProps_('true', 'WARN_ONLY', vw.client_code);

    var result = SopGate.evaluate_(vw);
    assertH_(results, counters, 'evaluate_: gateActive=true', result.gateActive === true, 'gateActive=' + result.gateActive);
    assertH_(results, counters, 'evaluate_: complete=false (no rows yet)', result.complete === false, 'complete=' + result.complete);
    assertH_(results, counters, 'evaluate_: missing.length > 0', result.missing && result.missing.length > 0, 'missing=' + JSON.stringify(result.missing));
    assertH_(results, counters, 'evaluate_: mode=WARN_ONLY', result.mode === 'WARN_ONLY', 'mode=' + result.mode);

    // WARN_ONLY — must not throw
    var threw = false;
    try {
      SopGate.checkForQcSubmit(vw, SG_DESIGNER_ACTOR, 'SG-WARN-INC-' + Date.now());
    } catch (e) { threw = true; }
    assertH_(results, counters, 'checkForQcSubmit: no throw in WARN_ONLY', !threw, 'threw unexpectedly');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  } finally {
    restore();
  }

  printResultsH_('testSopGate_warnOnly_incomplete', results, counters);
  return counters;
}


// ============================================================
// TEST 3 — WARN_ONLY + Complete
// All required items checked → gate passes silently.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testSopGate_warnOnly_complete() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };
  var restore  = sgSaveSopProps_();

  try {
    seedTestStaff();
    var jobNumber = thSetupInProgressJob_('sg-warn-cmp');
    assertH_(results, counters, 'Setup: IN_PROGRESS job created', !!jobNumber, 'null');
    if (!jobNumber) {
      printResultsH_('testSopGate_warnOnly_complete', results, counters);
      return counters;
    }

    var vw  = StateMachine.getJobView(jobNumber);
    var sop = schSeedActiveSopTemplate_(vw.client_code, vw.job_type, 'SGWC-' + Date.now());

    // Submit and process the checklist so required items are TRUE
    IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.SOP_CHECKLIST,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload: {
        jobNumber:       jobNumber,
        sopTemplateId:   sop.sopTemplateId,
        sopTemplateHash: sop.templateHash,
        batchRequestId:  'SG-BATCH-WC-' + Date.now(),
        items: [{ sopItemId: sop.sopItemId, sopItemCode: sop.sopItemCode, checkedValue: true, comment: '' }]
      },
      source: 'TEST'
    });
    processQueueFresh_();

    sgSetSopProps_('true', 'WARN_ONLY', vw.client_code);

    var result = SopGate.evaluate_(vw);
    assertH_(results, counters, 'evaluate_: gateActive=true', result.gateActive === true, 'gateActive=' + result.gateActive);
    assertH_(results, counters, 'evaluate_: complete=true', result.complete === true, 'complete=' + result.complete);
    assertH_(results, counters, 'evaluate_: missing=[]', result.missing && result.missing.length === 0, 'missing.length=' + (result.missing ? result.missing.length : 'null'));

    var threw = false;
    try {
      SopGate.checkForQcSubmit(vw, SG_DESIGNER_ACTOR, 'SG-WARN-CMP-' + Date.now());
    } catch (e) { threw = true; }
    assertH_(results, counters, 'checkForQcSubmit: no throw when complete', !threw, 'threw unexpectedly');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  } finally {
    restore();
  }

  printResultsH_('testSopGate_warnOnly_complete', results, counters);
  return counters;
}


// ============================================================
// TEST 4 — BLOCK + Incomplete (full integration)
// BLOCK mode + incomplete checklist, submitted via full queue
// round-trip (IntakeService → queue → QCHandler → SopGate).
//
// Part A — Gate blocks:
//   QC_SUBMIT enqueued → processQueueFresh_ → SopGate throws
//   before idempotency → FACT_QC_EVENTS = 0, VW still IN_PROGRESS.
//
// Part B — Idempotency not consumed (retryable):
//   Checklist completed, second QC_SUBMIT enqueued →
//   processQueueFresh_ → gate passes → FACT_QC_EVENTS = 1,
//   VW transitions to QC_REVIEW. Proves the idempotency slot
//   was not consumed during the first (blocked) submission.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testSopGate_blockIncomplete() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };
  var restore  = sgSaveSopProps_();

  try {
    seedTestStaff();
    var jobNumber = thSetupInProgressJob_('sg-blk-inc');
    assertH_(results, counters, 'Setup: IN_PROGRESS job created', !!jobNumber, 'null');
    if (!jobNumber) {
      printResultsH_('testSopGate_blockIncomplete', results, counters);
      return counters;
    }

    var vw  = StateMachine.getJobView(jobNumber);
    var sop = schSeedActiveSopTemplate_(vw.client_code, vw.job_type, 'SGBI-' + Date.now());

    sgSetSopProps_('true', 'BLOCK', vw.client_code);

    // ── Part A: first QC_SUBMIT — gate should block ───────────
    IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.QC_SUBMIT,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload:        { job_number: jobNumber },
      source:         'TEST'
    });
    processQueueFresh_();

    // No QC event row should exist — gate threw before idempotency
    var qcAfterBlock;
    try {
      qcAfterBlock = DAL.readWhere(
        Config.TABLES.FACT_QC_EVENTS,
        { job_number: jobNumber },
        { periodId: TH_PERIOD_ID }
      );
    } catch (e) { qcAfterBlock = []; }
    assertH_(results, counters, 'Part A: FACT_QC_EVENTS = 0 after gate block',
      !qcAfterBlock || qcAfterBlock.length === 0,
      'rows: ' + (qcAfterBlock ? qcAfterBlock.length : 0));

    // VW must still be IN_PROGRESS
    var vwAfterBlock = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'Part A: VW still IN_PROGRESS after gate block',
      vwAfterBlock && vwAfterBlock.current_state === Config.STATES.IN_PROGRESS,
      vwAfterBlock ? vwAfterBlock.current_state : 'null');

    // QueueProcessor retries failed items (MAX_ATTEMPTS=3), so the first
    // QC_SUBMIT is still PENDING after Part A. Clear it now so it does not
    // race with the SOP_CHECKLIST item in Part B's processQueueFresh_().
    clearStalePendingItems_();

    // ── Part B: complete the checklist, re-submit QC ──────────
    IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.SOP_CHECKLIST,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload: {
        jobNumber:       jobNumber,
        sopTemplateId:   sop.sopTemplateId,
        sopTemplateHash: sop.templateHash,
        batchRequestId:  'SG-BATCH-BLK-' + Date.now(),
        items: [{ sopItemId: sop.sopItemId, sopItemCode: sop.sopItemCode, checkedValue: true, comment: '' }]
      },
      source: 'TEST'
    });
    processQueueFresh_();

    // Second QC_SUBMIT — gate should now pass
    IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.QC_SUBMIT,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload:        { job_number: jobNumber },
      source:         'TEST'
    });
    processQueueFresh_();

    var qcAfterComplete;
    try {
      qcAfterComplete = DAL.readWhere(
        Config.TABLES.FACT_QC_EVENTS,
        { job_number: jobNumber },
        { periodId: TH_PERIOD_ID }
      );
    } catch (e) { qcAfterComplete = []; }
    assertH_(results, counters, 'Part B: FACT_QC_EVENTS = 1 after checklist complete',
      qcAfterComplete && qcAfterComplete.length === 1,
      'rows: ' + (qcAfterComplete ? qcAfterComplete.length : 0));

    var vwAfterComplete = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'Part B: VW transitions to QC_REVIEW',
      vwAfterComplete && vwAfterComplete.current_state === Config.STATES.QC_REVIEW,
      vwAfterComplete ? vwAfterComplete.current_state : 'null');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  } finally {
    restore();
  }

  printResultsH_('testSopGate_blockIncomplete', results, counters);
  return counters;
}


// ============================================================
// TEST 5 — BLOCK + Complete
// All required items checked → gate passes even in BLOCK mode.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testSopGate_blockComplete() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };
  var restore  = sgSaveSopProps_();

  try {
    seedTestStaff();
    var jobNumber = thSetupInProgressJob_('sg-blk-cmp');
    assertH_(results, counters, 'Setup: IN_PROGRESS job created', !!jobNumber, 'null');
    if (!jobNumber) {
      printResultsH_('testSopGate_blockComplete', results, counters);
      return counters;
    }

    var vw  = StateMachine.getJobView(jobNumber);
    var sop = schSeedActiveSopTemplate_(vw.client_code, vw.job_type, 'SGBC-' + Date.now());

    // Check all required items
    IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.SOP_CHECKLIST,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload: {
        jobNumber:       jobNumber,
        sopTemplateId:   sop.sopTemplateId,
        sopTemplateHash: sop.templateHash,
        batchRequestId:  'SG-BATCH-BC-' + Date.now(),
        items: [{ sopItemId: sop.sopItemId, sopItemCode: sop.sopItemCode, checkedValue: true, comment: '' }]
      },
      source: 'TEST'
    });
    processQueueFresh_();

    sgSetSopProps_('true', 'BLOCK', vw.client_code);

    var threw = false;
    try {
      SopGate.checkForQcSubmit(vw, SG_DESIGNER_ACTOR, 'SG-BLK-CMP-' + Date.now());
    } catch (e) { threw = true; }
    assertH_(results, counters, 'checkForQcSubmit: no throw when BLOCK+complete', !threw, 'threw unexpectedly');

    var result = SopGate.evaluate_(vw);
    assertH_(results, counters, 'evaluate_: complete=true', result.complete === true, 'complete=' + result.complete);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  } finally {
    restore();
  }

  printResultsH_('testSopGate_blockComplete', results, counters);
  return counters;
}


// ============================================================
// TEST 6 — Non-Pilot Client
// SOP_PILOT_CLIENTS='SBS', job client_code is something else →
// gate skipped regardless of mode.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testSopGate_nonPilotClient() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };
  var restore  = sgSaveSopProps_();

  try {
    // TH_CLIENT_CODE = 'NORSPAN' (not in pilot list)
    sgSetSopProps_('true', 'BLOCK', 'SBS');

    var view   = sgFakeView_('BLC-SG-NOPILOT-' + Date.now(), TH_CLIENT_CODE, 'STRUCT');
    var result = SopGate.evaluate_(view);

    assertH_(results, counters, 'evaluate_: gateActive=false for non-pilot client',
      result.gateActive === false, 'gateActive=' + result.gateActive);
    assertH_(results, counters, 'evaluate_: reason=NON_PILOT_CLIENT',
      result.reason === 'NON_PILOT_CLIENT', 'reason=' + result.reason);

    var threw = false;
    try {
      SopGate.checkForQcSubmit(view, SG_DESIGNER_ACTOR, 'SG-NOPILOT-' + Date.now());
    } catch (e) { threw = true; }
    assertH_(results, counters, 'checkForQcSubmit: no throw for non-pilot client', !threw, 'threw unexpectedly');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  } finally {
    restore();
  }

  printResultsH_('testSopGate_nonPilotClient', results, counters);
  return counters;
}


// ============================================================
// TEST 7 — No Active Template
// Feature enabled, client IS in pilot list, but no active SOP
// template exists for this client+jobType → gate skipped.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testSopGate_noActiveTemplate() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };
  var restore  = sgSaveSopProps_();

  try {
    // Use a client code unlikely to have a template
    var clientCode = 'SG-NOTEMPL-' + Date.now();
    sgSetSopProps_('true', 'BLOCK', clientCode);

    var view   = sgFakeView_('BLC-SG-NOTMPL-' + Date.now(), clientCode, 'STRUCT');
    var result = SopGate.evaluate_(view);

    assertH_(results, counters, 'evaluate_: gateActive=false when no template',
      result.gateActive === false, 'gateActive=' + result.gateActive);
    assertH_(results, counters, 'evaluate_: reason=NO_TEMPLATE',
      result.reason === 'NO_TEMPLATE', 'reason=' + result.reason);

    var threw = false;
    try {
      SopGate.checkForQcSubmit(view, SG_DESIGNER_ACTOR, 'SG-NOTMPL-' + Date.now());
    } catch (e) { threw = true; }
    assertH_(results, counters, 'checkForQcSubmit: no throw when no template', !threw, 'threw unexpectedly');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  } finally {
    restore();
  }

  printResultsH_('testSopGate_noActiveTemplate', results, counters);
  return counters;
}


// ============================================================
// TEST 8 — QCHandler Regression
// SOP gate disabled → existing QCHandler happy path still
// writes QC_SUBMITTED event and transitions job to QC_REVIEW.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testSopGate_qcHandlerRegression() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };
  var restore  = sgSaveSopProps_();

  try {
    seedTestStaff();
    sgSetSopProps_('false', 'WARN_ONLY', null);

    var jobNumber = thSetupInProgressJob_('sg-qc-reg');
    assertH_(results, counters, 'Setup: IN_PROGRESS job created', !!jobNumber, 'null');
    if (!jobNumber) {
      printResultsH_('testSopGate_qcHandlerRegression', results, counters);
      return counters;
    }

    IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.QC_SUBMIT,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload:        { job_number: jobNumber },
      source:         'TEST'
    });
    processQueueFresh_();

    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'QCHandler: job transitioned to QC_REVIEW',
      vw && vw.current_state === Config.STATES.QC_REVIEW,
      vw ? vw.current_state : 'null');

    var qcEvents;
    try {
      qcEvents = DAL.readWhere(
        Config.TABLES.FACT_QC_EVENTS,
        { job_number: jobNumber },
        { periodId: TH_PERIOD_ID }
      );
    } catch (e) { qcEvents = []; }
    assertH_(results, counters, 'FACT_QC_EVENTS has exactly 1 row',
      qcEvents && qcEvents.length === 1, 'rows: ' + (qcEvents ? qcEvents.length : 0));

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  } finally {
    restore();
  }

  printResultsH_('testSopGate_qcHandlerRegression', results, counters);
  return counters;
}


// ============================================================
// TEST 9 — SopChecklistHandler Regression
// SOP gate enabled but feature has no effect on checklist
// submission — existing SopChecklistHandler happy path still
// writes audit and current-status rows.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testSopGate_sopChecklistRegression() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };
  var restore  = sgSaveSopProps_();

  try {
    seedTestStaff();
    // Enable gate in BLOCK mode — SopChecklistHandler must be unaffected
    sgSetSopProps_('true', 'BLOCK', TH_CLIENT_CODE);

    var jobNumber = thSetupInProgressJob_('sg-sch-reg');
    assertH_(results, counters, 'Setup: IN_PROGRESS job created', !!jobNumber, 'null');
    if (!jobNumber) {
      printResultsH_('testSopGate_sopChecklistRegression', results, counters);
      return counters;
    }

    var vw  = StateMachine.getJobView(jobNumber);
    var sop = schSeedActiveSopTemplate_(vw.client_code, vw.job_type, 'SGREG-' + Date.now());

    IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.SOP_CHECKLIST,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload: {
        jobNumber:       jobNumber,
        sopTemplateId:   sop.sopTemplateId,
        sopTemplateHash: sop.templateHash,
        batchRequestId:  'SG-BATCH-REG-' + Date.now(),
        items: [{ sopItemId: sop.sopItemId, sopItemCode: sop.sopItemCode, checkedValue: true, comment: '' }]
      },
      source: 'TEST'
    });
    processQueueFresh_();

    var status = SopDAL.getCurrentStatus(jobNumber);
    assertH_(results, counters, 'FACT_SOP_CURRENT_STATUS row exists',
      status && status.length > 0, 'rows: ' + (status ? status.length : 0));
    assertH_(results, counters, 'checked_value is TRUE',
      status && status.length > 0 && String(status[0].checked_value).toUpperCase() === 'TRUE',
      status && status.length > 0 ? status[0].checked_value : 'no row');

    var audits = DAL.readWhere(
      Config.TABLES.FACT_SOP_AUDITS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID }
    );
    assertH_(results, counters, 'FACT_SOP_AUDITS has exactly 1 row',
      audits && audits.length === 1, 'rows: ' + (audits ? audits.length : 0));

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  } finally {
    restore();
  }

  printResultsH_('testSopGate_sopChecklistRegression', results, counters);
  return counters;
}
