/**
 * work-log-aggregation.test.js
 *
 * Tests for src/06-handlers/WorkLogAggregation.gs — the single shared
 * NET-hours aggregation function (Phase 3's item 2 "shared net-hours
 * aggregation function", which is also the fix for the void-netting bug
 * found while reconciling Phase 0's DEV evidence: PayrollEngine.aggregateHours_()
 * and QuarterlyBonusEngine.aggregateQuarterHours_() both filtered rows with
 * `hours <= 0`, which silently drops WORK_LOG_VOIDED rows (negative hours
 * by design) instead of netting them — so every void+resubmit correction
 * was double-counted, not net-zero, in payroll/bonus. BillingEngine's
 * equivalent function does not have this bug (only isNaN/===0 excluded);
 * this fix brings Payroll/Bonus in line with Billing's already-correct
 * pattern.
 */

const fs   = require('fs');
const path = require('path');

// eval() loads trusted, repo-local .gs source (not user input) — same
// pattern as every other test in this repo, see work-log-exclusion.test.js
// for the fuller rationale.
const constantsGs = fs.readFileSync(path.join(__dirname, '../src/00-foundation/Constants.gs'), 'utf8');
eval(constantsGs);
const exclusionGs = fs.readFileSync(path.join(__dirname, '../src/06-handlers/WorkLogExclusion.gs'), 'utf8');
eval(exclusionGs);
const aggregationGs = fs.readFileSync(path.join(__dirname, '../src/06-handlers/WorkLogAggregation.gs'), 'utf8');
eval(aggregationGs);


