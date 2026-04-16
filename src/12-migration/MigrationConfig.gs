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
// | Migration tables      | ❓     | High   | Create if missing (see below)|
// | RBAC model            | ✅     | Low    | None                         |
// | Audit logging         | ✅     | Low    | None                         |
// | Rollback mechanism    | ✅     | Medium | Batch-tag purge ready        |
// | Stacey read access    | ❓     | High   | CEO must provide spreadsheet ID |
// | DEV/PROD isolation    | ✅     | Low    | Run in DEV first             |
// | Override flags        | ✅     | High   | Keep false until migration   |
// ============================================================

var MigrationConfig = (function () {

  // ── Stacey (legacy) spreadsheet ───────────────────────────
  // Read-only. Never write to Stacey.
  // CEO must provide this ID before migration begins.
  var STACEY_SPREADSHEET_ID = 'REPLACE_WITH_STACEY_SPREADSHEET_ID';

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
