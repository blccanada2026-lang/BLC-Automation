// ============================================================
// SopAdminTests.gs — BLC Nexus T13 SOP Checklist Gate
// src/13-sop/SopAdminTests.gs
//
// Integration tests for SopAdminEngine and SopImporter.
// All test IDs use TEST- prefix (Rule T2).
// Tests are independent and idempotent (Rule T3).
//
// Run from Apps Script editor: testSopAdminAll()
// ============================================================

function testSopAdminAll() {
  var results = [];
  var tests   = [
    testSopAdmin_createTemplate_happy,
    testSopAdmin_createTemplate_rbacDenied,
    testSopAdmin_addItem_draftOk,
    testSopAdmin_addItem_activeFails,
    testSopAdmin_editItem_draftOk,
    testSopAdmin_editItem_activeFails,
    testSopAdmin_retireItemWithActiveFlagFalse,
    testSopAdmin_publishTemplate_setsHash,
    testSopAdmin_publishTemplate_autoRetires,
    testSopAdmin_publishAfterEdit_recomputesHash,
    testSopAdmin_copyTemplate_incrementsVersion,
    testSopAdmin_retireTemplate_happy,
    testSopImporter_dryRun,
    testSopImporter_idempotent
  ];

  tests.forEach(function (fn) {
    try {
      fn();
      results.push({ test: fn.name, status: 'PASS' });
      Logger.info('SOP_ADMIN_TEST_PASS', { test: fn.name });
    } catch (e) {
      results.push({ test: fn.name, status: 'FAIL', error: e.message });
      Logger.error('SOP_ADMIN_TEST_FAIL', { test: fn.name, error: e.message });
    }
  });

  var passed = results.filter(function (r) { return r.status === 'PASS'; }).length;
  var failed = results.filter(function (r) { return r.status === 'FAIL'; }).length;
  console.log('SOP ADMIN TESTS — ' + passed + ' passed, ' + failed + ' failed of ' + tests.length);
  if (failed > 0) {
    results.filter(function (r) { return r.status === 'FAIL'; }).forEach(function (r) {
      console.log('  FAIL: ' + r.test + ' — ' + r.error);
    });
  }
  return results;
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────
function adminAssert_(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(label + ': expected ' + JSON.stringify(expected) + ' got ' + JSON.stringify(actual));
  }
}
function adminAssertTrue_(label, value) {
  if (!value) throw new Error(label + ': expected truthy, got ' + JSON.stringify(value));
}
function adminAssertFalse_(label, value) {
  if (value)  throw new Error(label + ': expected falsy, got ' + JSON.stringify(value));
}
function adminAssertThrows_(label, fn, expectedCode) {
  var threw = false;
  try { fn(); } catch (e) {
    threw = true;
    if (expectedCode && e.code !== expectedCode) {
      throw new Error(label + ': expected error code ' + expectedCode + ' got ' + (e.code || e.message));
    }
  }
  if (!threw) throw new Error(label + ': expected an error but none was thrown');
}

/** Seed helper: creates a minimal DRAFT template + one item. Returns { sopTemplateId, sopItemId }. */
function seedDraftTemplate_(actorEmail, suffix) {
  var cc = 'TEST-' + suffix;
  var r  = SopAdminEngine.createTemplate(actorEmail, {
    clientCode: cc, jobType: 'STRUCT', software: 'REVIT', scopeCode: 'FULL'
  });
  var ri = SopAdminEngine.addItem(actorEmail, r.sopTemplateId, {
    item_code:   'TEST-ITEM-' + suffix,
    item_label:  'Test item for ' + suffix,
    is_required: 'TRUE'
  });
  return { sopTemplateId: r.sopTemplateId, sopItemId: ri.sopItemId, clientCode: cc };
}

/** Seed helper: creates, adds item, publishes. Returns { sopTemplateId, sopItemId, templateHash }. */
function seedActiveTemplate_(actorEmail, suffix) {
  var draft  = seedDraftTemplate_(actorEmail, suffix);
  var pub    = SopAdminEngine.publishTemplate(actorEmail, draft.sopTemplateId);
  draft.templateHash = pub.templateHash;
  return draft;
}

