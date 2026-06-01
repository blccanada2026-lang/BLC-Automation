// ============================================================
// MigrationRunner.gs — BLC Nexus T12 Migration
// src/12-migration/MigrationRunner.gs
//
// Top-level runner functions for the Stacey → Nexus migration.
// Run these from the Apps Script editor in order:
//
//   STEP 1: runMigrationEnableOverrides()
//   STEP 2: runMigrationImportAll()      ← pulls new rows from Stacey
//   STEP 3: runMigrationNormalizeAll()   ← normalizes raw → structured
//   STEP 4: runMigrationReplayAll()      ← writes to FACT tables
//   STEP 5: runMigrationDisableOverrides()  ← CRITICAL: must run after
//   STEP 6: runMigrationVerify()         ← post-run system tests
//
// All steps are idempotent — already-processed rows are skipped.
// Re-running any step is safe.
//
// BILLING GUARD: migrated rows have migration_batch set.
// BillingEngine filters WHERE migration_batch IS NULL before
// any billing calculation — no double-billing risk.
// ============================================================

var MIGRATION_RUNNER_EMAIL_ = 'blccanada2026@gmail.com';

// norm_ids of rows intentionally ignored (test data + zero-hour entries).
// These are INVALID rows that will never be replayed — marking them IGNORED
// keeps the MIGRATION_NORMALIZED sheet clean and explicit.
var IGNORED_NORM_IDS_ = [
  // ── TEST data (fake staff, test jobs, form placeholders) ──────
  '18eb919d-1d0f-4454-bc1b-0f8a27050924', // STAFF ROW-21 (blank row)
  '465c286d-72f3-4ea3-834a-903f374f1ea4', // STAFF ROW-22 (blank row)
  'fa224805-8e54-42da-b525-73345ea5e64e', // JOB TEST-004
  '9d34055d-adb7-4c9d-b36e-45871aab31f2', // JOB TEST-005
  '328bb308-d19b-41ba-8b3b-e351521f8a67', // JOB TEST-ALLOC-002
  'a62eebf4-cd4c-4bbb-8528-44eb844d7999', // WORK_LOG TEST DESIGNER2 ROW-2
  'f7a12c3c-3d0a-4ab0-9acd-0f2fa0d44167', // WORK_LOG TEST DESIGNER2 ROW-3
  '1cb1c3b4-52f1-4212-ab81-f368a140ac1e', // WORK_LOG TEST DESIGNER2 ROW-4
  'da712686-c6b4-4b95-8229-0d3f4f1a3804', // WORK_LOG Test Designer ROW-5
  '3822e77c-81fa-4e8a-8a9b-952a9ae1026b', // WORK_LOG Test Designer ROW-6
  'aca401f2-68d0-4066-b31f-1dd9804fd967', // WORK_LOG TEST DESIGNER2 ROW-7
  'f6f43954-05b8-4e52-88ee-c17e4a957c87', // WORK_LOG TEST DESIGNER2 ROW-8
  '9ad6466e-f40e-4a9a-bf05-c225ccc5869f', // WORK_LOG Test Designer ROW-9
  'bb5dafb1-68b8-4ff0-a8f0-9570e18830ba', // WORK_LOG Test Designer ROW-10 (hours="abc")
  '8a7b8235-e518-4657-9c28-3aea727987f1', // QC "Option 1" TEST-001 ROW-2
  '79cf5d95-0d87-4fd9-949b-6d617d9758ff', // QC "Option 1" TEST-002 ROW-3
  'f50537e3-7111-442c-a04c-f26c594ed2a2', // QC "Option 1" TEST-002 ROW-4
  '16947c63-e940-44d3-9d9a-cc14fcfdb03f', // QC "Option 1" TEST-003 ROW-5
  'd3dab549-0f04-41b6-8e40-a9e018845305', // QC "Option 1" TEST-003 ROW-6
  // ── TEST data — post-wipe re-normalization (new UUIDs) ───────
  'c3b01185-2647-44d9-b9dd-108eddc17305', // STAFF blank row (re-norm)
  '0ecc0297-c3a4-40b1-964a-fc2fce307403', // STAFF blank row (re-norm)
  '40df3340-c4cf-41d6-aeee-081cc3c91e8e', // WORK_LOG TEST DESIGNER2 TEST-001
  'b4678d2f-4717-49d0-878b-acb123195e81', // WORK_LOG TEST DESIGNER2 TEST-001
  'bed6914f-198e-40d8-9c72-7c75cdb6cc46', // WORK_LOG TEST DESIGNER2 TEST-001
  '5c347abf-a74b-4c70-8c59-9effafffe2ea', // WORK_LOG Test Designer TEST-002
  '7561eea2-5c8e-4f8d-a0c9-864271a04c62', // WORK_LOG Test Designer TEST-002
  'f973bbab-ddf4-4785-a89e-42a39c0834ce', // WORK_LOG TEST DESIGNER2 TEST-003
  '8b2a752e-88f9-4d9e-b6c9-5f3c53622ea8', // WORK_LOG TEST DESIGNER2 TEST-003
  '3439ac0e-6b52-40cb-a352-cf633d59cfda', // WORK_LOG Test Designer TEST-004
  '52f110f5-2f58-4ad6-9369-a507c3acff27', // WORK_LOG Test Designer TEST-005 (hours="abc")
  'e440e744-3200-4aef-bd3d-ce8e6104b3d1', // QC "Option 1" TEST-001
  '6955f079-511f-47af-aacc-df2e1375cc54', // QC "Option 1" TEST-002
  '1d42fdf3-c8ac-4cff-b907-be15cfa7f99c', // QC "Option 1" TEST-002
  'dcd74be0-d94b-4099-bdd1-63f232d45732', // QC "Option 1" TEST-003
  'a7a8a3aa-d8c2-4bb9-a254-b445bd7497f7', // QC "Option 1" TEST-003
  // ── Zero-hour designer work logs ─────────────────────────────
  '55f3c945-6b95-4bdd-bf6d-785ef477a09a', // ABB 2602-2065-B 0hrs
  '07a570ab-ab8f-4a34-89f9-2f04dbc8d22e', // ABB 2602-2065-E 0hrs
  '94c0bf9c-44da-42fa-bf82-d56dd65a9859', // RKG Q260156 0hrs
  '56a7f654-b07b-440c-a837-8afbda2fde73', // RKG Q260156 0hrs (dup)
  '218f3cfe-2fc7-49a2-97bd-5a1188043937', // RKU 2603-3222-A 0hrs
  '47b10413-7072-4f7d-a840-c690fabf133b', // ABB 2603-4048-A 0hrs
  // ── Zero-hour QC logs (SVN spot-checks, BCH) ─────────────────
  'b145c6a4-193d-4931-8336-50c2ccc17f07', // SVN QC 2603-2478-C 0hrs
  'f06c8f46-055b-40e8-850d-aaa98d2dda65', // SVN QC 2603-2479-C 0hrs
  '16039958-b4d2-4288-a00f-b87534252c8c', // SVN QC 2603-2477-A 0hrs
  'd9a1d113-57b0-4707-bdea-98459c53ca15', // SVN QC 2603-2478-A 0hrs
  '3d2bc997-603c-4fc4-9cef-34a0f8cd40f8', // SVN QC 2603-2479-A 0hrs
  '1e39d738-4309-4638-9937-3d7547bc7e56', // SVN QC 2603-2477-B 0hrs
  '2257e8ff-bd9b-4e3a-9ce0-a1b51a612c2d', // SVN QC 2603-2478-B 0hrs
  '137bdfb2-fa08-4496-b534-a94959b0e444', // SVN QC 2603-2479-B 0hrs
  '6049cd25-2023-4900-9081-c096f7bb8769', // BCH QC 2602-1916-M 0hrs
  '30dd6d33-4d32-4c42-9768-823d5bece4e5'  // BCH QC Q24403A 0hrs
];

