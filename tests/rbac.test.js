/**
 * rbac.test.js
 *
 * Tests for the Phase B1 RBAC extension (payroll automation, HR_ACCOUNTING
 * role for Aarthi — access: PREPARE + REVIEW only, no commit authority).
 *
 * Two independent gates under test, matching RBAC.gs's own documented
 * shape (see its file header): enforcePermission() (matrix-driven,
 * PERMISSION_MATRIX[role][action]) and enforceFinancialAccess() (a
 * separate, previously hardcoded CEO/SYSTEM-only gate, now made
 * action-aware so HR_ACCOUNTING can pass on prepare/preview-class
 * actions while still being rejected on commit-class ones).
 *
 * Resolved decision under test (recorded in PAYROLL_AUTOMATION_
 * ARCHITECTURE.md before this code was written): HR_ACCOUNTING is
 * allowed PAYROLL_PREVIEW, BONUS_PREVIEW, TIMESHEET_GENERATE,
 * REPORT_GENERATE. CEO/SYSTEM-only: PAYROLL_COMMIT, BONUS_COMMIT,
 * APPROVE_ALL_PAYROLL.
 */

const fs   = require('fs');
const path = require('path');
const { installRbacMocks, seedRosterActor } = require('./gas-rbac-mocks');

function loadSrc(relPath) {
  (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
}

let mocks;

beforeEach(() => {
  mocks = installRbacMocks();
  loadSrc('../src/02-security/RBAC.gs');
});

describe('RBAC.PERMISSION_MATRIX — HR_ACCOUNTING role', () => {
  test('is a registered canonical role', () => {
    expect(RBAC.ROLES.HR_ACCOUNTING).toBe('HR_ACCOUNTING');
  });

  test('can perform PAYROLL_PREVIEW, BONUS_PREVIEW, TIMESHEET_GENERATE, REPORT_GENERATE', () => {
    expect(RBAC.canPerform('HR_ACCOUNTING', 'PAYROLL_PREVIEW')).toBe(true);
    expect(RBAC.canPerform('HR_ACCOUNTING', 'BONUS_PREVIEW')).toBe(true);
    expect(RBAC.canPerform('HR_ACCOUNTING', 'TIMESHEET_GENERATE')).toBe(true);
    expect(RBAC.canPerform('HR_ACCOUNTING', 'REPORT_GENERATE')).toBe(true);
  });

  test('cannot perform PAYROLL_COMMIT, BONUS_COMMIT, APPROVE_ALL_PAYROLL', () => {
    expect(RBAC.canPerform('HR_ACCOUNTING', 'PAYROLL_COMMIT')).toBe(false);
    expect(RBAC.canPerform('HR_ACCOUNTING', 'BONUS_COMMIT')).toBe(false);
    expect(RBAC.canPerform('HR_ACCOUNTING', 'APPROVE_ALL_PAYROLL')).toBe(false);
  });

  test('cannot perform PAYROLL_RUN — the existing, still-fused commit-shaped action stays CEO/SYSTEM-only', () => {
    // Left false deliberately: runPayrollRun()/runBonusRun()/approveAllPayroll()
    // are not touched in Phase B1 and still gate on PAYROLL_RUN internally.
    // Granting this here would show her portal buttons that then fail on
    // enforceFinancialAccess() — exactly the "looks broken" risk flagged
    // in Investigation 4 §4.5, item 1.
    expect(RBAC.canPerform('HR_ACCOUNTING', 'PAYROLL_RUN')).toBe(false);
  });

  test('cannot perform job-lifecycle, work-log, QC, billing, queue, admin, client, rating, or SOP actions', () => {
    var deniedActions = [
      'JOB_CREATE', 'JOB_ALLOCATE', 'JOB_START', 'JOB_HOLD', 'JOB_RESUME', 'JOB_VIEW',
      'WORK_LOG_SUBMIT', 'WORK_LOG_AMEND', 'WORK_LOG_VOID', 'WORK_LOG_REASSIGN',
      'QC_SUBMIT', 'QC_APPROVE', 'QC_REJECT',
      'BILLING_RUN', 'QUEUE_MODIFY', 'ADMIN_CONFIG', 'CLIENT_VIEW',
      'RATE_STAFF', 'SOP_SAVE', 'SOP_ADMIN'
    ];
    deniedActions.forEach(function (action) {
      expect(RBAC.canPerform('HR_ACCOUNTING', action)).toBe(false);
    });
  });

  test('can view payroll and export data', () => {
    expect(RBAC.canPerform('HR_ACCOUNTING', 'PAYROLL_VIEW')).toBe(true);
    expect(RBAC.canPerform('HR_ACCOUNTING', 'DATA_EXPORT')).toBe(true);
  });

  test('CEO and SYSTEM can perform every new action, existing roles are unaffected', () => {
    var newActions = ['PAYROLL_PREVIEW', 'PAYROLL_COMMIT', 'BONUS_PREVIEW', 'BONUS_COMMIT',
                       'APPROVE_ALL_PAYROLL', 'TIMESHEET_GENERATE', 'REPORT_GENERATE'];
    newActions.forEach(function (action) {
      expect(RBAC.canPerform('CEO', action)).toBe(true);
      expect(RBAC.canPerform('SYSTEM', action)).toBe(true);
      expect(RBAC.canPerform('DESIGNER', action)).toBe(false);
      expect(RBAC.canPerform('PM', action)).toBe(false);
    });
    // Existing, pre-Phase-B1 permissions unchanged — spot-check a few.
    expect(RBAC.canPerform('CEO', 'PAYROLL_RUN')).toBe(true);
    expect(RBAC.canPerform('PM', 'BILLING_RUN')).toBe(true);
    expect(RBAC.canPerform('PM', 'PAYROLL_RUN')).toBe(false);
    expect(RBAC.canPerform('DESIGNER', 'WORK_LOG_SUBMIT')).toBe(true);
  });
});

describe('RBAC.enforceFinancialAccess(actor, action) — action-aware', () => {
  function resolveHrActor() {
    seedRosterActor(mocks, { person_code: 'AAR', email: 'aarthirajeshnair@gmail.com', role: 'HR_ACCOUNTING' });
    return RBAC.resolveActor('aarthirajeshnair@gmail.com');
  }

  function resolveCeoActor() {
    // CEO resolves via PRIVILEGED_ACTORS, no roster row needed.
    return RBAC.resolveActor('raj.nair@bluelotuscanada.ca');
  }

  function resolveDesignerActor() {
    seedRosterActor(mocks, { person_code: 'DES1', email: 'designer1@test.blc.internal', role: 'DESIGNER' });
    return RBAC.resolveActor('designer1@test.blc.internal');
  }

  test('HR_ACCOUNTING passes for PAYROLL_PREVIEW, BONUS_PREVIEW, TIMESHEET_GENERATE, REPORT_GENERATE', () => {
    var actor = resolveHrActor();
    expect(() => RBAC.enforceFinancialAccess(actor, RBAC.ACTIONS.PAYROLL_PREVIEW)).not.toThrow();
    expect(() => RBAC.enforceFinancialAccess(actor, RBAC.ACTIONS.BONUS_PREVIEW)).not.toThrow();
    expect(() => RBAC.enforceFinancialAccess(actor, RBAC.ACTIONS.TIMESHEET_GENERATE)).not.toThrow();
    expect(() => RBAC.enforceFinancialAccess(actor, RBAC.ACTIONS.REPORT_GENERATE)).not.toThrow();
  });

  test('HR_ACCOUNTING is rejected for PAYROLL_COMMIT, BONUS_COMMIT, APPROVE_ALL_PAYROLL — specific denial reason, not just any throw', () => {
    var actor = resolveHrActor();
    expect(() => RBAC.enforceFinancialAccess(actor, RBAC.ACTIONS.PAYROLL_COMMIT))
      .toThrow(/FINANCIAL_ACCESS_DENIED/);
    expect(() => RBAC.enforceFinancialAccess(actor, RBAC.ACTIONS.BONUS_COMMIT))
      .toThrow(/FINANCIAL_ACCESS_DENIED/);
    expect(() => RBAC.enforceFinancialAccess(actor, RBAC.ACTIONS.APPROVE_ALL_PAYROLL))
      .toThrow(/FINANCIAL_ACCESS_DENIED/);
  });

  test('HR_ACCOUNTING is rejected when called with no action at all — the safe backward-compatible default', () => {
    var actor = resolveHrActor();
    expect(() => RBAC.enforceFinancialAccess(actor)).toThrow(/FINANCIAL_ACCESS_DENIED/);
  });

  test('CEO passes regardless of action, including with no action passed (existing call sites unchanged)', () => {
    var actor = resolveCeoActor();
    expect(() => RBAC.enforceFinancialAccess(actor)).not.toThrow();
    expect(() => RBAC.enforceFinancialAccess(actor, RBAC.ACTIONS.PAYROLL_COMMIT)).not.toThrow();
    expect(() => RBAC.enforceFinancialAccess(actor, RBAC.ACTIONS.PAYROLL_PREVIEW)).not.toThrow();
    expect(() => RBAC.enforceFinancialAccess(actor, 'SOMETHING_NOT_IN_THE_ALLOW_LIST')).not.toThrow();
  });

  test('SYSTEM passes regardless of action', () => {
    var actor = RBAC.resolveActor('system@blclotus.com');
    expect(() => RBAC.enforceFinancialAccess(actor)).not.toThrow();
    expect(() => RBAC.enforceFinancialAccess(actor, RBAC.ACTIONS.PAYROLL_COMMIT)).not.toThrow();
  });

  test('DESIGNER is rejected regardless of action — not just financial actions, not accidentally widened', () => {
    var actor = resolveDesignerActor();
    expect(() => RBAC.enforceFinancialAccess(actor)).toThrow(/FINANCIAL_ACCESS_DENIED/);
    expect(() => RBAC.enforceFinancialAccess(actor, RBAC.ACTIONS.PAYROLL_PREVIEW)).toThrow(/FINANCIAL_ACCESS_DENIED/);
    expect(() => RBAC.enforceFinancialAccess(actor, RBAC.ACTIONS.TIMESHEET_GENERATE)).toThrow(/FINANCIAL_ACCESS_DENIED/);
  });

  test('the denial error names the actor and role, same as before this change', () => {
    var actor = resolveHrActor();
    try {
      RBAC.enforceFinancialAccess(actor, RBAC.ACTIONS.PAYROLL_COMMIT);
      throw new Error('expected enforceFinancialAccess to throw');
    } catch (e) {
      expect(e.code).toBe('FINANCIAL_ACCESS_DENIED');
      expect(e.context.role).toBe('HR_ACCOUNTING');
      expect(e.context.email).toBe('aarthirajeshnair@gmail.com');
    }
  });
});

describe('RBAC.getDevTestActors_ (via resolveActor) — test-hr@test.blc.internal', () => {
  test('resolves to HR_ACCOUNTING only when Config.isDev() is true', () => {
    mocks.Config.isDev = () => true;
    var actor = RBAC.resolveActor('test-hr@test.blc.internal');
    expect(actor.role).toBe('HR_ACCOUNTING');
    expect(actor.personCode).toBe('THR');
  });

  test('does not resolve in PROD — falls back to the restricted UNKNOWN guest, not HR_ACCOUNTING', () => {
    mocks.Config.isDev = () => false;
    var actor = RBAC.resolveActor('test-hr@test.blc.internal');
    expect(actor.role).not.toBe('HR_ACCOUNTING');
    expect(actor.personCode).toBe('UNKNOWN');
  });
});
