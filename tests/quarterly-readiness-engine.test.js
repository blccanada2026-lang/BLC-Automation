/**
 * quarterly-readiness-engine.test.js
 *
 * Tests for QuarterlyReadinessEngine.gs (2026-09-15) — the portal-run
 * "is this quarter ready for a bonus run" check that bundles ratings
 * completeness (via the REAL QuarterlyBonusEngine.getInternalRatings_),
 * a rework-cycle-backfill dry-run preview (via the generalized
 * reworkCycleBackfillCore_), and period_id integrity checks for both
 * FACT_PERFORMANCE_RATINGS and FACT_QUARTERLY_BONUS, plus the one
 * separate write action (applyReworkCycleBackfill).
 *
 * Loads the real QuarterlyBonusEngine.gs alongside it (not mocked) —
 * this suite is specifically testing that the readiness check reuses
 * the real ratings/backfill logic, not a reimplementation.
 */

const fs   = require('fs');
const path = require('path');
const { installV3Mocks } = require('./gas-v3-mocks');

function loadSrc(relPath) {
  (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
}

let mocks;

beforeEach(() => {
  mocks = installV3Mocks();
  mocks.Config.TABLES.FACT_PERFORMANCE_RATINGS = 'FACT_PERFORMANCE_RATINGS';
  mocks.Config.TABLES.FACT_QC_EVENTS           = 'FACT_QC_EVENTS';
  mocks.Config.TABLES.VW_JOB_CURRENT_STATE     = 'VW_JOB_CURRENT_STATE';
  mocks.Config.TABLES.DIM_STAFF_ROSTER         = 'DIM_STAFF_ROSTER';
  // ClientFeedback is a separate, large module (FormApp-dependent) — mocked
  // at the boundary rather than loaded, same thin-wrapper precedent as the
  // Portal.gs tests. Default: no responses for any month; tests override
  // per-call via feedbackStatusByMonth.
  global.ClientFeedback = {
    getFeedbackStatus: jest.fn(function (actorEmail, periodId) {
      return { period_id: periodId, quarter: '', responses_received: 0, per_designer: [] };
    })
  };
  loadSrc('../src/10-payroll/QuarterlyBonusEngine.gs');
  loadSrc('../src/12-migration/QuarterlyReadinessEngine.gs');
});

function mockFeedbackByMonth(byPeriod) {
  global.ClientFeedback.getFeedbackStatus = jest.fn(function (actorEmail, periodId) {
    var responses = byPeriod[periodId] || 0;
    return { period_id: periodId, quarter: '', responses_received: responses, per_designer: [] };
  });
}

function seedRoster(rows) {
  mocks.store['DIM_STAFF_ROSTER'] = rows.map(r => Object.assign({
    person_code: '', name: '', email: '', role: 'DESIGNER',
    supervisor_code: '', pm_code: '', active: 'TRUE',
    effective_from: '2025-01-01', effective_to: ''
  }, r));
}

function ratingRow(overrides) {
  return Object.assign({
    rating_id: 'R-' + Math.random(), period_id: '2026-Q2',
    ratee_code: '', rater_code: '', rater_role: 'TEAM_LEAD',
    avg_score_normalized: 80, submitted_at: '2026-06-15T00:00:00.000Z'
  }, overrides);
}

describe('QuarterlyReadinessEngine.runQuarterlyReadinessCheck', () => {
  test('happy path — bundles ratings completeness, client feedback, rework preview, and period_id integrity into one report', () => {
    seedRoster([
      { person_code: 'DS1', name: 'Designer One', role: 'DESIGNER' },
      { person_code: 'DS2', name: 'Designer Two', role: 'DESIGNER' },
      { person_code: 'TL1', name: 'Team Lead One', role: 'TEAM_LEAD' }
    ]);
    mocks.store['FACT_PERFORMANCE_RATINGS|2026-Q2'] = [
      ratingRow({ ratee_code: 'DS1', rater_code: 'TL1', rater_role: 'TEAM_LEAD' })
      // DS2 has no rating at all; TL1 has no CEO rating — both PENDING/missing
    ];
    mockFeedbackByMonth({ '2026-04': 3, '2026-05': 0, '2026-06': 2 });
    mocks.store['FACT_QC_EVENTS|2026-04'] = [
      { event_type: 'QC_MAJOR_REWORK', job_number: 'BLC-100', timestamp: '2026-04-15T10:00:00.000Z' }
    ];
    mocks.store['VW_JOB_CURRENT_STATE'] = [
      { job_number: 'BLC-100', allocated_to: 'DS1', rework_cycle: '', current_state: 'IN_PROGRESS' }
    ];

    const report = QuarterlyReadinessEngine.runQuarterlyReadinessCheck('ceo@test.blc.internal', 'Q2', 2026);

    expect(report.period_id).toBe('2026-Q2');
    expect(report.ratings.staff_total).toBe(3);
    expect(report.ratings.staff_confirmed).toBe(1); // only DS1
    expect(report.ratings.staff_missing.map(m => m.code).sort()).toEqual(['DS2', 'TL1']);

    expect(report.client_feedback.total_responses).toBe(5);
    expect(report.client_feedback.by_month.map(m => m.period_id)).toEqual(['2026-04', '2026-05', '2026-06']);
    expect(ClientFeedback.getFeedbackStatus).toHaveBeenCalledWith('ceo@test.blc.internal', '2026-04');
    expect(ClientFeedback.getFeedbackStatus).toHaveBeenCalledWith('ceo@test.blc.internal', '2026-05');
    expect(ClientFeedback.getFeedbackStatus).toHaveBeenCalledWith('ceo@test.blc.internal', '2026-06');

    expect(report.rework_backfill.dryRun).toBe(true);
    expect(report.rework_backfill.affected).toBe(1);
    expect(report.rework_backfill.updated).toBe(1);
    // Dry run — nothing actually written.
    expect(mocks.store['VW_JOB_CURRENT_STATE'][0].rework_cycle).toBe('');

    expect(report.period_id_integrity.ratings.corruptedCount).toBe(0);
    expect(report.period_id_integrity.ledger.corruptedCount).toBe(0);
  });

  test('client feedback totals zero across all three months when nothing has come in', () => {
    seedRoster([]);
    // Default mock (installed in beforeEach) returns 0 for every month.
    const report = QuarterlyReadinessEngine.runQuarterlyReadinessCheck('ceo@test.blc.internal', 'Q2', 2026);

    expect(report.client_feedback.total_responses).toBe(0);
    expect(report.client_feedback.by_month).toHaveLength(3);
    report.client_feedback.by_month.forEach(m => expect(m.responses_received).toBe(0));
  });

  test('reports zero rework jobs and full confirmation when everything is clean', () => {
    seedRoster([{ person_code: 'DS1', name: 'Designer One', role: 'DESIGNER' }]);
    mocks.store['FACT_PERFORMANCE_RATINGS|2026-Q2'] = [
      ratingRow({ ratee_code: 'DS1', rater_code: 'PM1', rater_role: 'PM' })
    ];

    const report = QuarterlyReadinessEngine.runQuarterlyReadinessCheck('ceo@test.blc.internal', 'Q2', 2026);

    expect(report.ratings.staff_confirmed).toBe(1);
    expect(report.ratings.staff_total).toBe(1);
    expect(report.rework_backfill.affected).toBe(0);
  });

  test('excludes inactive staff from the ratings-completeness count', () => {
    seedRoster([
      { person_code: 'DS1', name: 'Active', role: 'DESIGNER', active: 'TRUE' },
      { person_code: 'DS9', name: 'Inactive', role: 'DESIGNER', active: 'FALSE' }
    ]);
    mocks.store['FACT_PERFORMANCE_RATINGS|2026-Q2'] = [
      ratingRow({ ratee_code: 'DS1', rater_code: 'TL1', rater_role: 'TEAM_LEAD' })
    ];

    const report = QuarterlyReadinessEngine.runQuarterlyReadinessCheck('ceo@test.blc.internal', 'Q2', 2026);

    expect(report.ratings.staff_total).toBe(1);
    expect(report.ratings.staff_missing).toEqual([]);
  });

  test('flags a Date-coerced period_id as corrupted', () => {
    seedRoster([]);
    mocks.store['FACT_PERFORMANCE_RATINGS|2026-Q2'] = [];
    // Seed directly under the flat (non-partitioned) key the coercion
    // check reads from — a corrupted row whose period_id was coerced to
    // a real Date object by Sheets, same mechanism as VW_JOB_CURRENT_STATE's
    // confirmed period_id drift.
    mocks.store['FACT_PERFORMANCE_RATINGS'] = [
      ratingRow({ ratee_code: 'DS1', period_id: new Date('2026-06-01') })
    ];

    const report = QuarterlyReadinessEngine.runQuarterlyReadinessCheck('ceo@test.blc.internal', 'Q2', 2026);

    expect(report.period_id_integrity.ratings.corruptedCount).toBe(1);
  });

  test('throws on an invalid quarter before touching any data', () => {
    seedRoster([{ person_code: 'DS1' }]);
    expect(() => QuarterlyReadinessEngine.runQuarterlyReadinessCheck('ceo@test.blc.internal', 'Q9', 2026))
      .toThrow(/quarter must be one of Q1-Q4/);
  });

  test('RBAC denial — enforcePermission throwing aborts before any read', () => {
    global.RBAC.enforcePermission = () => { throw new Error('PAYROLL_VIEW denied'); };
    expect(() => QuarterlyReadinessEngine.runQuarterlyReadinessCheck('nobody@test.blc.internal', 'Q2', 2026))
      .toThrow(/PAYROLL_VIEW denied/);
  });
});

describe('QuarterlyReadinessEngine.applyReworkCycleBackfill', () => {
  function seedReworkFixture() {
    mocks.store['FACT_QC_EVENTS|2026-04'] = [
      { event_type: 'QC_MAJOR_REWORK', job_number: 'BLC-100', timestamp: '2026-04-15T10:00:00.000Z' }
    ];
    mocks.store['VW_JOB_CURRENT_STATE'] = [
      { job_number: 'BLC-100', allocated_to: 'DS1', rework_cycle: '', current_state: 'IN_PROGRESS' }
    ];
  }

  test('writes for real — VW_JOB_CURRENT_STATE.rework_cycle is updated', () => {
    seedReworkFixture();
    const result = QuarterlyReadinessEngine.applyReworkCycleBackfill('ceo@test.blc.internal', 'Q2', 2026);

    expect(result.dryRun).toBe(false);
    expect(result.updated).toBe(1);
    expect(mocks.store['VW_JOB_CURRENT_STATE'][0].rework_cycle).toBe(1);
  });

  test('idempotent — re-running converges to the same value, no double-count', () => {
    seedReworkFixture();
    QuarterlyReadinessEngine.applyReworkCycleBackfill('ceo@test.blc.internal', 'Q2', 2026);
    const second = QuarterlyReadinessEngine.applyReworkCycleBackfill('ceo@test.blc.internal', 'Q2', 2026);

    expect(second.updated).toBe(1);
    expect(mocks.store['VW_JOB_CURRENT_STATE'][0].rework_cycle).toBe(1);
  });

  test('RBAC denial — non-financial actor is refused, nothing written', () => {
    seedReworkFixture();
    global.RBAC.enforceFinancialAccess = () => { throw new Error('FINANCIAL_ACCESS denied'); };

    expect(() => QuarterlyReadinessEngine.applyReworkCycleBackfill('hr@test.blc.internal', 'Q2', 2026))
      .toThrow(/FINANCIAL_ACCESS denied/);
    expect(mocks.store['VW_JOB_CURRENT_STATE'][0].rework_cycle).toBe('');
  });

  test('throws on a missing year before touching any data', () => {
    expect(() => QuarterlyReadinessEngine.applyReworkCycleBackfill('ceo@test.blc.internal', 'Q2', undefined))
      .toThrow(/quarter must be one of Q1-Q4/);
  });
});
