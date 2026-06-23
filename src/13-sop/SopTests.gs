// ============================================================
// SopTests.gs — BLC Nexus T13 SOP Checklist Gate
// src/13-sop/SopTests.gs
//
// Integration tests for SopDAL, SopTemplateEngine, and
// SopAuditEngine. All test IDs use TEST- prefix (Rule T2).
// Tests are independent and idempotent (Rule T3).
//
// Run from Apps Script editor: call testSopAll() or any
// individual test function.
// ============================================================

// ──────────────────────────────────────────────────────────
// Test runner
// ──────────────────────────────────────────────────────────
function testSopAll() {
  var results = [];
  var tests   = [
    testSopDAL_getActiveTemplate_found,
    testSopDAL_getActiveTemplate_notFound,
    testSopTemplateEngine_hashMismatch,
    testSopAuditEngine_recordItemCheck_happy,
    testSopAuditEngine_recordItemCheck_duplicate,
    testSopAuditEngine_isChecklistComplete_true,
    testSopAuditEngine_isChecklistComplete_false,
    testSopAuditEngine_rbacDenied
  ];

  tests.forEach(function (fn) {
    try {
      fn();
      results.push({ test: fn.name, status: 'PASS' });
      Logger.info('SOP_TEST_PASS', { test: fn.name });
    } catch (e) {
      results.push({ test: fn.name, status: 'FAIL', error: e.message });
      Logger.error('SOP_TEST_FAIL', { test: fn.name, error: e.message });
    }
  });

  var passed  = results.filter(function (r) { return r.status === 'PASS'; }).length;
  var failed  = results.filter(function (r) { return r.status === 'FAIL'; }).length;
  console.log('SOP TESTS — ' + passed + ' passed, ' + failed + ' failed of ' + tests.length);
  if (failed > 0) {
    results.filter(function (r) { return r.status === 'FAIL'; }).forEach(function (r) {
      console.log('  FAIL: ' + r.test + ' — ' + r.error);
    });
  }
  return results;
}

// ──────────────────────────────────────────────────────────
// Helper: assert strict equality
// ──────────────────────────────────────────────────────────
function sopAssert_(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(label + ': expected ' + JSON.stringify(expected) + ' got ' + JSON.stringify(actual));
  }
}

function sopAssertTrue_(label, value) {
  if (!value) {
    throw new Error(label + ': expected truthy, got ' + JSON.stringify(value));
  }
}

function sopAssertFalse_(label, value) {
  if (value) {
    throw new Error(label + ': expected falsy, got ' + JSON.stringify(value));
  }
}

function sopAssertThrows_(label, fn, expectedCode) {
  var threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    if (expectedCode && e.code !== expectedCode) {
      throw new Error(label + ': expected error code ' + expectedCode + ' got ' + e.code + ' — ' + e.message);
    }
  }
  if (!threw) {
    throw new Error(label + ': expected an error but none was thrown');
  }
}

// ──────────────────────────────────────────────────────────
// Test 1: SopDAL.getActiveTemplate — found
// ──────────────────────────────────────────────────────────
function testSopDAL_getActiveTemplate_found() {
  var templateId = 'ST-TEST-GETACTIVE-' + Date.now();
  var itemId     = 'SI-TEST-GETACTIVE-' + Date.now();

  // Seed template
  SopDAL.saveTemplate({
    sop_template_id:  templateId,
    client_code:      'TEST-CLIENT',
    job_type:         'STRUCTURAL',
    software:         'REVIT',
    scope_code:       'FULL',
    version:          '1',
    status:           'ACTIVE',
    effective_from:   '2020-01-01',
    effective_to:     '2099-12-31',
    created_by:       'test',
    created_at:       new Date().toISOString(),
    template_hash:    ''
  });

  // Seed one item (so hash can be computed)
  SopDAL.saveItem({
    sop_item_id:          itemId,
    sop_template_id:      templateId,
    item_seq:             '1',
    item_code:            'TEST-ITEM-001',
    item_label:           'Test item label',
    item_description:     'Test item description',
    is_required:          'TRUE',
    requires_comment:     'FALSE',
    requires_attachment:  'FALSE',
    active_flag:          'TRUE',
    created_at:           new Date().toISOString()
  });

  var result = SopDAL.getActiveTemplate('TEST-CLIENT', 'STRUCTURAL', 'REVIT', 'FULL');
  sopAssertTrue_('getActiveTemplate should return a row', result !== null);
  sopAssert_('should return correct template id', result.sop_template_id, templateId);
}

