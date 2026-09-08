/**
 * staff-onboarding-change-pay-rate.test.js
 *
 * Tests for StaffOnboarding.changePayRate() — a thin wrapper around the
 * same scd2FieldChange_ mechanism changeSupervisor() already uses (see
 * staff-onboarding-change-supervisor.test.js for the underlying SCD-2
 * guards, which changePayRate inherits for free — this suite focuses on
 * what's specific to changePayRate itself, not re-proving scd2FieldChange_).
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
  loadSrc('../src/08-staff/StaffOnboarding.gs');
});

function seedRoster(rows) {
  mocks.store['DIM_STAFF_ROSTER'] = rows.map(r => Object.assign({
    person_code: '', name: '', email: '', role: 'DESIGNER',
    supervisor_code: '', pm_code: '', pay_currency: 'INR',
    pay_design: 0, pay_qc: 0, bonus_eligible: 'FALSE',
    active: 'TRUE', effective_from: '2024-01-01', effective_to: ''
  }, r));
}

describe('StaffOnboarding.changePayRate()', () => {
  test('closes the old row and inserts a new row with the corrected pay_design/pay_qc, effective_from = effectiveDate', () => {
    seedRoster([{ person_code: 'PRS', name: 'Priyanka S', pay_design: 250, pay_qc: 250 }]);

    StaffOnboarding.changePayRate('ceo@test.blc.internal', 'PRS', { pay_design: 300, pay_qc: 300 }, '2026-07-01');

    const rows = mocks.store['DIM_STAFF_ROSTER'].filter(r => r.person_code === 'PRS');
    expect(rows).toHaveLength(2);

    const oldRow = rows.find(r => r.pay_design === 250);
    const newRow = rows.find(r => r.pay_design === 300);

    expect(oldRow.effective_to).toBe('2026-06-30');
    expect(newRow.effective_from).toBe('2026-07-01');
    expect(newRow.effective_to).toBe('');
    expect(newRow.pay_qc).toBe(300);
  });

  test('copies forward every other field (name, role, supervisor_code) from the old row unchanged', () => {
    seedRoster([{
      person_code: 'ABB', name: 'Abhijit Bera', role: 'DESIGNER',
      supervisor_code: 'SVN', pay_design: 300, pay_qc: 300
    }]);

    StaffOnboarding.changePayRate('ceo@test.blc.internal', 'ABB', { pay_design: 350, pay_qc: 350 }, '2026-07-01');

    const newRow = mocks.store['DIM_STAFF_ROSTER'].find(r => r.person_code === 'ABB' && r.pay_design === 350);
    expect(newRow.name).toBe('Abhijit Bera');
    expect(newRow.role).toBe('DESIGNER');
    expect(newRow.supervisor_code).toBe('SVN');
    expect(newRow.active).toBe('TRUE');
  });

  test('idempotent: calling twice with the same (personCode, rates, effectiveDate) does not create a duplicate row', () => {
    seedRoster([{ person_code: 'BIT', pay_design: 250, pay_qc: 250 }]);

    StaffOnboarding.changePayRate('ceo@test.blc.internal', 'BIT', { pay_design: 300, pay_qc: 300 }, '2026-07-01');
    StaffOnboarding.changePayRate('ceo@test.blc.internal', 'BIT', { pay_design: 300, pay_qc: 300 }, '2026-07-01');

    const rows = mocks.store['DIM_STAFF_ROSTER'].filter(r => r.person_code === 'BIT');
    expect(rows).toHaveLength(2); // still just old (closed) + new — not 3
  });

  test('throws a clear error if person_code does not exist', () => {
    seedRoster([{ person_code: 'OTHER', pay_design: 300, pay_qc: 300 }]);
    expect(() => StaffOnboarding.changePayRate('ceo@test.blc.internal', 'NOBODY', { pay_design: 300, pay_qc: 300 }, '2026-07-01'))
      .toThrow(/NOBODY/);
  });

  test('enforces RBAC — calls RBAC.enforcePermission with ADMIN_CONFIG, same tier as changeSupervisor', () => {
    seedRoster([{ person_code: 'RKG', pay_design: 250, pay_qc: 250 }]);
    const spy = jest.spyOn(mocks.RBAC, 'enforcePermission');

    StaffOnboarding.changePayRate('ceo@test.blc.internal', 'RKG', { pay_design: 300, pay_qc: 300 }, '2026-07-01');

    expect(spy).toHaveBeenCalledWith(expect.anything(), 'ADMIN_CONFIG');
  });

  test('rejects a backdate to at/before the current open row\'s own effective_from (inherited inverted-window guard) — this is exactly why Sayan Roy/Savvy Nath need a direct field patch instead', () => {
    // Simulates SYR/SVN's real shape: a row already opened 2026-07-01 with
    // the wrong rate. changePayRate cannot fix it — same effectiveDate as
    // the row's own start throws, inherited from scd2FieldChange_.
    seedRoster([{ person_code: 'SYR', pay_design: 250, pay_qc: 250, effective_from: '2026-07-01', effective_to: '' }]);

    expect(() => StaffOnboarding.changePayRate('ceo@test.blc.internal', 'SYR', { pay_design: 300, pay_qc: 300 }, '2026-07-01'))
      .toThrow(/inverted/i);

    const rows = mocks.store['DIM_STAFF_ROSTER'].filter(r => r.person_code === 'SYR');
    expect(rows).toHaveLength(1); // rejected before any write
  });

  describe('newRates validation — rejects a partial/invalid object before any write', () => {
    // Root cause this guards against: scd2FieldChange_ closes the old row
    // BEFORE appending the new one. If newRates is missing a field, the
    // close-row write commits, then DAL.appendRow's own UNDEFINED_FIELD_VALUE
    // guard throws on the new row — leaving the person with NO open-ended
    // roster row at all, unrecoverable by simply retrying (the "no active
    // row to close" guard fires next). Must be caught here, before either
    // write happens.

    test('throws if pay_qc is missing, and leaves the roster completely untouched', () => {
      seedRoster([{ person_code: 'PRS', pay_design: 250, pay_qc: 250 }]);

      expect(() => StaffOnboarding.changePayRate('ceo@test.blc.internal', 'PRS', { pay_design: 300 }, '2026-07-01'))
        .toThrow(/pay_qc/i);

      const rows = mocks.store['DIM_STAFF_ROSTER'].filter(r => r.person_code === 'PRS');
      expect(rows).toHaveLength(1);
      expect(rows[0].pay_design).toBe(250); // old row never closed
    });

    test('throws if pay_design is missing, and leaves the roster completely untouched', () => {
      seedRoster([{ person_code: 'PRS', pay_design: 250, pay_qc: 250 }]);

      expect(() => StaffOnboarding.changePayRate('ceo@test.blc.internal', 'PRS', { pay_qc: 300 }, '2026-07-01'))
        .toThrow(/pay_design/i);

      const rows = mocks.store['DIM_STAFF_ROSTER'].filter(r => r.person_code === 'PRS');
      expect(rows).toHaveLength(1);
    });

    test('throws if a rate is not a finite number (e.g. NaN from a bad parseFloat upstream)', () => {
      seedRoster([{ person_code: 'PRS', pay_design: 250, pay_qc: 250 }]);

      expect(() => StaffOnboarding.changePayRate('ceo@test.blc.internal', 'PRS', { pay_design: NaN, pay_qc: 300 }, '2026-07-01'))
        .toThrow(/pay_design/i);

      const rows = mocks.store['DIM_STAFF_ROSTER'].filter(r => r.person_code === 'PRS');
      expect(rows).toHaveLength(1);
    });
  });
});