// ── STEP 1 ────────────────────────────────────────────────────
/**
 * Enables backdating + relaxed idempotency for migration period.
 * Must be called BEFORE importAll/normalizeAll/replayAll.
 * CRITICAL: call runMigrationDisableOverrides() after completing all steps.
 */
function runMigrationEnableOverrides() {
  MigrationConfig.enableOverrides();
  console.log('═══════════════════════════════════════════');
  console.log('[MigrationRunner] Overrides ENABLED');
  console.log('  ✅ ALLOW_BACKDATE_PERIOD  = true');
  console.log('  ✅ ALLOW_MIGR_IDEMPOTENCY = true');
  console.log('  ⚠️  Run runMigrationDisableOverrides() when done!');
  console.log('═══════════════════════════════════════════');
}

// ── STEP 2 ────────────────────────────────────────────────────
/**
 * Pulls all Stacey tabs into MIGRATION_RAW_IMPORT.
 * Idempotent — already-imported rows (by batch+tab+row_index) are skipped.
 * New rows added to Stacey since last run will be imported.
 */
function runMigrationImportAll() {
  console.log('═══════════════════════════════════════════');
  console.log('[MigrationRunner] STEP 2: importAll');
  console.log('  Batch: ' + MigrationConfig.getBatch());
  console.log('═══════════════════════════════════════════');
  try {
    var result = MigrationRawImporter.importAll(MIGRATION_RUNNER_EMAIL_);
    console.log('[MigrationRunner] importAll complete:');
    (result.results || []).forEach(function (r) {
      if (r.error) {
        console.log('  ❌ ' + r.tab + ': ERROR — ' + r.error);
      } else {
        var res = r.result || {};
        console.log('  ' + r.tab + ': imported=' + (res.imported || 0)
          + ' skipped=' + (res.skipped || 0)
          + (res.partial ? ' (PARTIAL — re-run needed)' : ' ✅'));
      }
    });
    if (result.anyPartial) {
      console.log('  ⚠️  Partial run — re-run runMigrationImportAll() to continue.');
    } else {
      console.log('  ✅ All tabs imported. Proceed to STEP 3.');
    }
  } catch (e) {
    console.log('  ❌ importAll failed: ' + e.message);
  }
  console.log('═══════════════════════════════════════════');
}

