// ============================================================
// SopUploadEngineTest.gs — T1 minimum for SopUploadEngine.createUpload
//
// Uses the existing TH_CLIENT_CODE ('TEST-CLIENT') and TH_CEO_EMAIL /
// TH_DESIGNER_EMAIL constants from TestHarness.gs rather than
// redeclaring a duplicate client-code constant (testing-policy.md §2
// prefers referencing a shared constant over a second literal with
// the same value).
// ============================================================

/**
 * Ensures an active TEST-CLIENT row exists in DIM_CLIENT_MASTER.
 * Called before any test that exercises SopUploadEngine.createUpload,
 * which validates client_code against an active DIM_CLIENT_MASTER row
 * (no other test suite requires this — see task-1-report.md Concern 1).
 * Idempotent — ClientOnboarding.onboardClient() leaves the existing
 * master row unchanged and only appends a new rate row if TEST-CLIENT
 * already exists.
 */
function thEnsureTestClient_() {
  if (!Config.isDev()) {
    throw new Error('Test suite cannot run in PROD. Switch to DEV environment.');
  }
  ClientOnboarding.onboardClient(TH_CEO_EMAIL, {
    client_code: TH_CLIENT_CODE,
    client_name: 'Test Client',
    currency:    'CAD',
    hourly_rate: 100
  });
}

function testSopUpload_happyPath() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var blob = Utilities.newBlob('fake sop content', 'text/plain', 'test-sop.txt');
    var result = SopUploadEngine.createUpload(TH_CEO_EMAIL, {
      clientCode: TH_CLIENT_CODE,
      productCode: Config.PRODUCT_CODES.TRUSS,
      docType: 'DESIGNER_SOP',
      fileBlob: blob,
      fileName: 'test-sop.txt'
    });
    assertH_(results, counters, 'Returns an uploadId', !!result.uploadId, JSON.stringify(result));

    var rows = DAL.readWhere(Config.TABLES.DIM_SOP_UPLOADS, { upload_id: result.uploadId });
    assertH_(results, counters, 'DIM_SOP_UPLOADS row exists', rows.length === 1, 'count=' + rows.length);
    if (rows.length === 1) {
      assertH_(results, counters, 'status = PENDING', rows[0].status === 'PENDING', rows[0].status);
      assertH_(results, counters, 'product_code stored', rows[0].product_code === Config.PRODUCT_CODES.TRUSS, rows[0].product_code);
    }
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  results.forEach(function (r) { console.log(r); });
  return counters;
}

function testSopUpload_rbacDenial() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var blob = Utilities.newBlob('fake sop content', 'text/plain', 'test-sop.txt');
    var threw = false;
    try {
      SopUploadEngine.createUpload(TH_DESIGNER_EMAIL, {
        clientCode: TH_CLIENT_CODE, productCode: Config.PRODUCT_CODES.TRUSS,
        docType: 'DESIGNER_SOP', fileBlob: blob, fileName: 'x.txt'
      });
    } catch (e) { threw = true; }
    assertH_(results, counters, 'Non-CEO actor rejected', threw, 'threw=' + threw);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  results.forEach(function (r) { console.log(r); });
  return counters;
}

function testSopUpload_invalidInput() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var threw = false;
    try {
      SopUploadEngine.createUpload(TH_CEO_EMAIL, {
        clientCode: TH_CLIENT_CODE, productCode: 'NOT_A_REAL_PRODUCT',
        docType: 'DESIGNER_SOP', fileBlob: Utilities.newBlob('x'), fileName: 'x.txt'
      });
    } catch (e) { threw = true; }
    assertH_(results, counters, 'Invalid product_code rejected', threw, 'threw=' + threw);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  results.forEach(function (r) { console.log(r); });
  return counters;
}

function testSopUpload_unknownClient() {
  // T1 calls for a "duplicate submission" case; this is a one-off admin
  // action with no natural idempotency key, so this suite substitutes
  // the other realistic rejection case: an unknown/inactive client_code.
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var threw = false;
    try {
      SopUploadEngine.createUpload(TH_CEO_EMAIL, {
        clientCode: 'NOT-A-REAL-CLIENT', productCode: Config.PRODUCT_CODES.TRUSS,
        docType: 'DESIGNER_SOP', fileBlob: Utilities.newBlob('x'), fileName: 'x.txt'
      });
    } catch (e) { threw = true; }
    assertH_(results, counters, 'Unknown client_code rejected', threw, 'threw=' + threw);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  results.forEach(function (r) { console.log(r); });
  return counters;
}