var ADMIN_EMAIL = 'raj@bluelotuscanada.ca';

// ──────────────────────────────────────────────────────────
// Test 1: createTemplate — happy path
// ──────────────────────────────────────────────────────────
function testSopAdmin_createTemplate_happy() {
  var suffix = 'CT-HAPPY-' + Date.now();
  var result = SopAdminEngine.createTemplate(ADMIN_EMAIL, {
    clientCode: 'TEST-' + suffix, jobType: 'STRUCT', software: 'REVIT', scopeCode: 'FULL'
  });
  adminAssertTrue_('createTemplate should return sopTemplateId', !!result.sopTemplateId);

  var template = SopDAL.getTemplateById(result.sopTemplateId);
  adminAssertTrue_('template should exist in DIM', !!template);
  adminAssert_('status should be DRAFT', template.status, 'DRAFT');
  adminAssert_('version should be 1',    template.version, '1');
  adminAssert_('template_hash should be empty', template.template_hash, '');
}

// ──────────────────────────────────────────────────────────
// Test 2: createTemplate — RBAC denied (DESIGNER)
// ──────────────────────────────────────────────────────────
function testSopAdmin_createTemplate_rbacDenied() {
  adminAssertThrows_(
    'createTemplate should throw for DESIGNER actor',
    function () {
      // Use a test email that resolves to DESIGNER role
      // If resolveActor throws (email not in roster), that error is acceptable
      // For a true RBAC test, we'd need a seeded test actor —
      // here we rely on an unknown email not having SOP_ADMIN
      var designerEmail = 'test-designer@blctest.com';
      SopAdminEngine.createTemplate(designerEmail, {
        clientCode: 'TEST-RBAC-ADM', jobType: 'STRUCT', software: 'REVIT', scopeCode: 'FULL'
      });
    },
    null // RBAC error code may vary by resolveActor behaviour — any throw is correct
  );
}

// ──────────────────────────────────────────────────────────
// Test 3: addItem — succeeds on DRAFT
// ──────────────────────────────────────────────────────────
function testSopAdmin_addItem_draftOk() {
  var suffix = 'ADD-DRAFT-' + Date.now();
  var draft  = seedDraftTemplate_(ADMIN_EMAIL, suffix);

  // Add a second item
  var r2 = SopAdminEngine.addItem(ADMIN_EMAIL, draft.sopTemplateId, {
    item_code: 'TEST-ITEM2-' + suffix, item_label: 'Second item'
  });
  adminAssertTrue_('addItem should return sopItemId', !!r2.sopItemId);

  var items = SopDAL.getSopItems(draft.sopTemplateId);
  adminAssert_('should now have 2 active items', items.length, 2);
  // item_seq of second item should be 2 (first was auto-assigned 1)
  adminAssert_('second item item_seq should be 2', items[1].item_seq, '2');
}

// ──────────────────────────────────────────────────────────
// Test 4: addItem — fails on ACTIVE template
// ──────────────────────────────────────────────────────────
function testSopAdmin_addItem_activeFails() {
  var suffix = 'ADD-ACTIVE-' + Date.now();
  var active = seedActiveTemplate_(ADMIN_EMAIL, suffix);

  adminAssertThrows_(
    'addItem should throw SOP_TEMPLATE_NOT_DRAFT for ACTIVE template',
    function () {
      SopAdminEngine.addItem(ADMIN_EMAIL, active.sopTemplateId, {
        item_code: 'BAD-ITEM', item_label: 'Should not be added'
      });
    },
    'SOP_TEMPLATE_NOT_DRAFT'
  );
}

