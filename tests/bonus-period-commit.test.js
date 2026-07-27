/**
 * bonus-period-commit.test.js
 *
 * Tests for src/10-payroll/BonusPeriodCommit.gs — period-level
 * idempotency, dry-run/commit run-ID gating, and the supersede audit
 * trail for runBonusForPeriod()/previewBonusForPeriod()/
 * commitBonusForPeriod()/supersedeBonusForPeriod().
 *
 * QuarterlyBonusEngine's own bonus MATH (previewQuarterlyBonus,
 * runQuarterlyBonus, runAnnualBonus_) is stubbed here, not re-tested —
 * this file tests the period-parameterization/commit-tracking layer
 * built on top of it. QuarterlyBonusEngine.gs itself has no Jest
 * coverage in this repo (see TEST_EVIDENCE.md); that gap is unchanged
 * by this file and is called out there.
 */

const fs   = require('fs');
const path = require('path');
const { installV3Mocks } = require('./gas-v3-mocks');

function loadSrc(relPath) {
  // eval() loads trusted, repo-local .gs source (not user input) — same
  // pattern as every other test in this repo. Indirect (global) eval —
  // not direct eval — specifically because this runs inside a helper
  // function; direct eval's declarations would be scoped to loadSrc()
  // and vanish once it returns, instead of becoming callable from the
  // test bodies below.
  (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
}

let mocks;

beforeEach(() => {
  mocks = installV3Mocks();
  // Stub QuarterlyBonusEngine's bonus-math entry points — this file does
  // not re-test the composite-score/hours-basis math, only the
  // period-commit layer sitting on top of it.
  global.QuarterlyBonusEngine = {
    previewQuarterlyBonus: jest.fn(function (actorEmail, quarter, year) {
      return global.__fixtureQuarterRows[quarter] || [];
    })
  };
  global.__fixtureQuarterRows = {};

  loadSrc('../src/10-payroll/BonusPeriodEngine.gs');
  loadSrc('../src/10-payroll/DanglingCorrectionGuard.gs');
  loadSrc('../src/10-payroll/BonusPeriodCommit.gs');
});

function setQuarterFixture(quarter, rows) {
  global.__fixtureQuarterRows[quarter] = rows;
}

const SAMPLE_ROWS_Q1 = [
  { person_code: 'PHD1', design_hours: 34, bonus_inr: 723.75, status: 'CALCULATED' },
  { person_code: 'PHD2', design_hours: 16, bonus_inr: 340,    status: 'CALCULATED' }
];

describe('dry-run determinism (original Phase 3 spec item 4d)', () => {
  test('re-running preview twice against unchanged data gives identical rows and checksum-equivalent output', () => {
    setQuarterFixture('Q1', SAMPLE_ROWS_Q1);
    const p1 = previewBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q1', new Date(2026, 6, 1));
    const p2 = previewBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q1', new Date(2026, 6, 1));
    expect(p2.rows).toEqual(p1.rows);
    // Distinct run IDs (each preview is its own run), but both commit
    // cleanly against the same underlying data — proving the second
    // preview's checksum matches what a commit would validate against.
    expect(p2.runId).not.toBe(p1.runId);
    const commit = commitBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q1', p2.runId, new Date(2026, 6, 1));
    expect(commit.committed).toBe(true);
  });
});

describe('runBonusForPeriod() — the requested API shape', () => {
  test('is a dry-run alias for previewBonusForPeriod() — never commits on its own', () => {
    setQuarterFixture('Q1', SAMPLE_ROWS_Q1);
    const result = runBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q1', new Date(2026, 6, 1));
    expect(result.runId).toBeTruthy();
    expect(result.rows).toEqual(SAMPLE_ROWS_Q1);
    // Nothing was written — confirmed by the absence of any PERIOD_COMMIT row.
    const markers = mocks.store['FACT_QUARTERLY_BONUS'] || [];
    expect(markers.filter(r => r.event_type === 'PERIOD_COMMIT')).toHaveLength(0);
  });
});

describe('previewBonusForPeriod() + commitBonusForPeriod() — QUARTER', () => {

  test('preview returns a runId and the rows from QuarterlyBonusEngine.previewQuarterlyBonus', () => {
    setQuarterFixture('Q1', SAMPLE_ROWS_Q1);
    const preview = previewBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q1', new Date(2026, 6, 1));
    expect(preview.runId).toBeTruthy();
    expect(preview.rows).toEqual(SAMPLE_ROWS_Q1);
    expect(preview.priorCommit).toBeNull();
  });

  test('preview REJECTS a quarter that has not fully closed yet', () => {
    setQuarterFixture('Q2', []);
    expect(() => previewBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q2', new Date(2026, 4, 1)))
      .toThrow(/not fully closed|in progress/);
  });

  test('commit REJECTS without a runId from a matching preview', () => {
    setQuarterFixture('Q1', SAMPLE_ROWS_Q1);
    expect(() => commitBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q1', 'NOT-A-REAL-RUN-ID', new Date(2026, 6, 1)))
      .toThrow(/run ID/);
  });

  test('commit REJECTS a runId generated for a DIFFERENT period', () => {
    setQuarterFixture('Q1', SAMPLE_ROWS_Q1);
    setQuarterFixture('Q2', []);
    const previewQ1 = previewBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q1', new Date(2026, 6, 1));
    expect(() => commitBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q2', previewQ1.runId, new Date(2026, 9, 1)))
      .toThrow(/different period/);
  });

  test('commit REJECTS a runId if the underlying data changed since preview (checksum mismatch)', () => {
    setQuarterFixture('Q1', SAMPLE_ROWS_Q1);
    const preview = previewBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q1', new Date(2026, 6, 1));
    // Data changes between preview and commit (e.g. a late-arriving rating).
    setQuarterFixture('Q1', [{ person_code: 'PHD1', design_hours: 34, bonus_inr: 999, status: 'CALCULATED' }]);
    expect(() => commitBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q1', preview.runId, new Date(2026, 6, 1)))
      .toThrow(/changed since|checksum/);
  });

  test('a valid preview -> commit writes a PERIOD_COMMIT marker for that period', () => {
    setQuarterFixture('Q1', SAMPLE_ROWS_Q1);
    const preview = previewBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q1', new Date(2026, 6, 1));
    const result  = commitBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q1', preview.runId, new Date(2026, 6, 1));
    expect(result.committed).toBe(true);
    expect(result.totalInr).toBeCloseTo(723.75 + 340, 2);

    const markers = mocks.store['FACT_QUARTERLY_BONUS'].filter(r => r.event_type === 'PERIOD_COMMIT');
    expect(markers).toHaveLength(1);
    expect(markers[0].idempotency_key).toBe('PERIOD_COMMIT|QUARTER|2026-Q1');
  });

  test('BLOCKS a second commit of the same period with a clear error naming the existing entry', () => {
    setQuarterFixture('Q1', SAMPLE_ROWS_Q1);
    const preview1 = previewBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q1', new Date(2026, 6, 1));
    commitBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q1', preview1.runId, new Date(2026, 6, 1));

    const preview2 = previewBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q1', new Date(2026, 6, 1));
    expect(() => commitBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q1', preview2.runId, new Date(2026, 6, 1)))
      .toThrow(/already has a committed bonus.*bonus_id=ID-\d+/s);
  });

  test('preview after a commit surfaces the prior committed entry for comparison', () => {
    setQuarterFixture('Q1', SAMPLE_ROWS_Q1);
    const preview1 = previewBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q1', new Date(2026, 6, 1));
    commitBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q1', preview1.runId, new Date(2026, 6, 1));

    const preview2 = previewBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q1', new Date(2026, 6, 1));
    expect(preview2.priorCommit).not.toBeNull();
    expect(preview2.priorCommit.totalInr).toBeCloseTo(1063.75, 2);
  });
});

describe('ANNUAL period gating', () => {
  function commitQuarter(q, rows, asOf) {
    setQuarterFixture(q, rows);
    const preview = previewBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-' + q, asOf);
    return commitBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-' + q, preview.runId, asOf);
  }

  test('ANNUAL preview BLOCKS when a quarter is missing, naming which one(s)', () => {
    commitQuarter('Q1', [{ person_code: 'PHD1', design_hours: 10, bonus_inr: 100, status: 'CALCULATED' }], new Date(2026, 3, 1));
    commitQuarter('Q2', [{ person_code: 'PHD1', design_hours: 10, bonus_inr: 100, status: 'CALCULATED' }], new Date(2026, 6, 1));
    commitQuarter('Q3', [{ person_code: 'PHD1', design_hours: 10, bonus_inr: 100, status: 'CALCULATED' }], new Date(2026, 9, 1));
    // Q4 not committed.
    expect(() => previewBonusForPeriod('ceo@test.blc.internal', 'ANNUAL', '2026-ANNUAL', new Date(2027, 0, 15)))
      .toThrow(/Q4/);
  });

  test('ANNUAL preview SUCCEEDS once all four quarters are committed, and sums their totals', () => {
    commitQuarter('Q1', [{ person_code: 'PHD1', design_hours: 10, bonus_inr: 100, status: 'CALCULATED' }], new Date(2026, 3, 1));
    commitQuarter('Q2', [{ person_code: 'PHD1', design_hours: 10, bonus_inr: 150, status: 'CALCULATED' }], new Date(2026, 6, 1));
    commitQuarter('Q3', [{ person_code: 'PHD1', design_hours: 10, bonus_inr: 200, status: 'CALCULATED' }], new Date(2026, 9, 1));
    commitQuarter('Q4', [{ person_code: 'PHD1', design_hours: 10, bonus_inr: 250, status: 'CALCULATED' }], new Date(2027, 0, 1));

    const annualPreview = previewBonusForPeriod('ceo@test.blc.internal', 'ANNUAL', '2026-ANNUAL', new Date(2027, 0, 15));
    const phd1Row = annualPreview.rows.find(r => r.person_code === 'PHD1');
    expect(phd1Row.bonus_inr).toBeCloseTo(100 + 150 + 200 + 250, 2);

    const annualCommit = commitBonusForPeriod('ceo@test.blc.internal', 'ANNUAL', '2026-ANNUAL', annualPreview.runId, new Date(2027, 0, 15));
    expect(annualCommit.committed).toBe(true);
  });

  test('ANNUAL commit is blocked on re-commit the same way QUARTER is', () => {
    ['Q1','Q2','Q3','Q4'].forEach((q, i) => commitQuarter(q, [{ person_code: 'PHD1', design_hours: 10, bonus_inr: 100, status: 'CALCULATED' }], new Date(2026, (i + 1) * 3, 1)));
    const p1 = previewBonusForPeriod('ceo@test.blc.internal', 'ANNUAL', '2026-ANNUAL', new Date(2027, 0, 15));
    commitBonusForPeriod('ceo@test.blc.internal', 'ANNUAL', '2026-ANNUAL', p1.runId, new Date(2027, 0, 15));

    const p2 = previewBonusForPeriod('ceo@test.blc.internal', 'ANNUAL', '2026-ANNUAL', new Date(2027, 0, 15));
    expect(() => commitBonusForPeriod('ceo@test.blc.internal', 'ANNUAL', '2026-ANNUAL', p2.runId, new Date(2027, 0, 15)))
      .toThrow(/already has a committed bonus/);
  });
});

describe('supersedeBonusForPeriod() — audit-trailed correction', () => {

  test('REJECTS superseding a period that was never committed', () => {
    setQuarterFixture('Q1', SAMPLE_ROWS_Q1);
    expect(() => supersedeBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q1', 'fix a mistake', new Date(2026, 6, 1)))
      .toThrow(/nothing to supersede|no committed/i);
  });

  test('voids the old marker, commits corrected amounts, and links old<->new by reference', () => {
    setQuarterFixture('Q1', SAMPLE_ROWS_Q1);
    const preview1 = previewBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q1', new Date(2026, 6, 1));
    const commit1  = commitBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q1', preview1.runId, new Date(2026, 6, 1));
    const oldBonusId = commit1.bonusId;

    // Discover the true figures were wrong — corrected fixture.
    const CORRECTED_ROWS = [
      { person_code: 'PHD1', design_hours: 31, bonus_inr: 660,    status: 'CALCULATED' }, // hours corrected down
      { person_code: 'PHD2', design_hours: 16, bonus_inr: 340,    status: 'CALCULATED' }
    ];
    setQuarterFixture('Q1', CORRECTED_ROWS);

    const supersede = supersedeBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q1', 'Q1 was inflated by migrated hours, ADR-WL-004', new Date(2026, 6, 5));
    expect(supersede.committed).toBe(true);
    expect(supersede.totalInr).toBeCloseTo(660 + 340, 2);
    expect(supersede.supersedesBonusId).toBe(oldBonusId);

    // Old marker is now voided; the ACTIVE marker is the new one.
    const active = bpcGetActiveMarker_('QUARTER', '2026-Q1');
    expect(active.bonus_id).toBe(supersede.bonusId);
    expect(active.bonus_id).not.toBe(oldBonusId);

    // Audit trail: both a PERIOD_COMMIT_VOIDED row (voiding the old marker)
    // and per-person voided + corrected rows exist — nothing was deleted
    // or silently overwritten.
    const allRows = mocks.store['FACT_QUARTERLY_BONUS'];
    const voidMarkers = allRows.filter(r => r.event_type === 'PERIOD_COMMIT_VOIDED');
    expect(voidMarkers).toHaveLength(1);
    expect(voidMarkers[0].pending_reason).toContain(oldBonusId);

    const perPersonVoided = allRows.filter(r => r.event_type === 'QUARTERLY_BONUS_VOIDED' && r.person_code === 'PHD1');
    expect(perPersonVoided).toHaveLength(1);
    expect(perPersonVoided[0].bonus_inr).toBeCloseTo(-723.75, 2);

    const perPersonCorrected = allRows.filter(r => r.event_type === 'QUARTERLY_BONUS' && r.person_code === 'PHD1');
    // Original commit's row + the new corrected row — original is untouched (append-only), not deleted.
    expect(perPersonCorrected.length).toBeGreaterThanOrEqual(2);
    const newest = perPersonCorrected[perPersonCorrected.length - 1];
    expect(newest.bonus_inr).toBeCloseTo(660, 2);
  });

  test('after a supersede, attempting a normal commit is still blocked (the period is committed via the NEW marker)', () => {
    setQuarterFixture('Q1', SAMPLE_ROWS_Q1);
    const preview1 = previewBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q1', new Date(2026, 6, 1));
    commitBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q1', preview1.runId, new Date(2026, 6, 1));
    supersedeBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q1', 'correction', new Date(2026, 6, 5));

    const preview2 = previewBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q1', new Date(2026, 6, 10));
    expect(() => commitBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q1', preview2.runId, new Date(2026, 6, 10)))
      .toThrow(/already has a committed bonus/);
  });
});

describe('dangling cross-partition correction guard (ADR-WL-005 follow-up)', () => {
  const Q2_CLOSE = new Date(2026, 9, 1); // safely after Q2 (Apr-Jun) closes

  function seedReassignPair({ queueId, actorCode, hours, voidPeriodId, resubmitPeriodId, voidTimestamp, resubmitTimestamp }) {
    const prefix = 'WL_REASSIGN_' + queueId;
    mocks.store['FACT_WORK_LOGS|' + voidPeriodId] = (mocks.store['FACT_WORK_LOGS|' + voidPeriodId] || []).concat([{
      event_id: 'EVT-VOID-' + queueId, actor_code: actorCode, hours: -hours,
      event_type: 'WORK_LOG_VOIDED', timestamp: voidTimestamp, idempotency_key: prefix + '_VOID'
    }]);
    mocks.store['FACT_WORK_LOGS|' + resubmitPeriodId] = (mocks.store['FACT_WORK_LOGS|' + resubmitPeriodId] || []).concat([{
      event_id: 'EVT-NEW-' + queueId, actor_code: actorCode, hours: hours,
      event_type: 'WORK_LOG_SUBMITTED', timestamp: resubmitTimestamp, idempotency_key: prefix + '_NEW'
    }]);
  }

  function seedCommitMarker(periodValue, timestamp) {
    mocks.store['FACT_QUARTERLY_BONUS'] = (mocks.store['FACT_QUARTERLY_BONUS'] || []).concat([{
      bonus_id: 'BONUS-' + periodValue, event_type: 'PERIOD_COMMIT', quarter_period_id: periodValue,
      idempotency_key: 'PERIOD_COMMIT|QUARTER|' + periodValue, timestamp: timestamp
    }]);
  }

  test('commit is BLOCKED when a dangling correction exists: original quarter already committed before the resubmit', () => {
    setQuarterFixture('Q2', SAMPLE_ROWS_Q1);
    seedReassignPair({
      queueId: 'D1', actorCode: 'PHD1', hours: 6,
      voidPeriodId: '2026-03', resubmitPeriodId: '2026-04',
      voidTimestamp: '2026-04-15T00:00:00.000Z', resubmitTimestamp: '2026-04-15T00:00:00.000Z'
    });
    seedCommitMarker('2026-Q1', '2026-04-01T00:00:00.000Z'); // Q1 committed BEFORE the 04-15 correction

    const preview = previewBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q2', Q2_CLOSE);
    expect(() => commitBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q2', preview.runId, Q2_CLOSE))
      .toThrow(/dangling|PHD1/i);
  });

  test('preview SURFACES the dangling correction without throwing — dry-run stays informational', () => {
    setQuarterFixture('Q2', SAMPLE_ROWS_Q1);
    seedReassignPair({
      queueId: 'D2', actorCode: 'PHD1', hours: 6,
      voidPeriodId: '2026-03', resubmitPeriodId: '2026-04',
      voidTimestamp: '2026-04-15T00:00:00.000Z', resubmitTimestamp: '2026-04-15T00:00:00.000Z'
    });
    seedCommitMarker('2026-Q1', '2026-04-01T00:00:00.000Z');

    const preview = previewBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q2', Q2_CLOSE);
    expect(preview.danglingCorrections).toHaveLength(1);
    expect(preview.danglingCorrections[0].actorCode).toBe('PHD1');
    expect(preview.rows).toEqual(SAMPLE_ROWS_Q1); // preview still returns the computable rows
  });

  test('commit SUCCEEDS normally once the dangling correction is resolved (original quarter not committed yet)', () => {
    setQuarterFixture('Q2', SAMPLE_ROWS_Q1);
    seedReassignPair({
      queueId: 'D3', actorCode: 'PHD1', hours: 6,
      voidPeriodId: '2026-03', resubmitPeriodId: '2026-04',
      voidTimestamp: '2026-04-15T00:00:00.000Z', resubmitTimestamp: '2026-04-15T00:00:00.000Z'
    });
    // No PERIOD_COMMIT marker for 2026-Q1 — still open, nothing dangling.

    const preview = previewBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q2', Q2_CLOSE);
    expect(preview.danglingCorrections).toHaveLength(0);
    const commit = commitBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q2', preview.runId, Q2_CLOSE);
    expect(commit.committed).toBe(true);
  });

  test('a resubmit landing in the SAME quarter as its original (common case) does not block the commit', () => {
    setQuarterFixture('Q2', SAMPLE_ROWS_Q1);
    seedReassignPair({
      queueId: 'D4', actorCode: 'PHD1', hours: 6,
      voidPeriodId: '2026-04', resubmitPeriodId: '2026-05', // different months, SAME quarter (Q2)
      voidTimestamp: '2026-05-01T00:00:00.000Z', resubmitTimestamp: '2026-05-01T00:00:00.000Z'
    });

    const preview = previewBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q2', Q2_CLOSE);
    expect(preview.danglingCorrections).toHaveLength(0);
    const commit = commitBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q2', preview.runId, Q2_CLOSE);
    expect(commit.committed).toBe(true);
  });

  test('multiple dangling corrections in the same quarter are ALL named in the block message, not just the first', () => {
    setQuarterFixture('Q2', SAMPLE_ROWS_Q1);
    seedReassignPair({
      queueId: 'D5', actorCode: 'PHD1', hours: 6,
      voidPeriodId: '2026-03', resubmitPeriodId: '2026-04',
      voidTimestamp: '2026-04-15T00:00:00.000Z', resubmitTimestamp: '2026-04-15T00:00:00.000Z'
    });
    seedReassignPair({
      queueId: 'D6', actorCode: 'PHD2', hours: 3,
      voidPeriodId: '2026-02', resubmitPeriodId: '2026-04',
      voidTimestamp: '2026-04-16T00:00:00.000Z', resubmitTimestamp: '2026-04-16T00:00:00.000Z'
    });
    seedCommitMarker('2026-Q1', '2026-04-01T00:00:00.000Z');

    const preview = previewBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q2', Q2_CLOSE);
    expect(preview.danglingCorrections).toHaveLength(2);

    let blockMessage = '';
    try {
      commitBonusForPeriod('ceo@test.blc.internal', 'QUARTER', '2026-Q2', preview.runId, Q2_CLOSE);
    } catch (e) {
      blockMessage = e.message;
    }
    expect(blockMessage).toEqual(expect.stringContaining('PHD1'));
    expect(blockMessage).toEqual(expect.stringContaining('PHD2'));
  });
});
