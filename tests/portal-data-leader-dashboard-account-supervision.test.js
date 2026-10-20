/**
 * portal-data-leader-dashboard-account-supervision.test.js
 *
 * 2026-10-20: Abhisek Rit (AR001) joined SBS in October under Sandy (SDA),
 * but only for his SBS work. His Nelson work stays with Deb/Sarty, and his
 * roster supervisor_code stays SGO. getLeaderDashboard()'s Team Hours scoped
 * a TEAM_LEAD's view by roster supervisor_code only, so Sandy never saw any
 * of AR001's hours.
 *
 * Fix: a TEAM_LEAD also sees the hours that REF_ACCOUNT_SUPERVISION assigns
 * to them, row by row, resolved the same way the supervisor bonus resolves it
 * (PayrollEngine.buildSupervisorBonusMapByAccount_). Matching is as of the
 * period's 1st day, and an exact-product row beats a wildcard row. Sandy's
 * Team Hours then equals what his supervisor bonus is paid on.
 */

const fs   = require('fs');
const path = require('path');

function loadSrc(relPath) {
  (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
}

var currentPeriod;

function installMocks() {
  var store = {};
  global.DAL = {
    readAll: function (tableName) { return (store[tableName] || []).slice(); }
  };
  global.Config = {
    TABLES: {
      DIM_STAFF_ROSTER:        'DIM_STAFF_ROSTER',
      FACT_WORK_LOGS:          'FACT_WORK_LOGS',
      MART_PAYROLL_SUMMARY:    'MART_PAYROLL_SUMMARY',
      FACT_QUARTERLY_BONUS:    'FACT_QUARTERLY_BONUS',
      REF_ACCOUNT_SUPERVISION: 'REF_ACCOUNT_SUPERVISION',
      VW_JOB_CURRENT_STATE:    'VW_JOB_CURRENT_STATE'
    }
  };
  global.RBAC = {
    ACTIONS: { PAYROLL_VIEW: 'PAYROLL_VIEW' },
    resolveActor: function () { return global.RBAC._actor; },
    hasPermission: function () { return false; },
    _actor: null
  };
  global.Identifiers = { generateCurrentPeriodId: function () { return currentPeriod; } };
  global.Logger = { info: function () {}, warn: function () {}, error: function () {} };
  return store;
}

let store;

beforeEach(() => {
  currentPeriod = '2026-10';
  store = installMocks();
  loadSrc('../src/06-handlers/TeamLeadScope.gs');
  loadSrc('../src/07-portal/PortalData.gs');

  store['DIM_STAFF_ROSTER'] = [
    { person_code: 'SDA',   name: 'Sandy',        role: 'TEAM_LEAD', supervisor_code: 'SGO', active: true },
    { person_code: 'PBG',   name: 'Roster Report', role: 'DESIGNER', supervisor_code: 'SDA', active: true },
    { person_code: 'AR001', name: 'Abhisek Rit',  role: 'DESIGNER',  supervisor_code: 'SGO', active: true },
    { person_code: 'XYZ',   name: 'Other SBS',    role: 'DESIGNER',  supervisor_code: 'BCH', active: true },
    { person_code: 'SGO',   name: 'Sarty',        role: 'PM',        supervisor_code: '',    active: true }
  ];
  store['VW_JOB_CURRENT_STATE'] = [
    { job_number: 'J-SBS',  client_code: 'SBS',    product_code: 'roof_truss' },
    { job_number: 'J-NEL',  client_code: 'NELSON', product_code: 'ROOF_TRUSS' }
  ];
  store['FACT_WORK_LOGS'] = [
    { actor_code: 'AR001', actor_role: 'DESIGNER', hours: 6, job_number: 'J-SBS', event_type: 'WORK_LOG_SUBMITTED' },
    { actor_code: 'AR001', actor_role: 'DESIGNER', hours: 4, job_number: 'J-NEL', event_type: 'WORK_LOG_SUBMITTED' },
    { actor_code: 'PBG',   actor_role: 'DESIGNER', hours: 3, job_number: 'J-NEL', event_type: 'WORK_LOG_SUBMITTED' },
    { actor_code: 'XYZ',   actor_role: 'DESIGNER', hours: 5, job_number: 'J-SBS', event_type: 'WORK_LOG_SUBMITTED' }
  ];
  // effective_from as a real Date object — Sheets returns Dates, not strings.
  store['REF_ACCOUNT_SUPERVISION'] = [
    { client_code: 'SBS',    product_code: '',           designer_code: 'AR001', supervisor_code: 'SDA', effective_from: new Date(2026, 9, 1), effective_to: '' },
    { client_code: 'NELSON', product_code: 'ROOF_TRUSS', designer_code: 'AR001', supervisor_code: 'DBS', effective_from: '2026-08-01', effective_to: '' },
    { client_code: 'SBS',    product_code: '',           designer_code: 'XYZ',   supervisor_code: 'BCH', effective_from: '2026-08-01', effective_to: '' }
  ];
});

function dashboardAs(role, personCode) {
  global.RBAC._actor = { email: 'a@test.blc.internal', role: role, personCode: personCode, scope: 'TEAM' };
  return JSON.parse(PortalData.getLeaderDashboard('a@test.blc.internal'));
}

function byCode(result) {
  var m = {};
  result.team_hours.forEach(function (e) { m[e.person_code] = e; });
  return m;
}

describe('getLeaderDashboard() — TEAM_LEAD sees account-supervised hours from REF_ACCOUNT_SUPERVISION', () => {
  test('Sandy sees only AR001\'s SBS hours (6), not his Nelson hours, plus roster reports in full', () => {
    const rows = byCode(dashboardAs('TEAM_LEAD', 'SDA'));
    expect(rows['AR001'].total_hours).toBe(6);
    expect(rows['AR001'].design_hours).toBe(6);
    expect(rows['PBG'].total_hours).toBe(3);
    expect(rows['XYZ']).toBeUndefined();
  });

  test('before the row\'s effective_from (September), Sandy does not see AR001', () => {
    currentPeriod = '2026-09';
    const rows = byCode(dashboardAs('TEAM_LEAD', 'SDA'));
    expect(rows['AR001']).toBeUndefined();
  });

  test('an exact-product row to another TL beats Sandy\'s wildcard row', () => {
    store['REF_ACCOUNT_SUPERVISION'].push(
      { client_code: 'SBS', product_code: 'ROOF_TRUSS', designer_code: 'AR001', supervisor_code: 'BCH', effective_from: '2026-10-01', effective_to: '' }
    );
    const rows = byCode(dashboardAs('TEAM_LEAD', 'SDA'));
    expect(rows['AR001']).toBeUndefined();
  });

  test('a closed row (effective_to before the period) no longer counts', () => {
    store['REF_ACCOUNT_SUPERVISION'][0].effective_to = new Date(2026, 8, 30);
    const rows = byCode(dashboardAs('TEAM_LEAD', 'SDA'));
    expect(rows['AR001']).toBeUndefined();
  });

  test('a TL with no account rows is unchanged (roster scoping only)', () => {
    const rows = byCode(dashboardAs('TEAM_LEAD', 'BCH'));
    expect(rows['XYZ'].total_hours).toBe(5);
    expect(rows['AR001']).toBeUndefined();
  });

  test('CEO still sees AR001\'s full total (10) — unscoped', () => {
    const rows = byCode(dashboardAs('CEO', 'CEO1'));
    expect(rows['AR001'].total_hours).toBe(10);
  });
});