function testSopUpload_reviewFeedback_validToken() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var blob = Utilities.newBlob('x', 'text/plain', 'x.txt');
    var upload = SopUploadEngine.createUpload(TH_CEO_EMAIL, {
      clientCode: TH_CLIENT_CODE, productCode: Config.PRODUCT_CODES.TRUSS,
      docType: 'DESIGNER_SOP', fileBlob: blob, fileName: 'x.txt'
    });
    // Simulate Claude having structured it — move straight to DRAFT_READY for this test.
    DAL.updateWhere(Config.TABLES.DIM_SOP_UPLOADS,
      { upload_id: upload.uploadId }, { status: 'DRAFT_READY' }, { callerModule: 'SopUploadEngineTest' });

    var token = SopUploadEngine.tokenForUpload(upload.uploadId);
    var review = SopUploadEngine.getUploadForReview(upload.uploadId, token);
    assertH_(results, counters, 'getUploadForReview returns status DRAFT_READY', review.status === 'DRAFT_READY', review.status);

    var feedback = SopUploadEngine.submitReviewFeedback(upload.uploadId, token, 'Test Manager', 'LOOKS_CORRECT', 'looks fine');
    assertH_(results, counters, 'submitReviewFeedback ok', feedback.ok === true, JSON.stringify(feedback));

    var rows = DAL.readWhere(Config.TABLES.FACT_SOP_REVIEW_FEEDBACK, { upload_id: upload.uploadId });
    assertH_(results, counters, 'FACT_SOP_REVIEW_FEEDBACK row written', rows.length === 1, 'count=' + rows.length);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  results.forEach(function (r) { console.log(r); });
  return counters;
}

function testSopUpload_reviewFeedback_invalidToken() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var blob = Utilities.newBlob('x', 'text/plain', 'x.txt');
    var upload = SopUploadEngine.createUpload(TH_CEO_EMAIL, {
      clientCode: TH_CLIENT_CODE, productCode: Config.PRODUCT_CODES.TRUSS,
      docType: 'DESIGNER_SOP', fileBlob: blob, fileName: 'x.txt'
    });
    DAL.updateWhere(Config.TABLES.DIM_SOP_UPLOADS,
      { upload_id: upload.uploadId }, { status: 'DRAFT_READY' }, { callerModule: 'SopUploadEngineTest' });

    var threw = false;
    try {
      SopUploadEngine.getUploadForReview(upload.uploadId, 'not-a-real-token');
    } catch (e) { threw = true; }
    assertH_(results, counters, 'Wrong token rejected', threw, 'threw=' + threw);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  results.forEach(function (r) { console.log(r); });
  return counters;
}

function testSopUpload_reviewFeedback_refusedAfterPublish() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var blob = Utilities.newBlob('x', 'text/plain', 'x.txt');
    var upload = SopUploadEngine.createUpload(TH_CEO_EMAIL, {
      clientCode: TH_CLIENT_CODE, productCode: Config.PRODUCT_CODES.TRUSS,
      docType: 'DESIGNER_SOP', fileBlob: blob, fileName: 'x.txt'
    });
    DAL.updateWhere(Config.TABLES.DIM_SOP_UPLOADS,
      { upload_id: upload.uploadId }, { status: 'PUBLISHED' }, { callerModule: 'SopUploadEngineTest' });

    var token = SopUploadEngine.tokenForUpload(upload.uploadId);
    var threw = false;
    try {
      SopUploadEngine.submitReviewFeedback(upload.uploadId, token, 'Test Manager', 'LOOKS_CORRECT', '');
    } catch (e) { threw = true; }
    assertH_(results, counters, 'Feedback refused once status is PUBLISHED', threw, 'threw=' + threw);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  results.forEach(function (r) { console.log(r); });
  return counters;
}

// Retires any pre-existing ACTIVE template for this client+scope so
// createTemplate() can run again on a repeat test run (Rule T3).
function thRetireActiveSopTemplateIfAny_(clientCode, scopeCode) {
  if (!Config.isDev()) {
    throw new Error('Test suite cannot run in PROD. Switch to DEV environment.');
  }
  var existing = SopDAL.findActiveTemplateForJob(clientCode, scopeCode);
  if (existing) {
    SopAdminEngine.retireTemplate(TH_CEO_EMAIL, existing.sop_template_id);
  }
}

