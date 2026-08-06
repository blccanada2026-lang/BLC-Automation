/**
 * staff-onboarding-hr-accounting-role.test.js
 *
 * Tests for StaffOnboarding.gs's role validation (Phase B1, payroll
 * automation). Investigation 2 found onboardStaff() and its bulk-import
 * counterpart onboardStaffRow_() each carry their OWN, independently
 * duplicated `validRoles` whitelist — copy-pasted, not shared — and
 * neither included HR_ACCOUNTING. Phase B1 extracts a single shared
 * constant used by both, adding HR_ACCOUNTING to it.
 *
 * Covers both entry points, since guarding only one (per this
 * codebase's own testing-policy precedent, .claude/rules/
 * testing-policy.md §3) leaves the other reachable with stale
 * validation — exactly the gap this fix closes.
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
  mocks.Config.TABLES.STG_STAFF_IMPORT = 'STG_STAFF_IMPORT';
  mocks.HealthMonitor = { isApproachingLimit: () => false };
  global.HealthMonitor = mocks.HealthMonitor;
  // 2026-08-06: onboardStaff() now fires a best-effort welcome email
  // (StaffOnboardingMailer.gs) for genuinely new staff — irrelevant to
  // role validation, which is what this file tests. See
  // staff-onboarding-email.test.js for the email's own coverage.
  global.sendNewStaffOnboardingEmail_ = function () {};
  loadSrc('../src/08-staff/StaffOnboarding.gs');
});

function basePayload(overrides) {
  return Object.assign({
    person_code:    'AAR',
    name:           'Aarthi',
    email:          'aarthirajeshnair@gmail.com',
    role:           'HR_ACCOUNTING',
    pay_currency:   'INR',
    pay_design:     0,
    pay_qc:         0,
    effective_from: '2026-08-01'
  }, overrides);
}

describe('StaffOnboarding.onboardStaff() — HR_ACCOUNTING role', () => {
  test('accepts HR_ACCOUNTING as a valid role', () => {
    var result = StaffOnboarding.onboardStaff('ceo@test.blc.internal', basePayload());
    expect(result.isNew).toBe(true);

    var row = mocks.store['DIM_STAFF_ROSTER'].find(r => r.person_code === 'AAR');
    expect(row).toBeDefined();
    expect(row.role).toBe('HR_ACCOUNTING');
    expect(row.email).toBe('aarthirajeshnair@gmail.com');
  });

  test('still rejects a genuinely invalid role', () => {
    expect(() => StaffOnboarding.onboardStaff('ceo@test.blc.internal', basePayload({ role: 'NOT_A_REAL_ROLE' })))
      .toThrow(/invalid role/i);
  });

  test('still accepts every pre-existing valid role (no regression)', () => {
    ['DESIGNER', 'QC', 'TEAM_LEAD', 'PM', 'CEO', 'ADMIN'].forEach((role, i) => {
      var result = StaffOnboarding.onboardStaff('ceo@test.blc.internal',
        basePayload({ person_code: 'P' + i, email: 'p' + i + '@test.blc.internal', role: role }));
      expect(result.isNew).toBe(true);
    });
  });
});

describe('StaffOnboarding.bulkOnboardStaff() -> onboardStaffRow_() — HR_ACCOUNTING role', () => {
  test('accepts HR_ACCOUNTING via the bulk-import path too — same source of truth as onboardStaff()', () => {
    mocks.store['STG_STAFF_IMPORT'] = [basePayload()];

    var summary = StaffOnboarding.bulkOnboardStaff('ceo@test.blc.internal');

    expect(summary.errors).toBe(0);
    expect(summary.created).toBe(1);
    var row = mocks.store['DIM_STAFF_ROSTER'].find(r => r.person_code === 'AAR');
    expect(row).toBeDefined();
    expect(row.role).toBe('HR_ACCOUNTING');
  });

  test('still rejects a genuinely invalid role via the bulk-import path', () => {
    mocks.store['STG_STAFF_IMPORT'] = [basePayload({ role: 'NOT_A_REAL_ROLE' })];

    var summary = StaffOnboarding.bulkOnboardStaff('ceo@test.blc.internal');

    expect(summary.errors).toBe(1);
    expect(summary.created).toBe(0);
    expect(summary.results[0].reason).toMatch(/invalid role/i);
  });
});
