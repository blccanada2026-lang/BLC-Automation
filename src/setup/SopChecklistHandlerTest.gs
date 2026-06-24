// ============================================================
// SopChecklistHandlerTest.gs — BLC Nexus Setup
// src/setup/SopChecklistHandlerTest.gs
//
// LOAD ORDER: Setup tier — loads after all T0–T13 files.
//
// HOW TO RUN (Apps Script editor):
//   runSopChecklistHandlerTests()  — all 5 tests, summary at end
//
// Individual tests:
//   testSopChecklistHandler_happyPath()
//   testSopChecklistHandler_rbacDenied()
//   testSopChecklistHandler_hashMismatch()
//   testSopChecklistHandler_duplicateBatch()
//   testSopChecklistHandler_jobNotFound()
//
// Test actors:
//   DESIGNER actor (SOP_SAVE=true)  — direct handle() calls
//   CLIENT  actor (SOP_SAVE=false)  — direct handle() calls
//   TH_DESIGNER_EMAIL via IntakeService → queue flow
//
// Happy path and duplicate tests go through IntakeService +
// processQueueFresh_() (full queue round-trip).
// RBAC denial, hash mismatch, and job-not-found tests call
// handle() directly — queue overhead avoided, RBAC guard verified.
// ============================================================

// ── Reusable actor stubs ──────────────────────────────────────

/** DESIGNER actor — SOP_SAVE=true. */
var SCH_DESIGNER_ACTOR = {
  email:         TH_DESIGNER_EMAIL,
  personCode:    'DS1',
  role:          'DESIGNER',
  displayName:   'Test Designer',
  scope:         'SELF',
  _rbacResolved: true
};

/** CLIENT actor — SOP_SAVE=false. */
var SCH_CLIENT_ACTOR = {
  email:         'testclient@example.com',
  personCode:    'EXT',
  role:          'CLIENT',
  displayName:   'External Client',
  scope:         'EXTERNAL',
  _rbacResolved: true
};

// ── Local helper ──────────────────────────────────────────────

/**
 * Creates a DRAFT template for (clientCode, jobType), adds one
 * required item, and publishes it. Each call uses a unique software
 * value so templates do not auto-retire one another across tests.
 *
 * @param {string} clientCode
 * @param {string} jobType
 * @param {string} suffix  Uniqueness salt (caller provides Date.now() + tag)
 * @returns {{ sopTemplateId, sopItemId, sopItemCode, templateHash }}
 */
function schSeedActiveSopTemplate_(clientCode, jobType, suffix) {
  // Retire any accumulated ACTIVE templates for this client+scope before
  // creating the new one. findActiveTemplateForJob now filters on client_code
  // + scope_code, so stale templates from prior test runs must be retired.
  var stale;
  do {
    stale = SopDAL.findActiveTemplateForJob(clientCode, TH_PRODUCT_CODE);
    if (stale) {
      SopAdminEngine.retireTemplate(TH_CEO_EMAIL, stale.sop_template_id);
    }
  } while (stale);

  var r = SopAdminEngine.createTemplate(TH_CEO_EMAIL, {
    clientCode: clientCode,
    jobType:    jobType,
    software:   'SCH-SW-' + suffix,
    scopeCode:  TH_PRODUCT_CODE
  });
  SopAdminEngine.addItem(TH_CEO_EMAIL, r.sopTemplateId, {
    item_code:   'SCH-ITEM-' + suffix,
    item_label:  'Test checklist item ' + suffix,
    is_required: 'TRUE'
  });
  var pub   = SopAdminEngine.publishTemplate(TH_CEO_EMAIL, r.sopTemplateId);
  var items = SopDAL.getSopItems(r.sopTemplateId);
  return {
    sopTemplateId:  r.sopTemplateId,
    sopItemId:      items[0].sop_item_id,
    sopItemCode:    items[0].item_code,
    templateHash:   pub.templateHash
  };
}

// ── Test runner ───────────────────────────────────────────────

/**
 * Runs all 5 SopChecklistHandler tests and prints an aggregate summary.
 * Call from the Apps Script editor.
 *
 * @returns {{ passed: number, failed: number }}
 */
function runSopChecklistHandlerTests() {
  var tests = [
    testSopChecklistHandler_happyPath,
    testSopChecklistHandler_rbacDenied,
    testSopChecklistHandler_hashMismatch,
    testSopChecklistHandler_duplicateBatch,
    testSopChecklistHandler_jobNotFound
  ];

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
  console.log('SOP CHECKLIST HANDLER TESTS — ' + totalPassed + ' passed, ' + totalFailed + ' failed');
  return { passed: totalPassed, failed: totalFailed };
}