// ── STEP 3 ────────────────────────────────────────────────────
/**
 * Normalizes raw import rows into structured MIGRATION_NORMALIZED records.
 * Idempotent — already-normalized rows are skipped.
 */
function runMigrationNormalizeAll() {
  console.log('═══════════════════════════════════════════');
  console.log('[MigrationRunner] STEP 3: normalizeAll');
  console.log('  Batch: ' + MigrationConfig.getBatch());
  console.log('═══════════════════════════════════════════');
  try {
    var result = MigrationNormalizer.normalizeAll(MIGRATION_RUNNER_EMAIL_, MigrationConfig.getBatch());
    console.log('[MigrationRunner] normalizeAll complete:');
    console.log('  normalized=' + (result.normalized || 0));
    console.log('  skipped='    + (result.skipped || 0));
    console.log('  invalid='    + (result.invalid || 0));
    if (result.invalid > 0) {
      console.log('  ⚠️  ' + result.invalid + ' invalid rows — check MIGRATION_NORMALIZED for validation_notes.');
    } else {
      console.log('  ✅ All rows valid. Proceed to STEP 4.');
    }
  } catch (e) {
    console.log('  ❌ normalizeAll failed: ' + e.message);
  }
  console.log('═══════════════════════════════════════════');
}

/**
 * Re-normalizes only INVALID rows (retry after fixing STAFF_MAP / column aliases).
 * Safe to run multiple times — already-VALID rows are not touched.
 */
