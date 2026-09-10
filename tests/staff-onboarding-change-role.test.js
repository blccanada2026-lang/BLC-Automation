/**
 * staff-onboarding-change-role.test.js
 *
 * Tests for StaffOnboarding.changeRole() — the SCD-2-style write path
 * for DIM_STAFF_ROSTER.role changes, same mechanism as changeSupervisor()
 * and changePayRate() (see scd2FieldChange_). Built as the blocking
 * prerequisite for the 2026-09-10 product-scoped-supervision design spec
 * §8 — a supervisor named in REF_ACCOUNT_SUPERVISION earns nothing from
 * buildSupervisorBonusMapByAccount_ until their role is exactly
 * 'TEAM_LEAD' (PayrollEngine.gs's role-based PM-skip rule), so this
 * function is what actually lets that bonus flow.
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
    active: 'TRUE', effective_from: '2025-01-01', effective_to: ''
  }, r));
}

describe('StaffOnboarding.changeRole()', () => {
  test('closes the old row (effective_to = day before effectiveDate) and inserts a new row with the new role', () => {
    seedRoster([{ person_code: 'DBS', name: 'Deb Sen', role: 'QC_REVIEWER' }]);

    StaffOnboarding.changeRole('ceo@test.blc.internal', 'DBS', 'TEAM_LEAD', '2026-08-01');

    const rows = mocks.store['DIM_STAFF_ROSTER'].filter(r => r.person_code === 'DBS');
    expect(rows).toHaveLength(2);

    const oldRow = rows.find(r => r.role === 'QC_REVIEWER');
    const newRow = rows.find(r => r.role === 'TEAM_LEAD');

    expect(oldRow.effective_to).toBe('2026-07-31');
    expect(newRow.effective_from).toBe('2026-08-01');
    expect(newRow.effective_to).toBe('');
  });

  test('the new row copies forward every other field from the old row unchanged', () => {
    seedRoster([{
      person_code: 'DBS', name: 'Deb Sen', email: 'dbs@test.blc.internal',
      role: 'QC_REVIEWER', supervisor_code: 'SGO', pay_currency: 'INR',
      pay_design: 300, pay_qc: 300, bonus_eligible: 'TRUE'
    }]);

    StaffOnboarding.changeRole('ceo@test.blc.internal', 'DBS', 'TEAM_LEAD', '2026-08-01');

    const newRow = mocks.store['DIM_STAFF_ROSTER'].find(r => r.person_code === 'DBS' && r.role === 'TEAM_LEAD');
    expect(newRow.name).toBe('Deb Sen');
    expect(newRow.email).toBe('dbs@test.blc.internal');
    expect(newRow.supervisor_code).toBe('SGO');
    expect(newRow.pay_design).toBe(300);
    expect(newRow.pay_qc).toBe(300);
    expect(newRow.bonus_eligible).toBe('TRUE');
    expect(newRow.active).toBe('TRUE');
  });

  test('idempotent: calling twice with the same (personCode, newRole, effectiveDate) does not create duplicate rows', () => {
    seedRoster([{ person_code: 'DBS', role: 'QC_REVIEWER' }]);

    StaffOnboarding.changeRole('ceo@test.blc.internal', 'DBS', 'TEAM_LEAD', '2026-08-01');
    StaffOnboarding.changeRole('ceo@test.blc.internal', 'DBS', 'TEAM_LEAD', '2026-08-01');

    const rows = mocks.store['DIM_STAFF_ROSTER'].filter(r => r.person_code === 'DBS');
    expect(rows).toHaveLength(2); // still just old (closed) + new — not 3
  });

  test('throws a clear error if newRole is blank', () => {
    seedRoster([{ person_code: 'DBS', role: 'QC_REVIEWER' }]);
    expect(() => StaffOnboarding.changeRole('ceo@test.blc.internal', 'DBS', '', '2026-08-01'))
      .toThrow(/newRole is required/);
  });

  test('throws a clear error if person_code does not exist', () => {
    seedRoster([{ person_code: 'OTHER', role: 'DESIGNER' }]);
    expect(() => StaffOnboarding.changeRole('ceo@test.blc.internal', 'NOBODY', 'TEAM_LEAD', '2026-08-01'))
      .toThrow(/NOBODY/);
  });

  test('throws a clear error if there is no currently-active (open-ended) row to close for that person', () => {
    seedRoster([{ person_code: 'DBS', role: 'QC_REVIEWER', effective_to: '2026-01-01' }]);
    expect(() => StaffOnboarding.changeRole('ceo@test.blc.internal', 'DBS', 'TEAM_LEAD', '2026-08-01'))
      .toThrow(/no active|open-ended|current/i);
  });

  test('enforces RBAC — calls RBAC.enforcePermission with ADMIN_CONFIG, same tier as changeSupervisor/changePayRate', () => {
    seedRoster([{ person_code: 'DBS', role: 'QC_REVIEWER' }]);
    const spy = jest.spyOn(mocks.RBAC, 'enforcePermission');

    StaffOnboarding.changeRole('ceo@test.blc.internal', 'DBS', 'TEAM_LEAD', '2026-08-01');

    expect(spy).toHaveBeenCalledWith(expect.anything(), 'ADMIN_CONFIG');
  });

  test('refuses to run if the person has MORE THAN ONE open-ended row — refuses to guess which to close', () => {
    seedRoster([
      { person_code: 'DBS', role: 'QC_REVIEWER', effective_from: '2024-01-01', effective_to: '' },
      { person_code: 'DBS', role: 'DESIGNER', effective_from: '2025-01-01', effective_to: '' }
    ]);
    expect(() => StaffOnboarding.changeRole('ceo@test.blc.internal', 'DBS', 'TEAM_LEAD', '2026-08-01'))
      .toThrow(/DBS/);
  });
});