// ============================================================
// TEST 1 — Happy Path
// DESIGNER submits a valid SOP_CHECKLIST payload via queue.
// Expected: FACT_SOP_CURRENT_STATUS row written with
// checked_value=TRUE and the correct sop_template_id.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testSopChecklistHandler_happyPath() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    seedTestStaff();

    var jobNumber = thSetupInProgressJob_('sop-happy');
    assertH_(results, counters, 'Setup: IN_PROGRESS job created',
      !!jobNumber, 'jobNumber=' + jobNumber);
    if (!jobNumber) {
      printResultsH_('testSopChecklistHandler_happyPath', results, counters);
      return counters;
    }

    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW row exists', !!vw, 'null');
    if (!vw) {
      printResultsH_('testSopChecklistHandler_happyPath', results, counters);
      return counters;
    }

    var sop = schSeedActiveSopTemplate_(vw.client_code, vw.job_type, 'HP-' + Date.now());
    assertH_(results, counters, 'Active SOP template seeded', !!sop.sopTemplateId, 'null');

    var batchId = 'TEST-BATCH-HP-' + Date.now();

    var sub = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.SOP_CHECKLIST,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload: {
        jobNumber:       jobNumber,
        sopTemplateId:   sop.sopTemplateId,
        sopTemplateHash: sop.templateHash,
        batchRequestId:  batchId,
        items: [{
          sopItemId:    sop.sopItemId,
          sopItemCode:  sop.sopItemCode,
          checkedValue: true,
          comment:      'Test comment'
        }]
      },
      source: 'TEST'
    });
    assertH_(results, counters, 'IntakeService returns ok=true',
      sub && sub.ok === true, JSON.stringify(sub));

    processQueueFresh_();

    var status = SopDAL.getCurrentStatus(jobNumber);
    assertH_(results, counters, 'FACT_SOP_CURRENT_STATUS row exists',
      status && status.length > 0, 'rows: ' + (status ? status.length : 0));
    assertH_(results, counters, 'checked_value is TRUE',
      status && status.length > 0 && String(status[0].checked_value).toUpperCase() === 'TRUE',
      status && status.length > 0 ? status[0].checked_value : 'no row');
    assertH_(results, counters, 'sop_template_id matches',
      status && status.length > 0 && status[0].sop_template_id === sop.sopTemplateId,
      status && status.length > 0 ? status[0].sop_template_id : 'no row');

    var audits = DAL.readWhere(
      Config.TABLES.FACT_SOP_AUDITS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID }
    );
    assertH_(results, counters, 'FACT_SOP_AUDITS has exactly 1 audit row',
      audits && audits.length === 1, 'rows: ' + (audits ? audits.length : 0));

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testSopChecklistHandler_happyPath', results, counters);
  return counters;
}


// ============================================================
// TEST 2 — RBAC Denial
// CLIENT actor (SOP_SAVE=false) calls handle() directly.
// Expected: enforcePermission throws before any payload parse.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testSopChecklistHandler_rbacDenied() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var threw = false;
    try {
      SopChecklistHandler.handle(
        {
          queue_id:     'TEST-RBAC-' + Date.now(),
          payload_json: JSON.stringify({
            jobNumber:       'BLC-FAKE-RBAC',
            sopTemplateId:   'ST-FAKE',
            sopTemplateHash: 'FAKEHASH',
            batchRequestId:  'BATCH-RBAC',
            items: [{ sopItemId: 'SI-FAKE', sopItemCode: 'FAKE', checkedValue: true, comment: '' }]
          })
        },
        SCH_CLIENT_ACTOR
      );
    } catch (e) {
      threw = true;
    }
    assertH_(results, counters, 'CLIENT actor: handle() throws RBAC denial',
      threw, 'no error thrown');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testSopChecklistHandler_rbacDenied', results, counters);
  return counters;
}


// ============================================================
// TEST 3 — Template Hash Mismatch
// Valid job + valid ACTIVE template, but sopTemplateHash in
// payload does not match the server-computed hash.
// Expected: SOP_HASH_MISMATCH thrown, no rows written.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testSopChecklistHandler_hashMismatch() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupInProgressJob_('sop-hashmm');
    assertH_(results, counters, 'Setup: IN_PROGRESS job created',
      !!jobNumber, 'jobNumber=' + jobNumber);
    if (!jobNumber) {
      printResultsH_('testSopChecklistHandler_hashMismatch', results, counters);
      return counters;
    }

    var vw  = StateMachine.getJobView(jobNumber);
    var sop = schSeedActiveSopTemplate_(vw.client_code, vw.job_type, 'MM-' + Date.now());

    var WRONG_HASH = 'BADHASH000000000000000000000000000000000000000000000000000000000';
    var threw      = false;
    var thrownCode = null;

    try {
      SopChecklistHandler.handle(
        {
          queue_id:     'TEST-HASHMM-' + Date.now(),
          payload_json: JSON.stringify({
            jobNumber:       jobNumber,
            sopTemplateId:   sop.sopTemplateId,
            sopTemplateHash: WRONG_HASH,
            batchRequestId:  'BATCH-MM-' + Date.now(),
            items: [{
              sopItemId:    sop.sopItemId,
              sopItemCode:  sop.sopItemCode,
              checkedValue: true,
              comment:      ''
            }]
          })
        },
        SCH_DESIGNER_ACTOR
      );
    } catch (e) {
      threw      = true;
      thrownCode = e.code || null;
    }

    assertH_(results, counters, 'Wrong hash: handle() throws',
      threw, 'no error thrown');
    assertH_(results, counters, 'Error code is SOP_HASH_MISMATCH',
      thrownCode === 'SOP_HASH_MISMATCH', 'code=' + thrownCode);

    var status = SopDAL.getCurrentStatus(jobNumber);
    assertH_(results, counters, 'No FACT_SOP_CURRENT_STATUS rows written on hash mismatch',
      !status || status.length === 0, 'rows written: ' + (status ? status.length : 0));

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testSopChecklistHandler_hashMismatch', results, counters);
  return counters;
}


