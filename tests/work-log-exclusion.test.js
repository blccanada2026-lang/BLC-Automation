/**
 * work-log-exclusion.test.js
 *
 * Tests for src/06-handlers/WorkLogExclusion.gs — the single shared
 * predicate for "is this FACT_WORK_LOGS row a migrated/historical row
 * that must be excluded from live payroll, bonus, and billing hours
 * aggregation?"
 *
 * Root cause under test: PayrollEngine.aggregateHours_(),
 * QuarterlyBonusEngine.aggregateQuarterHours_(), and
 * BillingEngine.buildHoursCache_() all filtered on `row.migration_batch`,
 * a field that is never a real FACT_WORK_LOGS column (DAL's
 * objectToRow_() only writes fields that already exist as a sheet
 * header) — so the exclusion silently never worked. The field that
 * does survive on every migration importer's write path is
 * `event_type`. Two spellings exist in the wild: `WORK_LOG_MIGRATED`
 * (most importers) and `WORK_LOG_MIGRATION` (typo variant used by
 * SbsReconFiller_Feb2026/Mar2026/Apr2026.gs — see Constants.gs:63-64).
 */

const fs   = require('fs');
const path = require('path');

// eval() here loads trusted, repo-local Apps Script (.gs) source files —
// not user input or any external/untrusted string. .gs files aren't real
// Node modules (no exports, GAS globals like SpreadsheetApp), so eval'ing
// the raw source into this test's scope is the only way to load them
// under Jest; every existing test in this repo (payroll.test.js,
// quarterly-bonus.test.js, etc.) uses the identical fs.readFileSync +
// eval pattern for the same reason.
//
// Constants.gs has zero dependencies and calls no GAS API (per its own
// header) — safe to eval standalone, no mocks needed.
const constantsGs = fs.readFileSync(
  path.join(__dirname, '../src/00-foundation/Constants.gs'), 'utf8'
);
eval(constantsGs);

// System under test
const workLogExclusionGs = fs.readFileSync(
  path.join(__dirname, '../src/06-handlers/WorkLogExclusion.gs'), 'utf8'
);
eval(workLogExclusionGs);


describe('isMigratedWorkLog()', () => {

  test('excludes a row with event_type WORK_LOG_MIGRATED', () => {
    const row = { event_type: 'WORK_LOG_MIGRATED', actor_code: 'RKG', hours: 6 };
    expect(isMigratedWorkLog(row)).toBe(true);
  });

  test('excludes a row with event_type WORK_LOG_MIGRATION (typo variant)', () => {
    // SbsReconFiller_Feb2026/Mar2026/Apr2026.gs write this spelling
    const row = { event_type: 'WORK_LOG_MIGRATION', actor_code: 'ABB', hours: 4 };
    expect(isMigratedWorkLog(row)).toBe(true);
  });

  test('does NOT exclude an organic WORK_LOG_SUBMITTED row', () => {
    const row = { event_type: 'WORK_LOG_SUBMITTED', actor_code: 'RKG', hours: 8 };
    expect(isMigratedWorkLog(row)).toBe(false);
  });

  test('does NOT exclude a WORK_LOG_AMENDED row (real corrections must still count)', () => {
    const row = { event_type: 'WORK_LOG_AMENDED', actor_code: 'RKG', hours: 2 };
    expect(isMigratedWorkLog(row)).toBe(false);
  });

  test('does NOT exclude a WORK_LOG_VOIDED row (voids must still count so net-zero corrections net to zero)', () => {
    const row = { event_type: 'WORK_LOG_VOIDED', actor_code: 'RKG', hours: -8 };
    expect(isMigratedWorkLog(row)).toBe(false);
  });

  test('regression guard: ignores row.migration_batch entirely, even if set', () => {
    // This is the actual on-disk shape that caused the Q1 2026 bonus
    // exposure: migration_batch is set on the JS object passed to
    // DAL.appendRow(), but DAL never persists it (not a real column),
    // so it must never come back on a read and must never be trusted
    // even if present on a test fixture.
    const row = { event_type: 'WORK_LOG_SUBMITTED', migration_batch: 'BATCH-RECON-001', hours: 8 };
    expect(isMigratedWorkLog(row)).toBe(false);
  });

  test('regression guard: excludes based on event_type alone, with no migration_batch field present', () => {
    // This is the real shape every migrated row actually has after a
    // DAL read — migration_batch was never written, so it's simply
    // absent, not falsy-but-present.
    const row = { event_type: 'WORK_LOG_MIGRATED', actor_code: 'BCH', hours: 4 };
    expect('migration_batch' in row).toBe(false);
    expect(isMigratedWorkLog(row)).toBe(true);
  });

  test('handles missing event_type without throwing', () => {
    expect(isMigratedWorkLog({ actor_code: 'RKG', hours: 8 })).toBe(false);
  });

  test('handles null/undefined row without throwing', () => {
    expect(isMigratedWorkLog(null)).toBe(false);
    expect(isMigratedWorkLog(undefined)).toBe(false);
  });

});
