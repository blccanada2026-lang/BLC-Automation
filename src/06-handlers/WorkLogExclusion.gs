// ============================================================
// WorkLogExclusion.gs — BLC Nexus T06 Shared Predicate
// src/06-handlers/WorkLogExclusion.gs
//
// LOAD ORDER: T06, after Constants.gs (T00).
// DEPENDENCIES: Constants.gs (EVENT_TYPES).
//
// Single source of truth: is this FACT_WORK_LOGS row a migrated/
// historical row that must be excluded from live payroll, bonus, and
// billing hours aggregation?
//
// Root cause this replaces: PayrollEngine.aggregateHours_(),
// QuarterlyBonusEngine.aggregateQuarterHours_(), and
// BillingEngine.buildHoursCache_() each filtered on `row.migration_batch`
// — a field that is never a real FACT_WORK_LOGS column. DAL's
// objectToRow_() only writes object keys that already exist as a column
// on the target sheet's header row (src/01-dal/DAL.gs), and
// `migration_batch` was never added to the canonical FACT_WORK_LOGS
// header (src/setup/SetupScript.gs). So every migration importer that
// set `migration_batch` on its row object had that field silently
// dropped on write, and every engine that filtered on it read back
// `undefined` — never excluding anything. `event_type` is the field
// that actually survives on every importer's write path; this module
// filters on that instead.
//
// Two spellings exist in the wild and must both be treated as migrated:
//   WORK_LOG_MIGRATED  — most importers (MigrationReplayEngine,
//                         MigrationReconFiller, MatixReconFiller,
//                         NelsonReconFiller_2026,
//                         AlbertaTrussReconFiller_2026,
//                         SbsReconFiller_Jan2026)
//   WORK_LOG_MIGRATION — pre-existing typo variant, used by
//                         SbsReconFiller_Feb2026/Mar2026/Apr2026.gs
//                         (see Constants.gs EVENT_TYPES comment)
// ============================================================

var MIGRATED_WORK_LOG_EVENT_TYPES_ = (function () {
  var set = {};
  set[Constants.EVENT_TYPES.WORK_LOG_MIGRATED]  = true;
  set[Constants.EVENT_TYPES.WORK_LOG_MIGRATION] = true;
  return set;
}());

/**
 * Returns true if this FACT_WORK_LOGS row is a migrated/historical row
 * that must be excluded from live payroll, bonus, or billing hours
 * aggregation.
 *
 * Deliberately does NOT look at row.migration_batch — see file header.
 *
 * @param {Object} row  A FACT_WORK_LOGS row object (e.g. from DAL.readAll)
 * @returns {boolean}
 */
function isMigratedWorkLog(row) {
  if (!row) return false;
  return !!MIGRATED_WORK_LOG_EVENT_TYPES_[String(row.event_type || '')];
}