function testSopUpload_publish_happyPath() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    thRetireActiveSopTemplateIfAny_(TH_CLIENT_CODE, Config.PRODUCT_CODES.TRUSS);
    var template = SopAdminEngine.createTemplate(TH_CEO_EMAIL, {
      clientCode: TH_CLIENT_CODE, jobType: Config.PRODUCT_LABELS.TRUSS,
      software: 'TestSoftware', scopeCode: Config.PRODUCT_CODES.TRUSS
    });
    SopAdminEngine.addItem(TH_CEO_EMAIL, template.sopTemplateId, {
      item_code: 'TEST_ITEM_1', item_label: 'Test item', is_required: 'TRUE'
    });

    var blob = Utilities.newBlob('x', 'text/plain', 'x.txt');
    var upload = SopUploadEngine.createUpload(TH_CEO_EMAIL, {
      clientCode: TH_CLIENT_CODE, productCode: Config.PRODUCT_CODES.TRUSS,
      docType: 'DESIGNER_SOP', fileBlob: blob, fileName: 'x.txt'
    });
    SopUploadEngine.markDraftReady(upload.uploadId, template.sopTemplateId, 'test notes');

    var result = SopUploadEngine.publishUpload(TH_CEO_EMAIL, upload.uploadId);
    assertH_(results, counters, 'publishUpload returns PUBLISHED', result.status === 'PUBLISHED', result.status);

    var rows = DAL.readWhere(Config.TABLES.DIM_SOP_UPLOADS, { upload_id: upload.uploadId });
    assertH_(results, counters, 'DIM_SOP_UPLOADS row shows PUBLISHED', rows[0].status === 'PUBLISHED', rows[0].status);

    var templateRow = SopDAL.getTemplateById(template.sopTemplateId);
    assertH_(results, counters, 'Underlying template is ACTIVE', templateRow.status === 'ACTIVE', templateRow.status);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  results.forEach(function (r) { console.log(r); });
  return counters;
}

function testSopUpload_listPendingUploads_reviewLinkFailureIsolated() {
  // Regression test for the fix-round Finding 2: buildReviewLink_ throwing
  // for one DRAFT_READY row (e.g. SOP_REVIEW_LINK_SECRET unset) must not
  // abort listPendingUploads for the whole CEO publish screen — the row
  // should still render with reviewLink: '' and its other fields intact.
  var results = [], counters = { passed: 0, failed: 0 };
  var props = PropertiesService.getScriptProperties();
  var savedSecret = props.getProperty('SOP_REVIEW_LINK_SECRET');
  // buildReviewLink_ short-circuits to '' before ever calling tokenForUpload
  // if PORTAL_BASE_URL is unset — force it set here so this test actually
  // reaches (and exercises) the tokenForUpload throw / try-catch fix,
  // regardless of whether PORTAL_BASE_URL happens to be set in this DEV env.
  var savedBaseUrl = props.getProperty('PORTAL_BASE_URL');
  try {
    props.deleteProperty('SOP_REVIEW_LINK_SECRET');
    props.setProperty('PORTAL_BASE_URL', 'https://example.com/exec');

    var blob = Utilities.newBlob('x', 'text/plain', 'x.txt');
    var upload = SopUploadEngine.createUpload(TH_CEO_EMAIL, {
      clientCode: TH_CLIENT_CODE, productCode: Config.PRODUCT_CODES.TRUSS,
      docType: 'DESIGNER_SOP', fileBlob: blob, fileName: 'x.txt'
    });
    DAL.updateWhere(Config.TABLES.DIM_SOP_UPLOADS,
      { upload_id: upload.uploadId }, { status: 'DRAFT_READY' }, { callerModule: 'SopUploadEngineTest' });

    var threw = false;
    var list;
    try {
      list = SopUploadEngine.listPendingUploads(TH_CEO_EMAIL);
    } catch (e) { threw = true; }
    assertH_(results, counters, 'listPendingUploads does not throw when SOP_REVIEW_LINK_SECRET is unset', !threw, 'threw=' + threw);

    if (!threw) {
      var row = list.filter(function (r) { return r.uploadId === upload.uploadId; })[0];
      assertH_(results, counters, 'DRAFT_READY row is still present in the result', !!row, JSON.stringify(row));
      if (row) {
        assertH_(results, counters, 'reviewLink falls back to empty string', row.reviewLink === '', 'reviewLink=' + row.reviewLink);
        assertH_(results, counters, 'Other row fields still populated', row.status === 'DRAFT_READY' && row.clientCode === TH_CLIENT_CODE, JSON.stringify(row));
      }
    }
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  } finally {
    if (savedSecret !== null)  { props.setProperty('SOP_REVIEW_LINK_SECRET', savedSecret); }
    else                       { props.deleteProperty('SOP_REVIEW_LINK_SECRET'); }
    if (savedBaseUrl !== null) { props.setProperty('PORTAL_BASE_URL', savedBaseUrl); }
    else                       { props.deleteProperty('PORTAL_BASE_URL'); }
  }
  results.forEach(function (r) { console.log(r); });
  return counters;
}