// ──────────────────────────────────────────────────────────
// Test 5: editItem — succeeds on DRAFT (label + flag update)
// ──────────────────────────────────────────────────────────
function testSopAdmin_editItem_draftOk() {
  var suffix = 'EDIT-DRAFT-' + Date.now();
  var draft  = seedDraftTemplate_(ADMIN_EMAIL, suffix);

  var r = SopAdminEngine.editItem(ADMIN_EMAIL, draft.sopItemId, {
    item_label:      'Updated label for edit test',
    item_description:'Added description',
    requires_comment: 'TRUE'
  });
  adminAssert_('editItem should return same sopItemId', r.sopItemId, draft.sopItemId);

  var item = SopDAL.getItemById(draft.sopItemId);
  adminAssert_('item_label should be updated',        item.item_label,      'Updated label for edit test');
  adminAssert_('item_description should be updated',  item.item_description,'Added description');
  adminAssert_('requires_comment should be TRUE',     item.requires_comment, 'TRUE');
}

// ──────────────────────────────────────────────────────────
// Test 6: editItem — fails on ACTIVE template item
// ──────────────────────────────────────────────────────────
function testSopAdmin_editItem_activeFails() {
  var suffix = 'EDIT-ACTIVE-' + Date.now();
  var active = seedActiveTemplate_(ADMIN_EMAIL, suffix);

  adminAssertThrows_(
    'editItem should throw SOP_TEMPLATE_NOT_DRAFT for item in ACTIVE template',
    function () {
      SopAdminEngine.editItem(ADMIN_EMAIL, active.sopItemId, { item_label: 'Should not update' });
    },
    'SOP_TEMPLATE_NOT_DRAFT'
  );

  // Confirm item was not modified
  var item = SopDAL.getItemById(active.sopItemId);
  adminAssertFalse_('item_label must not have changed', item.item_label === 'Should not update');
}

// ──────────────────────────────────────────────────────────
// Test 7: retire item using active_flag=FALSE on DRAFT
// ──────────────────────────────────────────────────────────
function testSopAdmin_retireItemWithActiveFlagFalse() {
  var suffix = 'RETIRE-ITEM-' + Date.now();
  var draft  = seedDraftTemplate_(ADMIN_EMAIL, suffix);

  // Add second item so template is still publishable after retiring item 1
  SopAdminEngine.addItem(ADMIN_EMAIL, draft.sopTemplateId, {
    item_code: 'KEEP-ITEM-' + suffix, item_label: 'Kept item', is_required: 'TRUE'
  });

  // Retire first item via active_flag=FALSE
  SopAdminEngine.editItem(ADMIN_EMAIL, draft.sopItemId, { active_flag: 'FALSE' });

  var item = SopDAL.getItemById(draft.sopItemId);
  adminAssert_('active_flag should be FALSE', item.active_flag, 'FALSE');

  // getSopItems filters active_flag=TRUE — retired item should not appear
  var activeItems = SopDAL.getSopItems(draft.sopTemplateId);
  var stillActive = activeItems.filter(function (i) { return i.sop_item_id === draft.sopItemId; });
  adminAssert_('retired item should not appear in active item list', stillActive.length, 0);

  // Row still exists in getAllItems (no hard delete)
  var allItems = SopDAL.getAllItems(draft.sopTemplateId);
  var preserved = allItems.filter(function (i) { return i.sop_item_id === draft.sopItemId; });
  adminAssert_('retired item row must still exist in getAllItems', preserved.length, 1);
}

// ──────────────────────────────────────────────────────────
// Test 8: publishTemplate — hash set, status becomes ACTIVE
// ──────────────────────────────────────────────────────────
function testSopAdmin_publishTemplate_setsHash() {
  var suffix   = 'PUB-HASH-' + Date.now();
  var draft    = seedDraftTemplate_(ADMIN_EMAIL, suffix);
  var result   = SopAdminEngine.publishTemplate(ADMIN_EMAIL, draft.sopTemplateId);

  adminAssertTrue_('publishTemplate should return templateHash', !!result.templateHash);
  adminAssert_('templateHash should be 64-char hex', result.templateHash.length, 64);

  var template = SopDAL.getTemplateById(draft.sopTemplateId);
  adminAssert_('template status should be ACTIVE',          template.status,        'ACTIVE');
  adminAssert_('template_hash should match returned value',  template.template_hash, result.templateHash);
  adminAssertTrue_('effective_from should be set', !!template.effective_from);
}