// ============================================================
// TEST 4 — Duplicate Batch
// Identical payload submitted twice (same batchRequestId).
// Expected: idempotency — second submission is a no-op.
// FACT_SOP_CURRENT_STATUS has exactly one row (upsert, not append).
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testSopChecklistHandler_duplicateBatch() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    seedTestStaff();

    var jobNumber = thSetupInProgressJob_('sop-dup');
    assertH_(results, counters, 'Setup: IN_PROGRESS job created',
      !!jobNumber, 'jobNumber=' + jobNumber);
    if (!jobNumber) {
      printResultsH_('testSopChecklistHandler_duplicateBatch', results, counters);
      return counters;
    }

    var vw     = StateMachine.getJobView(jobNumber);
    var sop    = schSeedActiveSopTemplate_(vw.client_code, vw.job_type, 'DUP-' + Date.now());
    var batchId = 'TEST-BATCH-DUP-' + Date.now();
    var payload = {
      jobNumber:       jobNumber,
      sopTemplateId:   sop.sopTemplateId,
      sopTemplateHash: sop.templateHash,
      batchRequestId:  batchId,
      items: [{
        sopItemId:    sop.sopItemId,
        sopItemCode:  sop.sopItemCode,
        checkedValue: true,
        comment:      ''
      }]
    };

    // First submission — should write audit + current-status rows
    IntakeService.processSubmission({
      formType: Config.FORM_TYPES.SOP_CHECKLIST,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload: payload, source: 'TEST'
    });
    processQueueFresh_();

    // Second submission — identical batchRequestId, should be idempotent no-op
    IntakeService.processSubmission({
      formType: Config.FORM_TYPES.SOP_CHECKLIST,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload: payload, source: 'TEST'
    });
    processQueueFresh_();

    // Exactly one current-status row (upsertCurrentStatus overwrites, never appends duplicates)
    var status = SopDAL.getCurrentStatus(jobNumber);
    assertH_(results, counters, 'FACT_SOP_CURRENT_STATUS has exactly one row',
      status && status.length === 1, 'rows: ' + (status ? status.length : 0));
    assertH_(results, counters, 'Status row checked_value is TRUE',
      status && status.length > 0 && String(status[0].checked_value).toUpperCase() === 'TRUE',
      status && status.length > 0 ? status[0].checked_value : 'no row');

    // FACT_SOP_AUDITS is append-only — exactly 1 row proves the second submission
    // was a true no-op via IdempotencyEngine.checkAndMark (not just an upsert overwrite).
    var audits = DAL.readWhere(
      Config.TABLES.FACT_SOP_AUDITS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID }
    );
    assertH_(results, counters, 'FACT_SOP_AUDITS has exactly 1 row (second call was idempotent)',
      audits && audits.length === 1, 'rows: ' + (audits ? audits.length : 0));

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testSopChecklistHandler_duplicateBatch', results, counters);
  return counters;
}


// ============================================================
// TEST 5 — Job Not Found
// Valid DESIGNER actor but jobNumber not present in
// VW_JOB_CURRENT_STATE → handler must throw before any writes.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testSopChecklistHandler_jobNotFound() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var threw = false;
    try {
      SopChecklistHandler.handle(
        {
          queue_id:     'TEST-NOTFOUND-' + Date.now(),
          payload_json: JSON.stringify({
            jobNumber:       'BLC-DOES-NOT-EXIST-' + Date.now(),
            sopTemplateId:   'ST-FAKE',
            sopTemplateHash: 'FAKEHASH',
            batchRequestId:  'BATCH-NF-' + Date.now(),
            items: [{ sopItemId: 'SI-FAKE', sopItemCode: 'FAKE', checkedValue: true, comment: '' }]
          })
        },
        SCH_DESIGNER_ACTOR
      );
    } catch (e) {
      threw = true;
    }
    assertH_(results, counters, 'Unknown jobNumber: handle() throws',
      threw, 'no error thrown');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testSopChecklistHandler_jobNotFound', results, counters);
  return counters;
}