function runReNormalizeInvalid() {
  console.log('═══════════════════════════════════════════');
  console.log('[MigrationRunner] reNormalizeInvalid');
  console.log('  Batch: ' + MigrationConfig.getBatch());
  console.log('═══════════════════════════════════════════');
  try {
    var result = MigrationNormalizer.reNormalizeInvalid(MIGRATION_RUNNER_EMAIL_);
    console.log('[MigrationRunner] reNormalizeInvalid complete:');
    console.log('  fixed='       + result.fixed);
    console.log('  stillInvalid=' + result.stillInvalid);
    if (result.stillInvalid > 0) {
      console.log('  ⚠️  ' + result.stillInvalid + ' rows still invalid — check MIGRATION_NORMALIZED for validation_notes.');
    } else {
      console.log('  ✅ All previously-invalid rows fixed. Proceed to STEP 4.');
    }
  } catch (e) {
    console.log('  ❌ reNormalizeInvalid failed: ' + e.message);
  }
  console.log('═══════════════════════════════════════════');
}

// ── STEP 4 ────────────────────────────────────────────────────
/**
 * Replays normalized rows into FACT_JOB_EVENTS, FACT_WORK_LOGS, etc.
 * Idempotent — already-replayed rows are skipped via IdempotencyEngine.
 */
function runMigrationReplayAll() {
  console.log('═══════════════════════════════════════════');
  console.log('[MigrationRunner] STEP 4: replayAll');
  console.log('  Batch: ' + MigrationConfig.getBatch());
  console.log('═══════════════════════════════════════════');
  try {
    var result = MigrationReplayEngine.replayAll(MIGRATION_RUNNER_EMAIL_, MigrationConfig.getBatch());
    console.log('[MigrationRunner] replayAll complete:');
    console.log('  replayed=' + (result.replayed || 0));
    console.log('  skipped='  + (result.skipped  || 0));
    console.log('  failed='   + (result.failed   || 0));
    if (result.failed > 0) {
      console.log('  ❌ ' + result.failed + ' rows failed — check Logger for REPLAY_HANDLER_FAILED events.');
    }
    if (result.partial) {
      console.log('  ⚠️  Partial run — re-run runMigrationReplayAll() to continue.');
    } else {
      console.log('  ✅ Replay complete. Run STEP 5 (disable overrides).');
    }
  } catch (e) {
    console.log('  ❌ replayAll failed: ' + e.message);
  }
  console.log('═══════════════════════════════════════════');
}

// ── STEP 5 ────────────────────────────────────────────────────
/**
 * Disables backdating + relaxed idempotency.
 * CRITICAL: always call this after completing migration steps.
 * Leaving overrides ON allows backdated records in production.
 */
function runMigrationDisableOverrides() {
  MigrationConfig.disableOverrides();
  console.log('═══════════════════════════════════════════');
  console.log('[MigrationRunner] Overrides DISABLED');
  console.log('  ✅ ALLOW_BACKDATE_PERIOD  = false');
  console.log('  ✅ ALLOW_MIGR_IDEMPOTENCY = false');
  console.log('  System is back in production mode.');
  console.log('═══════════════════════════════════════════');
}

// ── STEP 6 ────────────────────────────────────────────────────
/**
 * Runs post-migration system tests.
 * Must pass before declaring migration complete.
 */
function runMigrationVerify() {
  console.log('═══════════════════════════════════════════');
  console.log('[MigrationRunner] STEP 6: post-migration verification');
  console.log('═══════════════════════════════════════════');
  try {
    var result = MigrationTestRunner.runAll(MIGRATION_RUNNER_EMAIL_);
    console.log('[MigrationRunner] Verification ' + (result.passed ? '✅ PASSED' : '❌ FAILED'));
    (result.results || []).forEach(function (r) {
      console.log('  ' + (r.passed ? '✅' : '❌') + ' ' + r.test + ': ' + r.message);
    });
    if (!result.passed) {
      console.log('  ⚠️  Fix failures before running billing or payroll.');
    }
  } catch (e) {
    console.log('  ❌ Verification failed: ' + e.message);
  }
  console.log('═══════════════════════════════════════════');
}

// ── MARK IGNORED ──────────────────────────────────────────────
/**
 * Marks known-bad rows (test data + zero-hour entries) as IGNORED
 * in MIGRATION_NORMALIZED so they are excluded from future replays
 * and reconciliation reports.
 */
