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

});
