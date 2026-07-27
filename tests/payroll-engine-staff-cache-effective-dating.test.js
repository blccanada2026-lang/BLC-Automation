/**
 * payroll-engine-staff-cache-effective-dating.test.js
 *
 * Tests for PayrollEngine.gs's buildStaffCache_(asOfDate) — Task 2's
 * effective-dating fix for the supervisor-bonus attribution path.
 *
 * No prior Jest coverage exists for src/10-payroll/PayrollEngine.gs (the
 * V3 engine) — tests/payroll.test.js targets the legacy V2 root-level
 * PayrollEngine.js, a different codebase in the same repo. New coverage
 * built here, following the same eval()-load pattern as every other V3
 * test in this repo.
 *
 * buildStaffCache_ and buildSupervisorBonusMap_ are exposed on the public
 * API (trailing-underscore convention, same precedent as
 * aggregateHours_'s 2026-07-23 exposure) specifically so this suite can
 * test the real supervisor-attribution logic end-to-end without also
 * having to mock IdempotencyEngine/HealthMonitor/FACT_PAYROLL_LEDGER
 * writes, which are unrelated to the date-filtering behavior under test.
 */

const fs   = require('fs');
const path = require('path');
const { installV3StaffMocks } = require('./gas-v3-staff-mocks');