describe('aggregateNetWorkLogHours()', () => {

  test('sums organic hours per actor, split design vs QC', () => {
    const rows = [
      { actor_code: 'PHD1', actor_role: 'DESIGNER', hours: 6, event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'PHD1', actor_role: 'DESIGNER', hours: 4, event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'PHD1', actor_role: 'QC',       hours: 3, event_type: 'WORK_LOG_SUBMITTED' },
    ];
    const result = aggregateNetWorkLogHours(rows);
    expect(result.PHD1.design_hours).toBe(10);
    expect(result.PHD1.qc_hours).toBe(3);
  });

  test('excludes migrated rows (delegates to isMigratedWorkLog)', () => {
    const rows = [
      { actor_code: 'PHD1', actor_role: 'DESIGNER', hours: 6, event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'PHD1', actor_role: 'DESIGNER', hours: 40, event_type: 'WORK_LOG_MIGRATED' },
      { actor_code: 'PHD1', actor_role: 'DESIGNER', hours: 10, event_type: 'WORK_LOG_MIGRATION' },
    ];
    const result = aggregateNetWorkLogHours(rows);
    expect(result.PHD1.design_hours).toBe(6);
  });

  // ── The core bug fix ──────────────────────────────────────────
  test('REGRESSION: a same-period void+resubmit triple nets to the corrected value, not double-counted', () => {
    // ADR-WL-001 pattern: original (wrong job) -> void (negative) -> resubmit (correct job).
    const rows = [
      { actor_code: 'PHD1', actor_role: 'DESIGNER', hours: 3,  event_type: 'WORK_LOG_SUBMITTED', job_number: 'J1' },
      { actor_code: 'PHD1', actor_role: 'DESIGNER', hours: -3, event_type: 'WORK_LOG_VOIDED',    job_number: 'J1' },
      { actor_code: 'PHD1', actor_role: 'DESIGNER', hours: 3,  event_type: 'WORK_LOG_SUBMITTED', job_number: 'J7' },
    ];
    const result = aggregateNetWorkLogHours(rows);
    // Bug (pre-fix): void skipped (hours<=0), so 3 + 3 = 6. Correct: 3 - 3 + 3 = 3.
    expect(result.PHD1.design_hours).toBe(3);
  });

  test('REGRESSION: a void with no matching resubmit correctly reduces the total', () => {
    const rows = [
      { actor_code: 'PHD1', actor_role: 'DESIGNER', hours: 8,  event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'PHD1', actor_role: 'DESIGNER', hours: -5, event_type: 'WORK_LOG_VOIDED' },
    ];
    const result = aggregateNetWorkLogHours(rows);
    expect(result.PHD1.design_hours).toBe(3);
  });

  test('a WORK_LOG_AMENDED negative delta also nets correctly (not just WORK_LOG_VOIDED)', () => {
    // BillingEngine's comment: "runUndoDuplicateDBGFix writes negative
    // WORK_LOG_AMENDED events to cancel erroneous duplicate corrections."
    const rows = [
      { actor_code: 'PHD1', actor_role: 'DESIGNER', hours: 10, event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'PHD1', actor_role: 'DESIGNER', hours: -4, event_type: 'WORK_LOG_AMENDED' },
    ];
    const result = aggregateNetWorkLogHours(rows);
    expect(result.PHD1.design_hours).toBe(6);
  });

  test('exactly-zero and NaN hours are excluded (not counted as "nothing to net")', () => {
    const rows = [
      { actor_code: 'PHD1', actor_role: 'DESIGNER', hours: 0,   event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'PHD1', actor_role: 'DESIGNER', hours: NaN, event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'PHD1', actor_role: 'DESIGNER', hours: '',  event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'PHD1', actor_role: 'DESIGNER', hours: 5,   event_type: 'WORK_LOG_SUBMITTED' },
    ];
    const result = aggregateNetWorkLogHours(rows);
    expect(result.PHD1.design_hours).toBe(5);
  });

  test('rows with no actor_code are skipped', () => {
    const rows = [
      { actor_code: '', actor_role: 'DESIGNER', hours: 8, event_type: 'WORK_LOG_SUBMITTED' },
    ];
    const result = aggregateNetWorkLogHours(rows);
    expect(Object.keys(result)).toHaveLength(0);
  });

  test('falls back to person_code when actor_code is absent (matches pre-existing aggregateQuarterHours_ behavior)', () => {
    const rows = [
      { person_code: 'PHD1', actor_role: 'DESIGNER', hours: 5, event_type: 'WORK_LOG_SUBMITTED' },
    ];
    const result = aggregateNetWorkLogHours(rows);
    expect(result.PHD1.design_hours).toBe(5);
  });

  test('empty input returns empty map', () => {
    expect(aggregateNetWorkLogHours([])).toEqual({});
  });

  // ── Structural limitation, made explicit rather than silently assumed ──
  test('KNOWN LIMITATION: a correction whose void and resubmit land in DIFFERENT periods does not net within either period alone, but nets correctly across their union', () => {
    // WorkLogCorrectionHandler.handleReassign() writes the void under the
    // ORIGINAL row's period_id and the resubmit under whatever period is
    // "current" when the correction is filed — these can differ (see
    // WorkLogCorrectionHandler.gs lines ~634-637, 644, 660). A caller that
    // aggregates one period in isolation (e.g. a single quarter) will see
    // an incomplete net for that period; the discrepancy only resolves
    // when the periods on both sides of the correction are aggregated
    // together (e.g. summed into an annual total spanning both quarters).
    const periodA_rows = [ // e.g. Q1's March partition: original + void, resubmit filed later, in Q2
      { actor_code: 'PHD1', actor_role: 'DESIGNER', hours: 6,  event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'PHD1', actor_role: 'DESIGNER', hours: -6, event_type: 'WORK_LOG_VOIDED' },
    ];
    const periodB_rows = [ // e.g. Q2's April partition: resubmit only
      { actor_code: 'PHD1', actor_role: 'DESIGNER', hours: 6, event_type: 'WORK_LOG_SUBMITTED' },
    ];

    const resultA = aggregateNetWorkLogHours(periodA_rows);
    const resultB = aggregateNetWorkLogHours(periodB_rows);
    // Neither period alone shows the "true" 6h — A shows 0, B shows 6.
    expect(resultA.PHD1 ? resultA.PHD1.design_hours : 0).toBe(0);
    expect(resultB.PHD1.design_hours).toBe(6);

    // But aggregating the UNION of both periods' rows in one pass gives
    // the correct total — this is why a from-scratch annual aggregation
    // (read Jan-Dec once) is immune to this, while summing four
    // already-computed, independently-locked quarterly numbers is not.
    const resultUnion = aggregateNetWorkLogHours(periodA_rows.concat(periodB_rows));
    expect(resultUnion.PHD1.design_hours).toBe(6);
  });

  test('classifies QC_REVIEWER rows as qc_hours, same as QC (RBAC.gs alias, not applied to actor.role outside RBAC\'s own matrix lookup — see 2026-09-08 design spec, Discrepancy 1)', () => {
    const rows = [
      { actor_code: 'DBS', actor_role: 'QC_REVIEWER', hours: 4, event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'DBS', actor_role: 'QC_REVIEWER', hours: 3, event_type: 'WORK_LOG_SUBMITTED' },
    ];
    const result = aggregateNetWorkLogHours(rows);
    expect(result.DBS.qc_hours).toBe(7);
    expect(result.DBS.design_hours).toBe(0);
  });

});

