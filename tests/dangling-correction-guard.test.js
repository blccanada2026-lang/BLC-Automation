/**
 * dangling-correction-guard.test.js
 *
 * Tests for src/10-payroll/DanglingCorrectionGuard.gs.
 *
 * Context (ADR-WL-005 follow-up): WorkLogCorrectionHandler.handleReassign()
 * always writes its void row to the ORIGINAL's own period (confirmed by
 * reading the handler — handleAmend()/handleVoid() never cross partitions
 * either), but its resubmit row to "now", which can land in a later
 * quarter. A live aggregation of both quarters already nets correctly
 * (see work-log-aggregation.test.js) — that is NOT what this guard exists
 * to catch. The real risk is COMMIT TIMING: if the original's quarter was
 * already committed (an active PERIOD_COMMIT marker) BEFORE the correction
 * was filed, that commit is a frozen snapshot that will never see the
 * void, while the resubmit's quarter counts the same hours again when it
 * is committed — a genuine double-payment path. This guard detects that
 * specific condition so commitBonusForPeriod can refuse.
 */

const fs   = require('fs');
const path = require('path');
const { installV3Mocks } = require('./gas-v3-mocks');

function loadSrc(relPath) {
  // eval() loads trusted, repo-local .gs source (not user input) — same
  // pattern as every other test in this repo. Indirect (global) eval so
  // declarations become visible outside this helper.
  (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
}

let mocks;

beforeEach(() => {
  mocks = installV3Mocks();
  loadSrc('../src/10-payroll/BonusPeriodEngine.gs');
  loadSrc('../src/10-payroll/BonusPeriodCommit.gs');
  loadSrc('../src/10-payroll/DanglingCorrectionGuard.gs');
});

/** Seeds a WORK_LOG_REASSIGN void+resubmit pair across two partitions. */
function seedReassignPair({ queueId, actorCode, hours, voidPeriodId, resubmitPeriodId, voidTimestamp, resubmitTimestamp }) {
  const prefix = 'WL_REASSIGN_' + queueId;
  mocks.store['FACT_WORK_LOGS|' + voidPeriodId] = (mocks.store['FACT_WORK_LOGS|' + voidPeriodId] || []).concat([{
    event_id: 'EVT-VOID-' + queueId,
    actor_code: actorCode,
    hours: -hours,
    event_type: 'WORK_LOG_VOIDED',
    timestamp: voidTimestamp,
    idempotency_key: prefix + '_VOID'
  }]);
  mocks.store['FACT_WORK_LOGS|' + resubmitPeriodId] = (mocks.store['FACT_WORK_LOGS|' + resubmitPeriodId] || []).concat([{
    event_id: 'EVT-NEW-' + queueId,
    actor_code: actorCode,
    hours: hours,
    event_type: 'WORK_LOG_SUBMITTED',
    timestamp: resubmitTimestamp,
    idempotency_key: prefix + '_NEW'
  }]);
}

/** Seeds an active PERIOD_COMMIT marker for a QUARTER periodValue. */
function seedCommitMarker(periodValue, timestamp) {
  mocks.store['FACT_QUARTERLY_BONUS'] = (mocks.store['FACT_QUARTERLY_BONUS'] || []).concat([{
    bonus_id: 'BONUS-' + periodValue,
    event_type: 'PERIOD_COMMIT',
    quarter_period_id: periodValue,
    idempotency_key: 'PERIOD_COMMIT|QUARTER|' + periodValue,
    timestamp: timestamp
  }]);
}

describe('dcgDetectDanglingCorrections_', () => {
  test('flags DOUBLE_COUNT_RISK: original quarter committed BEFORE the correction was filed', () => {
    seedReassignPair({
      queueId: 'Q001', actorCode: 'PHD1', hours: 6,
      voidPeriodId: '2026-03', resubmitPeriodId: '2026-04',
      voidTimestamp: '2026-04-15T00:00:00.000Z', resubmitTimestamp: '2026-04-15T00:00:00.000Z'
    });
    seedCommitMarker('2026-Q1', '2026-04-01T00:00:00.000Z'); // committed BEFORE the 04-15 correction

    const result = dcgDetectDanglingCorrections_('Q2', '2026');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('DOUBLE_COUNT_RISK');
    expect(result[0].actorCode).toBe('PHD1');
    expect(result[0].hours).toBe(6);
    expect(result[0].originalQuarter).toBe('2026-Q1');
    expect(result[0].resubmitQuarter).toBe('2026-Q2');
    expect(result[0].message).toEqual(expect.stringContaining('PHD1'));
  });

  test('does not flag when the original quarter has never been committed (still open)', () => {
    seedReassignPair({
      queueId: 'Q002', actorCode: 'PHD1', hours: 6,
      voidPeriodId: '2026-03', resubmitPeriodId: '2026-04',
      voidTimestamp: '2026-04-15T00:00:00.000Z', resubmitTimestamp: '2026-04-15T00:00:00.000Z'
    });
    // No PERIOD_COMMIT marker seeded for 2026-Q1 — still open, will pick up the void live whenever committed.

    const result = dcgDetectDanglingCorrections_('Q2', '2026');

    expect(result).toHaveLength(0);
  });

  test('does not flag when the original quarter was committed AFTER the correction (commit already saw the void)', () => {
    seedReassignPair({
      queueId: 'Q003', actorCode: 'PHD1', hours: 6,
      voidPeriodId: '2026-03', resubmitPeriodId: '2026-04',
      voidTimestamp: '2026-04-05T00:00:00.000Z', resubmitTimestamp: '2026-04-05T00:00:00.000Z'
    });
    seedCommitMarker('2026-Q1', '2026-04-10T00:00:00.000Z'); // committed AFTER the 04-05 correction

    const result = dcgDetectDanglingCorrections_('Q2', '2026');

    expect(result).toHaveLength(0);
  });

  test('does not flag a resubmit landing in the SAME quarter as its original (common case, already nets correctly)', () => {
    seedReassignPair({
      queueId: 'Q004', actorCode: 'PHD1', hours: 6,
      voidPeriodId: '2026-01', resubmitPeriodId: '2026-02', // different months, SAME quarter (Q1)
      voidTimestamp: '2026-02-01T00:00:00.000Z', resubmitTimestamp: '2026-02-01T00:00:00.000Z'
    });
    seedCommitMarker('2026-Q1', '2026-01-15T00:00:00.000Z'); // even if Q1 itself had a (self-referencing) marker

    const result = dcgDetectDanglingCorrections_('Q1', '2026');

    expect(result).toHaveLength(0);
  });

  test('names every dangling correction, not just the first, when multiple exist in the same quarter', () => {
    seedReassignPair({
      queueId: 'Q005', actorCode: 'PHD1', hours: 6,
      voidPeriodId: '2026-03', resubmitPeriodId: '2026-04',
      voidTimestamp: '2026-04-15T00:00:00.000Z', resubmitTimestamp: '2026-04-15T00:00:00.000Z'
    });
    seedReassignPair({
      queueId: 'Q006', actorCode: 'PHD2', hours: 3,
      voidPeriodId: '2026-02', resubmitPeriodId: '2026-04',
      voidTimestamp: '2026-04-16T00:00:00.000Z', resubmitTimestamp: '2026-04-16T00:00:00.000Z'
    });
    seedCommitMarker('2026-Q1', '2026-04-01T00:00:00.000Z');

    const result = dcgDetectDanglingCorrections_('Q2', '2026');

    expect(result).toHaveLength(2);
    const actors = result.map(r => r.actorCode).sort();
    expect(actors).toEqual(['PHD1', 'PHD2']);
  });

  test('flags MISSING_VOID when a resubmit has no matching void row anywhere (partial reassign-write failure)', () => {
    mocks.store['FACT_WORK_LOGS|2026-04'] = [{
      event_id: 'EVT-NEW-ORPHAN', actor_code: 'PHD1', hours: 6,
      event_type: 'WORK_LOG_SUBMITTED', timestamp: '2026-04-15T00:00:00.000Z',
      idempotency_key: 'WL_REASSIGN_Q999_NEW'
    }];
    // No corresponding _VOID row written anywhere.

    const result = dcgDetectDanglingCorrections_('Q2', '2026');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('MISSING_VOID');
    expect(result[0].actorCode).toBe('PHD1');
  });

  test('ignores rows that are not WORK_LOG_REASSIGN resubmits', () => {
    mocks.store['FACT_WORK_LOGS|2026-04'] = [
      { event_id: 'EVT-1', actor_code: 'PHD1', hours: 6, event_type: 'WORK_LOG_SUBMITTED', timestamp: '2026-04-10T00:00:00.000Z', idempotency_key: 'WL_ABC123' },
      { event_id: 'EVT-2', actor_code: 'PHD2', hours: -2, event_type: 'WORK_LOG_VOIDED', timestamp: '2026-04-10T00:00:00.000Z', idempotency_key: 'WL_VOID_ABC456' }
    ];

    const result = dcgDetectDanglingCorrections_('Q2', '2026');

    expect(result).toHaveLength(0);
  });
});
