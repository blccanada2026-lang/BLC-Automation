/**
 * portal-data-leader-dashboard-payroll-status.test.js
 *
 * RBAC audit finding, 2026-08-05: PortalData.gs's getLeaderDashboard()
 * gated its payroll_status section with a hardcoded `role === 'CEO'`
 * check (PortalData.gs:505) instead of RBAC.hasPermission(actor,
 * PAYROLL_VIEW) — exactly the anti-pattern RBAC.gs's own file header
 * forbids. Per the real matrix, PM also has PAYROLL_VIEW:true, so PM
 * should see payroll_status too but didn't (fails safe — under-
 * privileged relative to the matrix, not a security leak, but an
 * inconsistency the Phase B1 canRunPayroll/canApprovePayroll/
 * canManageStaff fix should have caught in this function too).
 *
 * Fix: route through RBAC.hasPermission(actor, RBAC.ACTIONS.PAYROLL_VIEW),
 * matching every other flag in this codebase's RBAC-gated portal logic.
 */

const fs   = require('fs');
const path = require('path');

function loadSrc(relPath) {
  (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
}

function installMocks() {
  var store = {};

  global.DAL = {
    readAll: function (tableName) { return (store[tableName] || []).slice(); }
  };
  global.Config = {
    TABLES: {
      DIM_STAFF_ROSTER:     'DIM_STAFF_ROSTER',
      FACT_WORK_LOGS:       'FACT_WORK_LOGS',
      MART_PAYROLL_SUMMARY: 'MART_PAYROLL_SUMMARY',
      FACT_QUARTERLY_BONUS: 'FACT_QUARTERLY_BONUS'
    }
  };
  global.RBAC = {
    ACTIONS: { PAYROLL_VIEW: 'PAYROLL_VIEW' },
    resolveActor: function (email) { return global.RBAC._actor; },
    hasPermission: function () { return global.RBAC._hasPermission; },
    _actor: null,
    _hasPermission: false
  };
  global.Identifiers = { generateCurrentPeriodId: function () { return '2026-08'; } };
  global.Logger = { info: function () {}, warn: function () {}, error: function () {} };

  return store;
}

let store;

beforeEach(() => {
  store = installMocks();
  loadSrc('../src/07-portal/PortalData.gs');
  store['MART_PAYROLL_SUMMARY'] = [
    { period_id: '2026-08', person_code: 'X2', design_pay: 4000, qc_pay: 0, supervisor_bonus: 0, total_pay: 4000, status: 'PENDING_CONFIRMATION' }
  ];
});

function setActor(role, hasPayrollView) {
  global.RBAC._actor = { email: 'actor@test.blc.internal', role: role, personCode: 'X1', scope: 'ALL' };
  global.RBAC._hasPermission = hasPayrollView;
}

describe('getLeaderDashboard() — payroll_status gated by RBAC.hasPermission(PAYROLL_VIEW), not a hardcoded role', () => {
  test('PM with PAYROLL_VIEW granted sees payroll_status populated (previously always empty for non-CEO)', () => {
    setActor('PM', true);
    const result = JSON.parse(PortalData.getLeaderDashboard('actor@test.blc.internal'));
    expect(result.payroll_status.length).toBe(1);
    expect(result.payroll_status[0].person_code).toBe('X2');
  });

  test('CEO with PAYROLL_VIEW denied (stubbed false) does NOT get payroll_status populated — proves this is not secretly still role==="CEO"', () => {
    setActor('CEO', false);
    const result = JSON.parse(PortalData.getLeaderDashboard('actor@test.blc.internal'));
    expect(result.payroll_status).toEqual([]);
  });

  test('TEAM_LEAD with PAYROLL_VIEW denied does not see payroll_status (matches real matrix: TEAM_LEAD lacks PAYROLL_VIEW)', () => {
    setActor('TEAM_LEAD', false);
    const result = JSON.parse(PortalData.getLeaderDashboard('actor@test.blc.internal'));
    expect(result.payroll_status).toEqual([]);
  });
});
