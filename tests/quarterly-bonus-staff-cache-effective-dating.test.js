/**
 * quarterly-bonus-staff-cache-effective-dating.test.js
 *
 * Tests for QuarterlyBonusEngine.gs's OWN, separate buildStaffCache_(asOfDate)
 * — Task 2's effective-dating fix. QuarterlyBonusEngine.gs has its own
 * private buildStaffCache_() (distinct from PayrollEngine.gs's — these are
 * separate IIFE modules and cannot share private functions), so it needs
 * the identical fix applied independently.
 *
 * No prior Jest coverage exists for this V3 file — tests/quarterly-bonus.test.js
 * targets the legacy V2 root-level QuarterlyBonusEngine.js.
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
  loadSrc('../src/10-payroll/QuarterlyBonusEngine.gs');
});

function seedRoster(rows) {
  mocks.store['DIM_STAFF_ROSTER'] = rows.map(r => Object.assign({
    person_code: '', name: '', email: '', role: 'DESIGNER',
    supervisor_code: '', pm_code: '', pay_currency: 'INR',
    pay_design: 0, pay_qc: 0, bonus_eligible: 'FALSE',
    active: 'TRUE', effective_from: '2025-01-01', effective_to: ''
  }, r));
}

describe('QuarterlyBonusEngine.buildStaffCache_(asOfDate)', () => {
  test('resolves the OLD supervisor for a quarter-start date before the change', () => {
    seedRoster([
      { person_code: 'KUM', supervisor_code: 'OLD_TL', effective_from: '2025-01-01', effective_to: '2026-04-14' },
      { person_code: 'KUM', supervisor_code: 'NEW_TL', effective_from: '2026-04-15', effective_to: '' }
    ]);
    // Q1 2026 starts 2026-01-01 — before the change.
    const cache = QuarterlyBonusEngine.buildStaffCache_('2026-01-01');
    expect(cache.KUM.supervisor_code).toBe('OLD_TL');
  });

  test('resolves the NEW supervisor for a quarter-start date on/after the change', () => {
    seedRoster([
      { person_code: 'KUM', supervisor_code: 'OLD_TL', effective_from: '2025-01-01', effective_to: '2026-04-14' },
      { person_code: 'KUM', supervisor_code: 'NEW_TL', effective_from: '2026-04-15', effective_to: '' }
    ]);
    // Q3 2026 starts 2026-07-01 — after the change.
    const cache = QuarterlyBonusEngine.buildStaffCache_('2026-07-01');
    expect(cache.KUM.supervisor_code).toBe('NEW_TL');
  });

  test('preserves the existing start_date field (from effective_from), unaffected by this fix', () => {
    seedRoster([{ person_code: 'KUM', supervisor_code: 'BCH', effective_from: '2025-06-01', effective_to: '' }]);
    const cache = QuarterlyBonusEngine.buildStaffCache_('2026-01-01');
    expect(cache.KUM.start_date).toBe('2025-06-01');
  });

  test('defaults to today when asOfDate is omitted', () => {
    seedRoster([{ person_code: 'KUM', supervisor_code: 'BCH' }]);
    const cache = QuarterlyBonusEngine.buildStaffCache_();
    expect(cache.KUM.supervisor_code).toBe('BCH');
  });

  describe('duplicate-row guard', () => {
    test('throws if MORE THAN ONE row resolves as valid for the same person_code at asOfDate', () => {
      seedRoster([
        { person_code: 'KUM', supervisor_code: 'OLD_TL', effective_from: '2024-01-01', effective_to: '' },
        { person_code: 'KUM', supervisor_code: 'NEW_TL', effective_from: '2025-01-01', effective_to: '' }
      ]);

      expect(() => QuarterlyBonusEngine.buildStaffCache_('2026-01-01')).toThrow(/KUM/);
    });
  });
});
