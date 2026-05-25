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