function runMarkIgnoredRows() {
  console.log('═══════════════════════════════════════════');
  console.log('[MigrationRunner] Marking ' + IGNORED_NORM_IDS_.length + ' rows as IGNORED…');
  console.log('═══════════════════════════════════════════');

  var marked = 0;
  var failed = 0;

  IGNORED_NORM_IDS_.forEach(function (normId) {
    try {
      DAL.updateWhere(
        MigrationConfig.TABLES.NORMALIZED,
        { norm_id: normId },
        { replay_status: 'IGNORED', replay_error: 'Intentionally ignored: test data or zero-hour entry' },
        { callerModule: 'MigrationReconciler' }
      );
      marked++;
    } catch (e) {
      console.log('  ⚠️  Could not mark ' + normId.substring(0, 8) + '… : ' + e.message);
      failed++;
    }
  });

  console.log('  ✅ Marked IGNORED: ' + marked);
  if (failed > 0) console.log('  ⚠️  Failed: ' + failed);
  console.log('═══════════════════════════════════════════');
}

// ── CONVENIENCE: run full pipeline ────────────────────────────
/**
 * Runs all 4 data steps in sequence (import → normalize → replay → verify).
 * Overrides must already be enabled via runMigrationEnableOverrides().
 * Call runMigrationDisableOverrides() manually after this completes.
 */
function runMigrationFullPipeline() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║  BLC Nexus — Full Migration Pipeline       ║');
  console.log('╚═══════════════════════════════════════════╝');
  runMigrationImportAll();
  runMigrationNormalizeAll();
  runMigrationReplayAll();
  runMigrationVerify();
  console.log('');
  console.log('⚠️  IMPORTANT: Run runMigrationDisableOverrides() now!');
}

/**
 * Inspects the raw Stacey import rows for the 14 jobs that failed
 * normalisation with "period_id is required". Logs the full raw_json
 * for each so we can find any unmapped date columns in the source.
 */
function runInspectInvalidJobs() {
  var INVALID_JOB_NUMBERS = [
    'B500592', 'P-157', 'P-169', 'B600147', 'B600158',
    '261508',  '262008',
    '2690-3898-B',
    '260522',
    'Q260254', 'Q260288', 'Q260332',
    '160958',  '160948'
  ];

  var rows;
  try {
    rows = DAL.readAll('MIGRATION_RAW_IMPORT', { callerModule: 'MigrationRunner' });
  } catch (e) {
    console.log('ERROR reading MIGRATION_RAW_IMPORT: ' + e.message);
    return;
  }

  var found = 0;
  (rows || []).forEach(function(r) {
    var raw;
    try { raw = JSON.parse(r.raw_json || '{}'); } catch(e) { raw = {}; }
    var jn = String(raw.Job_Number || raw.job_number || raw.JobNumber || '').trim();
    if (INVALID_JOB_NUMBERS.indexOf(jn) === -1) return;
    found++;
    console.log('JOB: ' + jn + ' | import_key: ' + r.import_key);
    console.log('  raw_json: ' + r.raw_json);
  });

  console.log('');
  console.log('Found ' + found + ' of ' + INVALID_JOB_NUMBERS.length + ' invalid jobs in raw import.');
  if (found < INVALID_JOB_NUMBERS.length) {
    console.log('Missing ' + (INVALID_JOB_NUMBERS.length - found) + ' — those jobs may have no date at all in Stacey.');
  }
}

/** Lists every person_code + name in DIM_STAFF_ROSTER. Run to confirm codes for timesheet import. */
function runListStaffCodes() {
  var rows;
  try { rows = DAL.readAll('DIM_STAFF_ROSTER', { callerModule: 'MigrationRunner' }); }
  catch (e) { console.log('ERROR: ' + e.message); return; }
  console.log('DIM_STAFF_ROSTER — ' + (rows || []).length + ' rows:');
  (rows || []).forEach(function(r) {
    console.log('  ' + r.person_code + '  |  ' + (r.name || '') + '  |  active=' + r.active);
  });
}

