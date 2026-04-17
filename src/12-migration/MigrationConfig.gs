// ============================================================
// MigrationConfig.gs — BLC Nexus T12 Migration
// src/12-migration/MigrationConfig.gs
//
// Central configuration for the Stacey → Nexus migration.
// All batch IDs, spreadsheet IDs, and override flags live here.
//
// READINESS AUDIT — 2026-04-16
// | Area                  | Ready? | Risk   | Fix Before Migration         |
// |-----------------------|--------|--------|------------------------------|
// | FACT tables           | ✅     | Low    | None                         |
// | DIM tables            | ✅     | Low    | None                         |
// | Migration tables      | ✅     | High   | All 3 registered in Config   |
// | RBAC model            | ✅     | Low    | None                         |
// | Audit logging         | ✅     | Low    | None                         |
// | Rollback mechanism    | ✅     | Medium | PurgeTool.runPurge ready     |
// | Stacey read access    | ✅     | High   | ID set: 1EIuLg4dJj...           |
// | DEV/PROD isolation    | ✅     | Low    | Run in DEV first             |
// | Override flags        | ✅     | High   | Keep false until migration   |
//
// ── RISK REGISTER (Phase I) ──────────────────────────────────
// R01 | HIGH   | Billing inflation: migrated FACT rows could enter live billing
//     |        | runs if billing engine does not filter migration_batch.
//     |        | FIX: BillingEngine MUST add WHERE migration_batch IS NULL
//     |        | filter before any billing calculation. Verify before cutover.
//
// R02 | CLOSED | Stacey ID set: 1EIuLg4dJjePPOSinMcGZocKGpe2wnjXI2pEFflD_f9U
//
// R03 | HIGH   | Override flags left ON: ALLOW_BACKDATE_PERIOD and
//     |        | ALLOW_MIGR_IDEMPOTENCY must be reset to false after migration.
//     |        | Leaving them ON allows backdated records in production.
//
// R04 | MEDIUM | Partial quota cutoff: all importers/replayers support partial
//     |        | runs via migration_batch idempotency. Re-run is safe.
//
// R05 | MEDIUM | Column name mismatches: Stacey tab headers may not match the
//     |        | alias maps in MigrationNormalizer. Run StaceyAuditor.sampleTab()
//     |        | per tab and update STAFF_MAP, CLIENT_MAP etc. before Phase D.
//
// R06 | MEDIUM | DIM_STAFF_ROSTER duplicates: if person_codes already exist in
//     |        | Nexus, IdempotencyEngine will skip the write — verify counts.
//
// R07 | LOW    | Stacey has no payroll history: PAYROLL tab may be missing.
//     |        | StaceyAuditor.listTabs() will detect. MigrationNormalizer
//     |        | skips REPLACE_AFTER_AUDIT tabs safely.
//
// R08 | LOW    | Hours rounding: Stacey may store hours as strings (e.g. "8.5h").
//     |        | MigrationNormalizer uses Number() coercion — review raw_json
//     |        | samples from MIGRATION_RAW_IMPORT before replay.
//
// ── CUTOVER ROADMAP (Phase J) ─────────────────────────────────
// T-7 days : Run StaceyAuditor.runAudit() — map all tab names into STACEY_TABLES
// T-7 days : Update MigrationNormalizer column alias maps after tab inspection
// T-5 days : Run PurgeTool.runAudit() in DEV — confirm Nexus is clean
// T-3 days : Full dry run in DEV: importAll → normalizeAll → replayAll
// T-3 days : Run testReconciliation() and testMigrationSystemTest() — must PASS
// T-1 day  : CEO reviews reconciliation report; signs off on go-ahead
// T-0      : Set STACEY_SPREADSHEET_ID, run importAll → normalizeAll → replayAll in PROD
// T-0      : Run testReconciliation() in PROD — all checks must pass before go-live
// T-0      : Call MigrationConfig.disableOverrides() immediately after replay
// T+1 day  : Spot-check 10 random jobs in portal against Stacey source
// T+1 week : Monitor BillingEngine runs — confirm no migrated rows included
// T+1 mth  : Archive MIGRATION_RAW_IMPORT and MIGRATION_NORMALIZED (read-only)
//
// !! BILLING INFLATION GUARD !!
// Before any live billing run post-migration, confirm BillingEngine filters:
//   WHERE migration_batch IS NULL OR migration_batch = ''
// This prevents historical Stacey billing rows from being double-billed.
// ============================================================

var MigrationConfig = (function () {

  // ── Stacey (legacy) spreadsheet ───────────────────────────
  // Read-only. Never write to Stacey.
  // CEO must provide this ID before migration begins.
  var STACEY_SPREADSHEET_ID = '1EIuLg4dJjePPOSinMcGZocKGpe2wnjXI2pEFflD_f9U';

  // ── Migration batch tracking ──────────────────────────────
  var CURRENT_BATCH        = 'BATCH-001';
  var MIGRATION_SOURCE_TAG = 'STACEY_V2';

  // ── Override flags (ONLY for migration period) ────────────
  // These flags permit backdated period_ids and relaxed
  // idempotency rules during migration. Hardcoded OFF by default.
  // Set to true ONLY during the actual migration run, then back to false.
  var ALLOW_BACKDATE_PERIOD  = false;
  var ALLOW_MIGR_IDEMPOTENCY = false;

  // ── Table names (migration-specific) ─────────────────────
  var TABLES = {
    RAW_IMPORT: 'MIGRATION_RAW_IMPORT',
    NORMALIZED: 'MIGRATION_NORMALIZED',
    AUDIT_LOG:  'MIGRATION_AUDIT_LOG'
  };

  // ── Source table names (Stacey tabs — update after audit) ─
  // Fill these in after running StaceyAuditor.runAudit()
  var STACEY_TABLES = {
    STAFF:     'REPLACE_AFTER_AUDIT',
    CLIENTS:   'REPLACE_AFTER_AUDIT',
    JOBS:      'REPLACE_AFTER_AUDIT',
    WORK_LOGS: 'REPLACE_AFTER_AUDIT',
    BILLING:   'REPLACE_AFTER_AUDIT',
    PAYROLL:   'REPLACE_AFTER_AUDIT'
  };

  return {
    getStaceyId:       function () { return STACEY_SPREADSHEET_ID; },
    getBatch:          function () { return CURRENT_BATCH; },
    getSourceTag:      function () { return MIGRATION_SOURCE_TAG; },
    isBackdateAllowed: function () { return ALLOW_BACKDATE_PERIOD; },
    isMigrIdempotency: function () { return ALLOW_MIGR_IDEMPOTENCY; },
    enableOverrides:   function () {
      ALLOW_BACKDATE_PERIOD  = true;
      ALLOW_MIGR_IDEMPOTENCY = true;
    },
    disableOverrides:  function () {
      ALLOW_BACKDATE_PERIOD  = false;
      ALLOW_MIGR_IDEMPOTENCY = false;
    },
    TABLES:        TABLES,
    STACEY_TABLES: STACEY_TABLES
  };
}());