// ──────────────────────────────────────────────────────────
// Test 2: SopDAL.getActiveTemplate — not found
// ──────────────────────────────────────────────────────────
function testSopDAL_getActiveTemplate_notFound() {
  var result = SopDAL.getActiveTemplate('TEST-NONEXISTENT', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN');
  sopAssertFalse_('getActiveTemplate should return null for unknown combo', result);
}

// ──────────────────────────────────────────────────────────
// Test 3: SopTemplateEngine — hash mismatch throws
// ──────────────────────────────────────────────────────────
function testSopTemplateEngine_hashMismatch() {
  var templateId = 'ST-TEST-HASHMM-' + Date.now();
  var itemId     = 'SI-TEST-HASHMM-' + Date.now();

  // Seed template with a deliberately wrong stored hash
  SopDAL.saveTemplate({
    sop_template_id:  templateId,
    client_code:      'TEST-HASHMM',
    job_type:         'STRUCT',
    software:         'AUTOCAD',
    scope_code:       'BASIC',
    version:          '1',
    status:           'ACTIVE',
    effective_from:   '2020-01-01',
    effective_to:     '2099-12-31',
    created_by:       'test',
    created_at:       new Date().toISOString(),
    template_hash:    'BADHASH0000000000000000000000000000000000000000000000000000000000'
  });

  SopDAL.saveItem({
    sop_item_id:          itemId,
    sop_template_id:      templateId,
    item_seq:             '1',
    item_code:            'HM-ITEM-001',
    item_label:           'Hash mismatch item',
    item_description:     'Description',
    is_required:          'TRUE',
    requires_comment:     'FALSE',
    requires_attachment:  'FALSE',
    active_flag:          'TRUE',
    created_at:           new Date().toISOString()
  });

  sopAssertThrows_(
    'resolveTemplate should throw SOP_HASH_MISMATCH',
    function () { SopTemplateEngine.resolveTemplate('TEST-HASHMM', 'STRUCT', 'AUTOCAD', 'BASIC'); },
    'SOP_HASH_MISMATCH'
  );
}

// ──────────────────────────────────────────────────────────
// Test 4: SopAuditEngine.recordItemCheck — happy path
// ──────────────────────────────────────────────────────────
function testSopAuditEngine_recordItemCheck_happy() {
  var templateId = 'ST-TEST-HAPPY-' + Date.now();
  var itemId     = 'SI-TEST-HAPPY-' + Date.now();
  var jobId      = 'TEST-JOB-HAPPY-' + Date.now();
  var requestId  = 'REQ-HAPPY-' + Date.now();

  // Seed template + item with correct hash
  SopDAL.saveItem({
    sop_item_id:          itemId,
    sop_template_id:      templateId,
    item_seq:             '1',
    item_code:            'HAPPY-001',
    item_label:           'Happy path item',
    item_description:     'Description',
    is_required:          'TRUE',
    requires_comment:     'FALSE',
    requires_attachment:  'FALSE',
    active_flag:          'TRUE',
    created_at:           new Date().toISOString()
  });

  var actor = {
    email:       'test-designer@blctest.com',
    person_code: 'TEST-DESIGNER',
    role:        Constants.ROLES.DESIGNER
  };

  var result = SopAuditEngine.recordItemCheck({
    actor:               actor,
    requestId:           requestId,
    jobId:               jobId,
    jobNumber:           'TEST-JOB-001',
    clientCode:          'TEST-CLIENT',
    sopTemplateId:       templateId,
    sopTemplateVersion:  '1',
    sopTemplateHash:     'testhash',
    sopItemId:           itemId,
    sopItemCode:         'HAPPY-001',
    checkedValue:        true,
    comment:             ''
  });

  sopAssertFalse_('recordItemCheck happy path should not be duplicate', result.duplicate);
  sopAssertTrue_('recordItemCheck should return an auditId', !!result.auditId);

  // Verify current status was written
  var status = SopDAL.getCurrentStatus(jobId);
  sopAssertTrue_('getCurrentStatus should return rows after recordItemCheck', status.length > 0);
  sopAssert_('current status checked_value should be TRUE', status[0].checked_value, 'TRUE');
}

// ──────────────────────────────────────────────────────────
// Test 5: SopAuditEngine.recordItemCheck — duplicate
// ──────────────────────────────────────────────────────────
function testSopAuditEngine_recordItemCheck_duplicate() {
  var itemId    = 'SI-TEST-DUP-' + Date.now();
  var jobId     = 'TEST-JOB-DUP-' + Date.now();
  var requestId = 'REQ-DUP-' + Date.now();

  var actor = {
    email:       'test-designer@blctest.com',
    person_code: 'TEST-DESIGNER',
    role:        Constants.ROLES.DESIGNER
  };

  var params = {
    actor:               actor,
    requestId:           requestId,
    jobId:               jobId,
    jobNumber:           'TEST-JOB-002',
    clientCode:          'TEST-CLIENT',
    sopTemplateId:       'ST-TEST-DUP',
    sopTemplateVersion:  '1',
    sopTemplateHash:     'testhash',
    sopItemId:           itemId,
    sopItemCode:         'DUP-001',
    checkedValue:        true,
    comment:             ''
  };

  var first  = SopAuditEngine.recordItemCheck(params);
  var second = SopAuditEngine.recordItemCheck(params);

  sopAssertFalse_('first call should not be duplicate', first.duplicate);
  sopAssertTrue_('second call should be duplicate', second.duplicate);
}

// ──────────────────────────────────────────────────────────
// Test 6: isChecklistComplete — all required items checked
// ──────────────────────────────────────────────────────────
function testSopAuditEngine_isChecklistComplete_true() {
  var itemId = 'SI-TEST-COMP-' + Date.now();
  var jobId  = 'TEST-JOB-COMP-' + Date.now();
  var reqId  = 'REQ-COMP-' + Date.now();

  var actor = {
    email:       'test-designer@blctest.com',
    person_code: 'TEST-DESIGNER',
    role:        Constants.ROLES.DESIGNER
  };

  // Record the check so current status exists
  SopAuditEngine.recordItemCheck({
    actor:               actor,
    requestId:           reqId,
    jobId:               jobId,
    jobNumber:           'TEST-COMP-003',
    clientCode:          'TEST-CLIENT',
    sopTemplateId:       'ST-COMP',
    sopTemplateVersion:  '1',
    sopTemplateHash:     'testhash',
    sopItemId:           itemId,
    sopItemCode:         'COMP-001',
    checkedValue:        true,
    comment:             ''
  });

  var templateContext = {
    items: [{
      sop_item_id:  itemId,
      item_seq:     '1',
      is_required:  'TRUE'
    }]
  };

  var complete = SopAuditEngine.isChecklistComplete(jobId, templateContext);
  sopAssertTrue_('isChecklistComplete should return true when all required items are checked', complete);
}

// ──────────────────────────────────────────────────────────
// Test 7: isChecklistComplete — required item not checked
// ──────────────────────────────────────────────────────────
function testSopAuditEngine_isChecklistComplete_false() {
  var jobId = 'TEST-JOB-INCOMP-' + Date.now();

  // No current status rows for this job — no check has been recorded

  var templateContext = {
    items: [{
      sop_item_id:  'SI-MISSING-' + Date.now(),
      item_seq:     '1',
      is_required:  'TRUE'
    }]
  };

  var complete = SopAuditEngine.isChecklistComplete(jobId, templateContext);
  sopAssertFalse_('isChecklistComplete should return false when required item has no status row', complete);
}

// ──────────────────────────────────────────────────────────
// Test 8: recordItemCheck — RBAC denial (CLIENT role)
// ──────────────────────────────────────────────────────────
function testSopAuditEngine_rbacDenied() {
  var actor = {
    email:       'external@client.com',
    person_code: 'EXT-001',
    role:        Constants.ROLES.CLIENT
  };

  sopAssertThrows_(
    'recordItemCheck should throw SOP_RBAC_DENIED for CLIENT role',
    function () {
      SopAuditEngine.recordItemCheck({
        actor:               actor,
        requestId:           'REQ-RBAC-' + Date.now(),
        jobId:               'TEST-JOB-RBAC',
        jobNumber:           'TEST-RBAC-004',
        clientCode:          'TEST-CLIENT',
        sopTemplateId:       'ST-RBAC',
        sopTemplateVersion:  '1',
        sopTemplateHash:     'testhash',
        sopItemId:           'SI-RBAC-001',
        sopItemCode:         'RBAC-001',
        checkedValue:        true,
        comment:             ''
      });
    },
    'SOP_RBAC_DENIED'
  );
}