/**
 * Logs the entity_type, validation_notes, and normalized_json for every
 * INVALID row in MIGRATION_NORMALIZED so we can diagnose remaining failures.
 */
function runInspectStillInvalid() {
  var rows;
  try {
    rows = DAL.readAll('MIGRATION_NORMALIZED', { callerModule: 'MigrationRunner' });
  } catch (e) {
    console.log('ERROR reading MIGRATION_NORMALIZED: ' + e.message);
    return;
  }

  var batch   = MigrationConfig.getBatch();
  var invalid = (rows || []).filter(function(r) {
    return r.migration_batch === batch &&
           r.validation_status === 'INVALID' &&
           r.replay_status !== 'IGNORED';
  });

  console.log('Still-invalid rows in MIGRATION_NORMALIZED: ' + invalid.length);
  invalid.forEach(function(r) {
    console.log('─────────────────────────────────────────');
    console.log('  norm_id:   ' + r.norm_id);
    console.log('  entity:    ' + r.entity_type);
    console.log('  errors:    ' + r.validation_notes);
    console.log('  payload:   ' + r.normalized_json);
  });
}

/** Count entity types in MIGRATION_NORMALIZED for BATCH-001 to see what was migrated. */
function runCountBatch001Entities() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('MIGRATION_NORMALIZED');
  if (!sheet) { console.log('ERROR: MIGRATION_NORMALIZED not found'); return; }
  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  var batchCol  = headers.indexOf('migration_batch');
  var entityCol = headers.indexOf('entity_type');
  var statusCol = headers.indexOf('validation_status');
  var replayCol = headers.indexOf('replay_status');
  var counts = {};
  for (var i = 1; i < data.length; i++) {
    if (data[i][batchCol] !== 'BATCH-001') continue;
    var key = (data[i][entityCol] || 'UNKNOWN') + '|valid=' + data[i][statusCol] + '|replay=' + data[i][replayCol];
    counts[key] = (counts[key] || 0) + 1;
  }
  Object.keys(counts).sort().forEach(function(k) { console.log(k + ' → ' + counts[k]); });
}

/** Inspect first 5 rows of FACT_WORK_LOGS|2026-01 to verify field names and values. */
function runInspectWorkLogs2601() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('FACT_WORK_LOGS|2026-01');
  if (!sheet) { console.log('Sheet FACT_WORK_LOGS|2026-01 not found'); return; }
  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  console.log('Headers: ' + JSON.stringify(headers));
  console.log('Total rows (incl header): ' + data.length);
  for (var i = 1; i <= Math.min(3, data.length - 1); i++) {
    var row = {};
    headers.forEach(function(h, idx) { row[h] = data[i][idx]; });
    console.log('Row ' + i + ': ' + JSON.stringify(row));
  }
}

/**
 * Resets replay_status from REPLAYED → null for all BATCH-001 rows in
 * MIGRATION_NORMALIZED. Use when FACT tables were wiped after a replay run.
 */
function runResetBatch001ReplayStatus() {
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var sheet   = ss.getSheetByName('MIGRATION_NORMALIZED');
  if (!sheet) { console.log('ERROR: MIGRATION_NORMALIZED not found'); return; }

  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  var batchCol  = headers.indexOf('migration_batch');
  var statusCol = headers.indexOf('replay_status');

  if (batchCol < 0 || statusCol < 0) {
    console.log('ERROR: required columns not found. batch=' + batchCol + ' status=' + statusCol);
    return;
  }

  var reset = 0;
  for (var i = 1; i < data.length; i++) {
    if (data[i][batchCol] === 'BATCH-001' && data[i][statusCol] === 'REPLAYED') {
      sheet.getRange(i + 1, statusCol + 1).setValue('');
      reset++;
    }
  }
  console.log('Reset ' + reset + ' BATCH-001 rows to blank replay_status. Re-run runMigrationReplayAll.');
}

/** Resets replay_status only for BATCH-001 WORK_LOG rows so they re-replay with the actor_code fix.
 *  Leaves STAFF, CLIENT, JOB, BILLING rows as REPLAYED — they won't re-run. */