describe('aggregateNetWorkLogHoursByAccount()', () => {
  const jobToClientProductMap = {
    'BLC-01001': { client_code: 'ALBERTA TRUSS', product_code: 'ROOF_TRUSS' },
    'BLC-01002': { client_code: 'TITAN TRUSS',   product_code: 'ROOF_TRUSS' },
    'BLC-01003': { client_code: 'SBS',           product_code: 'ROOF_TRUSS' }
  };

  test('sums hours per (actor, client_code, product_code), split design vs QC', () => {
    const rows = [
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 6, job_number: 'BLC-01001', event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 4, job_number: 'BLC-01001', event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'PRS', actor_role: 'QC_REVIEWER', hours: 2, job_number: 'BLC-01001', event_type: 'WORK_LOG_SUBMITTED' },
    ];
    const result = aggregateNetWorkLogHoursByAccount(rows, jobToClientProductMap);
    expect(result.PRS['ALBERTA TRUSS']['ROOF_TRUSS'].design_hours).toBe(10);
    expect(result.PRS['ALBERTA TRUSS']['ROOF_TRUSS'].qc_hours).toBe(2);
  });

  test('the same person\'s hours on two different accounts stay in separate buckets', () => {
    const rows = [
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 6, job_number: 'BLC-01001', event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 3, job_number: 'BLC-01002', event_type: 'WORK_LOG_SUBMITTED' },
    ];
    const result = aggregateNetWorkLogHoursByAccount(rows, jobToClientProductMap);
    expect(result.PRS['ALBERTA TRUSS']['ROOF_TRUSS'].design_hours).toBe(6);
    expect(result.PRS['TITAN TRUSS']['ROOF_TRUSS'].design_hours).toBe(3);
  });

  test('the same person\'s hours on two different products within the SAME account stay in separate buckets', () => {
    const map = {
      'BLC-01001': { client_code: 'ALBERTA TRUSS', product_code: 'ROOF_TRUSS' },
      'BLC-01004': { client_code: 'ALBERTA TRUSS', product_code: 'FLOOR_JOIST' }
    };
    const rows = [
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 6, job_number: 'BLC-01001', event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 3, job_number: 'BLC-01004', event_type: 'WORK_LOG_SUBMITTED' },
    ];
    const result = aggregateNetWorkLogHoursByAccount(rows, map);
    expect(result.PRS['ALBERTA TRUSS']['ROOF_TRUSS'].design_hours).toBe(6);
    expect(result.PRS['ALBERTA TRUSS']['FLOOR_JOIST'].design_hours).toBe(3);
  });

  test('nets a WORK_LOG_VOIDED negative delta against the same (actor, client_code, product_code) bucket', () => {
    const rows = [
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 6, job_number: 'BLC-01001', event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: -6, job_number: 'BLC-01001', event_type: 'WORK_LOG_VOIDED' },
    ];
    const result = aggregateNetWorkLogHoursByAccount(rows, jobToClientProductMap);
    expect(result.PRS['ALBERTA TRUSS']['ROOF_TRUSS'].design_hours).toBe(0);
  });

  test('excludes migrated rows, same as aggregateNetWorkLogHours', () => {
    const rows = [
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 6, job_number: 'BLC-01001', event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 40, job_number: 'BLC-01001', event_type: 'WORK_LOG_MIGRATED' },
    ];
    const result = aggregateNetWorkLogHoursByAccount(rows, jobToClientProductMap);
    expect(result.PRS['ALBERTA TRUSS']['ROOF_TRUSS'].design_hours).toBe(6);
  });

  test('a row whose job_number has no entry in jobToClientProductMap is bucketed under literal "(UNKNOWN)" for both client and product, not silently dropped', () => {
    const rows = [
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 5, job_number: 'BLC-99999', event_type: 'WORK_LOG_SUBMITTED' },
    ];
    const result = aggregateNetWorkLogHoursByAccount(rows, jobToClientProductMap);
    expect(result.PRS['(UNKNOWN)']['(UNKNOWN)'].design_hours).toBe(5);
  });
});
