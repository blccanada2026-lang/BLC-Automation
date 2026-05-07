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