function runResetBatch001WorkLogReplayStatus() {
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var sheet   = ss.getSheetByName('MIGRATION_NORMALIZED');
  if (!sheet) { console.log('ERROR: MIGRATION_NORMALIZED not found'); return; }

  var data       = sheet.getDataRange().getValues();
  var headers    = data[0];
  var batchCol   = headers.indexOf('migration_batch');
  var statusCol  = headers.indexOf('replay_status');
  var typeCol    = headers.indexOf('entity_type');

  if (batchCol < 0 || statusCol < 0 || typeCol < 0) {
    console.log('ERROR: columns not found. batch=' + batchCol + ' status=' + statusCol + ' type=' + typeCol);
    return;
  }

  var reset = 0;
  for (var i = 1; i < data.length; i++) {
    if (data[i][batchCol] === 'BATCH-001' &&
        data[i][typeCol]  === 'WORK_LOG'  &&
        data[i][statusCol] === 'REPLAYED') {
      sheet.getRange(i + 1, statusCol + 1).setValue('');
      reset++;
    }
  }
  console.log('Reset ' + reset + ' BATCH-001 WORK_LOG rows. Now run runMigrationReplayAll().');
}

/**
 * ONE-TIME BACKFILL — sets active='TRUE' and effective_from='2024-01-01' on
 * DIM_STAFF_ROSTER rows seeded by migration replay (which didn't write these fields).
 * Safe to re-run — skips rows that already have active='TRUE'.
 */
function runBackfillStaffActive() {
  console.log('═══════════════════════════════════════════');
  console.log('[MigrationRunner] runBackfillStaffActive');
  console.log('═══════════════════════════════════════════');
  var rows;
  try {
    rows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'MigrationReplayEngine' });
  } catch (e) {
    console.log('  ❌ Could not read DIM_STAFF_ROSTER: ' + e.message);
    return;
  }
  var fixed = 0, skipped = 0;
  for (var i = 0; i < rows.length; i++) {
    var row  = rows[i];
    var code = String(row.person_code || '').trim();
    if (!code) continue;
    if (String(row.active || '').toUpperCase() === 'TRUE') { skipped++; continue; }
    var updates = { active: 'TRUE' };
    if (!row.effective_from && !row.start_date) updates.effective_from = '2024-01-01';
    DAL.updateWhere(Config.TABLES.DIM_STAFF_ROSTER,
      { person_code: code }, updates,
      { callerModule: 'MigrationReplayEngine' });
    fixed++;
    console.log('  fixed: ' + code);
  }
  console.log('─────────────────────────────────────────');
  console.log('  fixed=' + fixed + '  already-active=' + skipped);
  console.log('  ✅ Done. Re-run runPreviewQ1Bonus() to verify.');
  console.log('═══════════════════════════════════════════');
}

/**
 * Clears all BATCH-001 migration idempotency keys from Script Properties
 * so the replay can be re-run in PROD after being run in DEV.
 * Safe to run — only deletes keys prefixed with IDEM_MIGR- for BATCH-001.
 */
function runClearBatch001IdempotencyKeys() {
  var props = PropertiesService.getScriptProperties();
  var all   = props.getKeys();
  var cleared = 0;
  all.forEach(function(k) {
    if (k.indexOf('IDEM_MIGR-') === 0 && k.indexOf('BATCH-001') !== -1) {
      props.deleteProperty(k);
      cleared++;
    }
  });
  console.log('Cleared ' + cleared + ' BATCH-001 idempotency keys. Re-run runMigrationReplayAll.');
}

/** Clears only BATCH-001 work log idempotency keys (MIGR-WL-*) so they can be re-replayed
 *  with the actor_code fix — leaves STAFF, CLIENT, JOB, BILLING keys untouched. */
