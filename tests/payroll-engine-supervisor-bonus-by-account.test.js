/**
 * payroll-engine-supervisor-bonus-by-account.test.js
 *
 * Tests for PayrollEngine.buildSupervisorBonusMapByAccount_() — the
 * product-scoped rewrite (2026-09-10 design spec §5) of the account-
 * scoped calc (2026-09-08 design spec §4.4). NOT wired into
 * runBonusRun/previewPayoutStatement by this task — see the 2026-09-08
 * design spec §7 and the 2026-09-10 spec §11 for why.
 *
 * hoursMapByAccount is now three levels deep:
 * { designerCode: { clientCode: { productCode: { design_hours, qc_hours } } } }
 * (previously two levels — see 2026-09-08 design spec's version of this
 * file for the pre-product-scoping shape).
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
    product_code: '', effective_from: '2024-01-01', effective_to: ''
  }, r));
}

describe('PayrollEngine.buildSupervisorBonusMapByAccount_()', () => {
  test('design_hours and qc_hours count equally toward the TL bonus pool (2026-09-13 rule: clients are billed the same for both)', () => {
    seedSupervision([
      { client_code: 'SBS', designer_code: 'RKG', supervisor_code: 'BCH' }
    ]);
    const staffCache = {
      BCH: staff({ role: 'TEAM_LEAD' }),
      RKG: staff({ role: 'QC_REVIEWER' }) // e.g. Rajkumar — a designer who is also a QC reviewer
    };
    const hoursMapByAccount = {
      RKG: { SBS: { 'ROOF_TRUSS': { design_hours: 10, qc_hours: 15 } } }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    expect(result.bonusMap.BCH).toBe(625); // (10 + 15) x 25, not 10 x 25
  });

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
      PRS: { 'ALBERTA TRUSS': { 'ROOF_TRUSS': { design_hours: 95.25, qc_hours: 0 } } }
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
      RKG: { SBS: { 'ROOF_TRUSS': { design_hours: 10, qc_hours: 0 } } },
      ABB: { NORSPAN: { 'ROOF_TRUSS': { design_hours: 20, qc_hours: 0 } } }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

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
      BIT: { 'SOME SMALL ACCOUNT': { 'ROOF_TRUSS': { design_hours: 12, qc_hours: 0 } } }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    expect(result.bonusMap.SGO).toBeUndefined();
    expect(result.blockedPairs).toEqual([]);
    expect(result.skippedNonTeamLead).toEqual([
      { client_code: 'SOME SMALL ACCOUNT', product_code: 'ROOF_TRUSS', designer_code: 'BIT', supervisor_code: 'SGO', role: 'PM', hours: 12 }
    ]);
  });

  test('a genuinely unassigned pair is blocked, not silently mis-credited or dropped', () => {
    seedSupervision([]);
    const staffCache = {
      PRS: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      PRS: { 'BRAND NEW ACCOUNT': { 'ROOF_TRUSS': { design_hours: 8, qc_hours: 0 } } }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    expect(result.bonusMap).toEqual({});
    expect(result.blockedPairs).toEqual([
      { client_code: 'BRAND NEW ACCOUNT', product_code: 'ROOF_TRUSS', designer_code: 'PRS', hours: 8 }
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
      PRS: { 'ALBERTA TRUSS': { 'ROOF_TRUSS': { design_hours: 10, qc_hours: 0 } } },
      RKG: { 'UNASSIGNED ACCOUNT': { 'ROOF_TRUSS': { design_hours: 5, qc_hours: 0 } } }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    expect(result.bonusMap.DBS).toBe(250);
    expect(result.blockedPairs).toEqual([
      { client_code: 'UNASSIGNED ACCOUNT', product_code: 'ROOF_TRUSS', designer_code: 'RKG', hours: 5 }
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
      PRS: { 'ALBERTA TRUSS': { 'ROOF_TRUSS': { design_hours: 10, qc_hours: 0 } } }
    };

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
      BIT: { SBS: { 'ROOF_TRUSS': { design_hours: 6, qc_hours: 0 } } }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    expect(result.bonusMap.RKG).toBeUndefined();
    expect(result.blockedPairs).toEqual([]); // an assignment row DOES exist — not "unassigned"
    expect(result.skippedNonTeamLead).toEqual([
      { client_code: 'SBS', product_code: 'ROOF_TRUSS', designer_code: 'BIT', supervisor_code: 'RKG', role: 'DESIGNER', hours: 6 }
    ]);
  });

  test('a PM-supervised pair is logged as SUPERVISOR_BONUS_NON_TEAM_LEAD_SKIP, surfaced in skippedNonTeamLead, and NOT gating — it never appears in blockedPairs', () => {
    seedSupervision([
      { client_code: 'SOME SMALL ACCOUNT', designer_code: 'BIT', supervisor_code: 'SGO' }
    ]);
    const staffCache = {
      SGO: staff({ role: 'PM' }),
      BIT: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      BIT: { 'SOME SMALL ACCOUNT': { 'ROOF_TRUSS': { design_hours: 12, qc_hours: 0 } } }
    };

    const logWarns = [];
    mocks.Logger.warn = (eventName, payload) => {
      logWarns.push({ eventName, payload });
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    expect(logWarns.length).toBe(1);
    expect(logWarns[0].eventName).toBe('SUPERVISOR_BONUS_NON_TEAM_LEAD_SKIP');
    expect(logWarns[0].payload.supervisor_code).toBe('SGO');
    expect(logWarns[0].payload.role).toBe('PM');
    expect(logWarns[0].payload.client_code).toBe('SOME SMALL ACCOUNT');
    expect(logWarns[0].payload.product_code).toBe('ROOF_TRUSS');
    expect(logWarns[0].payload.designer_code).toBe('BIT');
    expect(logWarns[0].payload.hours).toBe(12);

    expect(result.blockedPairs).toEqual([]);
    expect(PayrollEngine.filterUnexpectedBlockedPairs_(result.blockedPairs)).toEqual([]);
    expect(result.skippedNonTeamLead).toEqual([
      { client_code: 'SOME SMALL ACCOUNT', product_code: 'ROOF_TRUSS', designer_code: 'BIT', supervisor_code: 'SGO', role: 'PM', hours: 12 }
    ]);
  });

  test('throws if more than one REF_ACCOUNT_SUPERVISION row resolves as valid for the same (client, product, designer) as of asOfDate (data corruption, e.g. a manual sheet edit bypassing assignAccountSupervisor)', () => {
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
      BIT: { SBS: { 'ROOF_TRUSS': { design_hours: 6, qc_hours: 0 } } }
    };

    expect(() => PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01'))
      .toThrow(/SBS\/ROOF_TRUSS\/BIT/);
  });

  test('a supervisor_code in REF_ACCOUNT_SUPERVISION not found in staffCache (e.g. typo or inactive person) is logged as SUPERVISOR_BONUS_UNRESOLVED_SUPERVISOR and blocked, not silently skipped with no visibility', () => {
    seedSupervision([
      { client_code: 'ACME CORP', designer_code: 'PRS', supervisor_code: 'NONEXISTENT' }
    ]);
    const staffCache = {
      PRS: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      PRS: { 'ACME CORP': { 'ROOF_TRUSS': { design_hours: 20, qc_hours: 0 } } }
    };

    const logWarns = [];
    mocks.Logger.warn = (eventName, payload) => {
      logWarns.push({ eventName, payload });
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    expect(logWarns.length).toBe(1);
    expect(logWarns[0].eventName).toBe('SUPERVISOR_BONUS_UNRESOLVED_SUPERVISOR');
    expect(logWarns[0].payload.supervisor_code).toBe('NONEXISTENT');
    expect(logWarns[0].payload.client_code).toBe('ACME CORP');
    expect(logWarns[0].payload.product_code).toBe('ROOF_TRUSS');
    expect(logWarns[0].payload.designer_code).toBe('PRS');
    expect(logWarns[0].payload.hours).toBe(20);

    expect(result.blockedPairs).toEqual([
      { client_code: 'ACME CORP', product_code: 'ROOF_TRUSS', designer_code: 'PRS', hours: 20 }
    ]);

    expect(result.bonusMap.NONEXISTENT).toBeUndefined();
  });

  // Two tiny pairs: each 0.00001 hours × 25 = 0.00025, which rounds to 0 after *100/100
  // The per-pair guard allows these through (0.00001 is truthy), but accumulation
  // + rounding produces a zero-value bonusMap entry. The final filter should remove it.
  test('a supervisor with only very-small-hours pairs that round to zero is filtered out (no non-positive entries in bonusMap)', () => {
    seedSupervision([
      { client_code: 'TINY ACCOUNT 1', designer_code: 'PRS', supervisor_code: 'DBS' },
      { client_code: 'TINY ACCOUNT 2', designer_code: 'PRS', supervisor_code: 'DBS' }
    ]);
    const staffCache = {
      DBS: staff({ role: 'TEAM_LEAD' }),
      PRS: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      PRS: {
        'TINY ACCOUNT 1': { 'ROOF_TRUSS': { design_hours: 0.00001, qc_hours: 0 } },
        'TINY ACCOUNT 2': { 'ROOF_TRUSS': { design_hours: 0.00001, qc_hours: 0 } }
      }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    expect(result.bonusMap.DBS).toBeUndefined();
    expect(result.blockedPairs).toEqual([]);
  });

  test('a product-specific supervision row matches only that exact product, leaving other products on the same account unmatched', () => {
    seedSupervision([
      { client_code: 'NELSON', product_code: 'ROOF_TRUSS', designer_code: 'AR001', supervisor_code: 'DBS' }
    ]);
    const staffCache = {
      DBS: staff({ role: 'TEAM_LEAD' }),
      AR001: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      AR001: {
        NELSON: {
          'ROOF_TRUSS':  { design_hours: 10, qc_hours: 0 },
          'FLOOR_JOIST': { design_hours: 4,  qc_hours: 0 }
        }
      }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    expect(result.bonusMap.DBS).toBe(250); // 10 x 25, ROOF_TRUSS only
    expect(result.blockedPairs).toEqual([
      { client_code: 'NELSON', product_code: 'FLOOR_JOIST', designer_code: 'AR001', hours: 4 }
    ]);
  });

  test('when both a wildcard row and a product-specific row match, the specific row wins for that product — the wildcard still covers the other products', () => {
    seedSupervision([
      { client_code: 'NORSPAN-MB', product_code: '',           designer_code: 'VKV', supervisor_code: 'BCH' },
      { client_code: 'NORSPAN-MB', product_code: 'FLOOR_JOIST', designer_code: 'VKV', supervisor_code: 'SDA' }
    ]);
    const staffCache = {
      BCH: staff({ role: 'TEAM_LEAD' }),
      SDA: staff({ role: 'TEAM_LEAD' }),
      VKV: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      VKV: {
        'NORSPAN-MB': {
          'ROOF_TRUSS':  { design_hours: 10, qc_hours: 0 },
          'FLOOR_JOIST': { design_hours: 6,  qc_hours: 0 }
        }
      }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    expect(result.bonusMap.BCH).toBe(250); // 10 x 25, ROOF_TRUSS via the wildcard
    expect(result.bonusMap.SDA).toBe(150); // 6 x 25, FLOOR_JOIST via the specific row
    expect(result.blockedPairs).toEqual([]);
  });

  test('throws if two product-specific rows resolve for the same exact product (not just the same client+designer)', () => {
    seedSupervision([
      { client_code: 'NELSON', product_code: 'ROOF_TRUSS', designer_code: 'AR001', supervisor_code: 'DBS', effective_from: '2024-01-01', effective_to: '' },
      { client_code: 'NELSON', product_code: 'ROOF_TRUSS', designer_code: 'AR001', supervisor_code: 'SGO', effective_from: '2025-01-01', effective_to: '' }
    ]);
    const staffCache = {
      DBS: staff({ role: 'TEAM_LEAD' }),
      SGO: staff({ role: 'PM' }),
      AR001: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      AR001: { NELSON: { 'ROOF_TRUSS': { design_hours: 5, qc_hours: 0 } } }
    };

    expect(() => PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01'))
      .toThrow(/NELSON\/ROOF_TRUSS\/AR001/);
  });

  test('date filtering happens BEFORE the exact-vs-wildcard tier split — an expired product-specific row must not suppress a live wildcard for that same product', () => {
    seedSupervision([
      { client_code: 'ALBERTA TRUSS', product_code: 'ROOF_TRUSS', designer_code: 'PRS', supervisor_code: 'PBG', effective_from: '2024-01-01', effective_to: '2026-08-31' },
      { client_code: 'ALBERTA TRUSS', product_code: '',           designer_code: 'PRS', supervisor_code: 'DBS', effective_from: '2026-09-01', effective_to: '' }
    ]);
    const staffCache = {
      PBG: staff({ role: 'TEAM_LEAD' }),
      DBS: staff({ role: 'TEAM_LEAD' }),
      PRS: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      PRS: { 'ALBERTA TRUSS': { 'ROOF_TRUSS': { design_hours: 10, qc_hours: 0 } } }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-15');

    // The exact-product row (PBG) expired 2026-08-31 — it must be excluded
    // by the date filter BEFORE the tier split runs, so it never gets a
    // chance to suppress the live wildcard row (DBS) for this product.
    expect(result.bonusMap.DBS).toBe(250);
    expect(result.bonusMap.PBG).toBeUndefined();
  });
});