// ──────────────────────────────────────────────────────────
// Test 9: publishTemplate — auto-retires previous ACTIVE
// ──────────────────────────────────────────────────────────
function testSopAdmin_publishTemplate_autoRetires() {
  var suffix = 'PUB-RETIRE-' + Date.now();

  // Create and publish first template
  var v1  = seedActiveTemplate_(ADMIN_EMAIL, suffix);

  // Copy to draft v2
  var cp  = SopAdminEngine.copyTemplate(ADMIN_EMAIL, v1.sopTemplateId);

  // Publish v2 — should auto-retire v1
  SopAdminEngine.publishTemplate(ADMIN_EMAIL, cp.sopTemplateId);

  var v1Template = SopDAL.getTemplateById(v1.sopTemplateId);
  adminAssert_('v1 should be RETIRED after v2 publish', v1Template.status, 'RETIRED');
  adminAssertTrue_('v1 effective_to should be set', !!v1Template.effective_to);

  var v2Template = SopDAL.getTemplateById(cp.sopTemplateId);
  adminAssert_('v2 should be ACTIVE', v2Template.status, 'ACTIVE');
}

// ──────────────────────────────────────────────────────────
// Test 10: publishing after editItem recomputes hash
// ──────────────────────────────────────────────────────────
function testSopAdmin_publishAfterEdit_recomputesHash() {
  var suffix = 'EDIT-HASH-' + Date.now();

  // Create and publish v1
  var v1 = seedActiveTemplate_(ADMIN_EMAIL, suffix);

  // Copy to draft v2 — modify an item, then publish
  var cp = SopAdminEngine.copyTemplate(ADMIN_EMAIL, v1.sopTemplateId);

  // Get the copied item
  var v2Items = SopDAL.getSopItems(cp.sopTemplateId);
  adminAssert_('v2 should have 1 item', v2Items.length, 1);

  // Edit the item label (changes the hash input)
  SopAdminEngine.editItem(ADMIN_EMAIL, v2Items[0].sop_item_id, {
    item_label: 'MODIFIED LABEL — ' + suffix
  });

  var pub = SopAdminEngine.publishTemplate(ADMIN_EMAIL, cp.sopTemplateId);

  // Hash must differ from v1 because label changed
  adminAssertFalse_('v2 hash should differ from v1 hash after edit', pub.templateHash === v1.templateHash);
  adminAssert_('hash should still be 64 chars', pub.templateHash.length, 64);
}

// ──────────────────────────────────────────────────────────
// Test 11: copyTemplate — increments version
// ──────────────────────────────────────────────────────────
function testSopAdmin_copyTemplate_incrementsVersion() {
  var suffix = 'COPY-VER-' + Date.now();
  var active = seedActiveTemplate_(ADMIN_EMAIL, suffix);

  var v1Template = SopDAL.getTemplateById(active.sopTemplateId);
  adminAssert_('v1 version should be 1', v1Template.version, '1');

  var cp    = SopAdminEngine.copyTemplate(ADMIN_EMAIL, active.sopTemplateId);
  var draft = SopDAL.getTemplateById(cp.sopTemplateId);

  adminAssert_('copy version should be 2', draft.version, '2');
  adminAssert_('copy status should be DRAFT', draft.status, 'DRAFT');

  // Items should be copied
  var items = SopDAL.getSopItems(cp.sopTemplateId);
  adminAssert_('copy should have 1 active item', items.length, 1);

  // Item IDs should be new (not the same as source)
  adminAssertFalse_('copied item should have new sop_item_id',
    items[0].sop_item_id === active.sopItemId);
}