function testSopUpload_markDraftReady_notFound() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var threw = false;
    var errorCode = null;
    try {
      SopUploadEngine.markDraftReady('NOT-A-REAL-UPLOAD-ID', 'SOME-TEMPLATE-ID', 'notes');
    } catch (e) {
      threw = true;
      errorCode = e.code;
    }
    assertH_(results, counters, 'markDraftReady on bogus uploadId throws', threw, 'threw=' + threw);
    assertH_(results, counters, 'Throws SOP_UPLOAD_NOT_FOUND', errorCode === 'SOP_UPLOAD_NOT_FOUND', 'code=' + errorCode);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  results.forEach(function (r) { console.log(r); });
  return counters;
}

function testSopUpload_publish_rbacDenial() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var threw = false;
    try {
      SopUploadEngine.listPendingUploads(TH_DESIGNER_EMAIL);
    } catch (e) { threw = true; }
    assertH_(results, counters, 'Non-CEO listPendingUploads rejected', threw, 'threw=' + threw);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  results.forEach(function (r) { console.log(r); });
  return counters;
}

function testSopUpload_publish_notStructured() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var blob = Utilities.newBlob('x', 'text/plain', 'x.txt');
    var upload = SopUploadEngine.createUpload(TH_CEO_EMAIL, {
      clientCode: TH_CLIENT_CODE, productCode: Config.PRODUCT_CODES.TRUSS,
      docType: 'DESIGNER_SOP', fileBlob: blob, fileName: 'x.txt'
    });
    var threw = false;
    try {
      SopUploadEngine.publishUpload(TH_CEO_EMAIL, upload.uploadId);
    } catch (e) { threw = true; }
    assertH_(results, counters, 'Publishing a not-yet-structured upload rejected', threw, 'threw=' + threw);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  results.forEach(function (r) { console.log(r); });
  return counters;
}

function testSopUpload_publish_doublePublish() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    thRetireActiveSopTemplateIfAny_(TH_CLIENT_CODE, Config.PRODUCT_CODES.OPEN_WOOD_FLOOR);
    var template = SopAdminEngine.createTemplate(TH_CEO_EMAIL, {
      clientCode: TH_CLIENT_CODE, jobType: Config.PRODUCT_LABELS.OPEN_WOOD_FLOOR,
      software: 'TestSoftware', scopeCode: Config.PRODUCT_CODES.OPEN_WOOD_FLOOR
    });
    SopAdminEngine.addItem(TH_CEO_EMAIL, template.sopTemplateId, {
      item_code: 'TEST_ITEM_2', item_label: 'Test item 2', is_required: 'TRUE'
    });
    var blob = Utilities.newBlob('x', 'text/plain', 'x.txt');
    var upload = SopUploadEngine.createUpload(TH_CEO_EMAIL, {
      clientCode: TH_CLIENT_CODE, productCode: Config.PRODUCT_CODES.OPEN_WOOD_FLOOR,
      docType: 'DESIGNER_SOP', fileBlob: blob, fileName: 'x.txt'
    });
    SopUploadEngine.markDraftReady(upload.uploadId, template.sopTemplateId, '');
    SopUploadEngine.publishUpload(TH_CEO_EMAIL, upload.uploadId);

    var threw = false;
    try {
      SopUploadEngine.publishUpload(TH_CEO_EMAIL, upload.uploadId);
    } catch (e) { threw = true; }
    assertH_(results, counters, 'Second publish rejected', threw, 'threw=' + threw);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  results.forEach(function (r) { console.log(r); });
  return counters;
}

function runSopUploadEngineTests() {
  if (!Config.isDev()) {
    throw new Error('Test suite cannot run in PROD. Switch to DEV environment.');
  }
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  SOP UPLOAD ENGINE TEST SUITE');
  console.log('═══════════════════════════════════════════════════════');

  thEnsureTestClient_();

  var suiteCounters = { passed: 0, failed: 0 };
  var tests = [
    testSopUpload_happyPath,
    testSopUpload_rbacDenial,
    testSopUpload_invalidInput,
    testSopUpload_unknownClient,
    testSopUpload_reviewFeedback_validToken,
    testSopUpload_reviewFeedback_invalidToken,
    testSopUpload_reviewFeedback_refusedAfterPublish,
    testSopUpload_markDraftReady_notFound,
    testSopUpload_listPendingUploads_reviewLinkFailureIsolated,
    testSopUpload_publish_happyPath,
    testSopUpload_publish_rbacDenial,
    testSopUpload_publish_notStructured,
    testSopUpload_publish_doublePublish
  ];
  for (var i = 0; i < tests.length; i++) {
    var c = tests[i]();
    suiteCounters.passed += c.passed;
    suiteCounters.failed += c.failed;
  }
  console.log('SUITE TOTAL — passed: ' + suiteCounters.passed + '  failed: ' + suiteCounters.failed);
  thCleanupTestArtifacts_();
  return suiteCounters;
}
