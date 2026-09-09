/**
 * payroll-engine-supervisor-bonus-by-account.test.js
 *
 * Tests for PayrollEngine.buildSupervisorBonusMapByAccount_() — the
 * account-scoped rewrite of buildSupervisorBonusMap_ (2026-09-08 design
 * spec §4.4). NOT wired into runBonusRun/previewPayoutStatement by this
 * task — see the design spec §7 for why (cutover requires a real-data
 * backfill of REF_ACCOUNT_SUPERVISION first, a separate later task).
 *
 * Covers all four concrete test cases from the design spec §5:
 *   1. Deb Sen -> Priyanka S, Alberta Truss
 *   2. Bharath, two accounts, two teams
 *   3. An account with no assigned Team Lead, defaulted to the PM (Sarty)
 *      -- role-based skip rule, no double-pay (spec §4.5)
 *   4. A genuinely unassigned pair -- blocked, not silently mis-credited
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
  mocks.Config.TABLES.REF_ACCOUNT_SUPERVISION = 'REF_ACCOUNT_SUPERVISION';
  mocks.Config.TABLES.VW_JOB_CURRENT_STATE    = 'VW_JOB_CURRENT_STATE';
  mocks.Config.TABLES.FACT_WORK_LOGS          = 'FACT_WORK_LOGS';
  mocks.Config.TABLES.FACT_PAYROLL_LEDGER     = 'FACT_PAYROLL_LEDGER';
  mocks.Config.TABLES.DIM_FX_RATES            = 'DIM_FX_RATES';
  loadSrc('../src/06-handlers/WorkLogAggregation.gs');
  loadSrc('../src/10-payroll/PayrollEngine.gs');
});

function staff(overrides) {
  return Object.assign({ role: 'DESIGNER' }, overrides);
}

function seedSupervision(rows) {
  mocks.store['REF_ACCOUNT_SUPERVISION'] = rows.map(r => Object.assign({
    effective_from: '2024-01-01', effective_to: ''
  }, r));
}

describe('PayrollEngine.buildSupervisorBonusMapByAccount_()', () => {
  test('Deb Sen -> Priyanka S, Alberta Truss: credits Deb Sen, not Pabitra, for her Alberta Truss hours', () => {
    seedSupervision([
      { client_code: 'ALBERTA TRUSS', designer_code: 'PRS', supervisor_code: 'DBS' }
    ]);
    const staffCache = {
      DBS: staff({ role: 'TEAM_LEAD' }),
      PBG: staff({ role: 'TEAM_LEAD' }),
      PRS: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      PRS: { 'ALBERTA TRUSS': { design_hours: 95.25, qc_hours: 0 } }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    expect(result.bonusMap.DBS).toBe(2381.25); // 95.25 x 25
    expect(result.bonusMap.PBG).toBeUndefined();
    expect(result.blockedPairs).toEqual([]);
  });

  test('Bharath, two accounts, two teams: each account\'s hours attribute to the right lead independently', () => {
    seedSupervision([
      { client_code: 'SBS',     designer_code: 'RKG', supervisor_code: 'BCH' },
      { client_code: 'NORSPAN', designer_code: 'ABB', supervisor_code: 'BCH' }
    ]);
    const staffCache = {
      BCH: staff({ role: 'TEAM_LEAD' }),
      RKG: staff({ role: 'DESIGNER' }),
      ABB: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      RKG: { SBS: { design_hours: 10, qc_hours: 0 } },
      ABB: { NORSPAN: { design_hours: 20, qc_hours: 0 } }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    // Both accounts' hours (10 + 20 = 30) roll up to the same person, Bharath.
    expect(result.bonusMap.BCH).toBe(750); // 30 x 25
  });

  test('an account defaulted to the PM (no real Team Lead): no double-pay, since PM already gets these hours via buildPmBonusMap_', () => {
    seedSupervision([
      { client_code: 'SOME SMALL ACCOUNT', designer_code: 'BIT', supervisor_code: 'SGO' } // SGO = Sarty, role PM
    ]);
    const staffCache = {
      SGO: staff({ role: 'PM' }),
      BIT: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      BIT: { 'SOME SMALL ACCOUNT': { design_hours: 12, qc_hours: 0 } }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    // No TL-bonus entry for Sarty — his role is PM, not TEAM_LEAD. The
    // pair is NOT blocked (an assignment row exists), it just produces no
    // TL-bonus credit, per the role-based skip rule (spec §4.5).
    expect(result.bonusMap.SGO).toBeUndefined();
    expect(result.blockedPairs).toEqual([]);
  });

  test('a genuinely unassigned pair is blocked, not silently mis-credited or dropped', () => {
    seedSupervision([]); // nothing assigned at all
    const staffCache = {
      PRS: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      PRS: { 'BRAND NEW ACCOUNT': { design_hours: 8, qc_hours: 0 } }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    expect(result.bonusMap).toEqual({});
    expect(result.blockedPairs).toEqual([
      { client_code: 'BRAND NEW ACCOUNT', designer_code: 'PRS', hours: 8 }
    ]);
  });

  test('one blocked pair does not affect a different, correctly-assigned pair in the same run', () => {
    seedSupervision([
      { client_code: 'ALBERTA TRUSS', designer_code: 'PRS', supervisor_code: 'DBS' }
    ]);
    const staffCache = {
      DBS: staff({ role: 'TEAM_LEAD' }),
      PRS: staff({ role: 'DESIGNER' }),
      RKG: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      PRS: { 'ALBERTA TRUSS': { design_hours: 10, qc_hours: 0 } },
      RKG: { 'UNASSIGNED ACCOUNT': { design_hours: 5, qc_hours: 0 } }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    expect(result.bonusMap.DBS).toBe(250); // PRS's pair still computed normally
    expect(result.blockedPairs).toEqual([
      { client_code: 'UNASSIGNED ACCOUNT', designer_code: 'RKG', hours: 5 }
    ]);
  });

  test('resolves the supervisor as of asOfDate, not today — a later reassignment must not retroactively change a past period\'s attribution', () => {
    seedSupervision([
      { client_code: 'ALBERTA TRUSS', designer_code: 'PRS', supervisor_code: 'PBG', effective_from: '2024-01-01', effective_to: '2026-08-31' },
      { client_code: 'ALBERTA TRUSS', designer_code: 'PRS', supervisor_code: 'DBS', effective_from: '2026-09-01', effective_to: '' }
    ]);
    const staffCache = {
      PBG: staff({ role: 'TEAM_LEAD' }),
      DBS: staff({ role: 'TEAM_LEAD' }),
      PRS: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      PRS: { 'ALBERTA TRUSS': { design_hours: 10, qc_hours: 0 } }
    };

    // A payroll run for AUGUST (asOfDate 2026-08-01) must still credit
    // PBG, the lead who was actually assigned during that period.
    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-08-01');

    expect(result.bonusMap.PBG).toBe(250);
    expect(result.bonusMap.DBS).toBeUndefined();
  });

  test('only credits a resolved supervisor whose role is literally TEAM_LEAD — a DESIGNER accidentally assigned as supervisor produces no bonus, not a crash', () => {
    seedSupervision([
      { client_code: 'SBS', designer_code: 'BIT', supervisor_code: 'RKG' } // RKG is a DESIGNER, not a lead
    ]);
    const staffCache = {
      RKG: staff({ role: 'DESIGNER' }),
      BIT: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      BIT: { SBS: { design_hours: 6, qc_hours: 0 } }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    expect(result.bonusMap.RKG).toBeUndefined();
    expect(result.blockedPairs).toEqual([]); // an assignment row DOES exist — not "unassigned"
  });

  test('throws if more than one REF_ACCOUNT_SUPERVISION row resolves as valid for the same pair as of asOfDate (data corruption, e.g. a manual sheet edit bypassing assignAccountSupervisor) — same "refuse to silently pick one" convention as buildStaffCache_', () => {
    seedSupervision([
      { client_code: 'SBS', designer_code: 'BIT', supervisor_code: 'BCH', effective_from: '2024-01-01', effective_to: '' },
      { client_code: 'SBS', designer_code: 'BIT', supervisor_code: 'SDA', effective_from: '2025-01-01', effective_to: '' }
    ]);
    const staffCache = {
      BCH: staff({ role: 'TEAM_LEAD' }),
      SDA: staff({ role: 'TEAM_LEAD' }),
      BIT: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      BIT: { SBS: { design_hours: 6, qc_hours: 0 } }
    };

    expect(() => PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01'))
      .toThrow(/SBS\/BIT/);
  });

  test('a supervisor_code in REF_ACCOUNT_SUPERVISION not found in staffCache (e.g. typo or inactive person) is logged as SUPERVISOR_BONUS_UNRESOLVED_SUPERVISOR and blocked, not silently skipped with no visibility', () => {
    seedSupervision([
      { client_code: 'ACME CORP', designer_code: 'PRS', supervisor_code: 'NONEXISTENT' }
    ]);
    const staffCache = {
      PRS: staff({ role: 'DESIGNER' })
      // NONEXISTENT not in staffCache — simulates typo or inactive person
    };
    const hoursMapByAccount = {
      PRS: { 'ACME CORP': { design_hours: 20, qc_hours: 0 } }
    };

    const logWarns = [];
    mocks.Logger.warn = (eventName, payload) => {
      logWarns.push({ eventName, payload });
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    // Should log a warning with distinct event name
    expect(logWarns.length).toBe(1);
    expect(logWarns[0].eventName).toBe('SUPERVISOR_BONUS_UNRESOLVED_SUPERVISOR');
    expect(logWarns[0].payload.supervisor_code).toBe('NONEXISTENT');
    expect(logWarns[0].payload.client_code).toBe('ACME CORP');
    expect(logWarns[0].payload.designer_code).toBe('PRS');
    expect(logWarns[0].payload.hours).toBe(20);

    // Should be in blockedPairs so it's visible in the same place a human reviews
    expect(result.blockedPairs).toEqual([
      { client_code: 'ACME CORP', designer_code: 'PRS', hours: 20 }
    ]);

    // Should NOT have a bonusMap entry for the nonexistent supervisor
    expect(result.bonusMap.NONEXISTENT).toBeUndefined();
  });

  test('a supervisor with only very-small-hours pairs that round to zero is filtered out (no non-positive entries in bonusMap)', () => {
    seedSupervision([
      { client_code: 'TINY ACCOUNT 1', designer_code: 'PRS', supervisor_code: 'DBS' },
      { client_code: 'TINY ACCOUNT 2', designer_code: 'PRS', supervisor_code: 'DBS' }
    ]);
    const staffCache = {
      DBS: staff({ role: 'TEAM_LEAD' }),
      PRS: staff({ role: 'DESIGNER' })
    };
    // Two tiny pairs: each 0.00001 hours × 25 = 0.00025, which rounds to 0 after *100/100
    // The per-pair guard at line 408 allows these through (0.00001 is truthy), but accumulation
    // + rounding produces a zero-value bonusMap entry. The final filter should remove it.
    const hoursMapByAccount = {
      PRS: {
        'TINY ACCOUNT 1': { design_hours: 0.00001, qc_hours: 0 },
        'TINY ACCOUNT 2': { design_hours: 0.00001, qc_hours: 0 }
      }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    // The bonusMap entry for DBS should either not exist, or if it does exist,
    // it should NOT be zero. The fix adds a final filter to ensure
    // no non-positive values remain in bonusMap.
    expect(result.bonusMap.DBS).toBeUndefined();
    expect(result.blockedPairs).toEqual([]); // pairs are not blocked, just filtered out
  });
});