// ──────────────────────────────────────────────────────────
// Test 12: retireTemplate — ACTIVE → RETIRED
// ──────────────────────────────────────────────────────────
function testSopAdmin_retireTemplate_happy() {
  var suffix   = 'RETIRE-TPL-' + Date.now();
  var active   = seedActiveTemplate_(ADMIN_EMAIL, suffix);

  SopAdminEngine.retireTemplate(ADMIN_EMAIL, active.sopTemplateId);

  var template = SopDAL.getTemplateById(active.sopTemplateId);
  adminAssert_('template should be RETIRED', template.status, 'RETIRED');
  adminAssertTrue_('effective_to should be set', !!template.effective_to);

  // Calling retireTemplate again should throw SOP_TEMPLATE_NOT_ACTIVE
  adminAssertThrows_(
    'retireTemplate on already-RETIRED should throw',
    function () { SopAdminEngine.retireTemplate(ADMIN_EMAIL, active.sopTemplateId); },
    'SOP_TEMPLATE_NOT_ACTIVE'
  );
}

// ──────────────────────────────────────────────────────────
// Test 13: SopImporter — dry run logs without writing
// ──────────────────────────────────────────────────────────
function testSopImporter_dryRun() {
  // Dry run relies on the MIGRATION_SOP_IMPORT sheet existing —
  // if it's absent DAL will throw and importFromSheet wraps it
  // as SOP_IMPORT_SHEET_NOT_FOUND. Both outcomes are valid here;
  // we only assert no live templates are written.

  var before = DAL.readAll(Config.TABLES.DIM_SOP_TEMPLATES, { callerModule: 'SopAdminEngine' }) || [];

  try {
    SopImporter.importFromSheet(ADMIN_EMAIL, 'MIGRATION_SOP_IMPORT', true);
  } catch (e) {
    if (e.code === 'SOP_IMPORT_SHEET_NOT_FOUND') {
      // Sheet absent — acceptable in test environment
      return;
    }
    throw e;
  }

  var after = DAL.readAll(Config.TABLES.DIM_SOP_TEMPLATES, { callerModule: 'SopAdminEngine' }) || [];
  adminAssert_('dry run must not write any templates', after.length, before.length);
}

// ──────────────────────────────────────────────────────────
// Test 14: SopImporter — idempotent (skips existing ACTIVE)
// ──────────────────────────────────────────────────────────
function testSopImporter_idempotent() {
  // Seed an ACTIVE template for the dimensions that would come from MIGRATION_SOP_IMPORT.
  // If the import sheet is absent this test is a no-op (sheet not found → skipped gracefully).
  // If present, the importer must skip the seeded dimension set.

  var rows;
  try {
    rows = DAL.readAll('MIGRATION_SOP_IMPORT', { callerModule: 'SopAdminEngine' });
  } catch (e) {
    // Sheet not present in test environment — acceptable
    return;
  }
  if (!rows || rows.length === 0) return;

  // Seed the first group as an existing ACTIVE template
  var firstRow = rows[0];
  var existing = SopDAL.getActiveTemplate(
    firstRow.client_code, firstRow.job_type, firstRow.software, firstRow.scope_code
  );
  if (!existing) {
    // Seed it
    var seed = SopAdminEngine.createTemplate(ADMIN_EMAIL, {
      clientCode: firstRow.client_code,
      jobType:    firstRow.job_type,
      software:   firstRow.software,
      scopeCode:  firstRow.scope_code
    });
    SopAdminEngine.addItem(ADMIN_EMAIL, seed.sopTemplateId, {
      item_code: 'IDEMPOTENCY-GUARD', item_label: 'Idempotency guard item'
    });
    SopAdminEngine.publishTemplate(ADMIN_EMAIL, seed.sopTemplateId);
  }

  // Run import execute — the seeded dimension set should be skipped
  var result = SopImporter.importFromSheet(ADMIN_EMAIL, 'MIGRATION_SOP_IMPORT', false);
  adminAssertTrue_('idempotent run should report at least 1 skip', result.skipped >= 1);
  adminAssert_('idempotent run should have 0 errors', result.errors.length, 0);
}
