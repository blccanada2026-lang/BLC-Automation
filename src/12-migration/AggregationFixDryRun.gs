// ============================================================
// AggregationFixDryRun.gs — BLC Nexus T12 Migration/Promotion
// src/12-migration/AggregationFixDryRun.gs
//
// PROMOTION DRY-RUN for the Phase 0/0b aggregation fix-set — see
// PROMOTION_CHECKLIST.md. Prints the fixed per-designer hours from
// BOTH engines the fix touched — PayrollEngine (base payroll, monthly)
// and QuarterlyBonusEngine (bonus, quarterly) — using the REAL fixed
// aggregation path, without writing anything.
//
// COVERS BOTH ENGINES (2026-07-23 revision): the original version of
// this file only exercised QuarterlyBonusEngine. Extended per explicit
// instruction — this promotion includes a PayrollEngine fix, and
// validating only the bonus engine against real data would leave the
// payroll fix unverified against real PROD data shape, the exact gap
// class this whole project started from.
//
// READ-ONLY BY CONSTRUCTION:
//   - PayrollEngine.aggregateHours_(periodId): DAL.readAll() (one
//     month partition) -> aggregateNetWorkLogHours(rows) — a pure
//     in-memory reduction, no DAL calls at all.
//   - QuarterlyBonusEngine.aggregateQuarterHours_(quarter, year):
//     DAL.readAll() (per month partition, 3x) -> aggregateNetWorkLogHours(rows)
//     — same shared, pure reduction.
// Both confirmed by reading the functions in full before writing this
// file. Nothing in this file or anything it calls contains
// DAL.appendRow / DAL.appendRows / DAL.ensurePartition.
//
// UNLIKE this migration/ folder's other diagnostics
// (CrossPartitionCorrectionAudit.gs, NorspanJobOriginAudit.gs, etc.),
// this file is DELIBERATELY NOT Config.isDev()-gated — its entire
// purpose is to eventually run against PROD, once explicitly
// authorized (see PROMOTION_CHECKLIST.md's dry-run step). It prints
// the ACTIVE script ID on every run so whoever runs it can visually
// confirm which project they're in before trusting the output.
//
// PERIODS COVERED: derived from AFPD_QUARTERS_ below (Q1/Q2 2026) —
// PayrollEngine.aggregateHours_() is run once per MONTH within each
// configured quarter (via AFPD_QUARTER_MONTHS_, a local month-list
// map — deliberately not borrowed from QuarterlyBonusEngine's private
// monthPeriodIds_(), same reasoning DanglingCorrectionGuard.gs used
// for its own local copy: keep this file's period coverage a single,
// self-contained source of truth rather than a cross-file dependency
// on another module's private helper), so the same periods are
// covered at both granularities and the two can be sanity-compared.
//
// HOW TO RUN (Apps Script editor, whichever project is active):
//   runAggregationFixDryRun()
//
// Requires PAYROLL_VIEW (read-only RBAC action). Writes nothing to
// any FACT/DIM table.
// ============================================================

var AFPD_ACTOR_EMAIL_ = 'raj.nair@bluelotuscanada.ca';
var AFPD_QUARTERS_ = [
  { quarter: 'Q1', year: 2026 },
  { quarter: 'Q2', year: 2026 }
];
var AFPD_QUARTER_MONTHS_ = {
  Q1: ['01', '02', '03'], Q2: ['04', '05', '06'],
  Q3: ['07', '08', '09'], Q4: ['10', '11', '12']
};

function afpdMonthPeriodIds_(quarter, year) {
  return AFPD_QUARTER_MONTHS_[quarter].map(function (m) { return String(year) + '-' + m; });
}

function runAggregationFixDryRun() {
  var actualScriptId = ScriptApp.getScriptId();
  console.log('=== Aggregation fix-set dry-run (read-only) ===');
  console.log('Script ID: ' + actualScriptId + ' — confirm this matches the project you intend to check ' +
              '(DEV: 1smkj0mmUqcWDDJPq... / PROD: 1HzRiDrQJ6z-BxPzk...) before trusting this output.');

  var actor = RBAC.resolveActor(AFPD_ACTOR_EMAIL_);
  RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_VIEW);

  var report = { payrollEngineByMonth: {}, quarterlyBonusEngineByQuarter: {} };

  for (var i = 0; i < AFPD_QUARTERS_.length; i++) {
    var q = AFPD_QUARTERS_[i];
    var qLabel = q.year + '-' + q.quarter;
    var months = afpdMonthPeriodIds_(q.quarter, q.year);

    console.log('');
    console.log('=== ' + qLabel + ' ===');

    // ── PayrollEngine, one call per month in this quarter ──
    for (var m = 0; m < months.length; m++) {
      var periodId = months[m];
      console.log('');
      console.log('--- ' + periodId + ' (PayrollEngine.aggregateHours_) ---');

      var monthMap;
      try {
        monthMap = PayrollEngine.aggregateHours_(periodId);
      } catch (e) {
        console.log('  ERROR computing ' + periodId + ': ' + e.message);
        report.payrollEngineByMonth[periodId] = { error: e.message };
        continue;
      }

      var monthCodes = Object.keys(monthMap).sort();
      if (monthCodes.length === 0) {
        console.log('  (no rows / no actors found for this month)');
      }
      monthCodes.forEach(function (code) {
        var v = monthMap[code];
        console.log('  ' + code + ': design=' + v.design_hours + 'h  qc=' + v.qc_hours + 'h');
      });
      report.payrollEngineByMonth[periodId] = monthMap;
    }

    // ── QuarterlyBonusEngine, one call for the whole quarter ──
    console.log('');
    console.log('--- ' + qLabel + ' (QuarterlyBonusEngine.aggregateQuarterHours_) ---');

    var hoursMap;
    try {
      hoursMap = QuarterlyBonusEngine.aggregateQuarterHours_(q.quarter, q.year);
    } catch (e) {
      console.log('  ERROR computing ' + qLabel + ': ' + e.message);
      report.quarterlyBonusEngineByQuarter[qLabel] = { error: e.message };
      continue;
    }

    var qCodes = Object.keys(hoursMap).sort();
    if (qCodes.length === 0) {
      console.log('  (no rows / no actors found for this quarter)');
    }
    qCodes.forEach(function (code) {
      console.log('  ' + code + ': ' + hoursMap[code] + 'h');
    });
    report.quarterlyBonusEngineByQuarter[qLabel] = hoursMap;
  }

  console.log('');
  console.log('=== End of dry-run. No writes were made — this function calls only ' +
              'PayrollEngine.aggregateHours_() and QuarterlyBonusEngine.aggregateQuarterHours_(), ' +
              'both of which only read via DAL.readAll(). ===');

  return report;
}