function runClearBatch001WorkLogKeys() {
  var props = PropertiesService.getScriptProperties();
  var all   = props.getKeys();
  var cleared = 0;
  all.forEach(function(k) {
    if (k.indexOf('IDEM_MIGR-WL-') === 0 && k.indexOf('BATCH-001') !== -1) {
      props.deleteProperty(k);
      cleared++;
    }
  });
  console.log('Cleared ' + cleared + ' BATCH-001 work log keys. Enable overrides then run runMigrationReplayAll().');
}

/**
 * Cleans DIM_STAFF_ROSTER in a single pass:
 *   1. Deduplicates rows by person_code — keeps the most-complete row per code.
 *   2. Sets active=FALSE for staff whose effective_to is in the past.
 *   3. Sets active=TRUE for staff with blank or future effective_to.
 *
 * Rewrites the sheet via clearSheet + appendRows through the DAL.
 * Safe to re-run — idempotent.
 */
function runCleanStaffRoster() {
  console.log('═══════════════════════════════════════════');
  console.log('[MigrationRunner] runCleanStaffRoster');
  console.log('═══════════════════════════════════════════');

  var CALLER = 'MigrationReplayEngine';
  var today  = new Date();
  today.setHours(0, 0, 0, 0);

  function parseDate_(val) {
    if (!val) return null;
    if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
    var d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }

  function countFilled_(obj) {
    return Object.keys(obj).filter(function(k) {
      var v = obj[k];
      return v !== null && v !== undefined && String(v).trim() !== '';
    }).length;
  }

  var rows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: CALLER });
  console.log('  Rows read: ' + rows.length);

  // ── Step 1: Deduplicate ─────────────────────────────────────
  // Keep the most-complete row per person_code. Blank person_code rows dropped.
  var bestByCode   = {};
  var bestCount    = {};
  var codeOrder    = [];  // stable insertion order

  rows.forEach(function(r) {
    var code = String(r.person_code || '').trim();
    if (!code) return;
    var filled = countFilled_(r);
    if (!bestByCode[code]) {
      bestByCode[code] = r;
      bestCount[code]  = filled;
      codeOrder.push(code);
    } else if (filled > bestCount[code]) {
      bestByCode[code] = r;
      bestCount[code]  = filled;
    }
  });

  var dupesRemoved = rows.length - codeOrder.length;
  console.log('  Unique staff: ' + codeOrder.length + ' | Duplicates removed: ' + dupesRemoved);

  // ── Step 2: Fix active status ───────────────────────────────
  var madeActive = 0, madeInactive = 0;
  var cleaned = codeOrder.map(function(code) {
    var r      = bestByCode[code];
    var effTo  = parseDate_(r.effective_to);
    var isActive;
    if (!effTo) {
      isActive = true;   // no leave date → still employed
    } else {
      isActive = effTo >= today;   // future leave date → still active
    }
    var wasActive = String(r.active || '').toUpperCase() === 'TRUE';
    if (isActive && !wasActive) {
      madeActive++;
      return Object.assign({}, r, { active: 'TRUE' });
    }
    if (!isActive && wasActive) {
      madeInactive++;
      console.log('  Deactivating ' + code + ' (effective_to=' + r.effective_to + ')');
      return Object.assign({}, r, { active: 'FALSE' });
    }
    return r;
  });

  console.log('  Active fixes: ' + madeActive + ' activated, ' + madeInactive + ' deactivated');

  // ── Step 3: Rewrite sheet ───────────────────────────────────
  console.log('  Clearing DIM_STAFF_ROSTER...');
  DAL.clearSheet(Config.TABLES.DIM_STAFF_ROSTER);

  console.log('  Writing ' + cleaned.length + ' rows...');
  DAL.appendRows(Config.TABLES.DIM_STAFF_ROSTER, cleaned, { callerModule: CALLER });

  console.log('─────────────────────────────────────────');
  console.log('  ✅ Done.');
  console.log('     Before: ' + rows.length + ' rows  →  After: ' + cleaned.length + ' rows');
  console.log('     Dupes removed: ' + dupesRemoved);
  console.log('     Deactivated:   ' + madeInactive);
  console.log('     Activated:     ' + madeActive);
  console.log('═══════════════════════════════════════════');
}