function loadSrc(relPath) {
  // eval() loads trusted, repo-local .gs source (not user input) — same
  // pattern as every other test in this repo. Indirect (global) eval so
  // declarations become visible outside this helper.
  (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
}

let mocks;

beforeEach(() => {
  mocks = installV3StaffMocks();
  loadSrc('../src/10-payroll/PayrollEngine.gs');
});

function seedRoster(rows) {
  mocks.store['DIM_STAFF_ROSTER'] = rows.map(r => Object.assign({
    person_code: '', name: '', email: '', role: 'DESIGNER',
    supervisor_code: '', pm_code: '', pay_currency: 'INR',
    pay_design: 0, pay_qc: 0, bonus_eligible: 'FALSE',
    active: 'TRUE', effective_from: '2025-01-01', effective_to: ''
  }, r));
}

describe('PayrollEngine.buildStaffCache_(asOfDate)', () => {
  test('with a single open-ended row, returns that row regardless of asOfDate (unchanged behavior)', () => {
    seedRoster([{ person_code: 'KUM', supervisor_code: 'BCH' }]);
    const cache = PayrollEngine.buildStaffCache_('2026-01-01');
    expect(cache.KUM.supervisor_code).toBe('BCH');
  });

  test('with a historical + current row, resolves the OLD supervisor for a date BEFORE the change', () => {
    seedRoster([
      { person_code: 'KUM', supervisor_code: 'OLD_TL', effective_from: '2025-01-01', effective_to: '2026-04-14' },
      { person_code: 'KUM', supervisor_code: 'NEW_TL', effective_from: '2026-04-15', effective_to: '' }
    ]);
    const cache = PayrollEngine.buildStaffCache_('2026-03-01');
    expect(cache.KUM.supervisor_code).toBe('OLD_TL');
  });

  test('resolves the NEW supervisor for a date on or after the effective date', () => {
    seedRoster([
      { person_code: 'KUM', supervisor_code: 'OLD_TL', effective_from: '2025-01-01', effective_to: '2026-04-14' },
      { person_code: 'KUM', supervisor_code: 'NEW_TL', effective_from: '2026-04-15', effective_to: '' }
    ]);
    const cache = PayrollEngine.buildStaffCache_('2026-05-01');
    expect(cache.KUM.supervisor_code).toBe('NEW_TL');
  });

  test('boundary: asOfDate exactly on the last day of the old row (effective_to) resolves OLD', () => {
    seedRoster([
      { person_code: 'KUM', supervisor_code: 'OLD_TL', effective_from: '2025-01-01', effective_to: '2026-04-14' },
      { person_code: 'KUM', supervisor_code: 'NEW_TL', effective_from: '2026-04-15', effective_to: '' }
    ]);
    const cache = PayrollEngine.buildStaffCache_('2026-04-14');
    expect(cache.KUM.supervisor_code).toBe('OLD_TL');
  });

  test('boundary: asOfDate exactly on the new row\'s effective_from resolves NEW', () => {
    seedRoster([
      { person_code: 'KUM', supervisor_code: 'OLD_TL', effective_from: '2025-01-01', effective_to: '2026-04-14' },
      { person_code: 'KUM', supervisor_code: 'NEW_TL', effective_from: '2026-04-15', effective_to: '' }
    ]);
    const cache = PayrollEngine.buildStaffCache_('2026-04-15');
    expect(cache.KUM.supervisor_code).toBe('NEW_TL');
  });

  test('a date before any row is effective excludes that person entirely', () => {
    seedRoster([{ person_code: 'KUM', supervisor_code: 'BCH', effective_from: '2026-06-01', effective_to: '' }]);
    const cache = PayrollEngine.buildStaffCache_('2026-01-01');
    expect(cache.KUM).toBeUndefined();
  });

  test('defaults to today when asOfDate is omitted (backward-compatible safety net for any unmapped caller)', () => {
    seedRoster([{ person_code: 'KUM', supervisor_code: 'BCH' }]);
    // No asOfDate passed — should not throw, should still resolve the open-ended row.
    const cache = PayrollEngine.buildStaffCache_();
    expect(cache.KUM.supervisor_code).toBe('BCH');
  });
});

describe('End-to-end: buildStaffCache_(asOfDate) + buildSupervisorBonusMap_ — the actual attribution scenario from the test matrix', () => {
  test('a supervisor change effective mid-quarter: re-running a PRIOR period attributes hours to the OLD supervisor', () => {
    seedRoster([
      { person_code: 'OLD_TL', role: 'TEAM_LEAD' },
      { person_code: 'NEW_TL', role: 'TEAM_LEAD' },
      {
        person_code: 'KUM', role: 'DESIGNER',
        supervisor_code: 'OLD_TL', effective_from: '2025-01-01', effective_to: '2026-04-14'
      }
    ]);
    // Second historical row appended separately (same person, new supervisor) — mirrors what
    // changeSupervisor() itself produces; done here directly to keep this test self-contained.
    mocks.store['DIM_STAFF_ROSTER'].push({
      person_code: 'KUM', name: '', email: '', role: 'DESIGNER',
      supervisor_code: 'NEW_TL', pm_code: '', pay_currency: 'INR',
      pay_design: 0, pay_qc: 0, bonus_eligible: 'FALSE',
      active: 'TRUE', effective_from: '2026-04-15', effective_to: ''
    });

    // Re-running MARCH (before the change) today, long after the July change happened.
    const marchCache = PayrollEngine.buildStaffCache_('2026-03-01');
    const marchHours  = { KUM: { design_hours: 40, qc_hours: 0 } };
    const marchBonus  = PayrollEngine.buildSupervisorBonusMap_(marchCache, marchHours);

    expect(marchBonus.OLD_TL).toBeDefined();
    expect(marchBonus.NEW_TL).toBeUndefined();
  });

  test('the same designer\'s hours, for a period FROM the effective date forward, attribute to the NEW supervisor', () => {
    seedRoster([
      { person_code: 'OLD_TL', role: 'TEAM_LEAD' },
      { person_code: 'NEW_TL', role: 'TEAM_LEAD' },
      {
        person_code: 'KUM', role: 'DESIGNER',
        supervisor_code: 'OLD_TL', effective_from: '2025-01-01', effective_to: '2026-04-14'
      }
    ]);
    mocks.store['DIM_STAFF_ROSTER'].push({
      person_code: 'KUM', name: '', email: '', role: 'DESIGNER',
      supervisor_code: 'NEW_TL', pm_code: '', pay_currency: 'INR',
      pay_design: 0, pay_qc: 0, bonus_eligible: 'FALSE',
      active: 'TRUE', effective_from: '2026-04-15', effective_to: ''
    });

    const mayCache = PayrollEngine.buildStaffCache_('2026-05-01');
    const mayHours  = { KUM: { design_hours: 40, qc_hours: 0 } };
    const mayBonus  = PayrollEngine.buildSupervisorBonusMap_(mayCache, mayHours);

    expect(mayBonus.NEW_TL).toBeDefined();
    expect(mayBonus.OLD_TL).toBeUndefined();
  });

  describe('duplicate-row guard', () => {
    // DEV briefly had two independent, uncoordinated seed paths both
    // insert a row for the same person_code (SetupScript.seedDimStaffRoster_
    // raw appendRow + SeedStaffImport/bulkOnboardStaff DAL writes, neither
    // aware of the other). PROD only avoided this because a one-off
    // migration cleanup happened to run there — the raw appendRow path
    // still exists and could reintroduce duplicates to PROD at any time.
    // Silently letting the last matching row win (previous behavior) would
    // absorb that corruption invisibly into a real payroll/bonus number.

    test('throws if MORE THAN ONE row resolves as valid for the same person_code at asOfDate', () => {
      seedRoster([
        { person_code: 'KUM', supervisor_code: 'OLD_TL', effective_from: '2024-01-01', effective_to: '' },
        { person_code: 'KUM', supervisor_code: 'NEW_TL', effective_from: '2025-01-01', effective_to: '' }
      ]);

      // Tightened 2026-07-27: assert on the SPECIFIC guard, not just any
      // throw mentioning KUM — a real DEV run caught a different guard
      // (inverted-window) satisfying a bare person-code check for the
      // wrong reason.
      expect(() => PayrollEngine.buildStaffCache_('2026-01-01')).toThrow(/KUM/);
      expect(() => PayrollEngine.buildStaffCache_('2026-01-01')).toThrow(/more than one/i);
    });

    test('does not throw when duplicate rows exist for a DIFFERENT person_code than the one being resolved twice', () => {
      seedRoster([
        { person_code: 'KUM', supervisor_code: 'TL1', effective_from: '2024-01-01', effective_to: '' },
        { person_code: 'OTHER', supervisor_code: 'TL2', effective_from: '2024-01-01', effective_to: '' }
      ]);

      expect(() => PayrollEngine.buildStaffCache_('2026-01-01')).not.toThrow();
    });

    test('throws on an inverted validity window (effective_to before effective_from), even for an asOfDate that would otherwise skip the row entirely', () => {
      seedRoster([
        // effective_from is AFTER effective_to — an impossible window. asOfDate below
        // is early enough that the normal effFrom > asOfDate check would silently
        // "continue" past this row if the inverted-window check didn't fire first.
        { person_code: 'KUM', supervisor_code: 'TL1', effective_from: '2026-05-01', effective_to: '2026-04-01' }
      ]);

      expect(() => PayrollEngine.buildStaffCache_('2024-01-01')).toThrow(/KUM/);
      expect(() => PayrollEngine.buildStaffCache_('2024-01-01')).toThrow(/inverted/i);
    });
  });
});
