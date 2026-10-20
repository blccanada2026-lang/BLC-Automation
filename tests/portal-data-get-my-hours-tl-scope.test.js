/**
 * portal-data-get-my-hours-tl-scope.test.js
 *
 * 2026-10-20: Sandy's (SDA) My Hours showed 13 people's entries, including
 * his PM (SGO) and a peer TL (BCH), because TEAM scope used shared-account
 * membership (buildTeamCodes_). Raj: My Hours must match Team Hours. A TL
 * sees own + direct reports + account-supervised entries only
 * (TeamLeadScope).
 */

const fs   = require('fs');
const path = require('path');

function loadSrc(relPath) {
  (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
}

let store;
let actorRole;

beforeEach(() => {
  store = {};
  actorRole = 'TEAM_LEAD';
  global.DAL = { readAll: function (t) { return (store[t] || []).slice(); } };
  global.Config = {
    TABLES: {
      DIM_STAFF_ROSTER:        'DIM_STAFF_ROSTER',
      FACT_WORK_LOGS:          'FACT_WORK_LOGS',
      VW_JOB_CURRENT_STATE:    'VW_JOB_CURRENT_STATE',
      FACT_PAYROLL_LEDGER:     'FACT_PAYROLL_LEDGER',
      REF_ACCOUNT_SUPERVISION: 'REF_ACCOUNT_SUPERVISION',
      REF_ACCOUNT_DESIGNER_MAP: 'REF_ACCOUNT_DESIGNER_MAP'
    }
  };
  global.RBAC = {
    SCOPES:  { SELF: 'SELF', TEAM: 'TEAM', ACCOUNTS: 'ACCOUNTS', ALL: 'ALL' },
    ACTIONS: { WORK_LOG_SUBMIT: 'WORK_LOG_SUBMIT', WORK_LOG_CORRECTION_ADMIN: 'WORK_LOG_CORRECTION_ADMIN' },
    resolveActor:      function (email) { return { email: email, role: actorRole, personCode: actorRole === 'TEAM_LEAD' ? 'SDA' : 'SGO' }; },
    hasPermission:     function () { return true; },
    enforcePermission: function () {},
    getScopeForRole:   function (role) { return role === 'TEAM_LEAD' ? 'TEAM' : 'ALL'; }
  };
  global.Identifiers = { generateCurrentPeriodId: function () { return '2026-10'; } };
  global.Logger = { info: function () {}, warn: function () {}, error: function () {} };
  loadSrc('../src/00-foundation/Constants.gs');
  loadSrc('../src/06-handlers/TeamLeadScope.gs');
  loadSrc('../src/07-portal/PortalData.gs');

  store['DIM_STAFF_ROSTER'] = [
    { person_code: 'SDA',   name: 'Sandy',   supervisor_code: 'SGO', active: true },
    { person_code: 'PBG',   name: 'Report',  supervisor_code: 'SDA', active: true },
    { person_code: 'AR001', name: 'Abhisek', supervisor_code: 'SGO', active: true },
    { person_code: 'BCH',   name: 'Peer TL', supervisor_code: 'SGO', active: true },
    { person_code: 'SGO',   name: 'Sarty',   supervisor_code: '',    active: true }
  ];
  // Everyone shares SBS — this is what used to leak into Sandy's view.
  store['REF_ACCOUNT_DESIGNER_MAP'] = ['SDA', 'PBG', 'AR001', 'BCH', 'SGO'].map(function (c) {
    return { client_code: 'SBS', designer_code: c };
  });
  store['REF_ACCOUNT_SUPERVISION'] = [
    { client_code: 'SBS', product_code: '', designer_code: 'AR001', supervisor_code: 'SDA', effective_from: '2026-10-01', effective_to: '' }
  ];
  store['VW_JOB_CURRENT_STATE'] = [
    { job_number: 'J-SBS', client_code: 'SBS',    product_code: 'ROOF_TRUSS', current_state: 'IN_PROGRESS' },
    { job_number: 'J-NEL', client_code: 'NELSON', product_code: 'ROOF_TRUSS', current_state: 'IN_PROGRESS' }
  ];
  function wl(code, job, hrs) {
    return { event_id: code + job, actor_code: code, job_number: job, hours: hrs, work_date: '2026-10-10', event_type: 'WORK_LOG_SUBMITTED', notes: '' };
  }
  store['FACT_WORK_LOGS'] = [
    wl('SDA', 'J-SBS', 5), wl('PBG', 'J-NEL', 3), wl('AR001', 'J-SBS', 6),
    wl('AR001', 'J-NEL', 4), wl('BCH', 'J-SBS', 7), wl('SGO', 'J-SBS', 2)
  ];
});

function myHours() {
  return JSON.parse(PortalData.getMyHours('x@test.blc.internal'));
}

describe('getMyHours — TEAM_LEAD sees the same set as Team Hours', () => {
  test('Sandy sees own, direct report, and AR001\'s SBS entry only — not SGO, BCH or AR001\'s Nelson entry', () => {
    const ids = myHours().entries.map(function (e) { return e.event_id; }).sort();
    expect(ids).toEqual(['AR001J-SBS', 'PBGJ-NEL', 'SDAJ-SBS']);
  });

  test('total_hours is still the caller\'s own hours only', () => {
    expect(myHours().total_hours).toBe(5);
  });

  test('PM/ALL scope is unchanged — sees every entry', () => {
    actorRole = 'PM';
    expect(myHours().entries.length).toBe(6);
  });
});
