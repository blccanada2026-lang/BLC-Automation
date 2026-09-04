/**
 * portal-data-build-perms.test.js
 *
 * Tests for PortalData.gs's buildPerms_() — specifically canRunPayroll,
 * canApprovePayroll, and canManageStaff, found (Investigation 4,
 * PAYROLL_AUTOMATION_ARCHITECTURE.md §4.2) to be hardcoded
 * `role === 'CEO'` / `role === 'CEO' || role === 'ADMIN'` string checks
 * instead of RBAC.hasPermission() calls — exactly the anti-pattern
 * RBAC.gs's own file header forbids ("DO NOT: Write `if (actor.role ===
 * 'CEO')` in handlers — use hasPermission()"). Phase B1 fixes this by
 * routing all three through RBAC.hasPermission(), matching every other
 * flag in buildPerms_ (canCreateJob, canAssign, etc.).
 *
 * These tests exercise buildPerms_() indirectly through the public
 * getViewData(email) entry point (buildPerms_ itself is private), and
 * assert the perms object reflects RBAC.hasPermission()'s return value
 * — not the actor's raw role string — by stubbing hasPermission per
 * test case. Real RBAC.gs matrix values are covered separately in
 * tests/rbac.test.js; this file is about delegation, not the matrix.
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
  // gas-v3-staff-mocks.js's RBAC stub is scoped to Task 2's needs and
  // doesn't include SCOPES — buildPerms_'s canViewAll flag reads
  // RBAC.SCOPES.ALL/.TEAM directly, so it's added here.
  mocks.RBAC.SCOPES = { SELF: 'SELF', TEAM: 'TEAM', ACCOUNTS: 'ACCOUNTS', ALL: 'ALL' };
  // Same reasoning — BILLING_RUN not in the shared stub's ACTIONS list,
  // needed for the canRunBilling audit-fix tests below.
  mocks.RBAC.ACTIONS.BILLING_RUN = 'BILLING_RUN';
  // Same reasoning — needed for the canAmendWork/canVoidWork OR-widening
  // tests below (2026-09-04).
  mocks.RBAC.ACTIONS.WORK_LOG_AMEND = 'WORK_LOG_AMEND';
  mocks.RBAC.ACTIONS.WORK_LOG_VOID = 'WORK_LOG_VOID';
  mocks.RBAC.ACTIONS.WORK_LOG_CORRECTION_ADMIN = 'WORK_LOG_CORRECTION_ADMIN';
  loadSrc('../src/07-portal/PortalData.gs');
});

function actorFor(role) {
  mocks.RBAC.resolveActor = function (email) {
    return { email: email, role: role, personCode: 'X1', scope: 'ALL' };
  };
}

function getPerms(role, hasPermissionImpl) {
  actorFor(role);
  mocks.RBAC.hasPermission = hasPermissionImpl;
  const json = PortalData.getViewData('actor@test.blc.internal');
  return JSON.parse(json).perms;
}

describe('PortalData buildPerms_ — canRunPayroll/canApprovePayroll/canManageStaff via RBAC.hasPermission()', () => {
  test('canRunPayroll reflects RBAC.hasPermission(actor, PAYROLL_RUN), not the raw role string', () => {
    // A role that is NOT 'CEO' but for which hasPermission is stubbed
    // true — only possible to observe if the code actually delegates.
    const perms = getPerms('HR_ACCOUNTING', (actor, action) => action === 'PAYROLL_RUN');
    expect(perms.canRunPayroll).toBe(true);
  });

  test('canRunPayroll is false when RBAC.hasPermission denies it, even for role "CEO" spelled correctly', () => {
    // Proves the check isn't secretly still `role === 'CEO'` underneath —
    // if it were, this would incorrectly come back true.
    const perms = getPerms('CEO', () => false);
    expect(perms.canRunPayroll).toBe(false);
  });

  test('canApprovePayroll reflects RBAC.hasPermission(actor, PAYROLL_RUN), not the raw role string', () => {
    const perms = getPerms('HR_ACCOUNTING', (actor, action) => action === 'PAYROLL_RUN');
    expect(perms.canApprovePayroll).toBe(true);
  });

  test('canApprovePayroll is false when RBAC.hasPermission denies it, even for role "CEO"', () => {
    const perms = getPerms('CEO', () => false);
    expect(perms.canApprovePayroll).toBe(false);
  });

  test('canManageStaff reflects RBAC.hasPermission(actor, ADMIN_CONFIG), not the raw role string', () => {
    const perms = getPerms('HR_ACCOUNTING', (actor, action) => action === 'ADMIN_CONFIG');
    expect(perms.canManageStaff).toBe(true);
  });

  test('canManageStaff is false when RBAC.hasPermission denies it, even for role "ADMIN"', () => {
    const perms = getPerms('ADMIN', () => false);
    expect(perms.canManageStaff).toBe(false);
  });

  test('behavioral equivalence preserved for the real matrix shape: CEO gets all three, DESIGNER gets none', () => {
    // hasPermission here mirrors the REAL matrix's actual values for
    // PAYROLL_RUN/ADMIN_CONFIG (confirmed in rbac.test.js) — a
    // regression check that the fix didn't change today's behavior for
    // existing roles, only how it's computed.
    const ceoPerms = getPerms('CEO', (actor, action) =>
      action === 'PAYROLL_RUN' || action === 'ADMIN_CONFIG');
    expect(ceoPerms.canRunPayroll).toBe(true);
    expect(ceoPerms.canApprovePayroll).toBe(true);
    expect(ceoPerms.canManageStaff).toBe(true);

    const designerPerms = getPerms('DESIGNER', () => false);
    expect(designerPerms.canRunPayroll).toBe(false);
    expect(designerPerms.canApprovePayroll).toBe(false);
    expect(designerPerms.canManageStaff).toBe(false);

    const adminPerms = getPerms('ADMIN', (actor, action) => action === 'ADMIN_CONFIG');
    expect(adminPerms.canManageStaff).toBe(true);
    expect(adminPerms.canRunPayroll).toBe(false);
  });
});

describe('PortalData buildPerms_ — canRunBilling (RBAC audit finding, 2026-08-05)', () => {
  // Found via full RBAC audit: the "Run Billing" portal button was wired
  // to canRunPayroll (RBAC.ACTIONS.PAYROLL_RUN) instead of its own
  // RBAC.ACTIONS.BILLING_RUN — buildPerms_ needs its own canRunBilling
  // flag, independent of canRunPayroll, delegating to hasPermission()
  // like every other flag here (not the raw role string).
  //
  // Real matrix values (billing is CEO/ADMIN/HR_ACCOUNTING-only, PM
  // explicitly excluded per business decision 2026-08-05) are covered
  // in tests/rbac.test.js — this file is about delegation mechanics
  // only, so the role/stub combinations below are illustrative, not a
  // claim about real grants.
  test('canRunBilling reflects RBAC.hasPermission(actor, BILLING_RUN), independent of canRunPayroll', () => {
    const perms = getPerms('ADMIN', (actor, action) => action === 'BILLING_RUN');
    expect(perms.canRunBilling).toBe(true);
    expect(perms.canRunPayroll).toBe(false); // hasPermission stub only allows BILLING_RUN
  });

  test('canRunBilling is false when RBAC.hasPermission denies BILLING_RUN, even for CEO', () => {
    const perms = getPerms('CEO', () => false);
    expect(perms.canRunBilling).toBe(false);
  });

  test('canRunBilling is false for PM even when other billing-adjacent permissions are granted — no accidental fallback to role or canRunPayroll', () => {
    const perms = getPerms('PM', (actor, action) => action === 'PAYROLL_VIEW'); // BILLING_RUN deliberately not stubbed true
    expect(perms.canRunBilling).toBe(false);
  });
});

describe('PortalData buildPerms_ — canAmendWork/canVoidWork accept WORK_LOG_CORRECTION_ADMIN too (2026-09-04)', () => {
  // HR_ACCOUNTING gained the WORK_LOG_CORRECTION_ADMIN carve-out in
  // RBAC.gs (see rbac.test.js) so it can correct duplicate/erroneous
  // work-log hours — but buildPerms_'s canAmendWork/canVoidWork only
  // ever checked WORK_LOG_AMEND/WORK_LOG_VOID directly, so the Edit/Void
  // buttons would stay hidden for HR_ACCOUNTING even after the RBAC and
  // handler fixes. These flags must accept EITHER grant.
  test('canAmendWork is true when only WORK_LOG_CORRECTION_ADMIN is granted, not WORK_LOG_AMEND', () => {
    const perms = getPerms('HR_ACCOUNTING', (actor, action) => action === 'WORK_LOG_CORRECTION_ADMIN');
    expect(perms.canAmendWork).toBe(true);
  });

  test('canVoidWork is true when only WORK_LOG_CORRECTION_ADMIN is granted, not WORK_LOG_VOID', () => {
    const perms = getPerms('HR_ACCOUNTING', (actor, action) => action === 'WORK_LOG_CORRECTION_ADMIN');
    expect(perms.canVoidWork).toBe(true);
  });

  test('canAmendWork/canVoidWork stay true for DESIGNER via the original WORK_LOG_AMEND/VOID grant alone — unaffected by the OR-widening', () => {
    const perms = getPerms('DESIGNER', (actor, action) => action === 'WORK_LOG_AMEND' || action === 'WORK_LOG_VOID');
    expect(perms.canAmendWork).toBe(true);
    expect(perms.canVoidWork).toBe(true);
  });

  test('canAmendWork/canVoidWork are false when neither grant is present', () => {
    const perms = getPerms('CLIENT', () => false);
    expect(perms.canAmendWork).toBe(false);
    expect(perms.canVoidWork).toBe(false);
  });

  test('canAmendWork/canVoidWork stay false for role "QC" even with both grants stubbed true — the pre-existing QC/QC_REVIEWER carve-out is untouched', () => {
    const perms = getPerms('QC', () => true);
    expect(perms.canAmendWork).toBe(false);
    expect(perms.canVoidWork).toBe(false);
  });
});
