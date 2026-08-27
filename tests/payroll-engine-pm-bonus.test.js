/**
 * payroll-engine-pm-bonus.test.js
 *
 * Tests for PayrollEngine.gs's PM bonus split (Phase B1, Item 3 —
 * payroll automation). Per PAYROLL_AUTOMATION_ARCHITECTURE.md §2.3
 * (decision already made, not re-litigated here): the PM bonus rule
 * becomes a SEPARATE, flat, roster-wide sum — INR 25 × Σ(design_hours
 * of every staff member whose role !== 'PM') — architecturally
 * distinct from the TL path (direct-report sum via supervisor_code).
 * NOT recursive, NOT a tree walk, and specifically NOT scoped by the
 * pm_code field the way the old, now-removed PM branch of
 * buildSupervisorBonusMap_ was.
 *
 * buildSupervisorBonusMap_ (TL-only after this change) and the new
 * buildPmBonusMap_ are both exposed on the public API, same precedent
 * as buildStaffCache_ (see PayrollEngine.gs's own comment at the
 * bottom of its public return object) — this suite tests the real
 * functions runBonusRun() actually uses, not a reimplementation.
 */

const fs   = require('fs');
const path = require('path');
const { installV3StaffMocks } = require('./gas-v3-staff-mocks');

function loadSrc(relPath) {
  (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
}

let mocks;

beforeEach(() => {
  mocks = installV3StaffMocks();
  mocks.Config.TABLES.FACT_WORK_LOGS      = 'FACT_WORK_LOGS';
  mocks.Config.TABLES.FACT_PAYROLL_LEDGER = 'FACT_PAYROLL_LEDGER';
  mocks.Config.TABLES.MART_PAYROLL_SUMMARY = 'MART_PAYROLL_SUMMARY';
  mocks.Config.TABLES.DIM_FX_RATES        = 'DIM_FX_RATES';
  // runBonusRun() calls HealthMonitor.start/endExecution + isApproachingLimit —
  // out of gas-v3-staff-mocks.js's scope (Task 2 never needed it).
  global.HealthMonitor = {
    startExecution: function () {}, endExecution: function () {}, isApproachingLimit: function () { return false; }
  };
  global.MailApp = { sendEmail: jest.fn() };
  global.PropertiesService = {
    getScriptProperties: function () { return { getProperty: function () { return null; } }; }
  };
  mocks.DAL.ensurePartition = function () {}; // no-op — this mock has no real partition concept
  mocks.DAL.appendRows = function (t, rows) { rows.forEach(function (r) { mocks.DAL.appendRow(t, r); }); };
  // aggregateHours_() delegates to the shared aggregateNetWorkLogHours(),
  // which lives in WorkLogAggregation.gs (depends on WorkLogExclusion.gs,
  // which depends on Constants.gs's EVENT_TYPES) — needed for the
  // runBonusRun() integration test below to exercise the real
  // aggregation path, not a reimplementation.
  loadSrc('../src/00-foundation/Constants.gs');
  loadSrc('../src/06-handlers/WorkLogExclusion.gs');
  loadSrc('../src/06-handlers/WorkLogAggregation.gs');
  loadSrc('../src/10-payroll/PayrollEngine.gs');
});

function staff(overrides) {
  return Object.assign({
    role: 'DESIGNER', supervisor_code: '', pm_code: '', bonus_eligible: false
  }, overrides);
}

function hours(designHours, qcHours) {
  return { design_hours: designHours || 0, qc_hours: qcHours || 0 };
}

describe('PayrollEngine.buildPmBonusMap_() — flat, roster-wide, non-recursive', () => {
  test('PM is credited on ALL non-PM design hours company-wide, regardless of pm_code', () => {
    // Deliberately NOT setting pm_code on anyone — the old PM branch of
    // buildSupervisorBonusMap_ required pm_code === PM's code to count
    // a person; the new flat rule has no such dependency at all.
    var staffCache = {
      PM1: staff({ role: 'PM' }),
      TL1: staff({ role: 'TEAM_LEAD' }),
      DES1: staff({ role: 'DESIGNER' }),
      DES2: staff({ role: 'DESIGNER' }),
      QC1: staff({ role: 'QC' })
    };
    var hoursMap = {
      TL1: hours(5),
      DES1: hours(10),
      DES2: hours(7),
      QC1: hours(3)
    };

    var bonusMap = PayrollEngine.buildPmBonusMap_(staffCache, hoursMap);

    // 5 + 10 + 7 + 3 = 25 non-PM design hours × INR 25/hr = INR 625
    expect(bonusMap.PM1).toBe(625);
  });

  test('excludes the PM\'s own design hours from their own bonus', () => {
    var staffCache = {
      PM1: staff({ role: 'PM' }),
      DES1: staff({ role: 'DESIGNER' })
    };
    var hoursMap = {
      PM1: hours(20),  // PM personally logged design hours
      DES1: hours(10)
    };

    var bonusMap = PayrollEngine.buildPmBonusMap_(staffCache, hoursMap);

    // Only DES1's 10 hours count, not PM1's own 20.
    expect(bonusMap.PM1).toBe(250);
  });

  test('only counts design_hours, never qc_hours', () => {
    var staffCache = {
      PM1: staff({ role: 'PM' }),
      QC1: staff({ role: 'QC' })
    };
    var hoursMap = { QC1: hours(4, 100) }; // 4 design hrs, 100 QC hrs

    var bonusMap = PayrollEngine.buildPmBonusMap_(staffCache, hoursMap);

    expect(bonusMap.PM1).toBe(100); // 4 × 25, not 104 × 25
  });

  test('a PM with zero non-PM design hours is excluded from the returned map entirely', () => {
    var staffCache = { PM1: staff({ role: 'PM' }) };
    var hoursMap = {};

    var bonusMap = PayrollEngine.buildPmBonusMap_(staffCache, hoursMap);

    expect(bonusMap.PM1).toBeUndefined();
  });

  test('multiple PMs are each credited the IDENTICAL company-wide total — a real, documented consequence of "flat", not a bug', () => {
    var staffCache = {
      PM1: staff({ role: 'PM' }),
      PM2: staff({ role: 'PM' }),
      DES1: staff({ role: 'DESIGNER' })
    };
    var hoursMap = { DES1: hours(8) };

    var bonusMap = PayrollEngine.buildPmBonusMap_(staffCache, hoursMap);

    expect(bonusMap.PM1).toBe(200); // 8 × 25
    expect(bonusMap.PM2).toBe(200); // same total, not split or divided
  });

  test('non-PM, non-DESIGNER, non-TEAM_LEAD roles (e.g. ADMIN) are never given a bonus entry', () => {
    var staffCache = {
      PM1: staff({ role: 'PM' }),
      ADMIN1: staff({ role: 'ADMIN' })
    };
    var hoursMap = { ADMIN1: hours(5) };

    var bonusMap = PayrollEngine.buildPmBonusMap_(staffCache, hoursMap);

    expect(bonusMap.ADMIN1).toBeUndefined();
    // ADMIN1's hours still count toward PM1's total, though — "every
    // non-PM design hour" includes ADMIN role rows too, per the flat
    // rule as specified (role !== 'PM' is the only exclusion).
    expect(bonusMap.PM1).toBe(125);
  });
});

describe('PayrollEngine.buildSupervisorBonusMap_() — now TL-only, unchanged direct-report logic', () => {
  test('still computes TL bonus from direct reports only (supervisor_code match)', () => {
    var staffCache = {
      TL1: staff({ role: 'TEAM_LEAD' }),
      DES1: staff({ role: 'DESIGNER', supervisor_code: 'TL1' }),
      DES2: staff({ role: 'DESIGNER', supervisor_code: 'OTHER_TL' }) // not TL1's report
    };
    var hoursMap = { DES1: hours(6), DES2: hours(100) };

    var bonusMap = PayrollEngine.buildSupervisorBonusMap_(staffCache, hoursMap);

    expect(bonusMap.TL1).toBe(150); // only DES1's 6 hrs × 25, DES2 excluded
  });

  test('no longer returns a PM entry at all — that logic moved to buildPmBonusMap_', () => {
    var staffCache = {
      PM1: staff({ role: 'PM' }),
      DES1: staff({ role: 'DESIGNER', pm_code: 'PM1' })
    };
    var hoursMap = { DES1: hours(10) };

    var bonusMap = PayrollEngine.buildSupervisorBonusMap_(staffCache, hoursMap);

    expect(bonusMap.PM1).toBeUndefined();
  });
});

describe('PayrollEngine.runBonusRun() — TL and PM bonuses both written, no double-counting concern', () => {
  function seedRoster(rows) {
    mocks.store['DIM_STAFF_ROSTER'] = rows.map(r => Object.assign({
      person_code: '', name: '', email: '', role: 'DESIGNER',
      supervisor_code: '', pm_code: '', pay_currency: 'INR',
      pay_design: 0, pay_qc: 0, bonus_eligible: 'FALSE',
      active: 'TRUE', effective_from: '2025-01-01', effective_to: ''
    }, r));
  }

  function seedWorkLogs(periodId, rows) {
    // gas-v3-staff-mocks.js's DAL.readAll keys purely by table name and
    // ignores the { periodId } opts argument (it doesn't model partitions)
    // — same simplification every other test using this harness relies on.
    mocks.store['FACT_WORK_LOGS'] = rows;
  }

  test('a TL who is also being counted under a PM gets both bonuses written, same designer hours counted for each — intentional, not a bug', () => {
    seedRoster([
      { person_code: 'PM1', role: 'PM', email: 'pm1@test.blc.internal' },
      { person_code: 'TL1', role: 'TEAM_LEAD', pm_code: 'PM1', email: 'tl1@test.blc.internal' },
      { person_code: 'DES1', role: 'DESIGNER', supervisor_code: 'TL1', pm_code: 'PM1', email: 'des1@test.blc.internal' }
    ]);
    seedWorkLogs('2026-08', [
      { event_id: 'E1', person_code: 'DES1', actor_code: 'DES1', actor_role: 'DESIGNER',
        event_type: 'WORK_LOG_SUBMITTED', hours: 10, work_date: '2026-08-05', period_id: '2026-08' }
    ]);

    var result = PayrollEngine.runBonusRun('ceo@test.blc.internal', { periodId: '2026-08' });

    expect(result.processed).toBe(2); // both TL1 and PM1 got a bonus row
    var bySupervisor = {};
    result.by_supervisor.forEach(function (s) { bySupervisor[s.person_code] = s.bonus_amount; });
    expect(bySupervisor.TL1).toBe(250); // 10 hrs × 25 (direct report)
    expect(bySupervisor.PM1).toBe(250); // same 10 hrs × 25 (flat roster-wide, no pm_code dependency now)
  });

  test('a successful bonus commit sends exactly one HR summary email covering only supervisor bonus', () => {
    seedRoster([
      { person_code: 'TL1', role: 'TEAM_LEAD', email: 'tl1@test.blc.internal' },
      { person_code: 'DES1', role: 'DESIGNER', supervisor_code: 'TL1', email: 'des1@test.blc.internal' }
    ]);
    seedWorkLogs('2026-08', [
      { event_id: 'E1', person_code: 'DES1', actor_code: 'DES1', actor_role: 'DESIGNER',
        event_type: 'WORK_LOG_SUBMITTED', hours: 8, work_date: '2026-08-05', period_id: '2026-08' }
    ]);

    PayrollEngine.runBonusRun('ceo@test.blc.internal', { periodId: '2026-08' });

    // 1 per-supervisor bonus email (sendBonusEmail_) + 1 HR summary = 2.
    expect(MailApp.sendEmail).toHaveBeenCalledTimes(2);
    var hrCall = MailApp.sendEmail.mock.calls.find(c => c[0].subject.indexOf('Payout Statement Summary') !== -1);
    expect(hrCall[0].body).toContain('SUPERVISOR BONUS');
    expect(hrCall[0].body).not.toContain('BASE PAY');
  });

  test('a fully-idempotent re-run (bonus already written) does NOT send a second HR summary', () => {
    seedRoster([
      { person_code: 'TL1', role: 'TEAM_LEAD', email: 'tl1@test.blc.internal' },
      { person_code: 'DES1', role: 'DESIGNER', supervisor_code: 'TL1', email: 'des1@test.blc.internal' }
    ]);
    seedWorkLogs('2026-08', [
      { event_id: 'E1', person_code: 'DES1', actor_code: 'DES1', actor_role: 'DESIGNER',
        event_type: 'WORK_LOG_SUBMITTED', hours: 8, work_date: '2026-08-05', period_id: '2026-08' }
    ]);

    var first = PayrollEngine.runBonusRun('ceo@test.blc.internal', { periodId: '2026-08' });
    expect(first.processed).toBe(1);
    var firstCallCount = MailApp.sendEmail.mock.calls.length; // 1 bonus email + 1 HR summary = 2

    MailApp.sendEmail.mockClear();

    var second = PayrollEngine.runBonusRun('ceo@test.blc.internal', { periodId: '2026-08' });

    expect(second.processed).toBe(0); // TL1 already has a PAYROLL_BONUS|TL1|2026-08 row — skipped
    expect(MailApp.sendEmail).toHaveBeenCalledTimes(0);
    expect(firstCallCount).toBe(2);
  });
});
